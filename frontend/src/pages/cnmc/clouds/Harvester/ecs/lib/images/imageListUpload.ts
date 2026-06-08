import type { HarvesterImageUploadTask } from '../../../../../../../services/harvesterApi';
import { fetchHarvesterImageUploadTasks } from '../../../../../../../services/harvesterApi';
import {
  clusterReportedSizeLooksLikeVirtualCapacity,
  getImageActualFileBytes,
  getImageStorageClassName,
  getImageDisplayAlias,
  getImageRowId,
  getImageRowNamespace,
  getImageVirtualSizeBytes,
  type ImageListRecord,
} from '../imagesSectionUtils';
import { IMAGE_UPLOAD_TASK_FETCH_LIMIT } from '../uploadTaskConstants';
import { parseHarvesterImageUploadTasksResponse } from '../uploadTaskReload';
import { readClusterVmImageImportProgress, resolveImageListStateKey } from '../vmImageStatus';
import {
  CLUSTER_IN_PROGRESS_STATE_KEYS,
  TOWER_UPLOAD_TASK_ID_KEY,
  TOWER_UPLOAD_VIRTUAL_ROW_FLAG,
} from './constants';
import { assessImageDeleteBlockedByVms } from './imageDeleteActions';
import { isTowerImageIngestComplete, mergeUploadTasksSorted } from './imageUploadTaskCore';

export { TOWER_UPLOAD_VIRTUAL_ROW_FLAG, TOWER_UPLOAD_TASK_ID_KEY } from './constants';

const UPLOAD_TASK_LOOKUP_TIMEOUT_MS = 12_000;

async function fetchUploadTasksWithTimeout(
  cloudId: string,
  limit = IMAGE_UPLOAD_TASK_FETCH_LIMIT,
): Promise<HarvesterImageUploadTask[]> {
  const resp = await Promise.race([
    fetchHarvesterImageUploadTasks(cloudId, limit),
    new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error('upload-tasks timeout')), UPLOAD_TASK_LOOKUP_TIMEOUT_MS);
    }),
  ]);
  return parseHarvesterImageUploadTasksResponse(resp);
}

export function isTowerUploadVirtualRow(r: ImageListRecord): boolean {
  return !!(r as Record<string, unknown>)[TOWER_UPLOAD_VIRTUAL_ROW_FLAG];
}

export function getTowerUploadTaskIdFromRow(r: ImageListRecord): string {
  return String((r as Record<string, unknown>)[TOWER_UPLOAD_TASK_ID_KEY] || '');
}

/** 底座导入/上传进行中不允许删除镜像/镜像数据 */
export function isImageRowDeleteBlockedBySync(r: ImageListRecord): boolean {
  return CLUSTER_IN_PROGRESS_STATE_KEYS.includes(
    resolveImageListStateKey(r) as (typeof CLUSTER_IN_PROGRESS_STATE_KEYS)[number],
  );
}

export function isImageListPendingSyncRow(r: ImageListRecord): boolean {
  return resolveImageListStateKey(r) === 'pending_sync';
}

export function isImageListFailedSyncRow(r: ImageListRecord): boolean {
  return resolveImageListStateKey(r) === 'failed';
}

/** 上传任务是否允许调用「同步至 Harvester」（与后端 upload-tasks sync 一致） */
export function isUploadTaskSyncRetryable(task: HarvesterImageUploadTask): boolean {
  const st = String(task.status || '').toLowerCase();
  if (st === 'uploaded') return true;
  // 仅分片已齐（ingest 完成）后的代传失败可重试 sync；ingest 阶段失败应重新上传
  if (st === 'failed') {
    return Math.max(0, Number(task.ingestProgress) || 0) >= 100;
  }
  return false;
}

/**
 * 镜像列表是否展示「同步」：待同步/同步失败且有关联上传任务。
 * 合并到库存行后无 __towerUploadVirtual，但仍带 __towerUploadTaskId。
 */
export function canShowTowerUploadSyncAction(
  r: ImageListRecord,
  tasks: readonly HarvesterImageUploadTask[] = [],
): boolean {
  const stateKey = resolveImageListStateKey(r);
  if (!['pending_sync', 'failed'].includes(stateKey)) return false;

  let taskId: string | undefined = resolveTaskIdFromImageRow(r);
  if (!taskId) {
    taskId = findUploadTaskForImageRow(r, tasks)?.id;
  }
  if (!taskId) return false;

  const task = tasks.find((t) => t.id === taskId);
  if (task) return isUploadTaskSyncRetryable(task);
  // 任务列表尚未拉到时不展示同步，避免点击后才发现不可重试
  return false;
}

/** 待同步/同步失败：删除镜像列表行时需一并删除 Tower 上传任务记录 */
export function isImageListTowerUploadDeleteRow(r: ImageListRecord): boolean {
  return isImageListPendingSyncRow(r) || isImageListFailedSyncRow(r);
}

/** 本地上传镜像（浏览器/分片上传到 Tower） */
export function isLocalUploadImageRow(
  r: ImageListRecord,
  tasks: readonly HarvesterImageUploadTask[] = [],
): boolean {
  if (isTowerUploadVirtualRow(r)) return true;
  if (getTowerUploadTaskIdFromRow(r)) return true;
  if (tasks.length > 0 && findUploadTaskForImageRow(r, tasks)) return true;
  const sourceType = String(
    r?.sourceType || (r?.spec as Record<string, unknown> | undefined)?.sourceType || '',
  ).toLowerCase();
  return sourceType === 'upload';
}

/** 本地上传镜像删除时是否需同时删除 Harvester 集群中的镜像资源 */
export function shouldDeleteClusterImageForLocalUploadRow(r: ImageListRecord): boolean {
  if (isImageListPendingSyncRow(r)) return false;
  const name = getImageRowId(r);
  if (!name || String(name).startsWith('tower-upload-')) return false;
  return true;
}

/** 镜像列表仍有待同步/同步中/失败数据时，禁止在抽屉内单独删除上传任务记录（须在列表删镜像数据） */
export function isUploadTaskDeleteBlocked(task: HarvesterImageUploadTask): boolean {
  const st = String(task.status || '').toLowerCase();
  if (st === 'success' || st === 'cancelled') return false;
  return (
    st === 'uploaded' ||
    st === 'pending' ||
    st === 'ingesting' ||
    st === 'proxying' ||
    st === 'failed'
  );
}

export function getUploadTaskDeleteBlockedMessage(task: HarvesterImageUploadTask): string | null {
  if (!isUploadTaskDeleteBlocked(task)) return null;
  const st = String(task.status || '').toLowerCase();
  if (st === 'uploaded' || isTowerImageIngestComplete(task)) {
    return '文件已传到 Tower，请在镜像列表删除镜像数据（会一并清理任务记录）';
  }
  if (st === 'failed') {
    return '上传失败，请先取消或处理失败任务后再删除';
  }
  if (st === 'pending' || st === 'ingesting') {
    return '分片上传进行中，请先取消任务或等待完成后再删除';
  }
  return '任务进行中，暂不允许删除';
}

export function getImageRowDeleteBlockedMessage(
  r: ImageListRecord,
  vms?: readonly ImageListRecord[],
): string | null {
  if (isImageRowDeleteBlockedBySync(r)) {
    return '镜像导入/上传进行中，请等待完成或失败后再删除';
  }
  if (Array.isArray(vms) && vms.length > 0) {
    const blocked = assessImageDeleteBlockedByVms(r, vms as ImageListRecord[]);
    if (blocked) return blocked;
  }
  return null;
}

function imageListTowerUploadDeleteLabel(r: ImageListRecord): string {
  const alias = getImageDisplayAlias(r);
  const name = getImageRowId(r);
  return alias ? `${alias} (${name})` : name;
}

export function imageListLocalUploadDeleteConfirmContent(r: ImageListRecord): string {
  const label = imageListTowerUploadDeleteLabel(r);
  if (shouldDeleteClusterImageForLocalUploadRow(r)) {
    return `将删除 Harvester 集群中的镜像：${label}，并同步删除关联的上传任务记录`;
  }
  return `将删除 Tower 上的镜像暂存文件：${label}，并同步删除关联的上传任务记录`;
}

/** 镜像列表删除成功提示 */
export function resolveImageDeleteSuccessMessage(opts: {
  localUpload: boolean;
  deleteCluster: boolean;
  deletedTask: boolean;
  clusterNotFound?: boolean;
  taskDeleteFailed?: boolean;
}): string {
  const { localUpload, deleteCluster, deletedTask, clusterNotFound, taskDeleteFailed } = opts;
  if (localUpload && taskDeleteFailed) {
    if (deleteCluster && !clusterNotFound) {
      return '集群镜像已删除，但上传任务记录删除失败，请稍后在「镜像上传任务」中重试';
    }
    return '上传任务记录删除失败，请稍后在「镜像上传任务」中重试';
  }
  if (clusterNotFound && deletedTask) {
    return '集群镜像不存在或已删除，上传任务记录已删除';
  }
  if (!localUpload) return '删除成功';
  if (deleteCluster && deletedTask) return '镜像及上传任务已删除';
  if (deleteCluster) return '镜像已删除';
  if (deletedTask) return '镜像暂存及上传任务已删除';
  return '删除成功';
}

/** 库存行是否已有 Tower 上传/同步任务（用于避免重复刷新库存覆盖进度） */
export function shouldRefreshInventoryAfterUploadTaskDelete(
  task: HarvesterImageUploadTask,
): boolean {
  if (String(task.status || '') === 'success') return true;
  return Boolean(String(task.createdImageName || '').trim());
}

/** 删除上传任务记录时的确认说明（任务记录 ≠ 集群镜像） */
export function uploadTaskDeleteConfirmContent(task: HarvesterImageUploadTask): string {
  const label = task.displayName || task.filename || task.id;
  if (shouldRefreshInventoryAfterUploadTaskDelete(task)) {
    return '将仅删除 Tower 上的任务记录，不会删除 Harvester 集群中的镜像。';
  }
  return `将删除 Tower 上传任务记录及本地暂存文件：${label}`;
}

export function findUploadTaskForImageRow(
  img: ImageListRecord,
  tasks: readonly HarvesterImageUploadTask[],
  allImages: readonly ImageListRecord[] = [],
): HarvesterImageUploadTask | undefined {
  let best: HarvesterImageUploadTask | undefined;
  for (const task of tasks) {
    best = pickStrongerUploadTaskMatch(img, task, best, allImages);
  }
  return best;
}

/** 镜像行关联的 Tower 上传任务 id（行内标记或 listTaskList 匹配） */
export function resolveLinkedUploadTaskId(
  r: ImageListRecord,
  tasks: readonly HarvesterImageUploadTask[],
): string | undefined {
  const fromRow = getTowerUploadTaskIdFromRow(r);
  if (fromRow) return fromRow;
  return findUploadTaskForImageRow(r, tasks)?.id;
}

/** 合并多处缓存的上传任务列表（去重），供删除/关联解析使用 */
export function mergeUploadTasksForLookup(
  ...sources: readonly (readonly HarvesterImageUploadTask[])[]
): HarvesterImageUploadTask[] {
  const flat = sources.flat().filter(Boolean);
  if (flat.length === 0) return [];
  return mergeUploadTasksSorted([], flat);
}

/** 虚拟行 `tower-upload-{taskId}` 解析任务 id */
export function parseTowerUploadVirtualTaskIdFromRow(r: ImageListRecord): string | undefined {
  const name = String(getImageRowId(r) || '').trim();
  const prefix = 'tower-upload-';
  if (!name.startsWith(prefix)) return undefined;
  const id = name.slice(prefix.length).trim();
  return id || undefined;
}

/** 镜像行关联的上传任务 id（行标记 / 虚拟名） */
export function resolveTaskIdFromImageRow(r: ImageListRecord): string | undefined {
  const fromRow = getTowerUploadTaskIdFromRow(r);
  if (fromRow) return fromRow;
  if (isTowerUploadVirtualRow(r)) return parseTowerUploadVirtualTaskIdFromRow(r);
  return undefined;
}

/**
 * 删除本地上传镜像时需同步清理的上传任务 id（行内标记 + 虚拟名 + 任务列表匹配 + API 兜底）。
 */
export async function resolveLinkedUploadTaskIdsForDelete(
  cloudId: string,
  r: ImageListRecord,
  ...cachedSources: readonly (readonly HarvesterImageUploadTask[])[]
): Promise<string[]> {
  const merged = mergeUploadTasksForLookup(...cachedSources);
  if (!isLocalUploadImageRow(r, merged)) return [];

  const ids = new Set<string>();
  const fromRow = getTowerUploadTaskIdFromRow(r);
  if (fromRow) ids.add(fromRow);
  const virtualId = parseTowerUploadVirtualTaskIdFromRow(r);
  if (virtualId) ids.add(virtualId);
  const matched = findUploadTaskForImageRow(r, merged);
  if (matched?.id) ids.add(matched.id);

  if (ids.size === 0) {
    try {
      const list = await fetchUploadTasksWithTimeout(cloudId);
      for (const t of list) {
        if (!t?.id) continue;
        if (imageMatchesUploadTask(r, t)) ids.add(t.id);
      }
    } catch {
      /* ignore：删除仍以集群镜像为准，后端会按镜像名清理关联任务 */
    }
  }

  return [...ids];
}

/** 本地上传镜像删除：本地未命中时从 API 拉取任务列表再匹配 */
export async function fetchLinkedUploadTaskId(
  cloudId: string,
  r: ImageListRecord,
  cachedTasks: readonly HarvesterImageUploadTask[],
): Promise<string | undefined> {
  const ids = await resolveLinkedUploadTaskIdsForDelete(cloudId, r, cachedTasks);
  return ids[0];
}

/** 批量删镜像后，找出仍挂在 listTaskList 上、对应已删库存行的任务 id */
export function uploadTaskIdsForDeletedImageKeys(
  tasks: readonly HarvesterImageUploadTask[],
  deletedKeys: ReadonlySet<string>,
): string[] {
  const ids: string[] = [];
  for (const t of tasks) {
    if (!t?.id) continue;
    const ns = String(t.createdImageNamespace || t.namespace || 'default').trim();
    const name = String(t.createdImageName || '').trim();
    if (name && deletedKeys.has(`${ns}/${name}`)) {
      ids.push(t.id);
      continue;
    }
    const virtualName = `tower-upload-${t.id}`;
    if (deletedKeys.has(`${ns}/${virtualName}`)) {
      ids.push(t.id);
    }
  }
  return ids;
}

/** 镜像列表进度列：已就绪显示完成(100)；进行中展示底座 status.progress（>0） */
export function resolveImageListDisplayProgress(r: ImageListRecord): number | null {
  const stateKey = resolveImageListStateKey(r);
  if (stateKey === 'ready') return 100;
  if (['pending_sync', 'failed', 'cancelled', 'unknown'].includes(stateKey)) {
    return null;
  }
  const progress = readClusterVmImageImportProgress(r);
  if (progress === undefined || !Number.isFinite(progress) || progress <= 0) return null;
  return Math.max(0, Math.min(100, progress));
}

function taskShowsInImageList(task: HarvesterImageUploadTask): boolean {
  // 列表状态/进度只看底座；已取消任务仅在「上传任务」抽屉展示
  return ['uploaded', 'proxying', 'failed'].includes(String(task.status || ''));
}

/** 库存已有同镜像 ready 行时，不再生成 tower-upload 虚拟行（任务状态可能尚未收成 success） */
function taskAlreadyFulfilledByReadyInventory(
  task: HarvesterImageUploadTask,
  images: readonly ImageListRecord[],
): boolean {
  const st = String(task.status || '');
  if (!['uploaded', 'proxying'].includes(st)) return false;
  const taskName = String(task.createdImageName || '').trim();
  const taskNs = String(task.createdImageNamespace || task.namespace || '').trim();
  const taskAlias = String(task.displayName || task.filename || '').trim();
  for (const img of images) {
    if (isTowerUploadVirtualRow(img)) continue;
    if (resolveImageListStateKey(img) !== 'ready') continue;
    const imgNs = getImageRowNamespace(img);
    if (taskNs && imgNs !== taskNs) continue;
    if (taskName && getImageRowId(img) === taskName) return true;
    if (taskAlias && getImageDisplayAlias(img) === taskAlias) return true;
  }
  return false;
}

export type ImageListProgressPollPlan = {
  pollUploadTasks: boolean;
  pollInventory: boolean;
};

function isHarvesterImageAwaitingClusterProgress(img: ImageListRecord): boolean {
  const stateKey = resolveImageListStateKey(img);
  if (['ready', 'failed', 'cancelled', 'pending_sync', 'unknown'].includes(stateKey)) {
    return false;
  }
  return CLUSTER_IN_PROGRESS_STATE_KEYS.includes(
    stateKey as (typeof CLUSTER_IN_PROGRESS_STATE_KEYS)[number],
  );
}

const IMAGE_LIST_TERMINAL_STATE_KEYS = new Set(['ready', 'failed', 'cancelled']);

function uploadTaskNeedsListReconcile(
  task: HarvesterImageUploadTask,
  images: readonly ImageListRecord[],
): boolean {
  const st = String(task.status || '').toLowerCase();
  if (['pending', 'ingesting', 'uploaded', 'proxying'].includes(st)) return true;
  if (st !== 'failed') return false;

  const matchedRow = images.find((img) => imageMatchesUploadTask(img, task, images));
  if (!matchedRow) return true;
  return !IMAGE_LIST_TERMINAL_STATE_KEYS.has(resolveImageListStateKey(matchedRow));
}

/** 镜像列表轮询：库存 API 拉底座 live 状态；任务轮询仅用于 reconcile 与无 CR 虚拟行。 */
export function planImageListProgressPoll(
  tasks: readonly HarvesterImageUploadTask[],
  images: readonly ImageListRecord[],
): ImageListProgressPollPlan {
  const pollInventory = images.some((img) => isHarvesterImageAwaitingClusterProgress(img));
  const pollUploadTasks = tasks.some((task) => uploadTaskNeedsListReconcile(task, images));
  return {
    pollUploadTasks,
    pollInventory: pollInventory || pollUploadTasks,
  };
}

/** 本地上传任务 → 镜像类型 metadata（与后端 vmImageHarvesterMetadataLikeUi 对齐） */
export function imageTypeFieldsFromUploadTask(task: HarvesterImageUploadTask): {
  diskFormat?: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
} {
  const it = String(task.imageType || '').toLowerCase();
  const diskFormat = it === 'iso' ? 'iso' : it === 'disk' ? 'qcow2' : undefined;
  const labels: Record<string, string> = {};
  if (it === 'iso') labels['harvesterhci.io/image-type'] = 'iso';
  else if (it === 'disk') labels['harvesterhci.io/image-type'] = 'disk';
  const annotations: Record<string, string> = {};
  const imageName = String(task.filename || task.displayName || '').trim();
  if (imageName) annotations['harvesterhci.io/image-name'] = imageName;
  return { diskFormat, labels, annotations };
}

function mergeImageTypeFieldsIntoRow(
  img: ImageListRecord,
  task: HarvesterImageUploadTask,
): ImageListRecord {
  const { diskFormat, labels, annotations } = imageTypeFieldsFromUploadTask(task);
  let row = img;
  if (diskFormat || Object.keys(labels).length || Object.keys(annotations).length) {
    const meta = (img.metadata || {}) as Record<string, unknown>;
    const existingLabels = (meta.labels || {}) as Record<string, string>;
    const existingAnn = (meta.annotations || {}) as Record<string, string>;
    const spec = (img.spec || {}) as Record<string, unknown>;
    row = {
      ...img,
      spec: {
        ...spec,
        ...(diskFormat ? { diskFormat } : {}),
      },
      metadata: {
        ...meta,
        labels: { ...existingLabels, ...labels },
        annotations: { ...existingAnn, ...annotations },
      },
    };
  }
  return enrichImageRowSizeFromUploadTask(row, task);
}

/** 库存行缺 size 时，用 upload-task 的 fileSize 回填实际大小（Tower 上传镜像常见） */
export function enrichImageRowSizeFromUploadTask(
  img: ImageListRecord,
  task: HarvesterImageUploadTask,
): ImageListRecord {
  const fileSize = Math.max(0, Number(task.fileSize) || 0);
  if (!fileSize) return img;

  const status = (img.status || {}) as Record<string, unknown>;
  const spec = (img.spec || {}) as Record<string, unknown>;

  const clusterBytes = getImageActualFileBytes(img);
  const virtualBytes =
    getImageVirtualSizeBytes(img) ??
    (Number(task.virtualSizeBytes) > 0 ? Number(task.virtualSizeBytes) : undefined);
  const preferTaskFileSize =
    clusterReportedSizeLooksLikeVirtualCapacity(clusterBytes, virtualBytes, fileSize) ||
    clusterBytes == null;

  const sc = getImageStorageClassName(img);

  const nextStatus: Record<string, unknown> = { ...status };
  const nextSpec: Record<string, unknown> = { ...spec };
  let next: ImageListRecord = { ...img };

  if (preferTaskFileSize) {
    nextStatus.size = fileSize;
    next.size = fileSize;
  }
  if (sc && sc !== 'longhorn') {
    next.storageClassName = sc;
    nextSpec.storageClassName = sc;
    if (!nextStatus.storageClassName) nextStatus.storageClassName = sc;
  }

  return { ...next, status: nextStatus, spec: nextSpec };
}

function isUploadSourceImageRow(img: ImageListRecord): boolean {
  return (
    String(
      img?.sourceType || (img?.spec as Record<string, unknown> | undefined)?.sourceType || '',
    ).toLowerCase() === 'upload'
  );
}

function isInProgressUploadInventoryRow(img: ImageListRecord): boolean {
  if (isTowerUploadVirtualRow(img) || !isUploadSourceImageRow(img)) return false;
  return CLUSTER_IN_PROGRESS_STATE_KEYS.includes(
    resolveImageListStateKey(img) as (typeof CLUSTER_IN_PROGRESS_STATE_KEYS)[number],
  );
}

function countInProgressUploadRowsInNamespace(
  images: readonly ImageListRecord[],
  namespace: string,
): number {
  return images.filter(
    (row) => getImageRowNamespace(row) === namespace && isInProgressUploadInventoryRow(row),
  ).length;
}

/** 任务与库存行关联强度（越高越优先）；0 表示不匹配 */
function uploadTaskImageMatchStrength(
  img: ImageListRecord,
  task: HarvesterImageUploadTask,
  allImages: readonly ImageListRecord[],
): number {
  if (isTowerUploadVirtualRow(img)) {
    const taskId = getTowerUploadTaskIdFromRow(img) || parseTowerUploadVirtualTaskIdFromRow(img);
    return taskId === task.id ? 100 : 0;
  }

  const imgName = getImageRowId(img);
  const imgNs = getImageRowNamespace(img);
  const taskName = String(task.createdImageName || '').trim();
  const taskNs = String(task.createdImageNamespace || task.namespace || '').trim();
  const taskSt = String(task.status || '');

  if (taskNs && imgNs !== taskNs) return 0;

  const linkedId = getTowerUploadTaskIdFromRow(img);
  if (linkedId && linkedId !== task.id) return 0;

  if (taskName && taskNs && imgName === taskName && imgNs === taskNs) return 90;

  if (taskSt === 'cancelled') return 0;
  if (taskSt === 'success') {
    if (taskName && taskNs && imgName === taskName && imgNs === taskNs) return 90;
    if (linkedId === task.id) return 85;
    const taskAlias = String(task.displayName || task.filename || '').trim();
    const imgAlias = getImageDisplayAlias(img);
    if (
      taskAlias &&
      imgAlias &&
      taskAlias === imgAlias &&
      resolveImageListStateKey(img) === 'ready'
    ) {
      return 75;
    }
    return 0;
  }
  if (!['uploaded', 'proxying', 'failed'].includes(taskSt)) return 0;
  if (!isUploadSourceImageRow(img)) return 0;

  if (linkedId === task.id) return 85;

  const taskAlias = String(task.displayName || task.filename || '').trim();
  const imgAlias = getImageDisplayAlias(img);
  const stateKey = resolveImageListStateKey(img);

  if (taskAlias && imgAlias && taskAlias === imgAlias) {
    if (['uploaded', 'proxying'].includes(taskSt)) {
      // 底座已 Imported 但任务仍为 proxying（轮询滞后）时，归并到 ready 库存行，避免虚拟 tower-upload 双行
      if (stateKey === 'ready') return 75;
      if (
        CLUSTER_IN_PROGRESS_STATE_KEYS.includes(
          stateKey as (typeof CLUSTER_IN_PROGRESS_STATE_KEYS)[number],
        )
      ) {
        return 70;
      }
    }
    if (taskSt === 'failed' && stateKey === 'failed') return 65;
  }

  // 同步刚启动、任务 createdImageName 尚未回写：同 namespace 仅一条进行中 upload 库存行时归并
  if (
    taskSt === 'proxying' &&
    !taskName &&
    isInProgressUploadInventoryRow(img) &&
    countInProgressUploadRowsInNamespace(allImages, imgNs) === 1
  ) {
    return 50;
  }

  return 0;
}

function imageMatchesUploadTask(
  img: ImageListRecord,
  task: HarvesterImageUploadTask,
  allImages: readonly ImageListRecord[] = [],
): boolean {
  return uploadTaskImageMatchStrength(img, task, allImages) > 0;
}

function pickStrongerUploadTaskMatch(
  img: ImageListRecord,
  candidate: HarvesterImageUploadTask,
  current: HarvesterImageUploadTask | undefined,
  allImages: readonly ImageListRecord[],
): HarvesterImageUploadTask {
  if (!current) return candidate;
  const candidateScore = uploadTaskImageMatchStrength(img, candidate, allImages);
  const currentScore = uploadTaskImageMatchStrength(img, current, allImages);
  return candidateScore > currentScore ? candidate : current;
}

/**
 * 同步重试会 generateName 出新 image-id；隐藏同 displayName 下已被任务取代的旧 upload 库存行，避免列表双行。
 */
export function shouldHideSupersededTowerUploadInventoryRow(
  img: ImageListRecord,
  tasks: readonly HarvesterImageUploadTask[],
): boolean {
  const imgName = getImageRowId(img);
  const imgNs = getImageRowNamespace(img);
  const alias = getImageDisplayAlias(img);
  if (!imgName || !imgNs || !alias) return false;
  const sourceType = String(
    img?.sourceType || (img?.spec as Record<string, unknown> | undefined)?.sourceType || '',
  ).toLowerCase();
  if (sourceType !== 'upload') return false;

  const linkedTaskId = getTowerUploadTaskIdFromRow(img);

  for (const task of tasks) {
    const st = String(task.status || '');
    if (!['uploaded', 'proxying', 'failed'].includes(st)) continue;
    const taskNs = String(task.createdImageNamespace || task.namespace || '').trim();
    const taskName = String(task.createdImageName || '').trim();
    const taskAlias = String(task.displayName || task.filename || '').trim();

    // 同步重试刚启动时 createdImageName 会被清空，需按任务 id / 别名隐藏旧失败行
    if (['uploaded', 'proxying'].includes(st) && taskNs === imgNs) {
      if (linkedTaskId && linkedTaskId === task.id && (!taskName || imgName !== taskName)) {
        return true;
      }
      if (
        !taskName &&
        taskAlias &&
        taskAlias === alias &&
        ['failed', 'cancelled'].includes(resolveImageListStateKey(img))
      ) {
        return true;
      }
    }

    if (!taskName || taskNs !== imgNs) continue;
    if (!taskAlias || taskAlias !== alias) continue;
    if (imgName === taskName) continue;
    return true;
  }
  return false;
}

export function uploadTaskToVirtualImageRow(
  task: HarvesterImageUploadTask,
  options?: { isPublicNamespace?: (name: string) => boolean },
): ImageListRecord {
  const st = String(task.status || '');
  const state =
    st === 'cancelled' ? 'cancelled' : st === 'proxying' ? 'syncing' : 'pending_sync';
  const rowName = task.createdImageName || `tower-upload-${task.id}`;
  const ns = String(task.namespace || '').trim();
  const namespacePublicByScenario = options?.isPublicNamespace?.(ns) === true;
  const { diskFormat, labels: typeLabels, annotations: typeAnn } =
    imageTypeFieldsFromUploadTask(task);
  const displayLabel = task.displayName || task.filename;
  const fileSize = Math.max(0, Number(task.fileSize) || 0);

  return {
    [TOWER_UPLOAD_VIRTUAL_ROW_FLAG]: true,
    [TOWER_UPLOAD_TASK_ID_KEY]: task.id,
    name: rowName,
    namespace: task.namespace,
    namespacePublicByScenario,
    displayName: displayLabel,
    size: fileSize || undefined,
    state,
    spec: {
      displayName: displayLabel,
      sourceType: 'upload',
      ...(diskFormat ? { diskFormat } : {}),
      ...(fileSize ? { size: fileSize } : {}),
    },
    ...(fileSize
      ? {
          status: { size: fileSize },
        }
      : {}),
    metadata: {
      name: rowName,
      namespace: task.namespace,
      creationTimestamp: task.createdAt,
      labels: {
        ...(displayLabel ? { 'harvesterhci.io/imageDisplayName': displayLabel } : {}),
        ...typeLabels,
      },
      ...(Object.keys(typeAnn).length ? { annotations: typeAnn } : {}),
    },
  };
}

/**
 * 上传任务与镜像列表合并：库存行仅挂 __towerUploadTaskId；无 CR 时生成虚拟 pending_sync 行。
 * 列表状态与进度一律由底座（resolveImageListStateKey / resolveImageListDisplayProgress）决定。
 */
export function mergeUploadTasksIntoImageList(
  images: readonly ImageListRecord[],
  tasks: readonly HarvesterImageUploadTask[],
  options?: { isPublicNamespace?: (name: string) => boolean },
): ImageListRecord[] {
  const listTasks = tasks.filter(taskShowsInImageList);
  const enrichTasks = tasks.filter((task) => {
    const st = String(task.status || '');
    return ['uploaded', 'proxying', 'failed', 'success'].includes(st);
  });
  const visibleImages = images.filter(
    (img) => !shouldHideSupersededTowerUploadInventoryRow(img, listTasks),
  );
  const taskByImageKey = new Map<string, HarvesterImageUploadTask>();

  for (const task of enrichTasks) {
    for (const img of visibleImages) {
      if (!imageMatchesUploadTask(img, task, visibleImages)) continue;
      const key = `${getImageRowNamespace(img)}/${getImageRowId(img)}`;
      taskByImageKey.set(
        key,
        pickStrongerUploadTaskMatch(img, task, taskByImageKey.get(key), visibleImages),
      );
    }
  }

  const patched = visibleImages.map((img) => {
    const key = `${getImageRowNamespace(img)}/${getImageRowId(img)}`;
    const task = taskByImageKey.get(key);
    if (!task) return img;
    const withType = mergeImageTypeFieldsIntoRow(img, task);
    return { ...withType, [TOWER_UPLOAD_TASK_ID_KEY]: task.id };
  });

  const virtualRows: ImageListRecord[] = [];
  for (const task of listTasks) {
    if (taskAlreadyFulfilledByReadyInventory(task, visibleImages)) continue;
    const duplicated = visibleImages.some((img) =>
      imageMatchesUploadTask(img, task, visibleImages),
    );
    if (!duplicated) {
      virtualRows.push(uploadTaskToVirtualImageRow(task, options));
    }
  }

  return [...virtualRows, ...patched];
}
