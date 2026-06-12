/**
 * 镜像下载：底座 GET download → Tower 暂存文件。
 */
import fs from 'fs';
import path from 'path';

import { AppDataSource } from '../../../../../config/database';
import { ImageDownloadTask } from '../../../../../entities/harvester/ImageDownloadTask';
import { streamHarvesterGetToFile } from '../../../../../services/clouds/harvester/harvesterImageStreamDownload';
import { upsertHarvesterImageInventoryItems } from '../../../../../services/clouds/harvester/inventory';
import {
  fetchHarvesterVmImageDetailFromCluster,
  isVolumeExportedVmImage,
  patchHarvesterVmImageStatusSize,
} from '../../../../../services/clouds/harvester/vmImageClusterApi';
import {
  guessVmImageDownloadFilename,
  pickHarvesterDownloadErrorMessage,
  resolveDownloadUrlFromVmImagePayload,
  resolveVmImageDownloadLinkCandidates,
} from '../../../../../services/clouds/harvester/vmImageDownload';
import { ensureHarvesterVmImageDownloaderReady } from '../../../../../services/clouds/harvester/vmImageDownloader';
import { logger } from '../../../../../utils/logger';
import {
  cleanupImageDownloadFile,
  imageDownloadTaskAbsPath,
} from '../../../../../utils/imageDownloadStorage';
import { harvesterConn } from './imageUploadTask.helpers';
import {
  abortImageDownloadTask,
  clearImageDownloadAbort,
  registerImageDownloadAbort,
} from '../imageDownloadRuntime';

const downloadLog = logger.child('image-download-task');

function clampProgress(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.floor(n)));
}

export async function runImageDownloadTask(
  taskId: string,
  cloud: any,
  opts?: { downloadLink?: string; imageType?: string; diskFormat?: string },
): Promise<void> {
  const repo = AppDataSource.getRepository(ImageDownloadTask);
  const task = await repo.findOne({ where: { id: taskId } });
  if (!task) return;

  const abortController = registerImageDownloadAbort(taskId);
  const absPath = imageDownloadTaskAbsPath(task);

  try {
    task.taskStatus = 'fetching';
    task.startedAt = task.startedAt || new Date();
    task.progress = 0;
    task.bytesDownloaded = 0;
    task.errorMessage = undefined;
    await repo.save(task);

    const conn = harvesterConn(cloud);
    let downloadLink = String(opts?.downloadLink || '').trim();
    if (!downloadLink) {
      try {
        const detail = await fetchHarvesterVmImageDetailFromCluster(
          cloud,
          task.namespace,
          task.imageName,
          conn.insecure,
        );
        downloadLink = resolveDownloadUrlFromVmImagePayload(detail) || '';
      } catch {
        downloadLink = '';
      }
    }
    const urls = await resolveVmImageDownloadLinkCandidates(
      cloud,
      task.namespace,
      task.imageName,
      downloadLink,
    );
    downloadLog.info('download start', {
      taskId,
      namespace: task.namespace,
      imageName: task.imageName,
      endpoint: cloud?.endpoint || cloud?.config?.endpoint,
      downloadLink: downloadLink || undefined,
      urls,
    });

    await ensureHarvesterVmImageDownloaderReady(cloud, task.namespace, task.imageName, {
      signal: abortController.signal,
      onWaiting: () => {
        downloadLog.info('waiting vm image downloader', {
          taskId,
          namespace: task.namespace,
          imageName: task.imageName,
        });
      },
    });

    let lastProgressAt = 0;
    let lastSavedProgress = 0;
    let result: { bytesWritten: number; contentLength?: number } | null = null;
    const errors: Error[] = [];

    for (const url of urls) {
      try {
        result = await streamHarvesterGetToFile({
          url,
          token: conn.token,
          insecure: conn.insecure,
          destPath: absPath,
          signal: abortController.signal,
          onProgress: (received, totalHint) => {
            const now = Date.now();
            if (now - lastProgressAt < 800) return;
            lastProgressAt = now;
            let pct = 0;
            if (totalHint && totalHint > 0) {
              pct = clampProgress((received / totalHint) * 100);
            } else if (task.fileSize && task.fileSize > 0) {
              pct = clampProgress((received / task.fileSize) * 100);
            }
            if (pct <= lastSavedProgress && received === task.bytesDownloaded) return;
            lastSavedProgress = pct;
            task.bytesDownloaded = received;
            task.progress = pct;
            void repo.save(task).catch(() => undefined);
          },
        });
        break;
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        errors.push(err);
        downloadLog.warn('download url failed', {
          taskId,
          url,
          err: err.message,
        });
        try {
          if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
        } catch {
          /* ignore */
        }
      }
    }

    if (!result) {
      throw new Error(pickHarvesterDownloadErrorMessage(errors));
    }

    const current = await repo.findOne({ where: { id: taskId } });
    if (!current) return;
    if (current.taskStatus === 'cancelled') {
      cleanupImageDownloadFile(absPath);
      return;
    }

    current.bytesDownloaded = result.bytesWritten;
    current.fileSize = result.contentLength || result.bytesWritten || current.fileSize;
    current.progress = 100;
    current.taskStatus = 'ready';
    current.finishedAt = new Date();
    current.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    if (!current.filename) {
      current.filename = guessVmImageDownloadFilename(
        current.displayName || '',
        current.imageName,
        opts?.imageType,
        opts?.diskFormat,
      );
    }
    await repo.save(current);
    downloadLog.info('download ready', { taskId, bytes: result.bytesWritten });

    const actualFileBytes = (() => {
      try {
        if (fs.existsSync(absPath)) return fs.statSync(absPath).size;
      } catch {
        /* ignore */
      }
      return result.bytesWritten;
    })();

    if (actualFileBytes > 0) {
      try {
        const detail = await fetchHarvesterVmImageDetailFromCluster(
          cloud,
          current.namespace,
          current.imageName,
          conn.insecure,
        );
        if (isVolumeExportedVmImage(detail)) {
          const cloudId = String(cloud?.id || '').trim();
          let patched: unknown = null;
          try {
            patched = await patchHarvesterVmImageStatusSize(
              cloud,
              current.namespace,
              current.imageName,
              actualFileBytes,
              conn.insecure,
            );
          } catch (patchErr) {
            downloadLog.warn('patch export image status.size failed', {
              taskId,
              err: patchErr instanceof Error ? patchErr.message : String(patchErr),
            });
          }
          if (cloudId) {
            const toStore =
              patched && typeof patched === 'object'
                ? patched
                : {
                    ...(detail && typeof detail === 'object' ? detail : {}),
                    status: {
                      ...(detail && typeof detail === 'object' && detail.status
                        ? detail.status
                        : {}),
                      size: actualFileBytes,
                    },
                  };
            await upsertHarvesterImageInventoryItems(cloudId, [toStore]);
          }
          downloadLog.info('export image status.size synced', {
            taskId,
            bytes: actualFileBytes,
            namespace: current.namespace,
            imageName: current.imageName,
          });
        }
      } catch (e) {
        downloadLog.warn('export image size sync skipped', {
          taskId,
          err: e instanceof Error ? e.message : String(e),
        });
      }
    }
  } catch (e: unknown) {
    const err = e as { message?: string };
    const msg = String(err?.message || e || '下载失败');
    cleanupImageDownloadFile(absPath);
    const current = await repo.findOne({ where: { id: taskId } });
    if (!current) return;
    if (msg === 'CANCELLED' || current.taskStatus === 'cancelled') {
      current.taskStatus = 'cancelled';
      current.finishedAt = new Date();
      await repo.save(current);
      return;
    }
    current.taskStatus = 'failed';
    current.errorMessage = msg;
    current.finishedAt = new Date();
    await repo.save(current);
    downloadLog.warn('download failed', { taskId, err: msg });
  } finally {
    clearImageDownloadAbort(taskId);
  }
}

export function cancelImageDownloadTaskRun(taskId: string): void {
  abortImageDownloadTask(taskId);
}

export function sanitizeDownloadTask(task: ImageDownloadTask): Record<string, unknown> {
  return {
    id: task.id,
    cloudId: task.cloudId,
    namespace: task.namespace,
    imageName: task.imageName,
    displayName: task.displayName,
    filename: task.filename,
    fileSize: task.fileSize,
    bytesDownloaded: task.bytesDownloaded,
    taskStatus: task.taskStatus,
    progress: task.progress,
    errorMessage: task.errorMessage,
    createdBy: task.createdBy,
    expiresAt: task.expiresAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}
