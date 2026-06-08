import type { HarvesterImageUploadTask } from '../../../../../../../services/harvesterApi';

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
  if (st === 'cancelled') {
    return { next: prev.filter((x) => x.id !== task.id), becameSuccess: false };
  }
  if (['uploaded', 'proxying', 'failed'].includes(st)) {
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

/** 分片是否已完整上传到 Tower（与底座同步无关） */
export function isTowerImageIngestComplete(task: HarvesterImageUploadTask): boolean {
  const st = String(task.status || '').toLowerCase();
  if (['uploaded', 'proxying', 'success'].includes(st)) return true;
  if (st === 'failed' && Number(task.ingestProgress ?? 0) >= 100) return true;
  return Number(task.ingestProgress ?? 0) >= 100;
}

/**
 * 上传任务抽屉状态：仅「传到 Tower」— pending/ingesting/failed(分片失败)/uploaded/cancelled。
 * proxying/success/同步失败等底座阶段一律展示为 uploaded（上传已完成）。
 */
export function getUploadDrawerDisplayStatus(task: HarvesterImageUploadTask): string {
  const st = String(task.status || '').toLowerCase();
  if (st === 'cancelled') return 'cancelled';
  if (isTowerImageIngestComplete(task)) return 'uploaded';
  if (st === 'failed') return 'failed';
  return st;
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

/** 用户/服务端明确取消：已清空分片，不可断点续传 */
export function isHardCancelledUploadTask(task: HarvesterImageUploadTask): boolean {
  return (
    String(task.status || '').toLowerCase() === 'cancelled' &&
    (!Array.isArray(task.receivedChunks) || task.receivedChunks.length === 0)
  );
}

const UPLOAD_TASK_IN_PROGRESS_STATUSES = ['proxying', 'uploaded', 'ingesting', 'pending'];

/** 终态 vs 进行中：failed/success 应覆盖 stale proxying；用户取消应覆盖陈旧 proxying 轮询态 */
function shouldPreferTerminalUploadTask(
  terminalSt: string,
  activeSt: string,
): boolean {
  const term = String(terminalSt || '').toLowerCase();
  const active = String(activeSt || '').toLowerCase();
  if (term === 'cancelled') {
    return true;
  }
  if (term === 'failed' || term === 'success') {
    return UPLOAD_TASK_IN_PROGRESS_STATUSES.includes(active);
  }
  return uploadTaskLifecycleRank(term) >= uploadTaskLifecycleRank(active);
}

function uploadTaskClusterProgress(task: HarvesterImageUploadTask): number {
  return Math.max(
    Number.isFinite(Number(task.proxyProgress)) ? Number(task.proxyProgress) : 0,
    Number.isFinite(Number(task.progress)) ? Number(task.progress) : 0,
  );
}

/** 同步重试刚启动：任务与底座进度均已归零，不应沿用上一轮失败前的进度 */
function isUploadTaskSyncAtStart(task: HarvesterImageUploadTask): boolean {
  return String(task.status || '').toLowerCase() === 'proxying' && uploadTaskClusterProgress(task) <= 0;
}

/** 从 failed/uploaded 进入 proxying@0：视为新一轮同步，而非轮询回退 */
function isUploadTaskSyncRetryTransition(
  prev: HarvesterImageUploadTask,
  next: HarvesterImageUploadTask,
): boolean {
  const prevSt = String(prev.status || '').toLowerCase();
  const nextSt = String(next.status || '').toLowerCase();
  return (
    nextSt === 'proxying' &&
    isUploadTaskSyncAtStart(next) &&
    ['failed', 'uploaded'].includes(prevSt)
  );
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
    let picked: HarvesterImageUploadTask;
    if (termA && termB) {
      picked =
        new Date(b.updatedAt || 0).getTime() >= new Date(a.updatedAt || 0).getTime() ? b : a;
    } else {
      const active = termA ? b : a;
      const terminal = termA ? a : b;
      const activeSt = String(active.status || '').toLowerCase();
      const terminalSt = String(terminal.status || '').toLowerCase();
      if (
        activeSt === 'proxying' &&
        terminalSt === 'failed' &&
        (isUploadTaskSyncAtStart(active) ||
          new Date(active.updatedAt || 0).getTime() >=
            new Date(terminal.updatedAt || 0).getTime())
      ) {
        picked = active;
      } else if (shouldPreferTerminalUploadTask(terminalSt, activeSt)) {
        picked = terminal;
      } else {
        const rankActive = uploadTaskLifecycleRank(activeSt);
        const rankTerminal = uploadTaskLifecycleRank(terminalSt);
        picked = rankActive > rankTerminal ? active : terminal;
      }
    }
    const pickedSt = String(picked.status || '').toLowerCase();
    const other = picked === a ? b : a;
    const otherSt = String(other.status || '').toLowerCase();
    // 本地上传阶段：陈旧取消可被更新的进行中记录覆盖；明确取消（分片已清空）始终保留
    if (
      pickedSt === 'cancelled' &&
      ['pending', 'ingesting', 'uploaded'].includes(otherSt)
    ) {
      if (isHardCancelledUploadTask(picked)) {
        /* keep picked */
      } else if (isHardCancelledUploadTask(other)) {
        picked = other;
      } else {
        const pickedTs = new Date(picked.updatedAt || 0).getTime();
        const otherTs = new Date(other.updatedAt || 0).getTime();
        if (pickedTs <= otherTs) {
          picked = other;
        }
      }
    }
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
      const progA = uploadTaskClusterProgress(a);
      const progB = uploadTaskClusterProgress(b);
      if (isUploadTaskSyncRetryTransition(a, b)) {
        picked = b;
      } else if (isUploadTaskSyncRetryTransition(b, a)) {
        picked = a;
      } else if (progB > progA) picked = b;
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

/** 上传任务抽屉进度：仅分片上传到 Tower（0–100），与底座同步进度无关 */
export function getTowerUploadTaskProgress(task: HarvesterImageUploadTask): number {
  const st = String(task.status || '').toLowerCase();
  if (st === 'cancelled') return 0;
  if (isTowerImageIngestComplete(task)) return 100;

  const total = Math.max(0, Number(task.totalChunks || 0));
  const received = Array.isArray(task.receivedChunks) ? task.receivedChunks.length : 0;
  if (total > 0 && ['pending', 'ingesting'].includes(st)) {
    return Math.min(99.99, Math.round((received / total) * 10000) / 100);
  }

  const ingest = Math.max(0, Math.min(100, Number(task.ingestProgress ?? 0)));
  if (ingest > 0) return Math.min(99.99, ingest);

  if (st === 'failed') return Math.max(0, Math.min(99.99, ingest));

  const fallback = Number(task.progress ?? 0);
  if (['pending', 'ingesting'].includes(st)) {
    return Math.max(0, Math.min(99.99, fallback));
  }
  return 0;
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
