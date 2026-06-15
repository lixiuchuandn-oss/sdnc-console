/**
 * 镜像上传任务 HTTP handlers（任务 CRUD、分片、代传入口、upload-proxy/token）。
 */
import fs from 'fs';
import path from 'path';
import { Request, Response } from 'express';
import multer from 'multer';

import {
  AppDataSource,
  ensureImageUploadTaskTable,
  ensureImageUploadTaskTableColumns,
} from '../../../../../config/database';
import { ImageUploadTask } from '../../../../../entities/harvester/ImageUploadTask';
import { syncHarvesterImages } from '../../../../../services/clouds/harvester/inventory';
import { fetchHarvesterVmImageDetailFromCluster } from '../../../../../services/clouds/harvester/vmImageClusterApi';
import { probeQcow2VirtualSizeFromPaths } from '../../../../../services/clouds/harvester/qcow2VirtualSize';
import {
  assertGlobalImageTaskSlot,
  isGlobalImageUploadBusyError,
  requestDeclaresLocalChunkedUpload,
  respondGlobalImageUploadBusy,
} from '../imageUploadGlobalConcurrency';
import {
  checkImageUploadDiskSpace,
  ensureImageUploadTempRoot,
  getImageUploadTempRoot,
} from '../../../../../utils/imageUploadStorage';
import {
  destroyImageUploadBodyReadable,
  getImageUploadInFlightTaskIds,
  hasImageUploadProxyRun,
} from '../imageUploadRuntime';
import {
  abortUploadTask,
  formatImageUploadTaskError,
  isCancelError,
} from './imageUploadTask.helpers';
import {
  assertImageUploadTaskAccess,
  isUploadTaskDeleteBlockedByPolicy,
  removeImageUploadTaskRecord,
} from './imageUploadTask.access';
import {
  markUploadTaskSuccessFromCluster,
  prepareClusterImageForUploadRetry,
  reconcileUploadTasksWithInventory,
  resolveHarvesterOrigin,
} from './imageUploadTask.reconcile';
import {
  ensureImageUploadMergedPreallocated,
  finalizeImageUploadTaskFilesCleanup,
  imageTaskMergedAbsPath,
  imageTaskMergedRelPath,
  scheduleImageUploadTaskFilesCleanup,
  sweepStaleImageUploadStagingFiles,
} from './imageUploadTask.staging';
import { ingestOctetStreamToTempFile, runImageUploadTask } from './imageUploadProxy.pipeline';
import {
  IMAGE_UPLOAD_DEFAULT_CHUNK_SIZE,
  IMAGE_UPLOAD_MAX_CHUNK_SIZE,
  chunkWriteOffset,
  computeTotalChunks,
  expectedChunkByteSize,
  parseReceivedChunkIndices,
  persistChunkReceivedIndices,
  reconcileReceivedChunkIndices,
  sanitizeTask,
  setReceivedChunkIndices,
  writeChunkToMergedFile,
} from './imageUploadTask.chunks';

export { IMAGE_UPLOAD_DEFAULT_CHUNK_SIZE, IMAGE_UPLOAD_MAX_CHUNK_SIZE } from './imageUploadTask.chunks';

// Harvester 镜像上传任务：multer 落盘目录、并发去重、取消用 AbortController
ensureImageUploadTempRoot();
const imageTaskUpload = multer({ dest: getImageUploadTempRoot() });

function globalImageTaskSlotOpts(excludeTaskId?: string) {
  return { excludeTaskId, inFlightTaskIds: getImageUploadInFlightTaskIds() };
}

/**
 * POST /:id/resources/harvester/images/upload-proxy
 * 单次 multipart：namespace、displayName、imageType、file；等价于「创建 upload-task + POST .../file」。
 * tools/uploader 等客户端通过 Tower 代理上传时使用此路径。
 */
export async function harvesterImageUploadProxyHandler(req: Request, res: Response) {
  imageTaskUpload.single('file')(req, res, async (err: any) => {
    try {
      if (err)
        return res
          .status(400)
          .json({ message: '文件接收失败', error: err?.message || String(err) });
      const { id } = req.params;
      const userId = String((req as any)?.user?.id || '');
      if (!userId) return res.status(401).json({ message: '未登录或用户无效' });

      const namespace = String((req.body as any)?.namespace || '').trim();
      const displayName = String((req.body as any)?.displayName || '').trim();
      const imageType = String((req.body as any)?.imageType || '').trim();
      if (!namespace) return res.status(400).json({ message: '缺少参数：namespace' });

      const cloud = (req as any).cloud;
      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file) return res.status(400).json({ message: '缺少上传文件，字段名应为 file' });

      const repo = AppDataSource.getRepository(ImageUploadTask);
      const now = new Date();
      const expires = new Date(now.getTime() + 30 * 60 * 1000);
      const task = repo.create({
        cloudId: id,
        namespace,
        displayName: displayName || undefined,
        imageType: imageType || undefined,
        taskStatus: 'pending',
        phase: 'pending',
        progress: 0,
        ingestProgress: 0,
        proxyProgress: 0,
        bytesUploaded: 0,
        createdBy: userId,
        expiresAt: expires,
        retryCount: 0,
      });
      const saved = await repo.save(task);

      saved.filename = file.originalname;
      saved.fileSize = file.size;
      saved.taskStatus = 'ingesting';
      saved.phase = 'ingesting';
      saved.ingestProgress = 100;
      saved.progress = 1;
      saved.bytesUploaded = 0;
      saved.startedAt = saved.startedAt || new Date();
      saved.errorCode = undefined;
      saved.errorMessage = undefined;
      await repo.save(saved);

      void runImageUploadTask(saved.id, cloud, file.path).catch((err) => {
        console.warn('[image-upload-proxy]', saved.id, err?.message || err);
      });

      res.status(202).json({
        message: '文件已接收，任务执行中',
        data: { taskId: saved.id, status: saved.taskStatus, phase: saved.phase },
      });
    } catch (error: any) {
      if (res.headersSent) return;
      if (isGlobalImageUploadBusyError(error)) {
        respondGlobalImageUploadBusy(res, error);
        return;
      }
      res.status(500).json({ message: '代理上传失败', error: error.message });
    }
  });
}

/**
 * POST /:id/resources/harvester/images/upload-tasks - 创建上传任务
 */
async function saveImageUploadTaskRecord(task: ImageUploadTask): Promise<ImageUploadTask> {
  const repo = AppDataSource.getRepository(ImageUploadTask);
  try {
    return await repo.save(task);
  } catch (first: any) {
    const msg = String(first?.message || first || '');
    if (!/no column named/i.test(msg) && !/has no column/i.test(msg)) {
      throw first;
    }
    await ensureImageUploadTaskTable();
    await ensureImageUploadTaskTableColumns();
    return await repo.save(task);
  }
}

export async function harvesterImageUploadTaskDiskCheckHandler(req: Request, res: Response) {
  try {
    const fileSize = Math.max(0, Math.floor(Number(req.query?.fileSize) || 0));
    if (fileSize < 1) {
      return res.status(400).json({ message: '缺少参数：fileSize' });
    }
    const chunkSize = Math.max(0, Math.floor(Number(req.query?.chunkSize) || 0));
    const result = await checkImageUploadDiskSpace(fileSize, chunkSize > 0 ? chunkSize : undefined);
    if (!result.sufficient) {
      return res.status(507).json({ message: result.message, data: result });
    }
    return res.json({ message: result.message, data: result });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '检查磁盘空间失败', error: error.message });
  }
}

export async function harvesterImageUploadTaskCreateHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { namespace, displayName, imageType, filename, fileSize, chunkSize } = (req.body ||
      {}) as Record<string, unknown>;
    if (!namespace) return res.status(400).json({ message: '缺少参数：namespace' });
    const size = Math.max(0, Math.floor(Number(fileSize) || 0));
    if (size < 1) {
      return res.status(400).json({ message: '缺少参数：fileSize（分片上传需声明文件大小）' });
    }

    const cs = Math.max(
      1024 * 1024,
      Math.min(
        IMAGE_UPLOAD_MAX_CHUNK_SIZE,
        Math.floor(Number(chunkSize) || IMAGE_UPLOAD_DEFAULT_CHUNK_SIZE),
      ),
    );
    const totalChunks = computeTotalChunks(size, cs);

    const diskCheck = await checkImageUploadDiskSpace(size, cs);
    if (!diskCheck.sufficient) {
      return res.status(507).json({ message: diskCheck.message, data: diskCheck });
    }

    const userId = String((req as any)?.user?.id || '');
    if (!userId) return res.status(401).json({ message: '未登录或用户无效' });

    if (!AppDataSource.isInitialized) {
      return res.status(503).json({ message: '数据库未就绪，请稍后重试' });
    }

    try {
      await ensureImageUploadTaskTable();
      await ensureImageUploadTaskTableColumns();
    } catch (schemaErr: any) {
      const detail = schemaErr?.message || String(schemaErr);
      console.error('[image-upload-task-create] schema init failed:', detail, schemaErr);
      return res.status(500).json({
        message: '上传任务表初始化失败',
        error: detail,
      });
    }

    if (requestDeclaresLocalChunkedUpload((req.body || {}) as Record<string, unknown>)) {
      await assertGlobalImageTaskSlot(globalImageTaskSlotOpts());
    }

    const now = new Date();
    const expires = new Date(now.getTime() + 30 * 60 * 1000);
    const task = AppDataSource.getRepository(ImageUploadTask).create({
      cloudId: id,
      namespace: String(namespace),
      displayName: displayName ? String(displayName) : undefined,
      imageType: imageType ? String(imageType) : undefined,
      filename: filename ? String(filename) : undefined,
      fileSize: size,
      chunkSize: cs,
      totalChunks,
      receivedChunksJson: '[]',
      taskStatus: 'pending',
      phase: 'pending',
      progress: 0,
      ingestProgress: 0,
      proxyProgress: 0,
      bytesUploaded: 0,
      createdBy: userId,
      expiresAt: expires,
      retryCount: 0,
    });
    const saved = await saveImageUploadTaskRecord(task);
    const relPath = await ensureImageUploadMergedPreallocated(saved);
    saved.localFileRelPath = relPath;
    const withMerged = await saveImageUploadTaskRecord(saved);
    res.json({ message: '创建成功', data: sanitizeTask(withMerged) });
  } catch (error: any) {
    if (res.headersSent) return;
    if (isGlobalImageUploadBusyError(error)) {
      respondGlobalImageUploadBusy(res, error);
      return;
    }
    const detail = error?.message || String(error);
    console.error('[image-upload-task-create]', detail, error);
    res.status(500).json({
      message: '创建上传任务失败',
      error: detail,
      hint: /no metadata for/i.test(detail)
        ? '后端未加载 ImageUploadTask 实体，请重新编译并重启服务'
        : /no column named/i.test(detail) || /has no column/i.test(detail)
          ? 'image_upload_tasks 表结构过旧；已尝试自动补列仍失败，请重启后端或执行 ALTER TABLE 补列'
          : undefined,
    });
  }
}

/**
 * GET /:id/resources/harvester/images/upload-tasks/:taskId - 查询单任务
 */
export async function harvesterImageUploadTaskGetHandler(req: Request, res: Response) {
  try {
    const { id, taskId } = req.params;
    const user = (req as any)?.user;
    const userId = String(user?.id || '');
    const role = String(user?.role || '');
    const isAdmin = ['super_admin', 'admin'].includes(role);

    const repo = AppDataSource.getRepository(ImageUploadTask);
    const task = await repo.findOne({ where: { id: taskId, cloudId: id } });
    if (!task) return res.status(404).json({ message: '任务不存在' });
    if (!isAdmin && task.createdBy !== userId)
      return res.status(403).json({ message: '无权访问该任务' });
    const [reconciled] = await reconcileUploadTasksWithInventory([task], (req as any).cloud);
    res.json({ message: '查询成功', data: sanitizeTask(reconciled) });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询任务失败', error: error.message });
  }
}

/**
 * GET /:id/resources/harvester/images/upload-tasks - 查询任务列表
 */
export async function harvesterImageUploadTaskListHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const user = (req as any)?.user;
    const userId = String(user?.id || '');
    const role = String(user?.role || '');
    const isAdmin = ['super_admin', 'admin'].includes(role);
    const limit = Math.max(1, Math.min(100, Number((req.query as any)?.limit || 100)));
    const repo = AppDataSource.getRepository(ImageUploadTask);
    const where = isAdmin ? { cloudId: id } : { cloudId: id, createdBy: userId };
    void sweepStaleImageUploadStagingFiles(id).catch(() => undefined);
    const tasks = await repo.find({
      where: where as any,
      order: { createdAt: 'DESC' },
      take: limit,
    });
    res.json({ message: '查询成功', data: { items: tasks.map(sanitizeTask) } });
    void reconcileUploadTasksWithInventory(tasks, (req as any).cloud, {
      skipLiveClusterFetch: true,
      skipStagingPurge: true,
    }).catch(() => undefined);
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询任务列表失败', error: error.message });
  }
}

/**
 * DELETE /:id/resources/harvester/images/upload-tasks/:taskId - 删除任务记录
 */
export async function harvesterImageUploadTaskDeleteHandler(req: Request, res: Response) {
  try {
    const { id, taskId } = req.params;
    const user = (req as any)?.user;
    const userId = String(user?.id || '');
    const role = String(user?.role || '');
    const isAdmin = ['super_admin', 'admin'].includes(role);
    const repo = AppDataSource.getRepository(ImageUploadTask);
    let task = await repo.findOne({ where: { id: taskId, cloudId: id } });
    if (!task) return res.status(404).json({ message: '任务不存在' });
    if (!isAdmin && task.createdBy !== userId)
      return res.status(403).json({ message: '无权删除该任务' });

    const force = String((req.query as any)?.force || '') === 'true';
    const removed = await removeImageUploadTaskRecord(task, (req as any).cloud, { force });
    if (!removed) {
      const st = String(task.taskStatus || '').toLowerCase();
      if (!force && isUploadTaskDeleteBlockedByPolicy(task)) {
        if (st === 'uploaded') {
          return res.status(409).json({
            message: '待同步期间不可删除上传任务记录，请在镜像列表删除镜像数据',
          });
        }
        if (st === 'proxying') {
          return res.status(409).json({
            message: '镜像同步中，不可删除上传任务记录，请等待完成或在镜像列表操作',
          });
        }
        if (st === 'failed') {
          return res.status(409).json({
            message: '同步失败时不可在此删除任务记录，请在镜像列表删除镜像数据',
          });
        }
      }
      return res.status(409).json({ message: '任务正在执行，暂不允许删除' });
    }
    return res.json({ message: '删除成功' });
  } catch (error: any) {
    if (res.headersSent) return;
    return res.status(500).json({ message: '删除任务记录失败', error: error.message });
  }
}

/**
 * POST /:id/resources/harvester/images/upload-tasks/:taskId/cancel - 取消上传任务
 * 硬取消：删除已传分片与临时文件，不可断点续传。
 */
export async function harvesterImageUploadTaskCancelHandler(req: Request, res: Response) {
  try {
    const { id, taskId } = req.params;
    const user = (req as any)?.user;
    const userId = String(user?.id || '');
    const role = String(user?.role || '');
    const isAdmin = ['super_admin', 'admin'].includes(role);
    const repo = AppDataSource.getRepository(ImageUploadTask);
    const task = await repo.findOne({ where: { id: taskId, cloudId: id } });
    if (!task) return res.status(404).json({ message: '任务不存在' });
    if (!isAdmin && task.createdBy !== userId)
      return res.status(403).json({ message: '无权操作该任务' });
    if (!['pending', 'ingesting', 'uploaded', 'proxying', 'failed'].includes(task.taskStatus)) {
      return res.status(409).json({ message: '任务当前状态不允许取消' });
    }
    abortUploadTask(task.id);
    destroyImageUploadBodyReadable(task.id);

    task.taskStatus = 'cancelled';
    task.phase = 'finished';
    task.finishedAt = new Date();
    task.errorCode = undefined;
    task.errorMessage = undefined;
    task.receivedChunksJson = '[]';
    task.ingestProgress = 0;
    task.progress = 0;
    task.bytesUploaded = 0;
    task.localFileRelPath = undefined;
    await repo.save(task);

    await scheduleImageUploadTaskFilesCleanup(task);
    await finalizeImageUploadTaskFilesCleanup(task.id);

    return res.json({ message: '取消成功', data: sanitizeTask(task) });
  } catch (error: any) {
    if (res.headersSent) return;
    return res.status(500).json({ message: '取消任务失败', error: error.message });
  }
}

/**
 * GET /:id/resources/harvester/images/upload-tasks/:taskId/chunks
 * 返回已收到的分片 index 列表（用于断点续传）
 */
export async function harvesterImageUploadTaskChunksListHandler(req: Request, res: Response) {
  try {
    const { id, taskId } = req.params;
    const access = await assertImageUploadTaskAccess(req, id, taskId);
    if (!access) return res.status(404).json({ message: '任务不存在或无权访问' });
    const { task } = access;
    res.json({
      message: '查询成功',
      data: {
        taskId: task.id,
        totalChunks: task.totalChunks,
        chunkSize: task.chunkSize,
        fileSize: task.fileSize,
        receivedChunks: reconcileReceivedChunkIndices(task),
      },
    });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询分片状态失败', error: error.message });
  }
}

/**
 * PUT /:id/resources/harvester/images/upload-tasks/:taskId/chunks/:index
 * 上传单个分片（body 为 application/octet-stream），仅校验分片字节数。
 */
export async function harvesterImageUploadTaskChunkPutHandler(req: Request, res: Response) {
  try {
    const { id, taskId, index: indexRaw } = req.params;
    const access = await assertImageUploadTaskAccess(req, id, taskId);
    if (!access) return res.status(404).json({ message: '任务不存在或无权访问' });
    const { task } = access;

    const chunkIndex = Math.floor(Number(indexRaw));
    const totalChunks = Math.max(0, Math.floor(Number(task.totalChunks) || 0));
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= totalChunks) {
      return res.status(400).json({ message: '无效的分片 index' });
    }
    if (task.taskStatus === 'cancelled') {
      return res.status(409).json({ message: '任务已取消，无法继续上传分片' });
    } else if (!['pending', 'ingesting', 'failed'].includes(task.taskStatus)) {
      return res.status(409).json({ message: '任务当前状态不允许上传分片' });
    }

    await assertGlobalImageTaskSlot(globalImageTaskSlotOpts(task.id));

    const fileSize = Math.max(0, Math.floor(Number(task.fileSize) || 0));
    const cs = Math.max(1, Math.floor(Number(task.chunkSize) || IMAGE_UPLOAD_DEFAULT_CHUNK_SIZE));
    const expectedBytes = expectedChunkByteSize(fileSize, cs, totalChunks, chunkIndex);

    let mergedPath = imageTaskMergedAbsPath(task);
    if (!fs.existsSync(mergedPath)) {
      const relPath = await ensureImageUploadMergedPreallocated(task);
      task.localFileRelPath = relPath;
      const repo = AppDataSource.getRepository(ImageUploadTask);
      await repo.save(task);
      mergedPath = imageTaskMergedAbsPath(task);
    }

    const receivedBefore = reconcileReceivedChunkIndices(task);
    if (receivedBefore.includes(chunkIndex)) {
      const saved = await persistChunkReceivedIndices(task.id, chunkIndex);
      return res.json({
        message: '分片已存在',
        data: sanitizeTask(saved),
      });
    }

    const chunks: Buffer[] = [];
    let byteLen = 0;
    if (Buffer.isBuffer(req.body)) {
      byteLen = req.body.length;
    } else {
      await new Promise<void>((resolve, reject) => {
        req.on('data', (buf) => {
          const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
          byteLen += b.length;
          chunks.push(b);
        });
        req.on('end', () => resolve());
        req.on('error', reject);
      });
    }
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.concat(chunks, byteLen);

    if (expectedBytes > 0 && body.length !== expectedBytes) {
      return res.status(400).json({
        message: '分片大小与声明不符',
        error: `分片 ${chunkIndex} 期望 ${expectedBytes} 字节，实际 ${body.length} 字节`,
      });
    }

    const offset = chunkWriteOffset(cs, chunkIndex);
    await writeChunkToMergedFile(mergedPath, offset, body);

    const saved = await persistChunkReceivedIndices(task.id, chunkIndex);

    res.json({ message: '分片上传成功', data: sanitizeTask(saved) });
  } catch (error: any) {
    if (res.headersSent) return;
    if (isGlobalImageUploadBusyError(error)) {
      respondGlobalImageUploadBusy(res, error);
      return;
    }
    res.status(500).json({ message: '分片上传失败', error: error.message });
  }
}

/**
 * POST /:id/resources/harvester/images/upload-tasks/:taskId/complete-chunks
 * 校验分片齐全与 .merged 文件大小（分片已按偏移直写，无需再合并）
 */
export async function harvesterImageUploadTaskCompleteChunksHandler(req: Request, res: Response) {
  try {
    const { id, taskId } = req.params;
    const access = await assertImageUploadTaskAccess(req, id, taskId);
    if (!access) return res.status(404).json({ message: '任务不存在或无权访问' });
    const { task } = access;

    if (task.taskStatus === 'cancelled') {
      return res.status(409).json({ message: '任务已取消，无法完成合并' });
    }

    const totalChunks = Math.max(0, Math.floor(Number(task.totalChunks) || 0));
    const received = reconcileReceivedChunkIndices(task);
    if (received.length !== totalChunks) {
      return res.status(409).json({
        message: '分片未收齐，无法合并',
        data: {
          received: received.length,
          totalChunks,
          missing: Array.from({ length: totalChunks }, (_, i) => i).filter(
            (i) => !received.includes(i),
          ),
        },
      });
    }
    for (let i = 0; i < totalChunks; i++) {
      if (!received.includes(i)) {
        return res.status(409).json({ message: `缺少分片 ${i}` });
      }
    }

    const jsonOnly = parseReceivedChunkIndices(task.receivedChunksJson);
    if (jsonOnly.length !== received.length) {
      setReceivedChunkIndices(task, received);
      await AppDataSource.getRepository(ImageUploadTask).save(task);
    }

    const relPath = String(task.localFileRelPath || '').trim() || imageTaskMergedRelPath(task.id);
    const destPath = path.join(getImageUploadTempRoot(), relPath);
    if (!fs.existsSync(destPath)) {
      return res.status(409).json({ message: '镜像文件尚未就绪，请继续上传分片' });
    }

    const stat = fs.statSync(destPath);
    const mergedSize = Math.max(0, Math.floor(Number(stat.size) || 0));
    const expectedSize = Math.max(0, Math.floor(Number(task.fileSize) || 0));
    if (expectedSize < 1) {
      try {
        fs.unlinkSync(destPath);
      } catch {
        /* ignore */
      }
      return res.status(400).json({ message: '任务缺少 fileSize，无法校验文件' });
    }
    if (mergedSize !== expectedSize) {
      try {
        fs.unlinkSync(destPath);
      } catch {
        /* ignore */
      }
      return res.status(400).json({
        message: '文件大小与上传前不一致',
        error: `期望 ${expectedSize} 字节，实际 ${mergedSize} 字节`,
        code: 'FILE_SIZE_MISMATCH',
      });
    }

    try {
      const legacyChunkDir = path.join(getImageUploadTempRoot(), 'chunks', task.id);
      if (fs.existsSync(legacyChunkDir)) {
        fs.rmSync(legacyChunkDir, { recursive: true, force: true });
      }
    } catch {
      /* ignore */
    }

    const repo = AppDataSource.getRepository(ImageUploadTask);
    task.localFileRelPath = relPath;
    task.taskStatus = 'uploaded';
    task.phase = 'uploaded';
    task.ingestProgress = 100;
    task.progress = 100;
    task.bytesUploaded = mergedSize;
    task.errorCode = undefined;
    task.errorMessage = undefined;
    const uploadDiskFormat =
      String(task.imageType || '').toLowerCase() === 'iso'
        ? 'iso'
        : String(task.imageType || '').toLowerCase() === 'disk'
          ? 'qcow2'
          : undefined;
    if (!task.virtualSizeBytes) {
      const virtualSizeBytes = probeQcow2VirtualSizeFromPaths([destPath]);
      if (virtualSizeBytes != null) task.virtualSizeBytes = virtualSizeBytes;
    }
    await repo.save(task);

    res.json({ message: '文件已就绪，等待同步至 Harvester', data: sanitizeTask(task) });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '合并分片失败', error: error.message });
  }
}

/**
 * POST /:id/resources/harvester/images/upload-tasks/:taskId/sync
 * 将已合并的本地文件同步（代传）至 Harvester
 */
export async function harvesterImageUploadTaskSyncHandler(req: Request, res: Response) {
  try {
    const { id, taskId } = req.params;
    const access = await assertImageUploadTaskAccess(req, id, taskId);
    if (!access) return res.status(404).json({ message: '任务不存在或无权访问' });
    let { task } = access;
    const cloud = (req as any).cloud;

    if (!['uploaded', 'failed'].includes(task.taskStatus)) {
      return res.status(409).json({
        message:
          task.taskStatus === 'proxying'
            ? '同步已在进行中'
            : '任务当前状态不允许同步（需为待同步或同步失败）',
      });
    }
    if (getImageUploadInFlightTaskIds().has(task.id) || hasImageUploadProxyRun(task.id)) {
      return res.status(409).json({ message: '同步已在进行中，请勿重复提交' });
    }

    await assertGlobalImageTaskSlot(globalImageTaskSlotOpts(task.id));

    const absPath = imageTaskMergedAbsPath(task);
    if (!fs.existsSync(absPath)) {
      return res.status(400).json({
        message:
          task.taskStatus === 'failed'
            ? '本地暂存文件已不存在，无法再次同步。请在镜像列表删除该镜像数据后重新上传'
            : '合并文件不存在，请重新上传',
      });
    }

    const repo = AppDataSource.getRepository(ImageUploadTask);
    task.taskStatus = 'proxying';
    task.phase = 'proxying';
    task.progress = 0;
    task.proxyProgress = 0;
    task.bytesUploaded = 0;
    task.startedAt = task.startedAt || new Date();
    task.errorCode = undefined;
    task.errorMessage = undefined;
    task.finishedAt = undefined;
    task.retryCount = (task.retryCount || 0) + 1;

    const prevImgNs = String(task.createdImageNamespace || '').trim();
    const prevImgName = String(task.createdImageName || '').trim();
    if (prevImgNs && prevImgName) {
      const prep = await prepareClusterImageForUploadRetry(
        cloud,
        id,
        task,
        prevImgNs,
        prevImgName,
      );
      if (prep === 'already_imported') {
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const origin = resolveHarvesterOrigin(cloud);
        const existingDetail = await fetchHarvesterVmImageDetailFromCluster(
          cloud,
          prevImgNs,
          prevImgName,
          insecure,
        );
        if (existingDetail) {
          task = await markUploadTaskSuccessFromCluster(task, cloud, existingDetail, repo);
        } else {
          task.taskStatus = 'success';
          task.phase = 'finished';
          task.proxyProgress = 100;
          task.progress = 100;
          task.finishedAt = new Date();
          await repo.save(task);
        }
        void syncHarvesterImages(cloud, insecure, { allowDuringUploadProxy: true }).catch(
          () => undefined,
        );
        return res.status(200).json({
          message: '镜像已在 Harvester 导入完成',
          data: sanitizeTask(task),
        });
      }
    }
    await repo.save(task);

    void runImageUploadTask(task.id, cloud, absPath).catch((err) => {
      console.warn('[image-upload-task-sync]', task.id, err?.message || err);
    });

    res.status(202).json({
      message: '已开始同步',
      data: sanitizeTask(task),
    });
  } catch (error: any) {
    if (res.headersSent) return;
    if (isGlobalImageUploadBusyError(error)) {
      respondGlobalImageUploadBusy(res, error);
      return;
    }
    res.status(500).json({ message: '启动同步失败', error: error.message });
  }
}

function parseOctetStreamUploadFilename(req: Request): string {
  try {
    const xfn = req.headers['x-file-name'];
    if (xfn != null && String(xfn).trim() !== '') {
      return decodeURIComponent(String(xfn));
    }
  } catch {
    /* 非法百分号编码等 */
  }
  return 'image';
}

function parseOctetStreamUploadSizeHeaders(req: Request): number {
  const xs = Number(req.headers['x-file-size']);
  const cl = Number(req.headers['content-length']);
  const fromMeta = Number.isFinite(xs) && xs > 0 ? xs : 0;
  const fromLen = Number.isFinite(cl) && cl > 0 ? cl : 0;
  return fromMeta || fromLen;
}

/** application/octet-stream：先落盘再异步代传 Harvester（与 multipart file 路径一致） */
async function handleHarvesterImageUploadTaskOctetStream(
  req: Request,
  res: Response,
): Promise<void> {
  const { id, taskId } = req.params;
  const user = (req as any)?.user;
  const userId = String(user?.id || '');
  const role = String(user?.role || '');
  const isAdmin = ['super_admin', 'admin'].includes(role);
  const cloud = (req as any).cloud;

  const filename = parseOctetStreamUploadFilename(req);
  const fileSize = parseOctetStreamUploadSizeHeaders(req);

  const repo = AppDataSource.getRepository(ImageUploadTask);
  const task = await repo.findOne({ where: { id: taskId, cloudId: id } });
  if (!task) {
    res.status(404).json({ message: '任务不存在' });
    return;
  }
  if (!isAdmin && task.createdBy !== userId) {
    res.status(403).json({ message: '无权操作该任务' });
    return;
  }
  if (!['pending', 'failed'].includes(task.taskStatus)) {
    res.status(409).json({ message: '任务当前状态不允许上传文件' });
    return;
  }

  task.filename = filename;
  if (fileSize > 0) task.fileSize = fileSize;
  task.taskStatus = 'ingesting';
  task.phase = 'ingesting';
  task.ingestProgress = 0;
  task.progress = 0;
  task.bytesUploaded = 0;
  task.startedAt = task.startedAt || new Date();
  task.errorCode = undefined;
  task.errorMessage = undefined;
  await repo.save(task);

  const tempPath = path.join(getImageUploadTempRoot(), `${task.id}-${Date.now()}`);
  const ingestAbort = new AbortController();
  try {
    await ingestOctetStreamToTempFile(req, tempPath, fileSize, task.id, ingestAbort);
  } catch (e: any) {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      /* ignore */
    }
    if (isCancelError(e)) return;
    throw new Error(formatImageUploadTaskError(e) || '接收镜像文件失败');
  }

  const writtenSize = fs.statSync(tempPath).size || 0;
  task.fileSize = writtenSize;
  task.ingestProgress = 100;
  task.progress = 100;
  if (!task.virtualSizeBytes) {
    const virtualSizeBytes = probeQcow2VirtualSizeFromPaths([tempPath]);
    if (virtualSizeBytes != null) task.virtualSizeBytes = virtualSizeBytes;
  }
  await repo.save(task);

  void runImageUploadTask(task.id, cloud, tempPath).catch((err) => {
    console.warn('[image-upload-task-octet]', task.id, err?.message || err);
  });

  res.status(202).json({
    message: '文件已接收，任务执行中',
    data: { taskId: task.id, status: 'ingesting', phase: 'ingesting' },
  });
}

/**
 * POST /:id/resources/harvester/images/upload-tasks/:taskId/file - 上传文件并异步执行
 * - Content-Type: application/octet-stream：元数据由 X-File-Name / X-File-Size 提供；先落盘再异步代传 Harvester，接收完成后返回 202。
 * - multipart field=file：兼容旧版浏览器 / 桌面工具（multer 落盘后再代传）。
 */
export async function harvesterImageUploadTaskFileHandler(req: Request, res: Response) {
  const rawCt = String(req.headers['content-type'] || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (rawCt === 'application/octet-stream') {
    try {
      await handleHarvesterImageUploadTaskOctetStream(req, res);
    } catch (e: any) {
      if (!res.headersSent) {
        if (isGlobalImageUploadBusyError(e)) {
          respondGlobalImageUploadBusy(res, e);
          return;
        }
        if (isCancelError(e)) return;
        res.status(500).json({
          message: '上传镜像文件失败',
          error: formatImageUploadTaskError(e),
        });
      }
    }
    return;
  }

  imageTaskUpload.single('file')(req, res, async (err: any) => {
    try {
      if (err)
        return res
          .status(400)
          .json({ message: '文件接收失败', error: err?.message || String(err) });
      const { id, taskId } = req.params;
      const user = (req as any)?.user;
      const userId = String(user?.id || '');
      const role = String(user?.role || '');
      const isAdmin = ['super_admin', 'admin'].includes(role);
      const cloud = (req as any).cloud;

      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file) return res.status(400).json({ message: '缺少上传文件，字段名应为 file' });

      const repo = AppDataSource.getRepository(ImageUploadTask);
      const task = await repo.findOne({ where: { id: taskId, cloudId: id } });
      if (!task) return res.status(404).json({ message: '任务不存在' });
      if (!isAdmin && task.createdBy !== userId)
        return res.status(403).json({ message: '无权操作该任务' });
      if (!['pending', 'failed'].includes(task.taskStatus)) {
        return res.status(409).json({ message: '任务当前状态不允许上传文件' });
      }

      task.filename = file.originalname;
      task.fileSize = file.size;
      task.taskStatus = 'ingesting';
      task.phase = 'ingesting';
      task.ingestProgress = 100;
      task.progress = 1;
      task.bytesUploaded = 0;
      task.startedAt = task.startedAt || new Date();
      task.errorCode = undefined;
      task.errorMessage = undefined;
      if (!task.virtualSizeBytes) {
        const virtualSizeBytes = probeQcow2VirtualSizeFromPaths([file.path]);
        if (virtualSizeBytes != null) task.virtualSizeBytes = virtualSizeBytes;
      }
      await repo.save(task);

      // 异步执行，HTTP 快速返回 202，前端通过任务状态轮询
      void runImageUploadTask(task.id, cloud, file.path).catch((err) => {
        console.warn('[image-upload-task]', task.id, err?.message || err);
      });

      res.status(202).json({
        message: '文件已接收，任务执行中',
        data: { taskId: task.id, status: task.taskStatus, phase: task.phase },
      });
    } catch (error: any) {
      if (res.headersSent) return;
      if (isGlobalImageUploadBusyError(error)) {
        respondGlobalImageUploadBusy(res, error);
        return;
      }
      res.status(500).json({ message: '提交上传任务失败', error: error.message });
    }
  });
}
