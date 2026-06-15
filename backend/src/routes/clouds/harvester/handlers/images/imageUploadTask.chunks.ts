/**
 * 浏览器分片上传：偏移直写 .merged、分片索引持久化与 ingest 进度计算。
 */
import fs from 'fs';

import { AppDataSource } from '../../../../../config/database';
import { ImageUploadTask } from '../../../../../entities/harvester/ImageUploadTask';

/** 浏览器分片上传默认片大小 32MiB（大文件创建任务时会按体积分档） */
export const IMAGE_UPLOAD_DEFAULT_CHUNK_SIZE = 32 * 1024 * 1024;
/** 单片上限 64MiB，需与 raw body limit 一致 */
export const IMAGE_UPLOAD_MAX_CHUNK_SIZE = 64 * 1024 * 1024;

export function chunkWriteOffset(chunkSize: number, chunkIndex: number): number {
  return Math.max(0, Math.floor(chunkSize)) * Math.max(0, Math.floor(chunkIndex));
}

export async function writeChunkToMergedFile(
  mergedPath: string,
  offset: number,
  body: Buffer,
): Promise<void> {
  const fh = await fs.promises.open(mergedPath, 'r+');
  try {
    await fh.write(body, 0, body.length, offset);
  } finally {
    await fh.close();
  }
}

export function parseReceivedChunkIndices(raw: unknown): number[] {
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => Math.floor(Number(x)))
      .filter((n) => Number.isInteger(n) && n >= 0)
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

export function setReceivedChunkIndices(task: ImageUploadTask, indices: number[]): void {
  const uniq = [...new Set(indices.filter((n) => Number.isInteger(n) && n >= 0))].sort(
    (a, b) => a - b,
  );
  task.receivedChunksJson = JSON.stringify(uniq);
}

/** 并行分片上传时串行化 receivedChunksJson 更新，避免读-改-写丢片 */
const imageUploadChunkLockTails = new Map<string, Promise<void>>();

export async function withImageUploadChunkLock<T>(
  taskId: string,
  fn: () => Promise<T>,
): Promise<T> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const prev = imageUploadChunkLockTails.get(taskId) ?? Promise.resolve();
  const tail = prev.then(() => gate);
  imageUploadChunkLockTails.set(taskId, tail);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (imageUploadChunkLockTails.get(taskId) === tail) {
      imageUploadChunkLockTails.delete(taskId);
    }
  }
}

export function reconcileReceivedChunkIndices(task: ImageUploadTask): number[] {
  return parseReceivedChunkIndices(task.receivedChunksJson);
}

/** 分片 ingest 进度（保留两位小数，避免 TB 级文件长期显示 0%） */
export function roundIngestProgress(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v * 100) / 100));
}

export function computeChunkIngestProgress(receivedCount: number, totalChunks: number): number {
  if (totalChunks < 1 || receivedCount < 1) return 0;
  return roundIngestProgress((receivedCount / totalChunks) * 100);
}

export function computeTotalChunks(fileSize: number, chunkSize: number): number {
  const size = Math.max(0, Math.floor(fileSize));
  const cs = Math.max(1, Math.floor(chunkSize));
  if (size < 1) return 0;
  return Math.ceil(size / cs);
}

/** 某分片 index 应有的字节数（最后一片可能小于 chunkSize） */
export function expectedChunkByteSize(
  fileSize: number,
  chunkSize: number,
  totalChunks: number,
  chunkIndex: number,
): number {
  const cs = Math.max(1, Math.floor(chunkSize));
  const total = Math.max(0, Math.floor(totalChunks));
  const idx = Math.floor(chunkIndex);
  if (idx < 0 || idx >= total) return 0;
  if (idx < total - 1) return cs;
  return Math.max(0, Math.floor(fileSize) - cs * Math.max(0, total - 1));
}

export async function persistChunkReceivedIndices(
  taskId: string,
  chunkIndex: number,
): Promise<ImageUploadTask> {
  return withImageUploadChunkLock(taskId, async () => {
    const repo = AppDataSource.getRepository(ImageUploadTask);
    const fresh = await repo.findOne({ where: { id: taskId } });
    if (!fresh) throw new Error('任务不存在');

    const totalChunks = Math.max(0, Math.floor(Number(fresh.totalChunks) || 0));
    const fileSize = Math.max(0, Math.floor(Number(fresh.fileSize) || 0));
    const cs = Math.max(1, Math.floor(Number(fresh.chunkSize) || IMAGE_UPLOAD_DEFAULT_CHUNK_SIZE));
    const received = reconcileReceivedChunkIndices(fresh);
    if (!received.includes(chunkIndex)) received.push(chunkIndex);
    received.sort((a, b) => a - b);
    setReceivedChunkIndices(fresh, received);

    fresh.taskStatus = 'ingesting';
    fresh.phase = 'ingesting';
    fresh.startedAt = fresh.startedAt || new Date();
    fresh.errorCode = undefined;
    fresh.errorMessage = undefined;

    const lastChunkSize = expectedChunkByteSize(fileSize, cs, totalChunks, totalChunks - 1);
    let bytesDone = 0;
    for (const idx of received) {
      bytesDone += idx < totalChunks - 1 ? cs : lastChunkSize;
    }
    fresh.bytesUploaded = Math.min(fileSize, bytesDone);
    fresh.ingestProgress = computeChunkIngestProgress(received.length, totalChunks);
    fresh.progress = roundIngestProgress(fresh.ingestProgress);
    return repo.save(fresh);
  });
}

export function sanitizeTask(task: ImageUploadTask) {
  return {
    id: task.id,
    cloudId: task.cloudId,
    namespace: task.namespace,
    displayName: task.displayName,
    imageType: task.imageType,
    filename: task.filename,
    fileSize: task.fileSize,
    virtualSizeBytes: task.virtualSizeBytes,
    chunkSize: task.chunkSize,
    totalChunks: task.totalChunks,
    receivedChunks: parseReceivedChunkIndices(task.receivedChunksJson),
    status: task.taskStatus,
    phase: task.phase,
    progress: task.progress,
    ingestProgress: task.ingestProgress,
    proxyProgress: task.proxyProgress,
    bytesUploaded: task.bytesUploaded,
    errorCode: task.errorCode,
    errorMessage: task.errorMessage,
    createdBy: task.createdBy,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    expiresAt: task.expiresAt,
    retryCount: task.retryCount,
    createdImageName: task.createdImageName,
    createdImageNamespace: task.createdImageNamespace,
  };
}
