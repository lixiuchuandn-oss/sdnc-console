/**
 * 离线升级包解压与合并逻辑。
 * 包格式、目录约定与发布侧说明见仓库：`deployment/docs/specs/offline-upgrade-bundle.md`
 */
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { execSync } from 'child_process';
import { getSystemSetting, setSystemSetting } from '../config/systemSettings';
import { logger } from '../utils/logger';

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

/** 与 index.ts 一致的静态资源根（前端构建产物） */
function resolveStaticPublicRoot(): string {
  const nestedPublicPath = path.join(__dirname, '../public');
  const appRootPublicPath = path.join(__dirname, '../../public');
  if (fs.existsSync(appRootPublicPath)) return appRootPublicPath;
  return nestedPublicPath;
}

/** 后端构建输出目录（backend/dist），离线包 server/ 内容合并到此 */
function resolveServerDeployRoot(): string {
  const backendRoot = path.dirname(findBackendPackageJsonPath());
  const distDir = path.join(backendRoot, 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  return distDir;
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
  needsRestart: boolean;
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
        fs.mkdirSync(dest, { recursive: true });
        fs.cpSync(publicSrc, dest, { recursive: true });
        appliedPublic = true;
        log.info('已合并离线包 public/ →', dest);
      }

      if (hasServer) {
        const dest = resolveServerDeployRoot();
        fs.mkdirSync(dest, { recursive: true });
        fs.cpSync(serverSrc, dest, { recursive: true });
        appliedServer = true;
        log.info('已合并离线包 server/ →', dest);
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
      setSystemSetting(
        LAST_KEY,
        JSON.stringify({
          at,
          manifestVersion,
          appliedPublic,
          appliedServer,
        }),
      );

      const needsRestart = appliedServer;
      const message = needsRestart
        ? '服务端文件已更新，请重启后端进程后生效；若仅更新了前端静态资源，刷新浏览器即可。'
        : '静态资源已更新，请刷新浏览器；若浏览器仍加载旧脚本，可强制刷新或清空缓存。';

      return {
        manifestVersion,
        appliedPublic,
        appliedServer,
        needsRestart,
        message,
      };
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }
}
