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
  /** Worker 地址（GET /v1/models → address） */
  address?: string;
  /** GPU 索引列表（GET /v1/models → accelerators） */
  accelerators?: string[];
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

export type XinferenceReplicaStatus = {
  replicaId: number;
  replicaModelUid: string;
  workerAddress?: string;
  status: string;
  createdTs?: number;
  errorMessage?: string | null;
};

export type XinferenceModelInstance = {
  modelName: string;
  modelUid: string;
  modelVersion?: string | null;
  modelAbility: string[];
  replica: number;
  status: string;
  instanceCreatedTs?: number;
  nWorker?: number;
  errorMessage?: string | null;
  replicaStatuses: XinferenceReplicaStatus[];
};

export type XinferenceLaunchModelPayload = {
  model_name: string;
  model_type?: string;
  model_engine?: string;
  model_size_in_billions?: string;
  model_format?: string;
  quantization?: string;
  multimodal_projector?: string;
  model_uid?: string;
  n_gpu?: string | number | null;
  n_gpu_layers?: number;
  replica?: number;
  download_hub?: string;
  request_limits?: number;
  model_path?: string;
  enable_thinking?: boolean;
  reasoning_content?: boolean;
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
    address: o.address != null ? String(o.address) : undefined,
    accelerators: pickAcceleratorsField(o),
  };
}

function pickAcceleratorsField(o: Record<string, unknown>): string[] | undefined {
  const raw = o.accelerators ?? o.gpu_idx ?? o.gpuIdx;
  if (Array.isArray(raw)) {
    const list = raw.map((x) => String(x).trim()).filter(Boolean);
    return list.length ? list : undefined;
  }
  if (typeof raw === 'string' && raw.trim()) {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return undefined;
}

function pickStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => String(x).trim()).filter(Boolean);
}

function mapReplicaStatus(raw: unknown): XinferenceReplicaStatus | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const replicaModelUid = String(o.replicaModelUid ?? o.replica_model_uid ?? '').trim();
  const replicaIdRaw = o.replicaId ?? o.replica_id;
  const replicaId =
    typeof replicaIdRaw === 'number' && Number.isFinite(replicaIdRaw) ? replicaIdRaw : 0;
  if (!replicaModelUid && replicaIdRaw == null) return null;
  return {
    replicaId,
    replicaModelUid: replicaModelUid || String(replicaId),
    workerAddress:
      o.workerAddress != null
        ? String(o.workerAddress)
        : o.worker_address != null
          ? String(o.worker_address)
          : undefined,
    status: String(o.status ?? ''),
    createdTs:
      typeof o.createdTs === 'number'
        ? o.createdTs
        : typeof o.created_ts === 'number'
          ? o.created_ts
          : undefined,
    errorMessage:
      o.errorMessage != null
        ? String(o.errorMessage)
        : o.error_message != null
          ? String(o.error_message)
          : null,
  };
}

function mapModelInstance(raw: unknown): XinferenceModelInstance | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const modelUid = String(o.modelUid ?? o.model_uid ?? '').trim();
  if (!modelUid) return null;
  const replicaStatusesRaw = Array.isArray(o.replicaStatuses)
    ? o.replicaStatuses
    : Array.isArray(o.replica_statuses)
      ? o.replica_statuses
      : [];
  return {
    modelName: String(o.modelName ?? o.model_name ?? modelUid),
    modelUid,
    modelVersion:
      o.modelVersion != null
        ? String(o.modelVersion)
        : o.model_version != null
          ? String(o.model_version)
          : null,
    modelAbility: pickStringArray(o.modelAbility ?? o.model_ability),
    replica: typeof o.replica === 'number' ? o.replica : 1,
    status: String(o.status ?? ''),
    instanceCreatedTs:
      typeof o.instanceCreatedTs === 'number'
        ? o.instanceCreatedTs
        : typeof o.instance_created_ts === 'number'
          ? o.instance_created_ts
          : undefined,
    nWorker:
      typeof o.nWorker === 'number'
        ? o.nWorker
        : typeof o.n_worker === 'number'
          ? o.n_worker
          : undefined,
    errorMessage:
      o.errorMessage != null
        ? String(o.errorMessage)
        : o.error_message != null
          ? String(o.error_message)
          : null,
    replicaStatuses: replicaStatusesRaw
      .map(mapReplicaStatus)
      .filter((x): x is XinferenceReplicaStatus => x != null),
  };
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
    enableDeduplication: false,
  });
  const list: unknown[] = Array.isArray(j?.models) ? j.models : [];
  const models = list.map(mapRunningModel).filter((m): m is XinferenceRunningModel => m != null);
  if (j?.degraded && j?.message) {
    const err = new Error(String(j.message));
    (err as Error & { degraded?: boolean }).degraded = true;
    if (models.length === 0) throw err;
  }
  return models;
}

/** 并行拉取 instances + models，供前端合并为统一运行列表 */
export async function fetchXinferencePoolModels(
  poolId: string,
  opts?: { skipCache?: boolean },
): Promise<{
  ready: XinferenceRunningModel[];
  instances: XinferenceModelInstance[];
  instancesDegraded?: boolean;
  instancesMessage?: string;
  modelsDegraded?: boolean;
  modelsMessage?: string;
}> {
  const skipCache = opts?.skipCache ?? true;
  let ready: XinferenceRunningModel[] = [];
  let modelsDegraded: boolean | undefined;
  let modelsMessage: string | undefined;

  try {
    ready = await fetchXinferenceRunningModels(poolId, { skipCache });
  } catch (e: unknown) {
    modelsDegraded = true;
    modelsMessage = e instanceof Error ? e.message : '拉取已就绪模型失败';
    const degraded = (e as Error & { degraded?: boolean }).degraded;
    if (!degraded) throw e;
  }

  const instancesRes = await fetchXinferenceModelInstances(poolId, { skipCache }).catch((e: unknown) => ({
    instances: [] as XinferenceModelInstance[],
    degraded: true,
    message: e instanceof Error ? e.message : '拉取模型实例失败',
  }));

  return {
    ready,
    instances: instancesRes.instances,
    instancesDegraded: instancesRes.degraded,
    instancesMessage: instancesRes.message,
    modelsDegraded,
    modelsMessage,
  };
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

export async function fetchXinferenceModelInstances(
  poolId: string,
  opts?: { skipCache?: boolean },
): Promise<{ instances: XinferenceModelInstance[]; degraded?: boolean; message?: string }> {
  const j = await apiRequest(xinferenceBase(poolId, '/models/instances'), {
    skipCache: opts?.skipCache ?? true,
    enableDeduplication: false,
  });
  const list: unknown[] = Array.isArray(j?.instances) ? j.instances : [];
  return {
    instances: list.map(mapModelInstance).filter((m): m is XinferenceModelInstance => m != null),
    degraded: j?.degraded === true,
    message: j?.message != null ? String(j.message) : undefined,
  };
}

export async function fetchXinferenceModelReplicas(
  poolId: string,
  modelUid: string,
  opts?: { skipCache?: boolean },
): Promise<XinferenceReplicaStatus[]> {
  const j = await apiRequest(
    xinferenceBase(poolId, `/models/${encodeURIComponent(modelUid)}/replicas`),
    { skipCache: opts?.skipCache ?? true, enableDeduplication: false },
  );
  const list: unknown[] = Array.isArray(j?.replicas) ? j.replicas : [];
  return list.map(mapReplicaStatus).filter((x): x is XinferenceReplicaStatus => x != null);
}

export type XinferenceRegisterModelPayload = {
  /** 模型定义对象或 JSON 字符串（与 Xinference custom model 一致） */
  model: Record<string, unknown> | string;
  persist: boolean;
  worker_ip?: string;
};

export async function registerXinferenceModel(
  poolId: string,
  modelType: string,
  payload: XinferenceRegisterModelPayload,
): Promise<void> {
  const body: Record<string, unknown> = {
    persist: payload.persist,
  };
  if (payload.worker_ip) body.worker_ip = payload.worker_ip;
  if (typeof payload.model === 'string') {
    body.model = payload.model;
  } else {
    body.model = payload.model;
  }
  await apiPost(
    xinferenceBase(poolId, `/model-registrations/${encodeURIComponent(modelType)}`),
    body,
    { enableRetry: false },
  );
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

/** GET /v1/engines/{modelType}/{modelName} 原始 JSON */
export async function fetchXinferenceModelEngines(
  poolId: string,
  modelType: string,
  modelName: string,
  opts?: { skipCache?: boolean },
): Promise<Record<string, unknown>> {
  const j = await apiRequest(
    xinferenceBase(
      poolId,
      `/engines/${encodeURIComponent(modelType)}/${encodeURIComponent(modelName)}`,
    ),
    { skipCache: opts?.skipCache ?? true },
  );
  return j && typeof j === 'object' ? (j as Record<string, unknown>) : {};
}

function extractCacheModelsPayload(j: unknown): unknown[] {
  if (Array.isArray(j)) return j;
  if (!j || typeof j !== 'object') return [];
  const o = j as Record<string, unknown>;
  if (Array.isArray(o.list)) return o.list;
  if (Array.isArray(o.models)) return o.models;
  if (Array.isArray(o.data)) return o.data;
  return [];
}

/** 已缓存模型版本列表（GET /v1/cache/models → list[].model_version） */
export async function fetchXinferenceCachedModels(
  poolId: string,
  modelName?: string,
  opts?: { skipCache?: boolean },
): Promise<string[]> {
  const q = modelName ? `?model_name=${encodeURIComponent(modelName)}` : '';
  const j = await apiRequest(xinferenceBase(poolId, `/cache/models${q}`), {
    skipCache: opts?.skipCache ?? true,
  });
  return extractCacheModelsPayload(j)
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        const version = String(o.model_version ?? o.modelVersion ?? o.version ?? '').trim();
        if (version) return version;
        const name = String(o.model_name ?? o.modelName ?? '').trim();
        const size = o.model_size_in_billions != null ? String(o.model_size_in_billions) : '';
        const format = o.model_format != null ? String(o.model_format) : '';
        const quant = o.quantization != null ? String(o.quantization) : '';
        if (name && format && quant) {
          const sizePart = size ? `${size.replace(/\./g, '_')}B` : '';
          return [name, sizePart, format, quant].filter(Boolean).join('--');
        }
      }
      return '';
    })
    .filter(Boolean);
}

export async function launchXinferenceModel(
  poolId: string,
  payload: XinferenceLaunchModelPayload & { wait_ready?: boolean; waitReady?: boolean },
  opts?: { waitReady?: boolean },
): Promise<{ modelUid: string }> {
  const waitReady = opts?.waitReady ?? payload.wait_ready ?? payload.waitReady ?? false;
  const body = { ...payload };
  delete body.wait_ready;
  delete body.waitReady;
  const q = `?wait_ready=${waitReady ? 'true' : 'false'}`;
  const j = await apiPost(xinferenceBase(poolId, `/models${q}`), body, {
    enableRetry: false,
  });
  const modelUid = String(j?.modelUid ?? j?.model_uid ?? '').trim();
  if (!modelUid) {
    throw new Error('启动成功但未返回 model_uid');
  }
  return { modelUid };
}

/** Xinference 异步启动进度，0～1 */
export async function fetchXinferenceLaunchProgress(
  poolId: string,
  modelUid: string,
): Promise<number> {
  const j = await apiRequest(
    xinferenceBase(poolId, `/models/${encodeURIComponent(modelUid)}/launch-progress`),
    { skipCache: true, enableDeduplication: false },
  );
  const p = Number(j?.progress);
  if (!Number.isFinite(p)) return 0;
  return Math.min(1, Math.max(0, p));
}

export async function cancelXinferenceModelLaunch(poolId: string, modelUid: string): Promise<void> {
  await apiPost(
    xinferenceBase(poolId, `/models/${encodeURIComponent(modelUid)}/cancel-launch`),
    {},
    { enableRetry: false },
  );
}

/**
 * 清理僵尸实例元数据（status_guard 中的 ERROR/CREATING 等，且未在运行列表）。
 * 代理 DELETE /v1/models/instances/{model_uid}；仍在跑须先 terminateXinferenceModel。
 */
export async function removeXinferenceInstanceMetadata(
  poolId: string,
  modelUid: string,
): Promise<{ modelUid: string; removed: boolean }> {
  const j = await apiDelete(
    xinferenceBase(poolId, `/models/instances/${encodeURIComponent(modelUid)}`),
  );
  return {
    modelUid: String(j?.modelUid ?? modelUid),
    removed: j?.removed === true,
  };
}

/** @deprecated 使用 removeXinferenceInstanceMetadata */
export const deleteXinferenceModelInstance = removeXinferenceInstanceMetadata;

export async function terminateXinferenceModel(poolId: string, modelUid: string): Promise<void> {
  await apiDelete(xinferenceBase(poolId, `/models/${encodeURIComponent(modelUid)}`));
}

export type XinferenceMonitoringUiConfig = {
  endpoint: string;
  grafanaUrl?: string;
  grafanaDashboardUid?: string;
  grafanaDatasource?: string;
  grafanaAlertDatasource?: string;
  clusterName?: string;
  configured: boolean;
  uiConfigError?: string;
};

export type XinferenceDifyEmbedConfig = {
  adminEmail: string;
  adminLoginConfigured: boolean;
  signinPath: string;
  difyConsoleUrl?: string;
};

export async function fetchXinferenceDifyEmbedConfig(
  poolId: string,
  opts?: { skipCache?: boolean },
): Promise<XinferenceDifyEmbedConfig> {
  const j = await apiRequest(xinferenceBase(poolId, '/dify/embed-config'), {
    skipCache: opts?.skipCache ?? true,
  });
  return {
    adminEmail: String(j?.adminEmail || 'admin@dify.ai'),
    adminLoginConfigured: Boolean(j?.adminLoginConfigured),
    signinPath: String(j?.signinPath || '/signin'),
    difyConsoleUrl: j?.difyConsoleUrl != null ? String(j.difyConsoleUrl) : undefined,
  };
}

export async function loginXinferenceDifyAdmin(poolId: string): Promise<void> {
  await apiPost(xinferenceBase(poolId, '/dify/admin-login'));
}

export type XinferenceDifySsoRedirect = {
  url: string;
  expiresIn: number;
  difyConsoleUrl?: string;
  embedBaseUrl?: string;
  embedMode?: boolean;
};

export async function fetchXinferenceDifySsoRedirect(
  poolId: string,
  opts?: { returnUrl?: string; skipCache?: boolean },
): Promise<XinferenceDifySsoRedirect> {
  const q = new URLSearchParams();
  if (opts?.returnUrl) q.set('return_url', opts.returnUrl);
  const qs = q.toString();
  const j = await apiRequest(
    xinferenceBase(poolId, `/dify/sso-redirect${qs ? `?${qs}` : ''}`),
    { skipCache: opts?.skipCache ?? true },
  );
  return {
    url: String(j?.url || ''),
    expiresIn: Number(j?.expiresIn ?? 60),
    difyConsoleUrl: j?.difyConsoleUrl != null ? String(j.difyConsoleUrl) : undefined,
    embedBaseUrl: j?.embedBaseUrl != null ? String(j.embedBaseUrl) : undefined,
    embedMode: Boolean(j?.embedMode),
  };
}

export async function fetchXinferenceMonitoringUiConfig(
  poolId: string,
  opts?: { skipCache?: boolean },
): Promise<XinferenceMonitoringUiConfig> {
  const j = await apiRequest(xinferenceBase(poolId, '/monitoring/ui-config'), {
    skipCache: opts?.skipCache ?? true,
  });
  return {
    endpoint: String(j?.endpoint || ''),
    grafanaUrl: j?.grafanaUrl != null ? String(j.grafanaUrl) : undefined,
    grafanaDashboardUid:
      j?.grafanaDashboardUid != null ? String(j.grafanaDashboardUid) : undefined,
    grafanaDatasource: j?.grafanaDatasource != null ? String(j.grafanaDatasource) : undefined,
    grafanaAlertDatasource:
      j?.grafanaAlertDatasource != null ? String(j.grafanaAlertDatasource) : undefined,
    clusterName: j?.clusterName != null ? String(j.clusterName) : undefined,
    configured: j?.configured === true,
    uiConfigError: j?.uiConfigError != null ? String(j.uiConfigError) : undefined,
  };
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
