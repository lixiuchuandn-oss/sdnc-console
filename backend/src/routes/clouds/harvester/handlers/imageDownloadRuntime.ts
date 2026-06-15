const downloadAbortControllers = new Map<string, AbortController>();

export function registerImageDownloadAbort(taskId: string): AbortController {
  const ac = new AbortController();
  downloadAbortControllers.set(taskId, ac);
  return ac;
}

export function abortImageDownloadTask(taskId: string): void {
  const ac = downloadAbortControllers.get(taskId);
  if (ac) ac.abort();
  downloadAbortControllers.delete(taskId);
}

export function clearImageDownloadAbort(taskId: string): void {
  downloadAbortControllers.delete(taskId);
}

export function isImageDownloadInFlight(taskId: string): boolean {
  return downloadAbortControllers.has(taskId);
}
