/**
 * 镜像下载任务 HTTP handlers（底座 → Tower → 浏览器）。
 */
import fs from 'fs';
import path from 'path';
import { Request, Response } from 'express';

import {
  AppDataSource,
  ensureImageDownloadTaskTable,
} from '../../../../../config/database';
import { HarvesterImageInventory } from '../../../../../entities/harvester/HarvesterImageInventory';
import { ImageDownloadTask } from '../../../../../entities/harvester/ImageDownloadTask';
import {
  readVmImageVirtualSizeBytes,
  fetchHarvesterVmImageDetailFromCluster,
} from '../../../../../services/clouds/harvester/vmImageClusterApi';
import {
  guessVmImageDownloadFilename,
  requestHarvesterVmImageDownloadCancel,
  resolveDownloadCancelUrlFromVmImagePayload,
} from '../../../../../services/clouds/harvester/vmImageDownload';
import {
  checkImageDownloadDiskSpace,
  cleanupImageDownloadFile,
  ensureImageDownloadTempRoot,
  imageDownloadTaskAbsPath,
} from '../../../../../utils/imageDownloadStorage';
import { isImageDownloadInFlight } from '../imageDownloadRuntime';
import {
  assertImageDownloadConcurrencyAllowed,
  isImageDownloadConcurrencyLimitError,
} from './imageDownloadConcurrency';
import {
  cancelImageDownloadTaskRun,
  runImageDownloadTask,
  sanitizeDownloadTask,
} from './imageDownloadTask.pipeline';

function parseRange(rangeHeader: string | undefined, fileSize: number): {
  start: number;
  end: number;
} | null {
  if (!rangeHeader || !rangeHeader.startsWith('bytes=')) return null;
  const m = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!m) return null;
  let start = m[1] ? Number(m[1]) : 0;
  let end = m[2] ? Number(m[2]) : fileSize - 1;
  if (!Number.isFinite(start) || start < 0) start = 0;
  if (!Number.isFinite(end) || end >= fileSize) end = fileSize - 1;
  if (start > end) return null;
  return { start, end };
}

async function assertDownloadTaskAccess(
  req: Request,
  cloudId: string,
  taskId: string,
): Promise<ImageDownloadTask | null> {
  const user = (req as any)?.user;
  const userId = String(user?.id || '');
  const role = String(user?.role || '');
  const isAdmin = ['super_admin', 'admin'].includes(role);
  const repo = AppDataSource.getRepository(ImageDownloadTask);
  const task = await repo.findOne({ where: { id: taskId, cloudId } });
  if (!task) return null;
  if (!isAdmin && task.createdBy !== userId) return null;
  return task;
}

/**
 * POST /:id/resources/harvester/images/download-tasks
 */
export async function harvesterImageDownloadTaskCreateHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const body = (req.body || {}) as Record<string, unknown>;
    const namespace = String(body.namespace || '').trim();
    const imageName = String(body.imageName || body.name || '').trim();
    const displayName = String(body.displayName || '').trim();
    const downloadLink = String(body.downloadLink || '').trim();
    const imageType = String(body.imageType || '').trim();
    const diskFormat = String(body.diskFormat || '').trim();

    if (!namespace) return res.status(400).json({ message: '缺少参数：namespace' });
    if (!imageName) return res.status(400).json({ message: '缺少参数：imageName' });

    const userId = String((req as any)?.user?.id || '');
    if (!userId) return res.status(401).json({ message: '未登录或用户无效' });

    await ensureImageDownloadTaskTable();
    ensureImageDownloadTempRoot();

    const imageRepo = AppDataSource.getRepository(HarvesterImageInventory);
    const inv = await imageRepo.findOne({
      where: { cloudId: id, namespace, name: imageName },
    });
    const raw = (inv?.rawData || {}) as Record<string, unknown>;
    const spec = (raw.spec || {}) as Record<string, unknown>;
    const links = (raw.links || {}) as Record<string, string>;
    const resolvedDisplay =
      displayName || inv?.displayName || String(spec.displayName || '').trim() || imageName;
    const resolvedLink = downloadLink || String(links.download || '').trim();
    const resolvedImageType = imageType || String(spec.imageType || '').trim();
    const resolvedDiskFormat = diskFormat || String(spec.diskFormat || '').trim();
    const sizeHint =
      Math.max(
        0,
        Math.floor(
          Number(inv?.size || 0) ||
            Number((raw.status as Record<string, unknown>)?.size || 0) ||
            readVmImageVirtualSizeBytes(raw) ||
            0,
        ),
      ) || 0;

    const disk = await checkImageDownloadDiskSpace();
    if (!disk.sufficient) {
      return res.status(507).json({ message: disk.message, data: disk });
    }

    try {
      await assertImageDownloadConcurrencyAllowed(id);
    } catch (limitErr: unknown) {
      if (isImageDownloadConcurrencyLimitError(limitErr)) {
        return res.status(429).json({
          message: limitErr.message,
          code: limitErr.code,
          data: { activeCount: limitErr.activeCount },
        });
      }
      throw limitErr;
    }

    const filename = guessVmImageDownloadFilename(
      resolvedDisplay,
      imageName,
      resolvedImageType,
      resolvedDiskFormat,
    );
    const relPath = `${cryptoRandomId()}.download`;
    const absPath = path.join(ensureImageDownloadTempRoot(), relPath);
    await fs.promises.writeFile(absPath, Buffer.alloc(0));

    const repo = AppDataSource.getRepository(ImageDownloadTask);
    const now = new Date();
    const task = repo.create({
      cloudId: id,
      namespace,
      imageName,
      displayName: resolvedDisplay,
      filename,
      fileSize: sizeHint > 0 ? sizeHint : undefined,
      localFileRelPath: relPath,
      bytesDownloaded: 0,
      taskStatus: 'pending',
      progress: 0,
      createdBy: userId,
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    });
    const saved = await repo.save(task);
    const cloud = (req as any).cloud;

    void runImageDownloadTask(saved.id, cloud, {
      downloadLink: resolvedLink,
      imageType: resolvedImageType,
      diskFormat: resolvedDiskFormat,
    }).catch((e) => {
      console.warn('[image-download-task]', saved.id, e?.message || e);
    });

    res.status(202).json({
      message: '下载任务已创建',
      data: sanitizeDownloadTask(saved),
    });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '创建下载任务失败', error: error.message });
  }
}

function cryptoRandomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * GET /:id/resources/harvester/images/download-tasks - 查询下载任务列表
 */
export async function harvesterImageDownloadTaskListHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const user = (req as any)?.user;
    const userId = String(user?.id || '');
    const role = String(user?.role || '');
    const isAdmin = ['super_admin', 'admin'].includes(role);
    const limit = Math.max(1, Math.min(100, Number((req.query as any)?.limit || 100)));

    await ensureImageDownloadTaskTable();
    const repo = AppDataSource.getRepository(ImageDownloadTask);
    const where = isAdmin ? { cloudId: id } : { cloudId: id, createdBy: userId };
    const tasks = await repo.find({
      where: where as any,
      order: { createdAt: 'DESC' },
      take: limit,
    });
    res.json({ message: '查询成功', data: { items: tasks.map(sanitizeDownloadTask) } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询下载任务列表失败', error: error.message });
  }
}

/**
 * GET /:id/resources/harvester/images/download-tasks/:taskId
 */
export async function harvesterImageDownloadTaskGetHandler(req: Request, res: Response) {
  try {
    const { id, taskId } = req.params;
    const task = await assertDownloadTaskAccess(req, id, taskId);
    if (!task) return res.status(404).json({ message: '任务不存在或无权访问' });
    res.json({ message: '查询成功', data: sanitizeDownloadTask(task) });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询下载任务失败', error: error.message });
  }
}

import { harvesterConn } from './imageUploadTask.helpers';

async function requestClusterImageDownloadCancel(
  cloud: any,
  task: ImageDownloadTask,
): Promise<void> {
  if (!cloud) return;
  let linksDownloadCancel: string | undefined;
  try {
    const conn = harvesterConn(cloud);
    const detail = await fetchHarvesterVmImageDetailFromCluster(
      cloud,
      task.namespace,
      task.imageName,
      conn.insecure,
    );
    linksDownloadCancel = resolveDownloadCancelUrlFromVmImagePayload(detail);
  } catch {
    /* fallback to canonical Steve URL */
  }
  await requestHarvesterVmImageDownloadCancel(cloud, task.namespace, task.imageName, {
    linksDownloadCancel,
  });
}

/**
 * POST /:id/resources/harvester/images/download-tasks/:taskId/cancel
 */
export async function harvesterImageDownloadTaskCancelHandler(req: Request, res: Response) {
  try {
    const { id, taskId } = req.params;
    const task = await assertDownloadTaskAccess(req, id, taskId);
    if (!task) return res.status(404).json({ message: '任务不存在或无权访问' });

    const repo = AppDataSource.getRepository(ImageDownloadTask);
    if (task.taskStatus === 'fetching' || task.taskStatus === 'pending') {
      cancelImageDownloadTaskRun(taskId);
      try {
        await requestClusterImageDownloadCancel((req as any).cloud, task);
      } catch (clusterErr: unknown) {
        const detail =
          clusterErr instanceof Error ? clusterErr.message : String(clusterErr || '未知错误');
        console.warn('[image-download-task] cluster downloadcancel failed', {
          taskId,
          namespace: task.namespace,
          imageName: task.imageName,
          err: detail,
        });
      }
      task.taskStatus = 'cancelled';
      task.finishedAt = new Date();
      await repo.save(task);
      cleanupImageDownloadFile(imageDownloadTaskAbsPath(task));
    }
    res.json({ message: '已取消', data: sanitizeDownloadTask(task) });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '取消下载失败', error: error.message });
  }
}

/**
 * DELETE /:id/resources/harvester/images/download-tasks/:taskId
 */
export async function harvesterImageDownloadTaskDeleteHandler(req: Request, res: Response) {
  try {
    const { id, taskId } = req.params;
    const task = await assertDownloadTaskAccess(req, id, taskId);
    if (!task) return res.status(404).json({ message: '任务不存在或无权访问' });
    if (isImageDownloadInFlight(taskId)) {
      return res.status(409).json({ message: '任务进行中，请先取消' });
    }
    cleanupImageDownloadFile(imageDownloadTaskAbsPath(task));
    await AppDataSource.getRepository(ImageDownloadTask).delete({ id: taskId, cloudId: id });
    res.json({ message: '删除成功' });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '删除下载任务失败', error: error.message });
  }
}

/**
 * GET /:id/resources/harvester/images/download-tasks/:taskId/file
 */
export async function harvesterImageDownloadTaskFileHandler(req: Request, res: Response) {
  try {
    const { id, taskId } = req.params;
    const task = await assertDownloadTaskAccess(req, id, taskId);
    if (!task) return res.status(404).json({ message: '任务不存在或无权访问' });
    if (task.taskStatus !== 'ready') {
      return res.status(409).json({ message: '文件尚未就绪', data: sanitizeDownloadTask(task) });
    }

    const absPath = imageDownloadTaskAbsPath(task);
    if (!fs.existsSync(absPath)) {
      return res.status(404).json({ message: '暂存文件不存在或已过期' });
    }

    const stat = await fs.promises.stat(absPath);
    const fileSize = stat.size;
    const filename = String(task.filename || `${task.imageName}.qcow2`).replace(/[/\\]/g, '_');

    if (req.method === 'HEAD') {
      res.setHeader('Content-Length', String(fileSize));
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Accept-Ranges', 'bytes');
      return res.status(200).end();
    }

    const range = parseRange(req.headers.range, fileSize);
    if (range) {
      const { start, end } = range;
      const chunkSize = end - start + 1;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', String(chunkSize));
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(filename)}"`,
      );
      const stream = fs.createReadStream(absPath, { start, end });
      stream.pipe(res);
      return;
    }

    res.setHeader('Content-Length', String(fileSize));
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(filename)}"`,
    );
    fs.createReadStream(absPath).pipe(res);
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '下载文件失败', error: error.message });
  }
}
