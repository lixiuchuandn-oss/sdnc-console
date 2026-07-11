import fs from 'fs';
import path from 'path';
import { resolveBackendRoot } from './resolveBackendRoot';

/**
 * SDNC 暂存/上传文件根目录。
 *
 * 环境变量：
 * - `TOWER_TEMP_ROOT`：统一根目录
 *
 * 默认：`{backend 包根}/data`（与 data.sqlite 同级）
 * - `{root}/temp_uploads` — 离线升级包等 Multer 上传
 */
export function getTowerTempRoot(): string {
  const custom = String(process.env.TOWER_TEMP_ROOT || '').trim();
  if (custom) return path.resolve(custom);
  return path.join(resolveBackendRoot(), 'data');
}

/** 通用 Multer 上传暂存目录（离线升级等） */
export function getTowerGeneralUploadTempRoot(): string {
  return path.join(getTowerTempRoot(), 'temp_uploads');
}

export function ensureDir(dir: string): string {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function ensureTowerTempRoot(): string {
  return ensureDir(getTowerTempRoot());
}

export function ensureTowerGeneralUploadTempRoot(): string {
  return ensureDir(getTowerGeneralUploadTempRoot());
}
