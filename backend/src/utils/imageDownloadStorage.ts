import fs from 'fs';
import path from 'path';

import {
  ensureImageDownloadTempRoot,
  getImageDownloadTempRoot,
} from './towerTempPaths';
import { getPathAvailableBytes } from './imageUploadStorage';

export { ensureImageDownloadTempRoot, getImageDownloadTempRoot };

export function imageDownloadTaskAbsPath(task: {
  id: string;
  localFileRelPath?: string | null;
}): string {
  const rel = String(task.localFileRelPath || '').trim() || `${task.id}.download`;
  return path.join(getImageDownloadTempRoot(), rel);
}

/** 镜像下载：仅校验 Tower 剩余空间是否低于该阈值（不与镜像体积比较） */
export const IMAGE_DOWNLOAD_MIN_FREE_BYTES = 10 * 1024 ** 3;

export async function checkImageDownloadDiskSpace(): Promise<{
  path: string;
  freeBytes: number;
  minFreeBytes: number;
  sufficient: boolean;
  message: string;
}> {
  const dir = ensureImageDownloadTempRoot();
  const minFreeBytes = IMAGE_DOWNLOAD_MIN_FREE_BYTES;
  let freeBytes = 0;
  try {
    freeBytes = await getPathAvailableBytes(dir);
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e || '');
    return {
      path: dir,
      freeBytes: 0,
      minFreeBytes,
      sufficient: false,
      message: `无法读取 Tower 镜像下载暂存目录磁盘空间：${detail}`,
    };
  }
  const sufficient = freeBytes >= minFreeBytes;
  const message = sufficient
    ? '磁盘空间充足'
    : '平台空间不足';
  return { path: dir, freeBytes, minFreeBytes, sufficient, message };
}

export function cleanupImageDownloadFile(absPath: string): void {
  try {
    if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
  } catch {
    /* ignore */
  }
}
