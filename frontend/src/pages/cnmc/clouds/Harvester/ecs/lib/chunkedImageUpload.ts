import {
  completeHarvesterImageUploadChunks,
  createHarvesterImageUploadTask,
  fetchHarvesterImageUploadTask,
  fetchHarvesterImageUploadTaskChunks,
  type HarvesterImageUploadTask,
  uploadHarvesterImageChunk,
} from '../../../../../../services/harvesterApi';
import { getApiErrorMessage } from '../../../../../../services/api';
import { createThrottledTaskUpsert } from './uploadTaskProgressThrottle';

/** 浏览器无法继续读取本地源文件时的续传提示（NotReadableError） */
export const LOCAL_SOURCE_FILE_RESUME_HINT =
  '请重新选择同一文件续传，并确保源文件未被移动或删除';

/** 并行上传分片数（HTTP/1.1 下同域连接有限，4 路较均衡） */
export const IMAGE_UPLOAD_PARALLEL = 4;
const CHUNK_UPLOAD_MAX_RETRIES = 3;

/** 按文件大小选择分片：越大越少往返，4GB+ 用 64MiB */
export function pickImageUploadChunkSize(fileSize: number): number {
  const size = Math.max(0, Math.floor(fileSize));
  if (size >= 2 * 1024 * 1024 * 1024) return 64 * 1024 * 1024;
  if (size >= 512 * 1024 * 1024) return 32 * 1024 * 1024;
  return 16 * 1024 * 1024;
}

function isAbortError(e: unknown): boolean {
  return (
    (e instanceof DOMException && e.name === 'AbortError') ||
    String((e as { name?: string })?.name || '') === 'AbortError'
  );
}

/** 本地 File 句柄失效（移动/删除/网络盘断开等） */
export function isLocalSourceFileNotReadableError(e: unknown): boolean {
  if (e instanceof DOMException && e.name === 'NotReadableError') return true;
  const name = String((e as { name?: string })?.name || '');
  if (name === 'NotReadableError') return true;
  const msg = String((e as { message?: string })?.message || e || '').toLowerCase();
  return (
    msg.includes('could not be read') ||
    msg.includes('notreadableerror') ||
    (msg.includes('permission') && msg.includes('file'))
  );
}

export function getChunkUploadErrorMessage(e: unknown, fallback: string): string {
  if (isLocalSourceFileNotReadableError(e)) return LOCAL_SOURCE_FILE_RESUME_HINT;
  return getApiErrorMessage(e, fallback);
}

/** 续传时选了与任务不一致的本地文件 */
export function isResumeUploadFileMismatchError(e: unknown): boolean {
  const msg = String((e as { message?: string })?.message || e || '');
  return (
    msg.includes('请选择同一文件') ||
    msg.includes('文件大小与任务不一致')
  );
}

/** 上传中断后清理并行上传的本地进度叠加字段，避免仍显示「并行上传中」 */
export function stripTowerUploadLocalOverlay(
  task: HarvesterImageUploadTask,
): HarvesterImageUploadTask {
  const ext = { ...(task as Record<string, unknown>) };
  delete ext.__towerUploadPhase;
  delete ext.__towerUploadChunkIndex;
  delete ext.__towerUploadInFlightIndices;
  return ext as HarvesterImageUploadTask;
}

export type RunChunkedImageUploadParams = {
  cloudId: string;
  file: File;
  namespace: string;
  displayName?: string;
  imageType?: string;
  signal?: AbortSignal;
  onTaskUpsert: (task: HarvesterImageUploadTask) => void;
  existingTask?: HarvesterImageUploadTask;
};

type InFlightChunk = {
  index: number;
  loaded: number;
  total: number;
};

function upsertParallelIngestProgress(
  base: HarvesterImageUploadTask,
  received: ReadonlySet<number>,
  totalChunks: number,
  inFlight: ReadonlyMap<number, InFlightChunk>,
  onTaskUpsert: (task: HarvesterImageUploadTask, opts?: { force?: boolean }) => void,
): void {
  let partial = 0;
  for (const item of inFlight.values()) {
    if (item.total > 0) partial += item.loaded / item.total;
  }
  const ratio =
    totalChunks > 0 ? Math.min(0.9999, (received.size + partial) / totalChunks) : 0;
  const ingestProgress = Math.min(99.99, Math.round(ratio * 10000) / 100);
  const inFlightIndices = [...inFlight.keys()].sort((a, b) => a - b);
  onTaskUpsert(
    {
      ...base,
      status: 'ingesting',
      phase: 'ingesting',
      totalChunks,
      receivedChunks: [...received].sort((a, b) => a - b),
      ingestProgress,
      progress: Math.min(99.99, Math.round(ingestProgress * 100) / 100),
      errorMessage: undefined,
      ...(inFlightIndices.length > 0
        ? {
            __towerUploadPhase: 'uploading',
            __towerUploadChunkIndex: inFlightIndices[0],
            __towerUploadInFlightIndices: inFlightIndices,
          }
        : {
            __towerUploadPhase: undefined,
            __towerUploadChunkIndex: undefined,
            __towerUploadInFlightIndices: undefined,
          }),
    } as HarvesterImageUploadTask,
    inFlight.size === 0 ? { force: true } : undefined,
  );
}

async function loadReceivedChunkSet(cloudId: string, taskId: string): Promise<Set<number>> {
  try {
    const chunksResp = await fetchHarvesterImageUploadTaskChunks(cloudId, taskId);
    const list = (chunksResp as { data?: { receivedChunks?: number[] } })?.data?.receivedChunks;
    if (Array.isArray(list)) return new Set(list);
  } catch {
    /* ignore */
  }
  return new Set();
}

async function uploadOneChunkWithRetry(
  cloudId: string,
  taskId: string,
  index: number,
  body: ArrayBuffer,
  signal: AbortSignal | undefined,
  onUploadProgress: (loaded: number, total: number) => void,
): Promise<HarvesterImageUploadTask> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < CHUNK_UPLOAD_MAX_RETRIES; attempt++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      const uploadResp = (await uploadHarvesterImageChunk(cloudId, taskId, index, body, {
        signal,
        onUploadProgress,
      })) as { data?: HarvesterImageUploadTask };
      const next = (uploadResp?.data || uploadResp) as HarvesterImageUploadTask;
      if (!next?.id) throw new Error('分片上传响应无效');
      return next;
    } catch (e) {
      lastErr = e;
      if (isAbortError(e)) throw e;
      if (attempt + 1 >= CHUNK_UPLOAD_MAX_RETRIES) break;
      await new Promise((r) => window.setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr || '分片上传失败'));
}

async function runChunkUploadLoop(
  cloudId: string,
  file: File,
  task: HarvesterImageUploadTask,
  onTaskUpsert: (task: HarvesterImageUploadTask) => void,
  signal?: AbortSignal,
): Promise<HarvesterImageUploadTask> {
  const emitTask = createThrottledTaskUpsert(onTaskUpsert, 400);
  const chunkSize = task.chunkSize || pickImageUploadChunkSize(file.size);
  const totalChunks =
    task.totalChunks || Math.max(1, Math.ceil(file.size / chunkSize));

  const received = await loadReceivedChunkSet(cloudId, task.id);
  if (Array.isArray(task.receivedChunks)) {
    for (const idx of task.receivedChunks) received.add(idx);
  }

  const pending: number[] = [];
  for (let index = 0; index < totalChunks; index++) {
    if (!received.has(index)) pending.push(index);
  }

  const inFlight = new Map<number, InFlightChunk>();

  const syncProgress = (force = false) => {
    upsertParallelIngestProgress(task, received, totalChunks, inFlight, (t, opts) =>
      emitTask(t, { force: force || opts?.force }),
    );
  };

  syncProgress(true);

  async function processChunk(index: number): Promise<void> {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const start = index * chunkSize;
    const end = Math.min(file.size, start + chunkSize);
    let ab: ArrayBuffer;
    try {
      ab = await file.slice(start, end).arrayBuffer();
    } catch (readErr: unknown) {
      if (isLocalSourceFileNotReadableError(readErr)) {
        throw new DOMException(LOCAL_SOURCE_FILE_RESUME_HINT, 'NotReadableError');
      }
      throw readErr;
    }

    inFlight.set(index, { index, loaded: 0, total: ab.byteLength });
    syncProgress();

    const next = await uploadOneChunkWithRetry(
      cloudId,
      task.id,
      index,
      ab,
      signal,
      (loaded, total) => {
        inFlight.set(index, { index, loaded, total });
        syncProgress();
      },
    );

    inFlight.delete(index);
    received.add(index);
    emitTask(next, { force: true });
    onTaskUpsert(next);
  }

  let cursor = 0;
  async function poolWorker(): Promise<void> {
    while (cursor < pending.length) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const index = pending[cursor];
      cursor += 1;
      await processChunk(index);
    }
  }

  const workers = Math.min(IMAGE_UPLOAD_PARALLEL, Math.max(1, pending.length));
  await Promise.all(Array.from({ length: workers }, () => poolWorker()));

  for (let attempt = 0; attempt < 3; attempt++) {
    const serverReceived = await loadReceivedChunkSet(cloudId, task.id);
    const missing: number[] = [];
    for (let index = 0; index < totalChunks; index++) {
      if (!serverReceived.has(index)) missing.push(index);
    }
    if (missing.length === 0) break;
    for (const index of missing) {
      await processChunk(index);
    }
  }

  const completeResp = (await completeHarvesterImageUploadChunks(cloudId, task.id)) as {
    data?: HarvesterImageUploadTask;
  };
  const finalTask = (completeResp?.data || completeResp) as HarvesterImageUploadTask;
  if (!finalTask?.id) {
    const latest = (await fetchHarvesterImageUploadTask(cloudId, task.id)) as {
      data?: HarvesterImageUploadTask;
    };
    const saved = (latest?.data || latest) as HarvesterImageUploadTask;
    onTaskUpsert(saved);
    return saved;
  }
  onTaskUpsert(finalTask);
  return finalTask;
}

export function assertResumeUploadFileMatchesTask(
  task: HarvesterImageUploadTask,
  file: File,
): void {
  const taskFileSize = Number(task.fileSize);
  if (Number.isFinite(taskFileSize) && taskFileSize > 0 && taskFileSize !== file.size) {
    throw new Error(
      `文件大小与任务不一致（任务 ${taskFileSize} 字节，当前文件 ${file.size} 字节），请选择同一文件续传`,
    );
  }
}

export async function runChunkedImageUploadFlow(
  params: RunChunkedImageUploadParams,
): Promise<HarvesterImageUploadTask> {
  const { cloudId, file, namespace, displayName, imageType, signal, onTaskUpsert, existingTask } =
    params;

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  let task = existingTask;
  if (task?.id) {
    assertResumeUploadFileMatchesTask(task, file);
  }

  if (!task?.id) {
    const chunkSize = pickImageUploadChunkSize(file.size);
    const created: any = await createHarvesterImageUploadTask(cloudId, {
      namespace,
      displayName,
      imageType,
      filename: file.name,
      fileSize: file.size,
      chunkSize,
    });
    task = (created?.data || created) as HarvesterImageUploadTask;
    if (!task?.id) throw new Error('创建任务失败：未返回 taskId');
    onTaskUpsert(task);
  }

  return runChunkUploadLoop(cloudId, file, task, onTaskUpsert, signal);
}

export function isUploadTaskActivelyUploading(
  taskId: string,
  controllers: ReadonlyMap<string, AbortController>,
): boolean {
  return controllers.has(taskId);
}

export { isAbortError as isChunkUploadAbortError };
