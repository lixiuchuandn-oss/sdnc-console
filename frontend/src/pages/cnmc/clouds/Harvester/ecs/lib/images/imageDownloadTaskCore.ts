import type { HarvesterImageDownloadTask } from '../../../../../../../services/harvesterApi';

/** 同时进行中的集群→Tower 拉取任务上限（pending / fetching） */
export const MAX_CONCURRENT_IMAGE_DOWNLOAD_TASKS = 3;

export const IMAGE_DOWNLOAD_CONCURRENCY_LIMIT_MESSAGE =
  '超出最大下载数量范围，请稍后重试';

export function mergeDownloadTasksSorted(
  prev: HarvesterImageDownloadTask[],
  incoming: HarvesterImageDownloadTask | HarvesterImageDownloadTask[],
): HarvesterImageDownloadTask[] {
  const list = Array.isArray(incoming) ? incoming : [incoming];
  const map = new Map<string, HarvesterImageDownloadTask>();
  for (const t of prev) map.set(t.id, t);
  for (const t of list) {
    if (t?.id) map.set(t.id, t);
  }
  return [...map.values()].sort(
    (a, b) => Date.parse(String(b.createdAt || 0)) - Date.parse(String(a.createdAt || 0)),
  );
}

export function isActiveImageDownloadTask(task: HarvesterImageDownloadTask): boolean {
  const st = String(task.taskStatus || '').toLowerCase();
  return st === 'pending' || st === 'fetching';
}

export function countActiveImageDownloadTasks(tasks: HarvesterImageDownloadTask[]): number {
  return tasks.filter(isActiveImageDownloadTask).length;
}

export function isImageDownloadConcurrencyExceeded(activeCount: number): boolean {
  return activeCount >= MAX_CONCURRENT_IMAGE_DOWNLOAD_TASKS;
}

export function parseHarvesterImageDownloadTasksResponse(resp: unknown): HarvesterImageDownloadTask[] {
  const r = resp as {
    data?: { items?: HarvesterImageDownloadTask[] } | HarvesterImageDownloadTask[];
    items?: HarvesterImageDownloadTask[];
  };
  if (Array.isArray(r?.items)) return r.items;
  const data = r?.data;
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}
