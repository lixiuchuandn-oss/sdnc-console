/**
 * 镜像上传任务：Tower 本地暂存文件（分片目录、.merged）的收集与清理。
 */
import fs from 'fs';
import path from 'path';

import { AppDataSource } from '../../../../../config/database';
import { ImageUploadTask } from '../../../../../entities/harvester/ImageUploadTask';
import {
  getImageUploadTempRoot,
  imageUploadTaskMergedAbsPath,
} from '../../../../../utils/imageUploadStorage';
import {
  hasImageUploadProxyRun,
  isUploadTaskTransferInFlight,
  queueDeferredImageUploadCleanup,
  takeDeferredImageUploadCleanupPaths,
  waitForImageUploadProxyIdle,
} from '../imageUploadRuntime';
import { imageUploadTaskLog, releaseStaleUploadTaskInFlight } from './imageUploadTask.helpers';

/** 清扫长期失败/已取消任务的 Tower 暂存，避免磁盘堆积 */
const STALE_FAILED_UPLOAD_STAGING_MS = 7 * 24 * 60 * 60 * 1000;

export function imageTaskMergedRelPath(taskId: string): string {
  return `${taskId}.merged`;
}

export function imageTaskMergedAbsPath(task: ImageUploadTask): string {
  return imageUploadTaskMergedAbsPath(task);
}

/** 创建任务时预分配 .merged，分片按偏移直写，无需末尾再合并 */
export async function ensureImageUploadMergedPreallocated(task: ImageUploadTask): Promise<string> {
  const relPath = imageTaskMergedRelPath(task.id);
  const absPath = path.join(getImageUploadTempRoot(), relPath);
  await fs.promises.mkdir(path.dirname(absPath), { recursive: true });
  const size = Math.max(0, Math.floor(Number(task.fileSize) || 0));
  const fh = await fs.promises.open(absPath, 'w');
  try {
    if (size > 0) await fh.truncate(size);
  } finally {
    await fh.close();
  }
  return relPath;
}

export function collectImageUploadTaskFilePaths(task: ImageUploadTask): {
  legacyChunkDir: string;
  mergedAbsPaths: string[];
} {
  const root = getImageUploadTempRoot();
  const legacyChunkDir = path.join(root, 'chunks', task.id);
  const mergedAbsPaths: string[] = [];
  const rel = String(task.localFileRelPath || '').trim();
  if (rel) mergedAbsPaths.push(path.join(root, rel));
  mergedAbsPaths.push(path.join(root, `${task.id}.merged`));
  return { legacyChunkDir, mergedAbsPaths: [...new Set(mergedAbsPaths)] };
}

function cleanupImageUploadLegacyChunkDir(legacyChunkDir: string): void {
  try {
    if (fs.existsSync(legacyChunkDir)) fs.rmSync(legacyChunkDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function unlinkImageUploadPaths(absPaths: string[]): void {
  for (const abs of absPaths) {
    try {
      if (!fs.existsSync(abs)) continue;
      fs.unlinkSync(abs);
      if (fs.existsSync(abs)) {
        imageUploadTaskLog.warn('staging file still exists after unlink', { path: abs });
      }
    } catch (e: any) {
      imageUploadTaskLog.warn('failed to unlink staging file', {
        path: abs,
        err: e?.message || e,
      });
    }
  }
}

export function cleanupImageUploadTaskFiles(task: ImageUploadTask): void {
  const { legacyChunkDir, mergedAbsPaths } = collectImageUploadTaskFilePaths(task);
  cleanupImageUploadLegacyChunkDir(legacyChunkDir);
  unlinkImageUploadPaths(mergedAbsPaths);
}

/** 代传进行中时 defer unlink，待读流关闭后再删，避免 (deleted) 占盘 */
export async function scheduleImageUploadTaskFilesCleanup(task: ImageUploadTask): Promise<void> {
  const { legacyChunkDir, mergedAbsPaths } = collectImageUploadTaskFilePaths(task);
  cleanupImageUploadLegacyChunkDir(legacyChunkDir);
  if (isUploadTaskTransferInFlight(task.id) || hasImageUploadProxyRun(task.id)) {
    queueDeferredImageUploadCleanup(task.id, mergedAbsPaths);
    return;
  }
  unlinkImageUploadPaths(mergedAbsPaths);
}

export function flushDeferredImageUploadCleanup(taskId: string): void {
  unlinkImageUploadPaths(takeDeferredImageUploadCleanupPaths(taskId));
}

export async function finalizeImageUploadTaskFilesCleanup(taskId: string): Promise<void> {
  await waitForImageUploadProxyIdle(taskId);
  flushDeferredImageUploadCleanup(taskId);
}

/** 底座已导入完成或任务 success 后：删除 .merged / 分片暂存并清 DB 路径 */
export async function purgeImageUploadTaskStagingFiles(task: ImageUploadTask): Promise<void> {
  releaseStaleUploadTaskInFlight(task);
  const { mergedAbsPaths } = collectImageUploadTaskFilePaths(task);
  const before = mergedAbsPaths.filter((p) => fs.existsSync(p));
  await scheduleImageUploadTaskFilesCleanup(task);
  await finalizeImageUploadTaskFilesCleanup(task.id);
  await clearImageUploadTaskLocalFileRelPath(task.id);
  const remaining = mergedAbsPaths.filter((p) => fs.existsSync(p));
  if (before.length > 0) {
    imageUploadTaskLog.info('purge image upload staging files', {
      taskId: task.id,
      removed: before.filter((p) => !remaining.includes(p)),
      remaining,
    });
  }
}

/** 清扫长期失败/已取消任务的 Tower 暂存，避免磁盘堆积 */
export async function sweepStaleImageUploadStagingFiles(cloudId: string): Promise<void> {
  const cid = String(cloudId || '').trim();
  if (!cid) return;
  const repo = AppDataSource.getRepository(ImageUploadTask);
  const tasks = await repo.find({
    where: { cloudId: cid },
    order: { updatedAt: 'DESC' },
    take: 200,
  });
  const now = Date.now();
  for (const task of tasks) {
    if (isUploadTaskTransferInFlight(task.id) || hasImageUploadProxyRun(task.id)) continue;
    const st = String(task.taskStatus || '').toLowerCase();
    if (st === 'cancelled') {
      try {
        await purgeImageUploadTaskStagingFiles(task);
      } catch {
        /* ignore */
      }
      continue;
    }
    if (st === 'failed') {
      const ts = task.finishedAt?.getTime() || task.updatedAt?.getTime() || 0;
      if (ts > 0 && now - ts >= STALE_FAILED_UPLOAD_STAGING_MS) {
        try {
          await purgeImageUploadTaskStagingFiles(task);
        } catch {
          /* ignore */
        }
      }
    }
    if (
      task.expiresAt &&
      task.expiresAt.getTime() < now &&
      ['pending', 'ingesting'].includes(st)
    ) {
      try {
        await scheduleImageUploadTaskFilesCleanup(task);
      } catch {
        /* ignore */
      }
    }
  }
}

async function clearImageUploadTaskLocalFileRelPath(taskId: string): Promise<void> {
  try {
    const repo = AppDataSource.getRepository(ImageUploadTask);
    const task = await repo.findOne({ where: { id: taskId } });
    if (task?.localFileRelPath) {
      task.localFileRelPath = undefined;
      await repo.save(task);
    }
  } catch {
    /* ignore */
  }
}

export function cleanupImageUploadLocalFile(localPath?: string): void {
  if (!localPath) return;
  try {
    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
  } catch {
    /* ignore */
  }
}
