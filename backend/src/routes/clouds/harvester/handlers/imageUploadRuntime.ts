/** 镜像代传运行时状态（与 handlers 解耦，供 inventory / 列表 API 判断是否跳过重 sync） */

const imageUploadInFlight = new Set<string>();
const imageUploadInFlightByCloud = new Map<string, number>();
const imageUploadAbortControllers = new Map<string, AbortController>();

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
