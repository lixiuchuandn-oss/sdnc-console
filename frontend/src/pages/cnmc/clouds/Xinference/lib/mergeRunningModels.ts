import type {
  XinferenceModelInstance,
  XinferenceRunningModel,
} from '../../../../../services/xinferenceApi';
import {
  normalizeRunningModelTypeKey,
  type XinferenceGalleryModelType,
} from './xinferenceModelRegistry';
import { resolveInstanceErrorMessage } from './launchProgressUtils';

export type PoolModelLifecycleStatus = 'CREATING' | 'READY' | 'ERROR' | 'TERMINATED' | string;

export type XinferencePoolModelRow = XinferenceRunningModel & {
  lifecycleStatus: PoolModelLifecycleStatus;
  /** 0~1；CREATING 时由前端轮询填充 */
  progress?: number | null;
  instanceCreatedTs?: number;
  errorMessage?: string | null;
  replicaStatuses?: XinferenceModelInstance['replicaStatuses'];
};

export type PoolModelStatusFilter = 'all' | 'creating' | 'ready' | 'error';

function workerAddressesFromInstance(inst: XinferenceModelInstance): string | undefined {
  const workers = [
    ...new Set(inst.replicaStatuses.map((r) => r.workerAddress).filter(Boolean) as string[]),
  ];
  return workers.length ? workers.join(', ') : undefined;
}

/** 与官方 RunningRow 对齐，并扩展 status / progress */
export type XinferenceRunningTableRow = XinferencePoolModelRow;

function instanceToRow(
  inst: XinferenceModelInstance,
  ready?: XinferenceRunningModel,
): XinferencePoolModelRow {
  const st = (inst.status || 'CREATING').toUpperCase();
  return {
    modelUid: inst.modelUid,
    modelName: inst.modelName,
    modelType: ready?.modelType,
    modelEngine: ready?.modelEngine,
    modelFormat: ready?.modelFormat,
    sizeInBillions: ready?.sizeInBillions,
    quantization: ready?.quantization,
    replica: inst.replica ?? ready?.replica,
    address: ready?.address ?? workerAddressesFromInstance(inst),
    accelerators: ready?.accelerators,
    lifecycleStatus: st,
    progress: st === 'CREATING' ? null : st === 'READY' ? 1 : undefined,
    instanceCreatedTs: inst.instanceCreatedTs,
    errorMessage: resolveInstanceErrorMessage(inst),
    replicaStatuses: inst.replicaStatuses,
  };
}

/** instances（含 CREATING/ERROR）+ models（READY）合并为统一列表 */
export function mergeRunningModelsAndInstances(
  ready: XinferenceRunningModel[],
  instances: XinferenceModelInstance[],
): XinferencePoolModelRow[] {
  const readyByUid = new Map(ready.map((m) => [m.modelUid, m]));
  const seen = new Set<string>();
  const rows: XinferencePoolModelRow[] = [];

  for (const inst of instances) {
    const uid = inst.modelUid;
    const st = (inst.status || '').toUpperCase();
    const readyModel = readyByUid.get(uid);
    const onReadyList = readyByUid.has(uid);

    if (st === 'CREATING' || st === 'ERROR') {
      seen.add(uid);
      rows.push(instanceToRow(inst, readyModel));
      continue;
    }

    if (st === 'READY' && onReadyList && readyModel) {
      seen.add(uid);
      rows.push({
        ...readyModel,
        lifecycleStatus: 'READY',
        progress: 1,
        instanceCreatedTs: inst.instanceCreatedTs,
        replicaStatuses: inst.replicaStatuses,
        errorMessage: resolveInstanceErrorMessage(inst),
      });
      continue;
    }

    if (!onReadyList) {
      seen.add(uid);
      rows.push(instanceToRow(inst, readyModel));
    }
  }

  for (const m of ready) {
    if (!seen.has(m.modelUid)) {
      rows.push({ ...m, lifecycleStatus: 'READY', progress: 1 });
    }
  }

  return rows;
}

export function filterPoolModelsByType(
  items: XinferencePoolModelRow[],
  modelType: XinferenceGalleryModelType,
): XinferencePoolModelRow[] {
  return items.filter((m) => {
    const t = normalizeRunningModelTypeKey(m.modelType);
    if (modelType === 'LLM') return t === 'LLM' || t == null;
    return t === modelType;
  });
}

export function filterPoolModelsByStatus(
  items: XinferencePoolModelRow[],
  statusFilter: PoolModelStatusFilter,
): XinferencePoolModelRow[] {
  if (statusFilter === 'all') return items;
  if (statusFilter === 'creating') {
    return items.filter((m) => m.lifecycleStatus.toUpperCase() === 'CREATING');
  }
  if (statusFilter === 'ready') {
    return items.filter((m) => m.lifecycleStatus.toUpperCase() === 'READY');
  }
  if (statusFilter === 'error') {
    return items.filter((m) => m.lifecycleStatus.toUpperCase() === 'ERROR');
  }
  return items;
}

export function filterPoolModelsByKeyword(
  items: XinferencePoolModelRow[],
  keyword: string,
): XinferencePoolModelRow[] {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return items;
  return items.filter((m) => {
    const hay = [
      m.modelUid,
      m.modelName,
      m.modelEngine,
      m.modelFormat,
      m.sizeInBillions,
      m.lifecycleStatus,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return hay.includes(kw);
  });
}

export function countActiveCreating(items: XinferencePoolModelRow[]): number {
  return items.filter((m) => m.lifecycleStatus.toUpperCase() === 'CREATING').length;
}

export function parsePoolModelStatusFilter(raw: string | null): PoolModelStatusFilter {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'creating' || s === 'ready' || s === 'error') return s;
  return 'all';
}

/** LLM 显示规模/量化列；与官方 DataGrid 列集一致 */
export function runningTableShowsLlmSizeColumns(modelType: XinferenceGalleryModelType): boolean {
  return modelType === 'LLM';
}
