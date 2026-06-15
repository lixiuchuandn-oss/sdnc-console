import type {
  HarvesterImageDownloadTask,
  HarvesterImageUploadTask,
} from '../../../../../../services/harvesterApi';
import {
  fetchHarvesterImageDownloadTasks,
  fetchHarvesterImageUploadTasks,
} from '../../../../../../services/harvesterApi';
import {
  mergeDownloadTasksSorted,
  parseHarvesterImageDownloadTasksResponse,
} from './images/imageDownloadTaskCore';
import {
  applyUploadTaskToListState,
  isHardCancelledUploadTask,
  mergeUploadTasksSorted,
  taskAffectsImageList,
} from './images/imageUploadTaskCore';
import {
  getImageUploadTasksSnapshot,
  patchImageUploadTasksSnapshot,
  type ImageUploadTasksSnapshot,
} from './imageUploadTasksStore';
import { IMAGE_UPLOAD_TASK_FETCH_LIMIT } from './uploadTaskConstants';

export { IMAGE_UPLOAD_TASK_FETCH_LIMIT } from './uploadTaskConstants';

const UPLOAD_TASKS_FETCH_TIMEOUT_MS = 15_000;
const uploadTasksSessionCacheKey = (cloudId: string) =>
  `harvester-image-upload-tasks:${cloudId}`;

export function readUploadTasksSessionCache(cloudId: string): HarvesterImageUploadTask[] {
  if (!cloudId || typeof window === 'undefined') return [];
  try {
    const raw = window.sessionStorage.getItem(uploadTasksSessionCacheKey(cloudId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as HarvesterImageUploadTask[]) : [];
  } catch {
    return [];
  }
}

export function syncUploadTasksSessionCache(
  cloudId: string,
  items: readonly HarvesterImageUploadTask[],
): void {
  if (!cloudId || typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(
      uploadTasksSessionCacheKey(cloudId),
      JSON.stringify(items),
    );
  } catch {
    /* ignore quota */
  }
}

/** 刷新后 API 返回前，用 session 缓存先恢复抽屉任务列表 */
export function hydrateUploadTasksFromSessionCache(cloudId: string): boolean {
  if (!cloudId) return false;
  const cached = readUploadTasksSessionCache(cloudId);
  if (!cached.length) return false;
  const prev = getImageUploadTasksSnapshot(cloudId);
  if (prev.uploadTasks.length > 0) return false;
  patchImageUploadTasksSnapshot(cloudId, {
    uploadTasks: mergeUploadTasksSorted([], cached),
  });
  return true;
}

export type UploadTaskReloadSideEffects = {
  onAfterApply?: (
    items: HarvesterImageUploadTask[],
    ctx: {
      batchTerminalReload?: boolean;
      prev: ImageUploadTasksSnapshot;
      next: ImageUploadTasksSnapshot;
    },
  ) => void;
  onError?: (error: unknown) => void;
};

const sideEffectsByCloud = new Map<string, UploadTaskReloadSideEffects>();
const inflightByCloud = new Map<string, Promise<void>>();

function isLocalOnlyIngestTask(task: HarvesterImageUploadTask): boolean {
  const st = String(task.status || '').toLowerCase();
  return st === 'pending' || st === 'ingesting';
}

export function registerUploadTaskReloadSideEffects(
  cloudId: string,
  effects: UploadTaskReloadSideEffects,
): void {
  sideEffectsByCloud.set(cloudId, effects);
}

export function unregisterUploadTaskReloadSideEffects(cloudId: string): void {
  sideEffectsByCloud.delete(cloudId);
}

/** 拉取上传任务列表并合并进 store（唯一数据写入路径） */
export function parseHarvesterImageUploadTasksResponse(
  resp: unknown,
): HarvesterImageUploadTask[] {
  const r = resp as {
    data?: { items?: HarvesterImageUploadTask[] } | HarvesterImageUploadTask[];
    items?: HarvesterImageUploadTask[];
  };
  if (Array.isArray(r?.items)) return r.items;
  const data = r?.data;
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

export async function reloadUploadTasksForCloud(
  cloudId: string,
  opts?: { showLoading?: boolean; batchTerminalReload?: boolean },
): Promise<void> {
  if (!cloudId) return;
  const inflight = inflightByCloud.get(cloudId);
  if (inflight) return inflight;

  const showLoading = opts?.showLoading === true;
  const batchTerminalReload = opts?.batchTerminalReload === true;

  const promise = (async () => {
    try {
      if (showLoading) patchImageUploadTasksSnapshot(cloudId, { uploadTasksLoading: true });
      let items: HarvesterImageUploadTask[];
      let downloadItems: HarvesterImageDownloadTask[] = [];
      try {
        const resp = await Promise.race([
          Promise.all([
            fetchHarvesterImageUploadTasks(cloudId, IMAGE_UPLOAD_TASK_FETCH_LIMIT),
            fetchHarvesterImageDownloadTasks(cloudId, IMAGE_UPLOAD_TASK_FETCH_LIMIT),
          ]),
          new Promise<never>((_, reject) => {
            window.setTimeout(
              () => reject(new Error('upload-tasks timeout')),
              UPLOAD_TASKS_FETCH_TIMEOUT_MS,
            );
          }),
        ]);
        items = parseHarvesterImageUploadTasksResponse(resp[0]);
        downloadItems = parseHarvesterImageDownloadTasksResponse(resp[1]);
      } catch (e) {
        const cached = readUploadTasksSessionCache(cloudId);
        if (cached.length) {
          items = cached;
          console.warn('[image-upload] reload failed, using session cache', e);
        } else {
          throw e;
        }
      }
      const prev = getImageUploadTasksSnapshot(cloudId);
      const serverIds = new Set(items.map((t) => t.id));
      const localOnly = prev.uploadTasks.filter(
        (t) => !serverIds.has(t.id) && isLocalOnlyIngestTask(t),
      );
      let nextUploadTasks = mergeUploadTasksSorted(mergeUploadTasksSorted([], items), localOnly);
      let nextListTaskList = prev.listTaskList;
      for (const task of items) {
        if (isHardCancelledUploadTask(task)) {
          nextListTaskList = nextListTaskList.filter((x) => x.id !== task.id);
        }
        const { next } = applyUploadTaskToListState(nextListTaskList, task);
        nextListTaskList = next;
      }

      const next: ImageUploadTasksSnapshot = {
        uploadTasks: nextUploadTasks,
        downloadTasks: mergeDownloadTasksSorted([], downloadItems),
        listTaskList: nextListTaskList,
        uploadTasksLoading: showLoading ? false : prev.uploadTasksLoading,
      };
      patchImageUploadTasksSnapshot(cloudId, next);
      syncUploadTasksSessionCache(cloudId, nextUploadTasks);

      const effects = sideEffectsByCloud.get(cloudId);
      effects?.onAfterApply?.(items, { batchTerminalReload, prev, next });
    } catch (e) {
      const onError = sideEffectsByCloud.get(cloudId)?.onError;
      if (onError) onError(e);
      else console.warn('[image-upload] reload upload tasks failed', e);
      if (showLoading) throw e;
    } finally {
      if (showLoading) patchImageUploadTasksSnapshot(cloudId, { uploadTasksLoading: false });
    }
  })();

  inflightByCloud.set(
    cloudId,
    promise.finally(() => {
      inflightByCloud.delete(cloudId);
    }),
  );
  return inflightByCloud.get(cloudId)!;
}

export function uploadTaskBatchNeedsInventorySideEffects(
  items: readonly HarvesterImageUploadTask[],
  opts: { batchTerminalReload?: boolean },
  prev: ImageUploadTasksSnapshot,
): boolean {
  if (opts.batchTerminalReload) {
    return items.some((task) => {
      const st = String(task.status || '').toLowerCase();
      return (st === 'cancelled' || st === 'failed') && taskAffectsImageList(task);
    });
  }
  return items.some((task) => {
    if (!taskAffectsImageList(task)) return false;
    const st = String(task.status || '').toLowerCase();
    if (st !== 'failed') return false;
    const prevTask =
      prev.uploadTasks.find((t) => t.id === task.id) ||
      prev.listTaskList.find((t) => t.id === task.id);
    const prevSt = String(prevTask?.status || '').toLowerCase();
    return prevSt === 'proxying' || prevSt === 'uploaded' || prevSt === 'success';
  });
}

export function uploadTaskItemsNeedSuccessInventorySync(
  items: readonly HarvesterImageUploadTask[],
  prev: ImageUploadTasksSnapshot,
): boolean {
  return items.some((task) => {
    if (String(task.status || '') !== 'success') return false;
    const wasAlreadySuccess = [...prev.uploadTasks, ...prev.listTaskList].some(
      (x) => x.id === task.id && x.status === 'success',
    );
    if (wasAlreadySuccess) return false;
    return (
      prev.uploadTasks.some((x) => x.id === task.id) ||
      prev.listTaskList.some((x) => x.id === task.id) ||
      !!task.createdImageName
    );
  });
}
