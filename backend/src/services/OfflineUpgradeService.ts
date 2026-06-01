/**
 * 离线升级包解压与合并逻辑。
 * 包格式、目录约定与发布侧说明见仓库：`deployment/docs/specs/offline-upgrade-bundle.md`
 */
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { execSync, spawn } from 'child_process';
import { getSystemSetting, setSystemSetting } from '../config/systemSettings';
import { logger } from '../utils/logger';
import { resolveStaticPublicRoot as resolveStaticPublicRootFromDir } from '../utils/resolveStaticPublicRoot';

const log = logger.child('OfflineUpgrade');

const LAST_KEY = 'tower.offline_upgrade_last';

function assertSafeZipEntryName(name: string): void {
  const norm = name.replace(/\\/g, '/').replace(/^\uFEFF/, '');
  if (!norm || norm.startsWith('/')) throw new Error(`非法压缩包路径: ${name}`);
  for (const seg of norm.split('/')) {
    if (seg === '..') throw new Error(`非法压缩包路径: ${name}`);
  }
}

/** 将 zip 内条目解压到 destDir，拒绝路径穿越 */
function extractZipSafely(zipPath: string, destDir: string): void {
  const zip = new AdmZip(zipPath);
  fs.mkdirSync(destDir, { recursive: true });
  const rootResolved = path.resolve(destDir);
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const raw = entry.entryName.replace(/\\/g, '/');
    assertSafeZipEntryName(raw);
    const target = path.join(destDir, ...raw.split('/'));
    const resolved = path.resolve(target);
    if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
      throw new Error('压缩包内存在非法路径');
    }
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, entry.getData());
  }
}

function findBackendPackageJsonPath(): string {
  let d = path.resolve(__dirname);
  for (let i = 0; i < 10; i++) {
    const p = path.join(d, 'package.json');
    if (fs.existsSync(p)) {
      try {
        const j = JSON.parse(fs.readFileSync(p, 'utf8')) as { name?: string };
        if (j.name === 'compute-tower-backend') return p;
      } catch {
        /* continue */
      }
    }
    const parent = path.dirname(d);
    if (parent === d) break;
    d = parent;
  }
  throw new Error('无法定位后端 package.json');
}

/** 与 index.ts 静态托管目录一致（本文件在 services/ 子目录，须用共享解析） */
function resolveStaticPublicRoot(): string {
  return resolveStaticPublicRootFromDir(__dirname);
}

/** 后端构建输出目录（backend/dist），离线包 server/ 内容合并到此 */
function resolveServerDeployRoot(): string {
  const backendRoot = path.dirname(findBackendPackageJsonPath());
  const distDir = path.join(backendRoot, 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  return distDir;
}

/** 部署根目录（含 package.json、public/、dist/） */
function resolveAppDeployRoot(): string {
  return path.dirname(findBackendPackageJsonPath());
}

/** 整目录替换，避免 cpSync 合并残留旧前端 chunk */
function replaceDirectoryTree(src: string, dest: string): void {
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

/** dist/public 若存在会抢在应用根 public 之前被误用（见 index.ts 注释）；升级后删除 */
function removeStaleDistPublic(): void {
  const distPublic = path.join(resolveServerDeployRoot(), 'public');
  if (fs.existsSync(distPublic)) {
    fs.rmSync(distPublic, { recursive: true, force: true });
    log.info('已删除过时的 dist/public');
  }
}

function shouldAutoRestartAfterUpgrade(): boolean {
  const v = process.env.TOWER_AUTO_RESTART_ON_UPGRADE?.trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'no') return false;
  return true;
}

function resolveAutoRestartCmd(): string {
  const custom = process.env.TOWER_AUTO_RESTART_CMD?.trim();
  if (custom) return custom;
  return 'pm2 restart compute-tower';
}

/** 在 HTTP 响应返回后再重启，避免 apply 请求被进程退出打断 */
function schedulePostUpgradeRestart(): void {
  if (!shouldAutoRestartAfterUpgrade()) {
    log.info('TOWER_AUTO_RESTART_ON_UPGRADE 已关闭，跳过自动重启');
    return;
  }
  const cmd = resolveAutoRestartCmd();
  const cwd = resolveAppDeployRoot();
  setTimeout(() => {
    try {
      log.info('升级后自动重启:', cmd, 'cwd=', cwd);
      const child = spawn(cmd, {
        shell: true,
        detached: true,
        stdio: 'ignore',
        cwd,
        env: process.env,
      });
      child.unref();
    } catch (e) {
      log.warn('升级后自动重启调度失败:', e instanceof Error ? e.message : String(e));
    }
  }, 1000);
}

export type OfflineUpgradeStatus = {
  runtimeVersion: string;
  lastApplied: {
    at: string;
    manifestVersion?: string;
    appliedPublic: boolean;
    appliedServer: boolean;
  } | null;
};

export type OfflineUpgradeApplyResult = {
  manifestVersion?: string;
  appliedPublic: boolean;
  appliedServer: boolean;
  /** 兼容旧前端：自动重启已调度时为 false */
  needsRestart: boolean;
  autoRestartScheduled?: boolean;
  message: string;
};

function readLastApplied(): OfflineUpgradeStatus['lastApplied'] {
  const raw = getSystemSetting(LAST_KEY);
  if (!raw || !String(raw).trim()) return null;
  try {
    const o = JSON.parse(String(raw)) as OfflineUpgradeStatus['lastApplied'];
    if (o && typeof o.at === 'string') return o;
  } catch {
    /* ignore */
  }
  return null;
}

export class OfflineUpgradeService {
  /**
   * `runtimeVersion` = `backend/package.json` 的 `version`（权威口径见仓库根 `AGENTS.md`「版本管理」）。
   */
  static getStatus(): OfflineUpgradeStatus {
    const pkgPath = findBackendPackageJsonPath();
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
    return {
      runtimeVersion: String(pkg.version || 'unknown'),
      lastApplied: readLastApplied(),
    };
  }

  /**
   * 从已落盘的 zip 文件应用离线包。
   * 约定：根目录可选 manifest.json（{ "version": "x.y.z" }）；须至少含 public/ 或 server/ 之一。
   */
  static applyFromZipFile(zipPath: string): OfflineUpgradeApplyResult {
    const staging = path.join(
      path.dirname(zipPath),
      `extract-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    );
    try {
      extractZipSafely(zipPath, staging);

      const manifestPath = path.join(staging, 'manifest.json');
      let manifestVersion: string | undefined;
      if (fs.existsSync(manifestPath)) {
        try {
          const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { version?: string };
          if (m.version != null) manifestVersion = String(m.version);
        } catch {
          throw new Error('manifest.json 格式无效');
        }
      }

      const publicSrc = path.join(staging, 'public');
      const serverSrc = path.join(staging, 'server');
      const hasPublic = fs.existsSync(publicSrc) && fs.statSync(publicSrc).isDirectory();
      const hasServer = fs.existsSync(serverSrc) && fs.statSync(serverSrc).isDirectory();
      if (!hasPublic && !hasServer) {
        throw new Error('离线包内须至少包含 public/ 或 server/ 目录之一');
      }

      let appliedPublic = false;
      let appliedServer = false;

      if (hasPublic) {
        const dest = resolveStaticPublicRoot();
        replaceDirectoryTree(publicSrc, dest);
        removeStaleDistPublic();
        appliedPublic = true;
        log.info('已替换离线包 public/ →', dest);
        const stampPath = path.join(dest, '.tower-build-stamp.json');
        if (!fs.existsSync(stampPath)) {
          log.warn('升级后未找到 public/.tower-build-stamp.json，请确认 zip 为最新构建');
        }
      }

      if (hasServer) {
        const dest = resolveServerDeployRoot();
        fs.mkdirSync(dest, { recursive: true });
        fs.cpSync(serverSrc, dest, { recursive: true });
        appliedServer = true;
        log.info('已合并离线包 server/ →', dest);
        // 同步 package.json version（展示用；与 AGENTS.md 版本口径一致）
        const pkgInZip = path.join(staging, 'package.json');
        if (fs.existsSync(pkgInZip)) {
          try {
            fs.copyFileSync(pkgInZip, path.join(resolveAppDeployRoot(), 'package.json'));
          } catch (e) {
            log.warn('同步 package.json 失败:', e instanceof Error ? e.message : String(e));
          }
        }
      }

      const hook = process.env.TOWER_POST_UPGRADE_CMD?.trim();
      if (hook) {
        try {
          execSync(hook, { stdio: 'pipe', timeout: 120_000, cwd: process.cwd(), env: process.env });
          log.info('TOWER_POST_UPGRADE_CMD 已执行');
        } catch (e) {
          log.warn('TOWER_POST_UPGRADE_CMD 执行失败:', e instanceof Error ? e.message : String(e));
        }
      }

      const at = new Date().toISOString();
      let stampBuiltAt: string | undefined;
      let stampFeatures: string[] | undefined;
      if (appliedPublic) {
        const stampPath = path.join(resolveStaticPublicRoot(), '.tower-build-stamp.json');
        if (fs.existsSync(stampPath)) {
          try {
            const st = JSON.parse(fs.readFileSync(stampPath, 'utf8')) as {
              builtAt?: string;
              features?: string[];
            };
            stampBuiltAt = st.builtAt;
            stampFeatures = Array.isArray(st.features) ? st.features : undefined;
          } catch {
            /* ignore */
          }
        }
      }

      setSystemSetting(
        LAST_KEY,
        JSON.stringify({
          at,
          manifestVersion,
          appliedPublic,
          appliedServer,
          stampBuiltAt,
          stampFeatures,
        }),
      );

      const filesUpdated = appliedPublic || appliedServer;
      const autoRestartEnabled = filesUpdated && shouldAutoRestartAfterUpgrade();
      if (autoRestartEnabled) {
        schedulePostUpgradeRestart();
      }

      const stampHint =
        stampBuiltAt != null
          ? ` 前端包构建时间：${stampBuiltAt}。`
          : appliedPublic
            ? ' 未检测到 public/.tower-build-stamp.json，请确认 zip 为最新构建。'
            : '';
      let message: string;
      if (!filesUpdated) {
        message = `已记录升级；请刷新浏览器。${stampHint}`;
      } else if (autoRestartEnabled) {
        message = `文件已更新，后台服务正在自动重启，约数秒后请刷新页面（Ctrl+F5）。${stampHint}`;
      } else {
        message = `文件已更新。请务必执行 pm2 restart compute-tower 后 Ctrl+F5 强刷。${stampHint}`;
      }

      return {
        manifestVersion,
        appliedPublic,
        appliedServer,
        needsRestart: filesUpdated && !autoRestartEnabled,
        autoRestartScheduled: autoRestartEnabled,
        message,
      };
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }
}
