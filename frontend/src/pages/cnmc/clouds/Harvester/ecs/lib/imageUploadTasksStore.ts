import type {
  HarvesterImageDownloadTask,
  HarvesterImageUploadTask,
} from '../../../../../../services/harvesterApi';
import { mergeDownloadTasksSorted } from './images/imageDownloadTaskCore';
import { applyUploadTaskToListState, mergeUploadTasksSorted } from './images/imageUploadTaskCore';
import { reloadUploadTasksForCloud, syncUploadTasksSessionCache } from './uploadTaskReload';

export type ImageUploadTasksSnapshot = {
  uploadTasks: HarvesterImageUploadTask[];
  listTaskList: HarvesterImageUploadTask[];
  downloadTasks: HarvesterImageDownloadTask[];
  uploadTasksLoading: boolean;
};

/** 镜像列表 Section 挂载时注册：库存进度轮询（Tab 切走 unregister，任务轮询由常驻抽屉维持） */
export type ImageUploadInventoryPollHooks = {
  isMounted: () => boolean;
  runInventoryPollTick: () => void;
};

type CloudUploadTasksEntry = {
  snapshot: ImageUploadTasksSnapshot;
  listeners: Set<() => void>;
  pollTimer: number | null;
  inventoryPollHooks: ImageUploadInventoryPollHooks | null;
  subscriberCount: number;
  reloadFn: ((showLoading?: boolean, batchTerminalReload?: boolean) => void | Promise<void>) | null;
};

const emptySnapshot = (): ImageUploadTasksSnapshot => ({
  uploadTasks: [],
  listTaskList: [],
  downloadTasks: [],
  uploadTasksLoading: false,
});

const entries = new Map<string, CloudUploadTasksEntry>();

function getEntry(cloudId: string): CloudUploadTasksEntry {
  let entry = entries.get(cloudId);
  if (!entry) {
    entry = {
      snapshot: emptySnapshot(),
      listeners: new Set(),
      pollTimer: null,
      inventoryPollHooks: null,
      subscriberCount: 0,
      reloadFn: null,
    };
    entries.set(cloudId, entry);
  }
  return entry;
}

function emit(cloudId: string): void {
  for (const listener of getEntry(cloudId).listeners) listener();
}

export function getImageUploadTasksSnapshot(cloudId: string): ImageUploadTasksSnapshot {
  return getEntry(cloudId).snapshot;
}

export function patchImageUploadTasksSnapshot(
  cloudId: string,
  patch: Partial<ImageUploadTasksSnapshot>,
): void {
  const entry = getEntry(cloudId);
  entry.snapshot = { ...entry.snapshot, ...patch };
  emit(cloudId);
}

export function subscribeImageUploadTasks(cloudId: string, listener: () => void): () => void {
  const entry = getEntry(cloudId);
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
  };
}

export function applyUploadTaskPatchToStore(
  cloudId: string,
  task: HarvesterImageUploadTask,
): { becameSuccess: boolean } {
  const snap = getImageUploadTasksSnapshot(cloudId);
  const { next, becameSuccess } = applyUploadTaskToListState(snap.listTaskList, task);
  patchImageUploadTasksSnapshot(cloudId, {
    uploadTasks: mergeUploadTasksSorted(snap.uploadTasks, task),
    listTaskList: next,
  });
  return { becameSuccess };
}

export function removeUploadTaskFromStore(cloudId: string, taskId: string): void {
  const snap = getImageUploadTasksSnapshot(cloudId);
  const nextUploadTasks = snap.uploadTasks.filter((x) => x.id !== taskId);
  patchImageUploadTasksSnapshot(cloudId, {
    uploadTasks: nextUploadTasks,
    listTaskList: snap.listTaskList.filter((x) => x.id !== taskId),
  });
  syncUploadTasksSessionCache(cloudId, nextUploadTasks);
}

export function applyDownloadTaskPatchToStore(
  cloudId: string,
  task: HarvesterImageDownloadTask,
): void {
  const snap = getImageUploadTasksSnapshot(cloudId);
  patchImageUploadTasksSnapshot(cloudId, {
    downloadTasks: mergeDownloadTasksSorted(snap.downloadTasks, task),
  });
}

export function removeDownloadTaskFromStore(cloudId: string, taskId: string): void {
  const snap = getImageUploadTasksSnapshot(cloudId);
  patchImageUploadTasksSnapshot(cloudId, {
    downloadTasks: snap.downloadTasks.filter((x) => x.id !== taskId),
  });
}

export function registerImageUploadTasksReload(
  cloudId: string,
  reloadFn?: (showLoading?: boolean, batchTerminalReload?: boolean) => void | Promise<void>,
): void {
  getEntry(cloudId).reloadFn =
    reloadFn ||
    ((showLoading, batchTerminalReload) =>
      reloadUploadTasksForCloud(cloudId, { showLoading, batchTerminalReload }));
}

export function unregisterImageUploadTasksReload(cloudId: string): void {
  getEntry(cloudId).reloadFn = null;
}

export function reloadImageUploadTasksFromStore(
  cloudId: string,
  showLoading?: boolean,
  batchTerminalReload?: boolean,
): Promise<void> {
  const fn = getEntry(cloudId).reloadFn;
  const result = fn
    ? fn(showLoading, batchTerminalReload)
    : reloadUploadTasksForCloud(cloudId, { showLoading, batchTerminalReload });
  return result instanceof Promise ? result : Promise.resolve();
}

export function registerImageUploadTasksSubscriber(cloudId: string): void {
  getEntry(cloudId).subscriberCount += 1;
}

export function unregisterImageUploadTasksSubscriber(cloudId: string): void {
  const entry = getEntry(cloudId);
  entry.subscriberCount = Math.max(0, entry.subscriberCount - 1);
  maybeStopImageUploadTasksPolling(cloudId);
}

export function registerImageUploadInventoryPollHooks(
  cloudId: string,
  hooks: ImageUploadInventoryPollHooks,
): void {
  getEntry(cloudId).inventoryPollHooks = hooks;
}

export function unregisterImageUploadInventoryPollHooks(cloudId: string): void {
  getEntry(cloudId).inventoryPollHooks = null;
}

function hasActiveUploadTasksInSnapshot(snapshot: ImageUploadTasksSnapshot): boolean {
  return [...snapshot.uploadTasks, ...snapshot.listTaskList].some((task) => {
    const st = String(task.status || '').toLowerCase();
    return ['pending', 'ingesting', 'uploaded', 'proxying'].includes(st);
  });
}

/** 镜像 Tab 未挂载时，仍有底座同步/待同步任务则需继续刷新库存进度 */
function hasActiveDownloadTasksInSnapshot(snapshot: ImageUploadTasksSnapshot): boolean {
  return snapshot.downloadTasks.some((task) => {
    const st = String(task.taskStatus || '').toLowerCase();
    return st === 'pending' || st === 'fetching';
  });
}

function hasActiveTransferTasksInSnapshot(snapshot: ImageUploadTasksSnapshot): boolean {
  return hasActiveUploadTasksInSnapshot(snapshot) || hasActiveDownloadTasksInSnapshot(snapshot);
}

function needsInventoryPollWhileTabHidden(snapshot: ImageUploadTasksSnapshot): boolean {
  return snapshot.listTaskList.some((task) => {
    const st = String(task.status || '').toLowerCase();
    return st === 'proxying' || st === 'uploaded';
  });
}

/** 常驻抽屉统一轮询：活跃任务刷新 + 库存进度刷新（Tab 隐藏时仍刷新进行中的同步） */
export function runImageUploadTasksPollCycle(cloudId: string): void {
  if (document.visibilityState === 'hidden') return;
  const entry = getEntry(cloudId);
  if (hasActiveTransferTasksInSnapshot(entry.snapshot)) {
    void entry.reloadFn?.(false);
  }
  const hooks = entry.inventoryPollHooks;
  if (hooks && (hooks.isMounted() || needsInventoryPollWhileTabHidden(entry.snapshot))) {
    hooks.runInventoryPollTick();
  }
}

function maybeStopImageUploadTasksPolling(cloudId: string): void {
  const entry = getEntry(cloudId);
  if (entry.subscriberCount > 0 || hasActiveTransferTasksInSnapshot(entry.snapshot)) return;
  if (entry.pollTimer != null) {
    window.clearInterval(entry.pollTimer);
    entry.pollTimer = null;
  }
}

/** 启动/维持轮询（仅常驻抽屉调用一次即可） */
export function ensureImageUploadTasksPolling(cloudId: string): void {
  const entry = getEntry(cloudId);
  if (entry.pollTimer != null) return;
  entry.pollTimer = window.setInterval(() => {
    runImageUploadTasksPollCycle(cloudId);
  }, 5000);
}

export function stopImageUploadTasksPolling(cloudId: string): void {
  const entry = getEntry(cloudId);
  if (entry.pollTimer != null) {
    window.clearInterval(entry.pollTimer);
    entry.pollTimer = null;
  }
}

export function resetImageUploadTasksStoreForTests(): void {
  for (const entry of entries.values()) {
    if (entry.pollTimer != null) window.clearInterval(entry.pollTimer);
  }
  entries.clear();
}
