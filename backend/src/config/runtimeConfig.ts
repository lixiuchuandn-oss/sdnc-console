import fs from 'fs';
import path from 'path';

/**
 * 运行期路径配置（原 Dify 集成已下线，仅保留安全日志/报告目录等存储路径）。
 * 兼容：若仍存在 `data/dify-config.cfg`，会读取其中的 logsDir / reportsDir。
 */
type StoragePaths = {
  logsDir: string;
  reportsDir: string;
};

const dataDir = path.join(process.cwd(), 'data');
const legacyDifyCfgPath = path.join(dataDir, 'dify-config.cfg');

function defaultPaths(): StoragePaths {
  return {
    logsDir: process.env.SECURITY_LOGS_DIR || path.join(dataDir, 'security-logs'),
    reportsDir: process.env.SECURITY_REPORTS_DIR || path.join(dataDir, 'security-reports'),
  };
}

let storage: StoragePaths = defaultPaths();

try {
  if (fs.existsSync(legacyDifyCfgPath)) {
    const raw = fs.readFileSync(legacyDifyCfgPath, 'utf-8');
    const json = JSON.parse(raw) as Partial<StoragePaths>;
    if (json.logsDir && typeof json.logsDir === 'string') storage.logsDir = json.logsDir;
    if (json.reportsDir && typeof json.reportsDir === 'string') storage.reportsDir = json.reportsDir;
  }
} catch {
  /* ignore */
}

export function getSecurityLogsDir(): string {
  return storage.logsDir;
}

export function getSecurityReportsDir(): string {
  return storage.reportsDir;
}

export function getPaths() {
  return { dataDir, legacyDifyCfgPath };
}
