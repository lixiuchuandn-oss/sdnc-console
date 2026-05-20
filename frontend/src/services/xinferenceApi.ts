import { apiDelete, apiPost, apiRequest } from './api';

function xinferenceBase(poolId: string, path: string): string {
  return `/api/clouds/${encodeURIComponent(poolId)}/xinference${path}`;
}

export type XinferenceClusterSummary = {
  count: number;
  address?: string;
  cpuUsagePercent: number | null;
  cpuCount: number | null;
  memUsedBytes: number | null;
  memTotalBytes: number | null;
  gpuCount: number;
  gpuUtilization: number | null;
  gpuVramUsedBytes: number | null;
  gpuVramTotalBytes: number | null;
  versionRelease?: string;
  versionCommit?: string;
};

export type XinferenceClusterNodeDetail = {
  key: string;
  nodeType: string;
  address?: string;
  cpuUsagePercent: number | null;
  cpuCount: number | null;
  memUsedBytes: number | null;
  memTotalBytes: number | null;
  gpuCount: number;
  gpuUtilization: number | null;
  gpuVramUsedBytes: number | null;
  gpuVramTotalBytes: number | null;
};

export type XinferenceClusterInfo = {
  endpoint: string;
  supervisor: XinferenceClusterSummary;
  workersSummary: XinferenceClusterSummary;
  workerDetails: XinferenceClusterNodeDetail[];
  runningModelCount: number;
  versionError?: string;
  modelsError?: string;
};

function emptySummary(): XinferenceClusterSummary {
  return {
    count: 0,
    cpuUsagePercent: null,
    cpuCount: null,
    memUsedBytes: null,
    memTotalBytes: null,
    gpuCount: 0,
    gpuUtilization: null,
    gpuVramUsedBytes: null,
    gpuVramTotalBytes: null,
  };
}

function mapSummary(raw: unknown): XinferenceClusterSummary {
  if (!raw || typeof raw !== 'object') return emptySummary();
  const o = raw as Record<string, unknown>;
  return {
    count: Number(o.count) || 0,
    address: o.address != null ? String(o.address) : undefined,
    cpuUsagePercent:
      typeof o.cpuUsagePercent === 'number' && Number.isFinite(o.cpuUsagePercent)
        ? o.cpuUsagePercent
        : null,
    cpuCount:
      typeof o.cpuCount === 'number' && Number.isFinite(o.cpuCount) ? o.cpuCount : null,
    memUsedBytes:
      typeof o.memUsedBytes === 'number' && Number.isFinite(o.memUsedBytes)
        ? o.memUsedBytes
        : null,
    memTotalBytes:
      typeof o.memTotalBytes === 'number' && Number.isFinite(o.memTotalBytes)
        ? o.memTotalBytes
        : null,
    gpuCount: typeof o.gpuCount === 'number' && Number.isFinite(o.gpuCount) ? o.gpuCount : 0,
    gpuUtilization:
      typeof o.gpuUtilization === 'number' && Number.isFinite(o.gpuUtilization)
        ? o.gpuUtilization
        : null,
    gpuVramUsedBytes:
      typeof o.gpuVramUsedBytes === 'number' && Number.isFinite(o.gpuVramUsedBytes)
        ? o.gpuVramUsedBytes
        : null,
    gpuVramTotalBytes:
      typeof o.gpuVramTotalBytes === 'number' && Number.isFinite(o.gpuVramTotalBytes)
        ? o.gpuVramTotalBytes
        : null,
    versionRelease: o.versionRelease != null ? String(o.versionRelease) : undefined,
    versionCommit: o.versionCommit != null ? String(o.versionCommit) : undefined,
  };
}

function mapNodeDetail(raw: unknown, index: number): XinferenceClusterNodeDetail {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const address = o.address != null ? String(o.address) : undefined;
  const nodeType = o.nodeType != null ? String(o.nodeType) : 'Worker';
  const key = address || `${nodeType}-${index}`;
  return {
    key,
    nodeType,
    address,
    cpuUsagePercent:
      typeof o.cpuUsagePercent === 'number' && Number.isFinite(o.cpuUsagePercent)
        ? o.cpuUsagePercent
        : null,
    cpuCount:
      typeof o.cpuCount === 'number' && Number.isFinite(o.cpuCount) ? o.cpuCount : null,
    memUsedBytes:
      typeof o.memUsedBytes === 'number' && Number.isFinite(o.memUsedBytes)
        ? o.memUsedBytes
        : null,
    memTotalBytes:
      typeof o.memTotalBytes === 'number' && Number.isFinite(o.memTotalBytes)
        ? o.memTotalBytes
        : null,
    gpuCount: typeof o.gpuCount === 'number' && Number.isFinite(o.gpuCount) ? o.gpuCount : 0,
    gpuUtilization:
      typeof o.gpuUtilization === 'number' && Number.isFinite(o.gpuUtilization)
        ? o.gpuUtilization
        : null,
    gpuVramUsedBytes:
      typeof o.gpuVramUsedBytes === 'number' && Number.isFinite(o.gpuVramUsedBytes)
        ? o.gpuVramUsedBytes
        : null,
    gpuVramTotalBytes:
      typeof o.gpuVramTotalBytes === 'number' && Number.isFinite(o.gpuVramTotalBytes)
        ? o.gpuVramTotalBytes
        : null,
  };
}

export type XinferenceRunningModel = {
  modelUid: string;
  modelName: string;
  modelType?: string;
  modelEngine?: string;
  modelFormat?: string;
  sizeInBillions?: string;
  quantization?: string;
  replica?: number;
};

export type XinferenceModelRegistration = {
  modelName: string;
  modelType?: string;
  isBuiltin?: boolean;
  description?: string;
  abilities: string[];
  languages: string[];
  contextLength?: number;
};

export type XinferenceLaunchModelPayload = {
  model_name: string;
  model_type?: string;
  model_engine?: string;
  model_size_in_billions?: string;
  model_format?: string;
  quantization?: string;
  model_uid?: string;
  n_gpu?: string | number;
  replica?: number;
  worker_ip?: string;
  gpu_idx?: number | number[];
  [key: string]: unknown;
};

function mapRunningModel(raw: unknown): XinferenceRunningModel | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const modelUid = String(o.modelUid ?? o.model_uid ?? o.id ?? '').trim();
  if (!modelUid) return null;
  return {
    modelUid,
    modelName: String(o.modelName ?? o.model_name ?? modelUid),
    modelType: o.modelType != null ? String(o.modelType) : o.model_type != null ? String(o.model_type) : undefined,
    modelEngine:
      o.modelEngine != null ? String(o.modelEngine) : o.model_engine != null ? String(o.model_engine) : undefined,
    modelFormat:
      o.modelFormat != null ? String(o.modelFormat) : o.model_format != null ? String(o.model_format) : undefined,
    sizeInBillions:
      o.sizeInBillions != null
        ? String(o.sizeInBillions)
        : o.model_size_in_billions != null
          ? String(o.model_size_in_billions)
          : undefined,
    quantization: o.quantization != null ? String(o.quantization) : undefined,
    replica: typeof o.replica === 'number' ? o.replica : undefined,
  };
}

function pickStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => String(x).trim()).filter(Boolean);
}

function mapRegistration(raw: unknown): XinferenceModelRegistration | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const modelName = String(o.modelName ?? o.model_name ?? '').trim();
  if (!modelName) return null;
  const contextLengthRaw = o.contextLength ?? o.context_length;
  return {
    modelName,
    modelType: o.modelType != null ? String(o.modelType) : o.model_type != null ? String(o.model_type) : undefined,
    isBuiltin: o.isBuiltin === true || o.is_builtin === true,
    description:
      o.description != null
        ? String(o.description)
        : o.model_description != null
          ? String(o.model_description)
          : undefined,
    abilities: pickStringArray(o.abilities ?? o.model_abilities ?? o.model_ability),
    languages: pickStringArray(o.languages ?? o.model_lang ?? o.model_langs),
    contextLength:
      typeof contextLengthRaw === 'number' && Number.isFinite(contextLengthRaw) ? contextLengthRaw : undefined,
  };
}

export async function fetchXinferenceRunningModels(
  poolId: string,
  opts?: { skipCache?: boolean },
): Promise<XinferenceRunningModel[]> {
  const j = await apiRequest(xinferenceBase(poolId, '/models'), {
    skipCache: opts?.skipCache ?? true,
  });
  const list: unknown[] = Array.isArray(j?.models) ? j.models : [];
  return list.map(mapRunningModel).filter((m): m is XinferenceRunningModel => m != null);
}

export async function fetchXinferenceModelRegistrations(
  poolId: string,
  modelType = 'LLM',
  opts?: { skipCache?: boolean; detailed?: boolean },
): Promise<XinferenceModelRegistration[]> {
  const q = new URLSearchParams({ modelType });
  if (opts?.detailed) q.set('detailed', 'true');
  const j = await apiRequest(`${xinferenceBase(poolId, '/model-registrations')}?${q}`, {
    skipCache: opts?.skipCache ?? true,
  });
  const list: unknown[] = Array.isArray(j?.registrations) ? j.registrations : [];
  return list.map(mapRegistration).filter((m): m is XinferenceModelRegistration => m != null);
}

export async function fetchXinferenceModelRegistrationDetail(
  poolId: string,
  modelType: string,
  modelName: string,
  opts?: { skipCache?: boolean },
): Promise<Record<string, unknown>> {
  const j = await apiRequest(
    xinferenceBase(
      poolId,
      `/model-registrations/${encodeURIComponent(modelType)}/${encodeURIComponent(modelName)}`,
    ),
    { skipCache: opts?.skipCache ?? true },
  );
  return j && typeof j === 'object' ? (j as Record<string, unknown>) : {};
}

export async function launchXinferenceModel(
  poolId: string,
  payload: XinferenceLaunchModelPayload,
): Promise<{ modelUid: string }> {
  const j = await apiPost(xinferenceBase(poolId, '/models'), payload, {
    enableRetry: false,
  });
  const modelUid = String(j?.modelUid ?? j?.model_uid ?? '').trim();
  if (!modelUid) {
    throw new Error('启动成功但未返回 model_uid');
  }
  return { modelUid };
}

export async function terminateXinferenceModel(poolId: string, modelUid: string): Promise<void> {
  await apiDelete(xinferenceBase(poolId, `/models/${encodeURIComponent(modelUid)}`));
}

export async function fetchXinferenceClusterInfo(
  poolId: string,
  opts?: { skipCache?: boolean },
): Promise<XinferenceClusterInfo> {
  const j = await apiRequest(xinferenceBase(poolId, '/cluster'), {
    skipCache: opts?.skipCache ?? true,
  });
  const workerDetailsRaw = Array.isArray(j?.workerDetails) ? j.workerDetails : [];
  return {
    endpoint: String(j?.endpoint || ''),
    supervisor: mapSummary(j?.supervisor),
    workersSummary: mapSummary(j?.workersSummary),
    workerDetails: workerDetailsRaw.map(mapNodeDetail),
    runningModelCount: Number(j?.runningModelCount) || 0,
    versionError: j?.versionError ? String(j.versionError) : undefined,
    modelsError: j?.modelsError ? String(j.modelsError) : undefined,
  };
}
