import fs from 'fs';
import path from 'path';
import { ensureImageUploadTempRoot, getImageUploadTempRoot } from './towerTempPaths';

export { ensureImageUploadTempRoot, getImageUploadTempRoot };

export type ImageUploadDiskCheckResult = {
  path: string;
  freeBytes: number;
  requiredBytes: number;
  sufficient: boolean;
  message: string;
};

/** 任务合并文件在暂存目录上的绝对路径（分片直写 .merged） */
export function imageUploadTaskMergedAbsPath(task: {
  id: string;
  localFileRelPath?: string | null;
}): string {
  const rel = String(task.localFileRelPath || '').trim() || `${task.id}.merged`;
  return path.join(getImageUploadTempRoot(), rel);
}

export function formatStorageBytes(bytes: number): string {
  const n = Math.max(0, Math.floor(Number(bytes) || 0));
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GiB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MiB`;
  if (n >= 1024) return `${Math.ceil(n / 1024)} KiB`;
  return `${n} B`;
}

/**
 * 镜像上传在暂存目录上的峰值占用：分片按偏移直写单一 .merged 文件，峰值约 fileSize。
 */
export function computeImageUploadPeakDiskBytes(fileSize: number, _chunkSize?: number): number {
  return Math.max(0, Math.floor(Number(fileSize) || 0));
}

/** 读取目录所在文件系统可用空间（bavail * bsize） */
export async function getPathAvailableBytes(targetPath: string): Promise<number> {
  const root = path.resolve(targetPath);
  const probe = fs.existsSync(root) ? root : path.dirname(root);
  ensureImageUploadTempRoot();
  const st = await fs.promises.statfs(probe);
  const bsize = Number(st.bsize) || 4096;
  const bavail = Number(st.bavail) || 0;
  return Math.max(0, Math.floor(bsize * bavail));
}

export async function checkImageUploadDiskSpace(
  fileSize: number,
  chunkSize?: number,
): Promise<ImageUploadDiskCheckResult> {
  const dir = ensureImageUploadTempRoot();
  const size = Math.max(0, Math.floor(Number(fileSize) || 0));
  const required = computeImageUploadPeakDiskBytes(size, chunkSize);
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
      message: `无法读取 Tower 镜像暂存目录磁盘空间：${detail}`,
    };
  }
  const sufficient = required < 1 || freeBytes >= required;
  const message = sufficient
    ? '磁盘空间充足'
    : `Tower 镜像暂存目录空间不足（${dir}）：需约 ${formatStorageBytes(required)}，当前可用 ${formatStorageBytes(freeBytes)}`;
  return { path: dir, freeBytes, requiredBytes: required, sufficient, message };
}
