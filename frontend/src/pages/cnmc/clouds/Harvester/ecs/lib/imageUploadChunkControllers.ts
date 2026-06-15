/** 浏览器分片上传 AbortController：挂在模块级，切换 Tab 卸载抽屉时不 abort，避免误中断上传 */

const chunkUploadControllers = new Map<string, AbortController>();

export function registerChunkUploadController(taskId: string, controller: AbortController): void {
  chunkUploadControllers.set(taskId, controller);
}

export function abortChunkUploadController(taskId: string): void {
  chunkUploadControllers.get(taskId)?.abort();
  chunkUploadControllers.delete(taskId);
}

export function clearChunkUploadController(taskId: string): void {
  chunkUploadControllers.delete(taskId);
}

export function isChunkUploadControllerActive(taskId: string): boolean {
  return chunkUploadControllers.has(taskId);
}

export function getChunkUploadControllersMap(): ReadonlyMap<string, AbortController> {
  return chunkUploadControllers;
}

export function resetChunkUploadControllersForTests(): void {
  chunkUploadControllers.clear();
}
