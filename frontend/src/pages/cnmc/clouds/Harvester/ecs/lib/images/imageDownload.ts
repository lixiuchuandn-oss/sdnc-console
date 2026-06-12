import {
  createHarvesterImageDownloadTask,
  deleteHarvesterImageDownloadTask,
  fetchHarvesterImageDownloadTasks,
  type HarvesterImageDownloadTask,
} from '../../../../../../../services/harvesterApi';
import { getImageUploadTasksSnapshot } from '../imageUploadTasksStore';
import {
  countActiveImageDownloadTasks,
  IMAGE_DOWNLOAD_CONCURRENCY_LIMIT_MESSAGE,
  isImageDownloadConcurrencyExceeded,
  parseHarvesterImageDownloadTasksResponse,
} from './imageDownloadTaskCore';
import { API_BASE_URL } from '../../../../../../../services/api';
import { getToken } from '../../../../../../../utils/tokenStorage';
import { pickImageUploadChunkSize } from '../chunkedImageUpload';
import { CLUSTER_IN_PROGRESS_STATE_KEYS } from './constants';
import { isTowerUploadVirtualRow } from './imageListUpload';
import {
  getImageDisplayAlias,
  getImageRowId,
  getImageRowNamespace,
  type ImageListRecord,
} from '../imagesSectionUtils';
import { resolveImageListStateKey } from '../vmImageStatus';

const CHUNK_DOWNLOAD_MAX_RETRIES = 3;

export type ImageLocalDownloadProgress = {
  loaded: number;
  total: number;
  percent: number;
  chunkIndex: number;
  totalChunks: number;
};

export type SaveImageDownloadTaskFileOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: ImageLocalDownloadProgress) => void;
};

export function canShowImageDownloadAction(r: ImageListRecord): boolean {
  if (isTowerUploadVirtualRow(r)) return false;
  const stateKey = resolveImageListStateKey(r);
  if (
    CLUSTER_IN_PROGRESS_STATE_KEYS.includes(
      stateKey as (typeof CLUSTER_IN_PROGRESS_STATE_KEYS)[number],
    )
  ) {
    return false;
  }
  if (['failed', 'pending_sync', 'cancelled', 'pending'].includes(stateKey)) return false;
  return true;
}

export function imageDownloadBlockedMessage(r: ImageListRecord): string | undefined {
  if (canShowImageDownloadAction(r)) return undefined;
  const stateKey = resolveImageListStateKey(r);
  if (CLUSTER_IN_PROGRESS_STATE_KEYS.includes(stateKey as never)) {
    return '镜像尚未就绪，无法下载';
  }
  if (stateKey === 'pending_sync') return '镜像待同步，无法下载';
  if (stateKey === 'failed') return '镜像状态异常，无法下载';
  return '当前状态不可下载';
}

export async function assertImageDownloadConcurrencyAllowed(cloudId: string): Promise<void> {
  const snap = getImageUploadTasksSnapshot(cloudId);
  const storeActive = countActiveImageDownloadTasks(snap.downloadTasks);
  if (isImageDownloadConcurrencyExceeded(storeActive)) {
    throw new Error(IMAGE_DOWNLOAD_CONCURRENCY_LIMIT_MESSAGE);
  }

  const resp = await fetchHarvesterImageDownloadTasks(cloudId, 100);
  const items = parseHarvesterImageDownloadTasksResponse(resp);
  const serverActive = countActiveImageDownloadTasks(items);
  if (isImageDownloadConcurrencyExceeded(serverActive)) {
    throw new Error(IMAGE_DOWNLOAD_CONCURRENCY_LIMIT_MESSAGE);
  }
}

export async function startImageDownloadTaskFromRecord(
  cloudId: string,
  record: ImageListRecord,
): Promise<HarvesterImageDownloadTask> {
  const namespace = getImageRowNamespace(record);
  const imageName = getImageRowId(record);
  if (!namespace || !imageName) throw new Error('镜像行缺少命名空间或名称');

  await assertImageDownloadConcurrencyAllowed(cloudId);

  const spec = (record.spec || {}) as Record<string, unknown>;
  const links = (record.links || {}) as Record<string, string>;
  const created = await createHarvesterImageDownloadTask(cloudId, {
    namespace,
    imageName,
    displayName: getImageDisplayAlias(record),
    downloadLink: links.download,
    imageType: String(spec.imageType || ''),
    diskFormat: String(spec.diskFormat || ''),
  });
  const task = ((created as { data?: HarvesterImageDownloadTask })?.data ||
    created) as HarvesterImageDownloadTask;
  if (!task?.id) throw new Error('创建下载任务失败');
  return task;
}

/** 项目 TS lib 未包含 File System Access API 写入面，本地补全最小类型 */
type FileSystemWritableFileStream = WritableStream & {
  write: (data: Blob | BufferSource | string) => Promise<void>;
  close: () => Promise<void>;
  abort: (reason?: unknown) => Promise<void>;
};

type FileSystemFileHandleWithWritable = FileSystemFileHandle & {
  createWritable: () => Promise<FileSystemWritableFileStream>;
};

type SaveFilePickerWindow = Window & {
  showSaveFilePicker?: (options?: { suggestedName?: string }) => Promise<FileSystemFileHandleWithWritable>;
};

function sanitizeDownloadFilename(task: HarvesterImageDownloadTask): string {
  return String(task.filename || `${task.imageName || 'image'}.qcow2`).replace(/[/\\]/g, '_');
}

function buildImageDownloadTaskFileUrl(cloudId: string, taskId: string): string {
  return `${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/images/download-tasks/${encodeURIComponent(
    taskId,
  )}/file`;
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function isAbortError(e: unknown): boolean {
  return (
    (e instanceof DOMException && e.name === 'AbortError') ||
    String((e as { name?: string })?.name || '') === 'AbortError'
  );
}

function clampPercent(loaded: number, total: number): number {
  if (total <= 0) return 100;
  return Math.max(0, Math.min(100, Math.floor((loaded / total) * 100)));
}

function buildChunkRanges(fileSize: number, chunkSize: number): Array<{ start: number; end: number }> {
  if (fileSize <= 0) return [];
  const size = Math.max(1, chunkSize);
  const ranges: Array<{ start: number; end: number }> = [];
  for (let start = 0; start < fileSize; start += size) {
    ranges.push({ start, end: Math.min(fileSize - 1, start + size - 1) });
  }
  return ranges;
}

async function headImageDownloadTaskFileSize(cloudId: string, taskId: string): Promise<number> {
  const res = await fetch(buildImageDownloadTaskFileUrl(cloudId, taskId), {
    method: 'HEAD',
    headers: authHeaders(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `获取文件大小失败 (${res.status})`);
  }
  const len = Number(res.headers.get('Content-Length') || 0);
  if (!Number.isFinite(len) || len < 0) {
    throw new Error('无法获取文件大小');
  }
  return len;
}

async function resolveImageDownloadTaskFileSize(
  cloudId: string,
  task: HarvesterImageDownloadTask,
): Promise<number> {
  const fromTask = Math.floor(Number(task.fileSize) || 0);
  if (fromTask > 0) return fromTask;
  return await headImageDownloadTaskFileSize(cloudId, task.id);
}

async function fetchImageDownloadTaskFileRange(
  cloudId: string,
  taskId: string,
  start: number,
  end: number,
  signal?: AbortSignal,
): Promise<Blob> {
  const res = await fetch(buildImageDownloadTaskFileUrl(cloudId, taskId), {
    headers: {
      ...authHeaders(),
      Range: `bytes=${start}-${end}`,
    },
    signal,
  });
  if (res.status !== 206 && res.status !== 200) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `分片下载失败 (${res.status})`);
  }
  const expected = end - start + 1;
  const blob = await res.blob();
  if (expected > 0 && blob.size !== expected) {
    throw new Error(`分片大小不符：期望 ${expected} 字节，实际 ${blob.size} 字节`);
  }
  return blob;
}

async function fetchImageDownloadChunkWithRetry(
  cloudId: string,
  taskId: string,
  start: number,
  end: number,
  signal?: AbortSignal,
): Promise<Blob> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < CHUNK_DOWNLOAD_MAX_RETRIES; attempt++) {
    try {
      return await fetchImageDownloadTaskFileRange(cloudId, taskId, start, end, signal);
    } catch (e) {
      lastErr = e;
      if (isAbortError(e)) throw e;
      if (attempt + 1 >= CHUNK_DOWNLOAD_MAX_RETRIES) break;
    }
  }
  if (lastErr instanceof Error) throw lastErr;
  throw new Error('分片下载失败');
}

function emitLocalDownloadProgress(
  opts: SaveImageDownloadTaskFileOptions | undefined,
  loaded: number,
  total: number,
  chunkIndex: number,
  totalChunks: number,
): void {
  opts?.onProgress?.({
    loaded,
    total,
    percent: clampPercent(loaded, total),
    chunkIndex,
    totalChunks,
  });
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

async function downloadChunksSequentially(
  cloudId: string,
  taskId: string,
  ranges: Array<{ start: number; end: number }>,
  fileSize: number,
  writeChunk: (blob: Blob, chunkIndex: number) => Promise<void>,
  opts?: SaveImageDownloadTaskFileOptions,
): Promise<void> {
  const totalChunks = ranges.length;
  let loaded = 0;
  emitLocalDownloadProgress(opts, loaded, fileSize, 0, totalChunks);

  for (let i = 0; i < ranges.length; i++) {
    if (opts?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const { start, end } = ranges[i];
    const blob = await fetchImageDownloadChunkWithRetry(
      cloudId,
      taskId,
      start,
      end,
      opts?.signal,
    );
    await writeChunk(blob, i);
    loaded = end + 1;
    emitLocalDownloadProgress(opts, loaded, fileSize, i, totalChunks);
  }
}

/**
 * Tower 暂存 → 本地：HTTP Range 顺序分片拉取（与上传分片尺寸策略一致），单片重试。
 * 优先 File System Access API 顺序写盘；回退为分片合并后触发浏览器下载。
 */
export async function saveImageDownloadTaskFileToLocal(
  cloudId: string,
  task: HarvesterImageDownloadTask,
  opts?: SaveImageDownloadTaskFileOptions,
): Promise<void> {
  if (String(task.taskStatus || '').toLowerCase() !== 'ready') {
    throw new Error('镜像尚未拉取到 Tower，请稍后再试');
  }

  const filename = sanitizeDownloadFilename(task);
  const fileSize = await resolveImageDownloadTaskFileSize(cloudId, task);
  const chunkSize = pickImageUploadChunkSize(fileSize);
  const ranges = buildChunkRanges(fileSize, chunkSize);
  const win = window as SaveFilePickerWindow;

  if (typeof win.showSaveFilePicker === 'function') {
    try {
      const handle = await win.showSaveFilePicker({ suggestedName: filename });
      const writable = await handle.createWritable();
      try {
        await downloadChunksSequentially(
          cloudId,
          task.id,
          ranges,
          fileSize,
          async (blob) => {
            await writable.write(blob);
          },
          opts,
        );
        await writable.close();
        return;
      } catch (pipeErr) {
        try {
          await writable.abort();
        } catch {
          /* ignore */
        }
        throw pipeErr;
      }
    } catch (e) {
      const dom = e as DOMException;
      if (dom?.name === 'AbortError') {
        throw new Error('已取消保存到本地');
      }
      // 非用户取消（如非安全上下文）时回退 blob 下载
    }
  }

  const blobParts: Blob[] = [];
  await downloadChunksSequentially(
    cloudId,
    task.id,
    ranges,
    fileSize,
    async (blob) => {
      blobParts.push(blob);
    },
    opts,
  );
  triggerBlobDownload(new Blob(blobParts, { type: 'application/octet-stream' }), filename);
}

/** 本地保存完成后删除 Tower 暂存文件与任务记录 */
export async function saveImageDownloadTaskFileToLocalWithCleanup(
  cloudId: string,
  task: HarvesterImageDownloadTask,
  opts?: SaveImageDownloadTaskFileOptions,
): Promise<void> {
  await saveImageDownloadTaskFileToLocal(cloudId, task, opts);
  try {
    await deleteHarvesterImageDownloadTask(cloudId, task.id);
  } catch (cleanupErr: unknown) {
    const detail =
      cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr || '未知错误');
    throw new Error(`文件已保存到本地，但清理 Tower 暂存失败：${detail}`);
  }
}

export function formatImageDownloadProgressText(task: HarvesterImageDownloadTask): string {
  const pct = Math.max(0, Math.min(100, Math.floor(Number(task.progress) || 0)));
  if (task.taskStatus === 'fetching') {
    return `正在从集群努力拉取中，请耐心等待… ${pct}%`;
  }
  if (task.taskStatus === 'ready') return '已拉取到 Tower，可在任务中下载到本地';
  if (task.taskStatus === 'pending') return '正在创建下载任务…';
  return '准备下载…';
}

export function formatImageLocalDownloadProgressText(progress: ImageLocalDownloadProgress): string {
  const chunkLine =
    progress.totalChunks > 0
      ? `第 ${progress.chunkIndex + 1}/${progress.totalChunks} 片`
      : '';
  return `正在分片下载到本地… ${progress.percent}%${chunkLine ? `（${chunkLine}）` : ''}`;
}
