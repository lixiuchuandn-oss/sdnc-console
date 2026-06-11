import fs from 'fs';
import path from 'path';

import {
  ensureImageDownloadTempRoot,
  getImageDownloadTempRoot,
} from './towerTempPaths';
import { formatStorageBytes, getPathAvailableBytes } from './imageUploadStorage';

export { ensureImageDownloadTempRoot, getImageDownloadTempRoot };

export function imageDownloadTaskAbsPath(task: {
  id: string;
  localFileRelPath?: string | null;
}): string {
  const rel = String(task.localFileRelPath || '').trim() || `${task.id}.download`;
  return path.join(getImageDownloadTempRoot(), rel);
}

export async function checkImageDownloadDiskSpace(
  estimatedBytes: number,
): Promise<{
  path: string;
  freeBytes: number;
  requiredBytes: number;
  sufficient: boolean;
  message: string;
}> {
  const dir = ensureImageDownloadTempRoot();
  const required = Math.max(0, Math.floor(Number(estimatedBytes) || 0));
  let freeBytes = 0;
  try {
    freeBytes = await getPathAvailableBytes(dir);
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e || '');
    return {
      path: dir,
      freeBytes: 0,
      requiredBytes: required,
      sufficient: false,
      message: `无法读取 Tower 镜像下载暂存目录磁盘空间：${detail}`,
    };
  }
  const sufficient = required < 1 || freeBytes >= required;
  const message = sufficient
    ? '磁盘空间充足'
    : `Tower 镜像下载暂存目录空间不足（${dir}）：需约 ${formatStorageBytes(required)}，当前可用 ${formatStorageBytes(freeBytes)}`;
  return { path: dir, freeBytes, requiredBytes: required, sufficient, message };
}

export function cleanupImageDownloadFile(absPath: string): void {
  try {
    if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
  } catch {
    /* ignore */
  }
}
