import {
  findVmsReferencingHarvesterImage,
  formatHarvesterImageDeleteInUseMessage,
  stripHarvesterImageDeleteErrorPrefixes,
} from 'utils/harvesterUtils';
import type { HarvesterImageUploadTask } from '../../../../../../services/harvesterApi';
import { fetchHarvesterImageUploadTasks } from '../../../../../../services/harvesterApi';
import {
  getImageActualFileBytes,
  getImageStorageClassName,
  getImageDisplayAlias,
  getImageRowId,
  getImageRowNamespace,
  getImageVirtualSizeBytes,
  type ImageListRecord,
} from './imagesSectionUtils';
import {
  isClusterVmImageImportComplete,
  readClusterVmImageImportProgress,
  resolveImageListStateKey,
  resolveVmImageImportFailureMessage,
} from './vmImageStatus';

export type BatchImageDeleteResult = {
  ok: boolean;
  name: string;
  ns?: string;
  id?: string;
  err?: string;
};

export function getImageNsNameKey(r: ImageListRecord): string {
  return `${getImageRowNamespace(r)}/${getImageRowId(r)}`;
}

export function selectImagesByRowKeys(
  images: readonly ImageListRecord[],
  selectedKeys: Array<string | number>,
): ImageListRecord[] {
  const map = new Map<string, ImageListRecord>();
  for (const r of images) map.set(getImageRowId(r), r);
  return selectedKeys.map((k) => map.get(String(k))).filter(Boolean) as ImageListRecord[];
}

export function assessImageDeleteBlockedByVms(
  r: ImageListRecord,
  vms: ImageListRecord[],
): string | null {
  const name = getImageRowId(r);
  if (!name) return null;
  const ns = getImageRowNamespace(r);
  const used = findVmsReferencingHarvesterImage(ns, name, vms);
  if (used.length === 0) return null;
  return `镜像仍被以下虚拟机使用，无法删除：${used.map((u) => u.label).join('、')}`;
}

export function isImageDeleteInUseHttpError(err: unknown): boolean {
  const msg = extractImageDeleteErrorText(err).toLowerCase();
  return (
    (err as { status?: number })?.status === 422 ||
    msg.includes('422') ||
    msg.includes('in use') ||
    msg.includes('being used') ||
    msg.includes('cannot delete image') ||
    msg.includes('被使用') ||
    msg.includes('仍被')
  );
}

export function getImageDeleteInUseErrorMessage(): string {
  return '镜像仍被虚拟机使用，无法删除';
}

const IMAGE_IN_USE_FRIENDLY_RE =
  /^镜像仍被虚拟机「[^」]+」使用，无法删除$|^镜像仍被以下虚拟机使用，无法删除：/;

/** 将 Harvester 删除镜像 webhook / API 英文报错转为可读中文 */
export function formatHarvesterImageDeleteError(
  err: unknown,
  opts?: { vms?: any[] },
): string {
  const raw = extractImageDeleteErrorText(err);
  if (!raw) return '删除失败';

  if (IMAGE_IN_USE_FRIENDLY_RE.test(raw)) return raw;

  for (const candidate of collectImageDeleteErrorCandidates(err)) {
    const inUse = formatHarvesterImageDeleteInUseMessage(candidate, opts);
    if (inUse && !isGenericImageInUseMessage(inUse)) return inUse;
  }

  const stripped = stripHarvesterImageDeleteErrorPrefixes(raw);
  if (stripped && stripped !== raw) {
    const nested = formatHarvesterImageDeleteInUseMessage(stripped, opts);
    if (nested && !isGenericImageInUseMessage(nested)) return nested;
  }

  const friendlyFromRaw = formatHarvesterImageDeleteInUseMessage(raw, opts);
  if (friendlyFromRaw) return friendlyFromRaw;

  if (isImageDeleteInUseHttpError(err) || /cannot delete image/i.test(stripped || raw)) {
    return getImageDeleteInUseErrorMessage();
  }

  return raw.startsWith('删除') || raw.startsWith('镜像仍被') ? raw : `删除失败：${raw}`;
}

function isGenericImageInUseMessage(msg: string): boolean {
  return msg === getImageDeleteInUseErrorMessage();
}

function collectImageDeleteErrorCandidates(err: unknown): string[] {
  const e = err as {
    message?: string;
    responseData?: { message?: string; error?: string };
  };
  const out: string[] = [];
  const push = (v: unknown) => {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s && !out.includes(s)) out.push(s);
  };
  push(e?.responseData?.message);
  push(e?.responseData?.error);
  push(e?.message);
  return out;
}

function extractImageDeleteErrorText(err: unknown): string {
  const candidates = collectImageDeleteErrorCandidates(err);
  const detailed = candidates.find((m) =>
    /cannot delete image|being used by volume|admission webhook/i.test(m),
  );
  if (detailed) return detailed;

  const friendly = candidates.find((m) => IMAGE_IN_USE_FRIENDLY_RE.test(m));
  if (friendly) return friendly;

  return String(candidates[0] || err || '').trim();
}

export function getImageBatchDeleteLabel(r: ImageListRecord): string {
  const name = getImageRowId(r);
  const alias = getImageDisplayAlias(r);
  return alias ? `${alias} (${name})` : name;
}

export async function mapBatchImageDelete(
  targets: readonly ImageListRecord[],
  deleteOne: (r: ImageListRecord) => Promise<void>,
  opts?: { vms?: any[] },
): Promise<BatchImageDeleteResult[]> {
  const results: BatchImageDeleteResult[] = [];
  for (const r of targets) {
    const ns = getImageRowNamespace(r);
    const name = getImageRowId(r);
    const label = getImageBatchDeleteLabel(r);
    try {
      await deleteOne(r);
      results.push({ ok: true, name: label, ns, id: name });
    } catch (e: unknown) {
      results.push({
        ok: false,
        name: label,
        err: formatHarvesterImageDeleteError(e, opts),
      });
    }
  }
  return results;
}

export function summarizeBatchImageDeleteMessage(results: readonly BatchImageDeleteResult[]): {
  success?: string;
  error?: string;
  deletedKeys: Set<string>;
} {
  const okResults = results.filter((x) => x.ok);
  const fail = results.filter((x) => !x.ok);
  const deletedKeys = new Set(
    okResults.filter((r) => r.ns && r.id).map((r) => `${r.ns}/${r.id}`),
  );
  return {
    success: okResults.length > 0 ? `删除成功 ${okResults.length} 条` : undefined,
    error:
      fail.length > 0
        ? `删除失败 ${fail.length} 条：${fail.map((f) => (f.err ? `${f.name}（${f.err}）` : f.name)).join('；')}`
        : undefined,
    deletedKeys,
  };
}

export function filterImageListAfterDelete(
  prev: readonly ImageListRecord[],
  deletedKeys: ReadonlySet<string>,
): ImageListRecord[] {
  return prev.filter((img) => !deletedKeys.has(getImageNsNameKey(img)));
}

/** 将单条 upload task 合并进 listTaskList；success 暂留列表直至库存行就绪 */
export function applyUploadTaskToListState(
  prev: readonly HarvesterImageUploadTask[],
  task: HarvesterImageUploadTask,
): { next: HarvesterImageUploadTask[]; becameSuccess: boolean } {
  const st = String(task.status || '');
  if (st === 'success') {
    const wasAlreadySuccess = prev.some((x) => x.id === task.id && x.status === 'success');
    const shouldNotify =
      !wasAlreadySuccess && (prev.some((x) => x.id === task.id) || !!task.createdImageName);
    return { next: mergeUploadTasksSorted(prev, task), becameSuccess: shouldNotify };
  }
  if (['uploaded', 'proxying', 'failed', 'cancelled'].includes(st)) {
    return { next: mergeUploadTasksSorted(prev, task), becameSuccess: false };
  }
  return { next: [...prev], becameSuccess: false };
}

/** 需合并进镜像列表或触发库存刷新的上传任务终态 */
export function taskAffectsImageList(task: HarvesterImageUploadTask): boolean {
  return ['uploaded', 'proxying', 'failed', 'success', 'cancelled'].includes(
    String(task.status || ''),
  );
}

export function mergeUploadTasksSorted(
  prev: readonly HarvesterImageUploadTask[],
  incoming: HarvesterImageUploadTask | readonly HarvesterImageUploadTask[],
): HarvesterImageUploadTask[] {
  const map = new Map(prev.map((x) => [x.id, x]));
  const list = Array.isArray(incoming) ? incoming : [incoming];
  for (const task of list) {
    if (!task?.id) continue;
    const existing = map.get(task.id);
    map.set(task.id, existing ? mergeUploadTaskRecord(existing, task) : task);
  }
  return Array.from(map.values()).sort(
    (a, b) =>
      new Date(b.createdAt || b.updatedAt || 0).getTime() -
      new Date(a.createdAt || a.updatedAt || 0).getTime(),
  );
}

function isActiveIngestUploadTask(task: HarvesterImageUploadTask): boolean {
  return ['pending', 'ingesting'].includes(String(task.status || '').toLowerCase());
}

/** 上传任务抽屉：展示用状态（同步阶段仍显示为 uploaded，不展示同步中/已完成等） */
export function getUploadDrawerDisplayStatus(task: HarvesterImageUploadTask): string {
  const st = String(task.status || '').toLowerCase();
  if (st === 'cancelled') return 'cancelled';
  const ingestComplete =
    st === 'uploaded' ||
    Number(task.ingestProgress ?? 0) >= 100 ||
    ['proxying', 'success'].includes(st);
  if (ingestComplete && ['uploaded', 'proxying', 'success', 'failed'].includes(st)) {
    return 'uploaded';
  }
  return st;
}

/** 是否已进入同步阶段（抽屉内不展示同步状态，仅用于提示文案） */
export function isUploadTaskInSyncPhase(task: HarvesterImageUploadTask): boolean {
  const st = String(task.status || '').toLowerCase();
  if (['proxying', 'success'].includes(st)) return true;
  if (st === 'failed' && Number(task.ingestProgress ?? 0) >= 100) return true;
  return false;
}

/** 生命周期越靠后 rank 越高；合并时优先保留阶段更靠后的记录（如 uploaded → proxying） */
function uploadTaskLifecycleRank(status: string): number {
  const st = String(status || '').toLowerCase();
  const ranks: Record<string, number> = {
    cancelled: 0,
    pending: 10,
    ingesting: 20,
    uploaded: 30,
    failed: 35,
    proxying: 40,
    success: 50,
  };
  return ranks[st] ?? 0;
}

function isUploadTaskTerminalStatus(status: string): boolean {
  return ['cancelled', 'success', 'failed'].includes(String(status || '').toLowerCase());
}

/** 合并同 id 任务：ingest / 集群 sync 阶段保留更高进度，避免轮询回退到 0 显示为 - */
function mergeUploadTaskRecord(
  a: HarvesterImageUploadTask,
  b: HarvesterImageUploadTask,
): HarvesterImageUploadTask {
  const stA = String(a.status || '').toLowerCase();
  const stB = String(b.status || '').toLowerCase();
  const termA = isUploadTaskTerminalStatus(stA);
  const termB = isUploadTaskTerminalStatus(stB);
  if (termA || termB) {
    const picked =
      termA && termB
        ? new Date(b.updatedAt || 0).getTime() >= new Date(a.updatedAt || 0).getTime()
          ? b
          : a
        : termB
          ? b
          : a;
    if (String(picked.status || '').toLowerCase() === 'cancelled') {
      return {
        ...picked,
        receivedChunks: [],
        progress: 0,
        ingestProgress: 0,
      } as HarvesterImageUploadTask;
    }
    return picked;
  }

  let picked: HarvesterImageUploadTask;
  if (!isActiveIngestUploadTask(a) && !isActiveIngestUploadTask(b)) {
    const rankA = uploadTaskLifecycleRank(stA);
    const rankB = uploadTaskLifecycleRank(stB);
    const syncLike = (st: string) => ['proxying', 'failed', 'success'].includes(st);
    if (rankA !== rankB) {
      picked = rankB > rankA ? b : a;
    } else if (syncLike(stA) || syncLike(stB)) {
      const progA = Math.max(Number(a.proxyProgress || 0), Number(a.progress || 0));
      const progB = Math.max(Number(b.proxyProgress || 0), Number(b.progress || 0));
      if (progB > progA) picked = b;
      else if (progA > progB) picked = a;
      else {
        picked =
          new Date(b.updatedAt || 0).getTime() >= new Date(a.updatedAt || 0).getTime() ? b : a;
      }
    } else {
      picked =
        new Date(b.updatedAt || 0).getTime() >= new Date(a.updatedAt || 0).getTime() ? b : a;
    }
  } else {
    const progA = getTowerUploadTaskProgress(a);
    const progB = getTowerUploadTaskProgress(b);
    if (progB > progA) picked = b;
    else if (progA > progB) picked = a;
    else {
      picked =
        new Date(b.updatedAt || 0).getTime() >= new Date(a.updatedAt || 0).getTime() ? b : a;
    }
  }
  const other = picked === a ? b : a;
  const pickedExt = picked as Record<string, unknown>;
  const otherExt = other as Record<string, unknown>;

  const rcA = Array.isArray(a.receivedChunks) ? a.receivedChunks : [];
  const rcB = Array.isArray(b.receivedChunks) ? b.receivedChunks : [];
  const mergedReceived = rcA.length >= rcB.length ? rcA : rcB;

  let chunkIndex = pickedExt.__towerUploadChunkIndex ?? otherExt.__towerUploadChunkIndex;
  const rawInFlight = pickedExt.__towerUploadInFlightIndices ?? otherExt.__towerUploadInFlightIndices;
  let inFlightIndices: number[] | undefined = Array.isArray(rawInFlight)
    ? rawInFlight.filter((idx): idx is number => typeof idx === 'number')
    : undefined;
  const receivedSet = new Set(mergedReceived);
  if (typeof chunkIndex === 'number' && receivedSet.has(chunkIndex)) {
    chunkIndex = undefined;
  }
  if (inFlightIndices && inFlightIndices.length > 0) {
    inFlightIndices = inFlightIndices.filter((idx) => !receivedSet.has(idx));
    if (inFlightIndices.length === 0) inFlightIndices = undefined;
  }

  const merged = {
    ...picked,
    ...(mergedReceived.length > (Array.isArray(picked.receivedChunks) ? picked.receivedChunks.length : 0)
      ? { receivedChunks: mergedReceived }
      : {}),
    __towerUploadPhase: pickedExt.__towerUploadPhase ?? otherExt.__towerUploadPhase,
  } as Record<string, unknown>;

  if (chunkIndex !== undefined) merged.__towerUploadChunkIndex = chunkIndex;
  else delete merged.__towerUploadChunkIndex;

  if (inFlightIndices && inFlightIndices.length > 0) {
    merged.__towerUploadInFlightIndices = inFlightIndices;
  } else {
    delete merged.__towerUploadInFlightIndices;
  }

  return merged as HarvesterImageUploadTask;
}

/** 上传任务抽屉：浏览器 → Tower，0-100，100 表示传到 Tower 完成 */
export function getTowerUploadTaskProgress(task: HarvesterImageUploadTask): number {
  const st = String(task.status || '').toLowerCase();
  if (st === 'cancelled') return 0;
  if (st === 'uploaded' || st === 'success') return 100;
  if (['proxying', 'failed'].includes(st) && Number(task.ingestProgress) >= 100) return 100;

  const total = Math.max(0, Number(task.totalChunks || 0));
  const received = Array.isArray(task.receivedChunks) ? task.receivedChunks.length : 0;
  if (total > 0 && ['pending', 'ingesting'].includes(st)) {
    return Math.min(99.99, Math.round((received / total) * 10000) / 100);
  }

  const ingest = Math.max(0, Math.min(100, Number(task.ingestProgress ?? 0)));
  if (ingest > 0) return Math.min(99.99, ingest);

  const fallback = Number(task.progress ?? 0);
  if (['pending', 'ingesting'].includes(st)) {
    return Math.max(0, Math.min(99.99, fallback));
  }
  return Math.max(0, Math.min(100, fallback));
}

/** 镜像列表：同步进度仅来自集群 status.progress（proxyProgress），未上报前为 null */
export function getHarvesterSyncProgress(task: HarvesterImageUploadTask): number | null {
  const st = String(task.status || '').toLowerCase();
  if (st === 'uploaded') return null;
  if (st === 'success') return 100;
  if (st === 'proxying' || st === 'failed') {
    const cluster = Math.max(
      Number.isFinite(Number(task.proxyProgress)) ? Number(task.proxyProgress) : 0,
      Number.isFinite(Number(task.progress)) ? Number(task.progress) : 0,
    );
    if (cluster > 0) {
      return Math.max(0, Math.min(100, cluster));
    }
    return null;
  }
  return null;
}

export function formatUploadTaskProgressLabel(percent: number): string {
  if (!Number.isFinite(percent)) return '0%';
  if (percent >= 10) return `${Math.round(percent)}%`;
  if (percent >= 1) return `${percent.toFixed(1)}%`;
  return `${percent.toFixed(2)}%`;
}

/** 上传任务抽屉：分片进度行（兼容并行上传与轮询合并后的序号） */
export function formatImageUploadTaskChunkLine(
  task: HarvesterImageUploadTask,
  opts: { isRunning: boolean },
): string | null {
  const totalChunks = Number(task.totalChunks || 0);
  if (totalChunks <= 0) return null;
  if (!['pending', 'ingesting'].includes(String(task.status || ''))) return null;

  const receivedList = Array.isArray(task.receivedChunks) ? task.receivedChunks : [];
  const receivedCount = receivedList.length;
  const receivedSet = new Set(receivedList);
  const base = `分片 ${receivedCount}/${totalChunks}`;

  if (!opts.isRunning) return base;

  const ext = task as Record<string, unknown>;
  const inFlightRaw = ext.__towerUploadInFlightIndices;
  const inFlight: number[] = Array.isArray(inFlightRaw)
    ? inFlightRaw
        .map((x) => Number(x))
        .filter((n) => Number.isInteger(n) && n >= 0 && !receivedSet.has(n))
        .sort((a, b) => a - b)
    : [];

  if (inFlight.length === 1) {
    return `${base}（上传第 ${inFlight[0] + 1} 片）`;
  }
  if (inFlight.length > 1) {
    const labels = inFlight.map((i) => i + 1);
    if (labels.length <= 3) {
      return `${base}（并行上传第 ${labels.join('、')} 片）`;
    }
    return `${base}（并行上传第 ${labels[0]}–${labels[labels.length - 1]} 片，${labels.length} 路）`;
  }

  const chunkIdx = Number(ext.__towerUploadChunkIndex ?? -1);
  if (Number.isInteger(chunkIdx) && chunkIdx >= 0 && !receivedSet.has(chunkIdx)) {
    return `${base}（上传第 ${chunkIdx + 1} 片）`;
  }

  return `${base}（并行上传中）`;
}

export const TOWER_UPLOAD_VIRTUAL_ROW_FLAG = '__towerUploadVirtual';
export const TOWER_UPLOAD_TASK_ID_KEY = '__towerUploadTaskId';
export const TOWER_UPLOAD_SYNC_ERROR_KEY = '__towerUploadSyncError';

export function isTowerUploadVirtualRow(r: ImageListRecord): boolean {
  return !!(r as Record<string, unknown>)[TOWER_UPLOAD_VIRTUAL_ROW_FLAG];
}

export function getTowerUploadTaskIdFromRow(r: ImageListRecord): string {
  return String((r as Record<string, unknown>)[TOWER_UPLOAD_TASK_ID_KEY] || '');
}

/** 同步中不允许删除镜像/镜像数据 */
export function isImageRowDeleteBlockedBySync(r: ImageListRecord): boolean {
  return resolveImageListStateKey(r) === 'syncing';
}

export function isImageListPendingSyncRow(r: ImageListRecord): boolean {
  return resolveImageListStateKey(r) === 'pending_sync';
}

export function isImageListFailedSyncRow(r: ImageListRecord): boolean {
  return resolveImageListStateKey(r) === 'failed';
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

/** 待同步（uploaded）或本地分片写入中时不允许删除上传任务记录 */
export function isUploadTaskDeleteBlocked(task: HarvesterImageUploadTask): boolean {
  const st = String(task.status || '').toLowerCase();
  return st === 'uploaded' || st === 'pending' || st === 'ingesting';
}

export function getUploadTaskDeleteBlockedMessage(task: HarvesterImageUploadTask): string | null {
  if (!isUploadTaskDeleteBlocked(task)) return null;
  const st = String(task.status || '').toLowerCase();
  if (st === 'uploaded') {
    return '待同步期间不可删除上传任务记录，请在镜像列表删除镜像数据';
  }
  if (st === 'pending' || st === 'ingesting') {
    return '分片上传进行中，请先取消任务或等待完成后再删除';
  }
  return '任务进行中，暂不允许删除';
}

export function getImageRowDeleteBlockedMessage(r: ImageListRecord): string | null {
  if (resolveImageListStateKey(r) === 'syncing') {
    return '镜像同步中，请等待同步完成或失败后再删除';
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
    return `将删除 Harvester 集群中的镜像：${label}（若存在关联上传任务则一并删除）`;
  }
  return `将删除 Tower 上的镜像暂存文件：${label}（若存在关联上传任务则一并删除）`;
}

/** 镜像列表删除成功提示（无任务 ID 时仍可删集群镜像） */
export function resolveImageDeleteSuccessMessage(opts: {
  localUpload: boolean;
  deleteCluster: boolean;
  deletedTask: boolean;
}): string {
  const { localUpload, deleteCluster, deletedTask } = opts;
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
): HarvesterImageUploadTask | undefined {
  return tasks.find((t) => imageMatchesUploadTask(img, t));
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

/** 本地上传镜像删除：本地未命中时从 API 拉取任务列表再匹配 */
export async function fetchLinkedUploadTaskId(
  cloudId: string,
  r: ImageListRecord,
  cachedTasks: readonly HarvesterImageUploadTask[],
): Promise<string | undefined> {
  const fromCache = resolveLinkedUploadTaskId(r, cachedTasks);
  if (fromCache) return fromCache;
  if (!isLocalUploadImageRow(r, cachedTasks)) return undefined;
  try {
    const resp = (await fetchHarvesterImageUploadTasks(cloudId, 50)) as {
      data?: { items?: HarvesterImageUploadTask[] };
      items?: HarvesterImageUploadTask[];
    };
    const items = resp?.data?.items || resp?.items || [];
    const list = Array.isArray(items) ? items : [];
    return resolveLinkedUploadTaskId(r, list);
  } catch {
    return undefined;
  }
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

/** 镜像列表进度列：同步/导入进度仅展示集群上报值（>0），未开始或未上报时显示 - */
export function resolveImageListDisplayProgress(r: ImageListRecord): number | null {
  const stateKey = resolveImageListStateKey(r);
  if (stateKey === 'pending_sync' || stateKey === 'failed') return null;
  const progress = readImageRowProgress(r);
  const clusterSyncStates = ['syncing', 'downloading', 'uploading', 'importing', 'exporting'];
  if (clusterSyncStates.includes(stateKey)) {
    if (!Number.isFinite(progress) || progress <= 0) return null;
    return Math.max(0, Math.min(100, progress));
  }
  if (!Number.isFinite(progress) || progress <= 0) return null;
  return Math.max(0, Math.min(100, progress));
}

function readImageRowProgress(r: ImageListRecord): number {
  const clusterProgress = readClusterVmImageImportProgress(r);
  // 导入未完成时以集群 status.progress 为准，避免行级 progress 残留 100 覆盖真实进度
  if (!isClusterVmImageImportComplete(r)) {
    if (clusterProgress !== undefined) return clusterProgress;
    const status = r?.status as Record<string, unknown> | undefined;
    const statusProgress = Number(status?.progress);
    if (Number.isFinite(statusProgress)) return statusProgress;
    const rowProgress = Number(r?.progress);
    if (Number.isFinite(rowProgress)) return rowProgress;
    return NaN;
  }
  const status = r?.status as Record<string, unknown> | undefined;
  const rowProgress = Number(r?.progress);
  const statusProgress = Number(status?.progress);
  if (Number.isFinite(statusProgress) && statusProgress > 0) return statusProgress;
  if (Number.isFinite(rowProgress) && rowProgress > 0) return rowProgress;
  if (Number.isFinite(statusProgress)) return statusProgress;
  if (Number.isFinite(rowProgress)) return rowProgress;
  return NaN;
}

function taskShowsInImageList(task: HarvesterImageUploadTask): boolean {
  // success 暂留列表：在库存就绪前继续展示 100% 进度，避免 99% → - → 已就绪 闪烁
  // cancelled 暂留列表：覆盖库存行「上传中/同步中」，直至用户删除任务记录
  return ['uploaded', 'proxying', 'failed', 'success', 'cancelled'].includes(
    String(task.status || ''),
  );
}

export type ImageListProgressPollPlan = {
  pollUploadTasks: boolean;
  pollInventory: boolean;
};

/** 是否仍有进行中的集群导入/同步（不含已挂 Tower 上传任务 overlay 的行） */
export function isHarvesterImageAwaitingClusterProgress(img: ImageListRecord): boolean {
  if (getTowerUploadTaskIdFromRow(img)) return false;
  const stateKey = resolveImageListStateKey(img);
  if (['ready', 'failed', 'cancelled', 'pending_sync'].includes(stateKey)) return false;
  return ['downloading', 'uploading', 'importing', 'exporting', 'syncing'].includes(stateKey);
}

/**
 * 镜像列表轮询计划：底座已失败或任务已终态时停止刷库存，避免进度条狂闪拖垮页面。
 */
export function planImageListProgressPoll(
  tasks: readonly HarvesterImageUploadTask[],
  images: readonly ImageListRecord[],
): ImageListProgressPollPlan {
  let pollUploadTasks = false;
  let pollInventory = false;

  for (const task of tasks) {
    const st = String(task.status || '').toLowerCase();
    if (st === 'uploaded' || st === 'failed' || st === 'cancelled') continue;

    const matchedRow = images.find((img) => imageMatchesUploadTask(img, task));
    const rowState = matchedRow ? resolveImageListStateKey(matchedRow) : null;

    if (st === 'success') {
      if (rowState !== 'ready') {
        pollUploadTasks = true;
        pollInventory = true;
      }
      continue;
    }

    if (st === 'proxying') {
      pollUploadTasks = true;
      if (rowState === 'failed') continue;
      // 代传中对齐任务会 upsert 库存；skipSync 拉库存即可更新进度/就绪态，避免全量 sync
      if (rowState !== 'ready') pollInventory = true;
      continue;
    }
  }

  if (!pollInventory) {
    for (const img of images) {
      if (tasks.some((t) => imageMatchesUploadTask(img, t))) continue;
      if (isHarvesterImageAwaitingClusterProgress(img)) {
        pollUploadTasks = true;
        pollInventory = true;
        break;
      }
    }
  }

  return { pollUploadTasks, pollInventory };
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

  const hasActual = getImageActualFileBytes(img) != null;

  const sc = getImageStorageClassName(img);

  const nextStatus: Record<string, unknown> = { ...status };
  const nextSpec: Record<string, unknown> = { ...spec };
  let next: ImageListRecord = { ...img };

  if (!hasActual) {
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

export function isInternalTowerErrorMessage(msg: unknown): boolean {
  const lower = String(msg || '').toLowerCase();
  return (
    lower.includes('sqlite_error') ||
    lower.includes('cannot start a transaction') ||
    lower.includes('no such savepoint') ||
    lower.includes('typeorm')
  );
}

export function resolveImageListFailureMessage(
  r: ImageListRecord,
  task?: HarvesterImageUploadTask,
): string | undefined {
  const fromCluster = resolveVmImageImportFailureMessage(r);
  if (fromCluster) return fromCluster;
  const fromRow = (r as Record<string, unknown>)[TOWER_UPLOAD_SYNC_ERROR_KEY];
  if (typeof fromRow === 'string' && fromRow.trim() && !isInternalTowerErrorMessage(fromRow)) {
    return fromRow.trim();
  }
  const fromTask = String(task?.errorMessage || '').trim();
  if (fromTask && !isInternalTowerErrorMessage(fromTask)) return fromTask;
  if (fromTask && isInternalTowerErrorMessage(fromTask)) {
    return 'Tower 同步状态更新异常，请刷新列表后重试';
  }
  return undefined;
}

function mergeImageStatusWithPatch(
  row: ImageListRecord,
  statusPatch: Record<string, unknown>,
): Record<string, unknown> {
  const status = (row.status || {}) as Record<string, unknown>;
  const virtualSize =
    statusPatch.virtualSize ??
    status.virtualSize ??
    status.virtualsize ??
    row.virtualSize;
  const next = { ...status, ...statusPatch };
  if (virtualSize != null && Number(virtualSize) > 0) {
    next.virtualSize = virtualSize;
  }
  return next;
}

function withMergedImageStatus(
  row: ImageListRecord,
  statusPatch: Record<string, unknown>,
): { status: Record<string, unknown>; virtualSize?: number } {
  const status = mergeImageStatusWithPatch(row, statusPatch);
  const virtualSize = getImageVirtualSizeBytes({ ...row, status });
  return {
    ...(virtualSize != null ? { virtualSize } : {}),
    status,
  };
}

function withImageRowSyncFailureMessage(
  row: ImageListRecord,
  task?: HarvesterImageUploadTask,
): ImageListRecord {
  const failMsg = resolveImageListFailureMessage(row, task);
  if (!failMsg) return row;
  return { ...row, [TOWER_UPLOAD_SYNC_ERROR_KEY]: failMsg } as ImageListRecord;
}

function imageMatchesUploadTask(img: ImageListRecord, task: HarvesterImageUploadTask): boolean {
  const imgName = getImageRowId(img);
  const imgNs = getImageRowNamespace(img);
  if (task.createdImageName && task.createdImageNamespace) {
    return imgName === task.createdImageName && imgNs === task.createdImageNamespace;
  }
  const dn = String(task.displayName || '').trim();
  if (!dn) return false;
  return getImageDisplayAlias(img) === dn && imgNs === task.namespace;
}

export function uploadTaskToVirtualImageRow(
  task: HarvesterImageUploadTask,
  options?: { isPublicNamespace?: (name: string) => boolean },
): ImageListRecord {
  const st = String(task.status || '');
  let state = 'pending_sync';
  if (st === 'success') state = 'ready';
  else if (st === 'cancelled') state = 'cancelled';
  else if (st === 'proxying') state = 'syncing';
  else if (st === 'failed') state = 'failed';
  else if (st === 'uploaded') state = 'pending_sync';

  const progress = st === 'success' ? 100 : getHarvesterSyncProgress(task);
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
    ...(String(task.errorMessage || '').trim()
      ? { [TOWER_UPLOAD_SYNC_ERROR_KEY]: String(task.errorMessage).trim() }
      : {}),
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
    ...(progress != null || fileSize
      ? {
          status: {
            ...(progress != null ? { progress } : {}),
            ...(fileSize ? { size: fileSize } : {}),
          },
          ...(progress != null ? { progress } : {}),
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

/** 将已上传完成（待同步/同步中/失败）的任务合并为镜像列表虚拟行，并在已有库存行上覆盖同步进度 */
export function mergeUploadTasksIntoImageList(
  images: readonly ImageListRecord[],
  tasks: readonly HarvesterImageUploadTask[],
  options?: { isPublicNamespace?: (name: string) => boolean },
): ImageListRecord[] {
  const listTasks = tasks.filter(taskShowsInImageList);
  const taskByImageKey = new Map<string, HarvesterImageUploadTask>();

  for (const task of listTasks) {
    for (const img of images) {
      if (imageMatchesUploadTask(img, task)) {
        const key = `${getImageRowNamespace(img)}/${getImageRowId(img)}`;
        taskByImageKey.set(key, task);
      }
    }
  }

  const patched = images.map((img) => {
    const key = `${getImageRowNamespace(img)}/${getImageRowId(img)}`;
    const task = taskByImageKey.get(key);
    if (!task) return img;

    const st = String(task.status || '');
    const withType = mergeImageTypeFieldsIntoRow(img, task);
    if (st === 'cancelled') {
      const clusterState = resolveImageListStateKey(withType);
      // 底座已 Imported：取消仅表示 Tower 代传中止，不应覆盖集群已就绪镜像
      if (clusterState === 'ready') {
        return withType;
      }
      // 底座已明确失败（Imported=False 等）：展示失败，而非 Tower 任务 cancelled
      if (clusterState === 'failed') {
        return withImageRowSyncFailureMessage(
          {
            ...withType,
            state: 'failed',
            progress: undefined,
            ...withMergedImageStatus(withType, { progress: undefined }),
            [TOWER_UPLOAD_TASK_ID_KEY]: task.id,
          },
          task,
        );
      }
      return {
        ...withType,
        state: 'cancelled',
        progress: undefined,
        ...withMergedImageStatus(withType, { progress: undefined }),
        [TOWER_UPLOAD_TASK_ID_KEY]: task.id,
      };
    }
    if (st === 'uploaded') {
      return {
        ...withType,
        state: 'pending_sync',
        progress: undefined,
        ...withMergedImageStatus(withType, { progress: undefined }),
      };
    }
    if (st === 'success') {
      if (isClusterVmImageImportComplete(withType)) {
        return withType;
      }
      const clusterProgress = readClusterVmImageImportProgress(withType);
      const taskProgress = getHarvesterSyncProgress({ ...task, status: 'proxying' });
      const mergedProgress = Math.max(
        clusterProgress != null ? clusterProgress : 0,
        taskProgress != null ? taskProgress : 0,
      );
      const normalizedProgress =
        mergedProgress > 0 ? Math.max(0, Math.min(100, mergedProgress)) : null;
      return {
        ...withType,
        state: 'syncing',
        ...(normalizedProgress != null
          ? {
              progress: normalizedProgress,
              ...withMergedImageStatus(withType, { progress: normalizedProgress }),
            }
          : {
              progress: undefined,
              ...withMergedImageStatus(withType, { progress: undefined }),
            }),
        [TOWER_UPLOAD_TASK_ID_KEY]: task.id,
      };
    }
    if (st === 'failed' && isInternalTowerErrorMessage(task.errorMessage)) {
      if (isClusterVmImageImportComplete(withType)) {
        return withType;
      }
    }
    if (st === 'proxying' || st === 'failed') {
      if (isClusterVmImageImportComplete(withType)) {
        return withType;
      }
      const clusterState = resolveImageListStateKey(withType);
      const effectiveStatus =
        st === 'failed' || (st === 'proxying' && clusterState === 'failed') ? 'failed' : st;
      const syncProgress = getHarvesterSyncProgress({ ...task, status: effectiveStatus });
      const invProgress = readImageRowProgress(withType);
      const progress =
        effectiveStatus === 'failed'
          ? null
          : Math.max(
              syncProgress != null && Number.isFinite(syncProgress) ? syncProgress : 0,
              Number.isFinite(invProgress) && invProgress > 0 ? invProgress : 0,
            ) || null;
      const normalizedProgress =
        progress != null && progress > 0 ? Math.max(0, Math.min(100, progress)) : null;
      const state = effectiveStatus === 'proxying' ? 'syncing' : 'failed';
      const failedRow = withImageRowSyncFailureMessage(
        {
          ...withType,
          state,
          ...(normalizedProgress != null
            ? {
                progress: normalizedProgress,
                ...withMergedImageStatus(withType, { progress: normalizedProgress }),
              }
            : {
                progress: undefined,
                ...withMergedImageStatus(withType, { progress: undefined }),
              }),
          [TOWER_UPLOAD_TASK_ID_KEY]: task.id,
        },
        task,
      );
      return failedRow;
    }
    return img;
  });

  const virtualRows: ImageListRecord[] = [];
  for (const task of listTasks) {
    const duplicated = images.some((img) => imageMatchesUploadTask(img, task));
    if (!duplicated) {
      virtualRows.push(uploadTaskToVirtualImageRow(task, options));
    }
  }

  return [...virtualRows, ...patched];
}
