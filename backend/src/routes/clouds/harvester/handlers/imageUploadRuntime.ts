/** 镜像代传运行时状态（与 handlers 解耦，供 inventory / 列表 API 判断是否跳过重 sync） */

import type { Readable } from 'stream';

const imageUploadInFlight = new Set<string>();
const imageUploadInFlightByCloud = new Map<string, number>();
const imageUploadAbortControllers = new Map<string, AbortController>();
const imageUploadDeferredCleanupPaths = new Map<string, Set<string>>();
const imageUploadProxyRuns = new Map<string, Promise<void>>();
const imageUploadActiveBodyReadables = new Map<string, Readable>();

export function getImageUploadInFlightTaskIds(): ReadonlySet<string> {
  return imageUploadInFlight;
}

export function getImageUploadAbortController(taskId: string): AbortController | undefined {
  return imageUploadAbortControllers.get(taskId);
}

export function setImageUploadAbortController(taskId: string, controller: AbortController): void {
  imageUploadAbortControllers.set(taskId, controller);
}

export function deleteImageUploadAbortController(taskId: string): void {
  imageUploadAbortControllers.delete(taskId);
}

export function registerImageUploadProxyStart(cloudId: string, taskId: string): void {
  if (!imageUploadInFlight.has(taskId)) {
    imageUploadInFlight.add(taskId);
    const cid = String(cloudId || '').trim();
    if (cid) {
      imageUploadInFlightByCloud.set(cid, (imageUploadInFlightByCloud.get(cid) || 0) + 1);
    }
  }
}

export function registerImageUploadProxyEnd(cloudId: string, taskId: string): void {
  if (imageUploadInFlight.delete(taskId)) {
    const cid = String(cloudId || '').trim();
    if (cid) {
      const next = (imageUploadInFlightByCloud.get(cid) || 1) - 1;
      if (next <= 0) imageUploadInFlightByCloud.delete(cid);
      else imageUploadInFlightByCloud.set(cid, next);
    }
  }
  imageUploadAbortControllers.delete(taskId);
}

export function hasImageUploadProxyInFlightForCloud(cloudId: string): boolean {
  const cid = String(cloudId || '').trim();
  if (!cid) return imageUploadInFlight.size > 0;
  return (imageUploadInFlightByCloud.get(cid) || 0) > 0;
}

/** 仅当 Tower 进程内仍有代传/分片上传协程时视为执行中 */
export function isUploadTaskTransferInFlight(taskId: string): boolean {
  return imageUploadInFlight.has(taskId);
}

/** 是否仍有代传 Promise 在跑（与 inFlight 标记应对齐，用于识别僵尸 proxying） */
export function hasImageUploadProxyRun(taskId: string): boolean {
  return imageUploadProxyRuns.has(taskId);
}

/** 代传仍在读盘时 defer unlink，避免 (deleted) 仍占磁盘 */
export function queueDeferredImageUploadCleanup(taskId: string, absPaths: string[]): void {
  const paths = absPaths.map((p) => String(p || '').trim()).filter(Boolean);
  if (!paths.length) return;
  let set = imageUploadDeferredCleanupPaths.get(taskId);
  if (!set) {
    set = new Set<string>();
    imageUploadDeferredCleanupPaths.set(taskId, set);
  }
  for (const p of paths) set.add(p);
}

export function takeDeferredImageUploadCleanupPaths(taskId: string): string[] {
  const set = imageUploadDeferredCleanupPaths.get(taskId);
  if (!set) return [];
  imageUploadDeferredCleanupPaths.delete(taskId);
  return [...set];
}

export function attachImageUploadProxyRun(taskId: string, promise: Promise<void>): void {
  imageUploadProxyRuns.set(taskId, promise);
  void promise.finally(() => {
    if (imageUploadProxyRuns.get(taskId) === promise) {
      imageUploadProxyRuns.delete(taskId);
    }
  });
}

/** 等待代传协程结束；超时返回 false */
export async function waitForImageUploadProxyIdle(
  taskId: string,
  timeoutMs = 120_000,
): Promise<boolean> {
  const run = imageUploadProxyRuns.get(taskId);
  if (!run) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      run.catch(() => undefined),
      new Promise<void>((_, reject) => {
        timer = setTimeout(() => reject(new Error('IMAGE_UPLOAD_PROXY_IDLE_TIMEOUT')), timeoutMs);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function destroyUploadReadable(readable: Readable): void {
  try {
    if (!readable.destroyed) readable.destroy();
  } catch {
    /* ignore */
  }
}

export function trackImageUploadBodyReadable(taskId: string, readable: Readable | null): void {
  if (!readable) {
    imageUploadActiveBodyReadables.delete(taskId);
    return;
  }
  const prev = imageUploadActiveBodyReadables.get(taskId);
  if (prev && prev !== readable) destroyUploadReadable(prev);
  imageUploadActiveBodyReadables.set(taskId, readable);
}

export function destroyImageUploadBodyReadable(taskId: string): void {
  const readable = imageUploadActiveBodyReadables.get(taskId);
  if (!readable) return;
  destroyUploadReadable(readable);
  imageUploadActiveBodyReadables.delete(taskId);
}

/** 测试专用：重置进程内运行时状态 */
export function resetImageUploadRuntimeForTests(): void {
  for (const taskId of imageUploadActiveBodyReadables.keys()) {
    destroyImageUploadBodyReadable(taskId);
  }
  imageUploadInFlight.clear();
  imageUploadInFlightByCloud.clear();
  imageUploadAbortControllers.clear();
  imageUploadDeferredCleanupPaths.clear();
  imageUploadProxyRuns.clear();
}
