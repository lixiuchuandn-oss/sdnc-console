import fs from 'fs';
import path from 'path';
import { resolveBackendRoot } from './resolveBackendRoot';

/**
 * Tower 暂存/上传文件根目录。
 *
 * 环境变量（优先级从高到低）：
 * - `TOWER_TEMP_ROOT`：统一根目录，其下按用途分子目录
 * - `IMAGE_UPLOAD_TEMP_ROOT`：仅覆盖镜像分片上传目录（兼容旧配置）
 *
 * 默认：`{backend 包根}/data`（与 data.sqlite 同级，须在 backend 目录启动）
 * - `{root}/image-upload-tasks` — 浏览器镜像分片上传
 * - `{root}/temp_uploads` — 离线升级包、安全日志等 Multer 上传
 */
export function getTowerTempRoot(): string {
  const custom = String(process.env.TOWER_TEMP_ROOT || '').trim();
  if (custom) return path.resolve(custom);
  return path.join(resolveBackendRoot(), 'data');
}

/** 镜像分片上传落盘目录 */
export function getImageUploadTempRoot(): string {
  const legacy = String(process.env.IMAGE_UPLOAD_TEMP_ROOT || '').trim();
  if (legacy) return path.resolve(legacy);
  return path.join(getTowerTempRoot(), 'image-upload-tasks');
}

/** 通用 Multer 上传暂存目录（离线升级、安全日志等） */
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

export function ensureImageUploadTempRoot(): string {
  return ensureDir(getImageUploadTempRoot());
}

export function ensureTowerGeneralUploadTempRoot(): string {
  return ensureDir(getTowerGeneralUploadTempRoot());
}
