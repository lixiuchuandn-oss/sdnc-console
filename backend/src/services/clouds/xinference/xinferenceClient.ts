import axios from 'axios';
import https from 'https';
import type { Cloud } from '../../../entities/Cloud';

export type XinferenceHttpContext = {
  origin: string;
  token: string;
  insecure: boolean;
};

function normalizeBaseUrl(raw: string): string {
  let base = String(raw || '')
    .trim()
    .replace(/\/+$/, '');
  if (base && !/^https?:\/\//i.test(base)) {
    base = `http://${base}`;
  }
  try {
    return new URL(base).origin;
  } catch {
    return base;
  }
}

export function getXinferenceContext(cloud: Cloud): XinferenceHttpContext | null {
  const provider = String(cloud.config?.provider || '').toLowerCase();
  if (provider !== 'xinference') return null;
  const base = normalizeBaseUrl(
    String((cloud as any).endpoint || (cloud as any).config?.endpoint || ''),
  );
  const token = String(
    cloud.secretKey || (cloud as any).config?.apiToken || (cloud as any).config?.token || '',
  ).trim();
  const insecure = !!(cloud.config as any)?.ignoreTls;
  if (!base) return null;
  return { origin: base, token, insecure };
}

export function buildXinferenceContextFromArgs(args: {
  endpoint?: string;
  secretKey?: string;
  config?: any;
}): XinferenceHttpContext | null {
  const base = normalizeBaseUrl(String(args.endpoint || args.config?.endpoint || '').trim());
  const token = String(args.secretKey || args.config?.apiToken || args.config?.token || '').trim();
  const insecure = !!args.config?.ignoreTls;
  if (!base) return null;
  return { origin: base, token, insecure };
}

function buildAuthHeaders(token: string): Record<string, string> {
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

export type XinferenceHttpResult = {
  ok: boolean;
  status: number;
  data?: any;
  message?: string;
};

async function xinferenceRequest(
  ctx: XinferenceHttpContext,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
  opts?: { timeout?: number },
): Promise<XinferenceHttpResult> {
  const p = path.startsWith('/') ? path : `/${path}`;
  const url = `${ctx.origin}${p}`;
  const isHttps = url.startsWith('https:');
  const agent = isHttps
    ? new https.Agent({ keepAlive: true, rejectUnauthorized: !ctx.insecure })
    : undefined;
  try {
    const res = await axios.request({
      method,
      url,
      data: body,
      headers: {
        ...buildAuthHeaders(ctx.token),
        ...(body != null ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(isHttps && agent ? { httpsAgent: agent } : {}),
      timeout: opts?.timeout ?? (method === 'POST' ? 120000 : 30000),
      validateStatus: () => true,
    });
    if (res.status === 401) {
      return { ok: false, status: 401, message: 'Xinference 认证失败：API 令牌无效或已过期' };
    }
    if (res.status < 200 || res.status >= 300) {
      const detail =
        res.data?.detail ||
        res.data?.message ||
        res.data?.error ||
        (typeof res.data === 'string' ? res.data : null);
      const msg = detail ? String(detail) : `Xinference 请求失败: HTTP ${res.status}`;
      return { ok: false, status: res.status, message: msg };
    }
    return { ok: true, status: res.status, data: res.data };
  } catch (e: any) {
    const isTimeout = e?.code === 'ECONNABORTED' || String(e?.message || '').includes('timeout');
    return {
      ok: false,
      status: 0,
      message: isTimeout
        ? `Xinference 请求超时（${opts?.timeout ?? (method === 'POST' ? 120000 : 30000)}ms）`
        : e?.message || 'Xinference 请求异常',
    };
  }
}

export async function xinferenceGet(
  ctx: XinferenceHttpContext,
  path: string,
  opts?: { timeout?: number },
): Promise<XinferenceHttpResult> {
  return xinferenceRequest(ctx, 'GET', path, undefined, opts);
}

export async function xinferencePost(
  ctx: XinferenceHttpContext,
  path: string,
  body: unknown,
  opts?: { timeout?: number },
): Promise<XinferenceHttpResult> {
  return xinferenceRequest(ctx, 'POST', path, body, opts);
}

export async function xinferenceDelete(
  ctx: XinferenceHttpContext,
  path: string,
  opts?: { timeout?: number },
): Promise<XinferenceHttpResult> {
  return xinferenceRequest(ctx, 'DELETE', path, undefined, opts);
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
  address?: string;
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

/** GET /v1/models/instances — 含 CREATING（下载/加载中）实例；DELETE /v1/models/instances/{model_uid} 清理僵尸元数据（非 terminate） */
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

function pickStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => String(x).trim()).filter(Boolean);
}

function readContextLength(m: Record<string, unknown>): number | undefined {
  const direct = m.context_length ?? m.contextLength;
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;
  const specs = Array.isArray(m.model_specs) ? m.model_specs : [];
  for (const spec of specs) {
    if (!spec || typeof spec !== 'object') continue;
    const s = spec as Record<string, unknown>;
    const cl = s.context_length ?? s.contextLength;
    if (typeof cl === 'number' && Number.isFinite(cl)) return cl;
  }
  return undefined;
}

function normalizeReplicaStatus(raw: unknown): XinferenceReplicaStatus | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const replicaModelUid = String(m.replica_model_uid ?? m.replicaModelUid ?? '').trim();
  const replicaIdRaw = m.replica_id ?? m.replicaId;
  const replicaId =
    typeof replicaIdRaw === 'number' && Number.isFinite(replicaIdRaw) ? replicaIdRaw : 0;
  if (!replicaModelUid && replicaIdRaw == null) return null;
  return {
    replicaId,
    replicaModelUid: replicaModelUid || String(replicaId),
    workerAddress:
      m.worker_address != null
        ? String(m.worker_address)
        : m.workerAddress != null
          ? String(m.workerAddress)
          : undefined,
    status: String(m.status ?? ''),
    createdTs:
      typeof m.created_ts === 'number'
        ? m.created_ts
        : typeof m.createdTs === 'number'
          ? m.createdTs
          : undefined,
    errorMessage:
      m.error_message != null
        ? String(m.error_message)
        : m.errorMessage != null
          ? String(m.errorMessage)
          : null,
  };
}

/** GET /v1/models/instances */
export function normalizeModelInstances(raw: unknown): XinferenceModelInstance[] {
  if (!Array.isArray(raw)) return [];
  const out: XinferenceModelInstance[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const m = item as Record<string, unknown>;
    const modelUid = String(m.model_uid ?? m.modelUid ?? '').trim();
    if (!modelUid) continue;
    const modelName = String(m.model_name ?? m.modelName ?? modelUid).trim();
    const replicaStatusesRaw = Array.isArray(m.replica_statuses)
      ? m.replica_statuses
      : Array.isArray(m.replicaStatuses)
        ? m.replicaStatuses
        : [];
    out.push({
      modelName,
      modelUid,
      modelVersion:
        m.model_version != null
          ? String(m.model_version)
          : m.modelVersion != null
            ? String(m.modelVersion)
            : null,
      modelAbility: pickStringArray(m.model_ability ?? m.modelAbility),
      replica: typeof m.replica === 'number' ? m.replica : 1,
      status: String(m.status ?? ''),
      instanceCreatedTs:
        typeof m.instance_created_ts === 'number'
          ? m.instance_created_ts
          : typeof m.instanceCreatedTs === 'number'
            ? m.instanceCreatedTs
            : undefined,
      nWorker:
        typeof m.n_worker === 'number'
          ? m.n_worker
          : typeof m.nWorker === 'number'
            ? m.nWorker
            : undefined,
      errorMessage:
        m.error_message != null
          ? String(m.error_message)
          : m.errorMessage != null
            ? String(m.errorMessage)
            : null,
      replicaStatuses: replicaStatusesRaw
        .map(normalizeReplicaStatus)
        .filter((x): x is XinferenceReplicaStatus => x != null),
    });
  }
  return out;
}

/** GET /v1/models/{uid}/replicas */
export function normalizeModelReplicas(raw: unknown): XinferenceReplicaStatus[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeReplicaStatus).filter((x): x is XinferenceReplicaStatus => x != null);
}

/** GET /v1/models → 运行中模型列表 */
export function normalizeRunningModels(raw: unknown): XinferenceRunningModel[] {
  if (!raw || typeof raw !== 'object') return [];
  const o = raw as Record<string, unknown>;
  let items: unknown[] = [];
  if (Array.isArray(o.data)) {
    items = o.data;
  } else if (!Array.isArray(raw)) {
    items = Object.entries(o).map(([uid, info]) => {
      if (info && typeof info === 'object') {
        return { id: uid, ...(info as object) };
      }
      return { id: uid, model_name: uid };
    });
  }
  const out: XinferenceRunningModel[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const m = item as Record<string, unknown>;
    const modelUid = String(m.id ?? m.model_uid ?? '').trim();
    if (!modelUid) continue;
    const modelName = String(m.model_name ?? modelUid).trim();
    out.push({
      modelUid,
      modelName,
      modelType: m.model_type != null ? String(m.model_type) : undefined,
      modelEngine: m.model_engine != null ? String(m.model_engine) : undefined,
      modelFormat: m.model_format != null ? String(m.model_format) : undefined,
      sizeInBillions:
        m.model_size_in_billions != null
          ? String(m.model_size_in_billions)
          : m.size_in_billions != null
            ? String(m.size_in_billions)
            : undefined,
      quantization: m.quantization != null ? String(m.quantization) : undefined,
      replica: typeof m.replica === 'number' ? m.replica : undefined,
      address: m.address != null ? String(m.address) : undefined,
      accelerators: pickAcceleratorsField(m),
    });
  }
  return out;
}

function pickAcceleratorsField(m: Record<string, unknown>): string[] | undefined {
  const raw = m.accelerators ?? m.gpu_idx ?? m.gpuIdx;
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

/** GET /v1/model_registrations/{type} */
export function normalizeModelRegistrations(raw: unknown): XinferenceModelRegistration[] {
  if (!Array.isArray(raw)) return [];
  const out: XinferenceModelRegistration[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const m = item as Record<string, unknown>;
    const modelName = String(m.model_name ?? '').trim();
    if (!modelName) continue;
    const abilities = pickStringArray(m.model_abilities ?? m.model_ability);
    const languages = pickStringArray(m.model_lang ?? m.model_langs);
    out.push({
      modelName,
      modelType: m.model_type != null ? String(m.model_type) : undefined,
      isBuiltin: m.is_builtin === true,
      description:
        m.model_description != null
          ? String(m.model_description)
          : m.description != null
            ? String(m.description)
            : undefined,
      abilities,
      languages,
      contextLength: readContextLength(m),
    });
  }
  return out;
}

/** 探测集群是否启用认证（兼容旧版无此接口） */
export async function xinferenceClusterAuthRequired(ctx: XinferenceHttpContext): Promise<boolean> {
  const r = await xinferenceGet(ctx, '/v1/cluster/auth', { timeout: 15000 });
  if (r.status === 404) return false;
  if (!r.ok) return false;
  return !!r.data?.auth;
}

export async function testXinferenceConnection(args: {
  endpoint?: string;
  secretKey?: string;
  config?: any;
}): Promise<{ ok: boolean; message: string }> {
  const ctx = buildXinferenceContextFromArgs(args);
  if (!ctx) {
    return { ok: false, message: '缺少 Xinference 服务地址' };
  }
  const needsAuth = await xinferenceClusterAuthRequired(ctx);
  if (needsAuth && !ctx.token) {
    return { ok: false, message: 'Xinference 集群已启用认证，请填写 API 令牌' };
  }
  const sup = await xinferenceGet(ctx, '/v1/supervisor', { timeout: 20000 });
  if (!sup.ok) {
    return { ok: false, message: sup.message || 'Xinference 连接失败' };
  }
  return { ok: true, message: 'Xinference 接口连通' };
}

/** Worker 列表：兼容数组 / { data } / 键值对象 */
export function normalizeXinferenceWorkers(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.data)) return o.data;
    if (Array.isArray(o.workers)) return o.workers;
    const values = Object.values(o);
    if (values.length && values.every((v) => v && typeof v === 'object')) {
      return values as any[];
    }
  }
  return [];
}

export function countRunningModels(raw: unknown): number {
  if (!raw || typeof raw !== 'object') return 0;
  const o = raw as Record<string, unknown>;
  if (Array.isArray(o.data)) return o.data.length;
  return Object.keys(o).length;
}

export type XinferenceClusterNodeRaw = {
  node_type?: string;
  ip_address?: string;
  cpu_count?: number | null;
  cpu_available?: number | null;
  mem_used?: number | null;
  mem_total?: number | null;
  gpu_count?: number;
  gpu_utilization?: number | null;
  gpu_vram_total?: number | string | null;
  gpu_vram_available?: number | null;
};

export type XinferenceClusterNodeMetrics = {
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

function parseMiBString(raw: string): number | null {
  const m = String(raw)
    .trim()
    .match(/^([\d.]+)\s*MiB$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? Math.round(n * 1024 * 1024) : null;
}

function parseGpuVramTotalBytes(raw: number | string | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const fromMiB = parseMiBString(raw);
    if (fromMiB != null) return fromMiB;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function avgNullable(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** 多节点 CPU 使用率：按核数加权，与仪表板集群环图口径一致 */
function weightedCpuUsagePercent(nodes: XinferenceClusterNodeMetrics[]): number | null {
  let totalCores = 0;
  let weighted = 0;
  for (const n of nodes) {
    const cores = n.cpuCount ?? 0;
    const usage = n.cpuUsagePercent;
    if (cores > 0 && usage != null && Number.isFinite(usage)) {
      totalCores += cores;
      weighted += usage * cores;
    }
  }
  if (totalCores > 0) return weighted / totalCores;
  return avgNullable(nodes.map((n) => n.cpuUsagePercent));
}

/** 多节点 GPU 负载：按 GPU 数量加权 */
function weightedGpuUtilization(nodes: XinferenceClusterNodeMetrics[]): number | null {
  let totalGpus = 0;
  let weighted = 0;
  for (const n of nodes) {
    const gpus = n.gpuCount ?? 0;
    const util = n.gpuUtilization;
    if (gpus > 0 && util != null && Number.isFinite(util)) {
      totalGpus += gpus;
      weighted += util * gpus;
    }
  }
  if (totalGpus > 0) return weighted / totalGpus;
  return avgNullable(nodes.map((n) => n.gpuUtilization));
}

function sumNullable(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0);
}

/** 解析 GET /v1/cluster/info?detailed=true 单节点 */
export function normalizeClusterDeviceNode(
  raw: XinferenceClusterNodeRaw,
): XinferenceClusterNodeMetrics {
  const nodeType = String(raw.node_type || '').trim() || 'Unknown';
  const address = raw.ip_address != null ? String(raw.ip_address).trim() : undefined;
  const cpuCount =
    typeof raw.cpu_count === 'number' && Number.isFinite(raw.cpu_count) ? raw.cpu_count : null;
  const cpuAvailable =
    typeof raw.cpu_available === 'number' && Number.isFinite(raw.cpu_available)
      ? raw.cpu_available
      : null;
  let cpuUsagePercent: number | null = null;
  if (cpuCount != null && cpuCount > 0 && cpuAvailable != null) {
    cpuUsagePercent = ((cpuCount - cpuAvailable) / cpuCount) * 100;
  }

  const memUsedBytes =
    typeof raw.mem_used === 'number' && Number.isFinite(raw.mem_used) ? raw.mem_used : null;
  const memTotalBytes =
    typeof raw.mem_total === 'number' && Number.isFinite(raw.mem_total) ? raw.mem_total : null;
  const gpuCount =
    typeof raw.gpu_count === 'number' && Number.isFinite(raw.gpu_count) ? raw.gpu_count : 0;
  const gpuUtilization =
    typeof raw.gpu_utilization === 'number' && Number.isFinite(raw.gpu_utilization)
      ? raw.gpu_utilization
      : null;
  const gpuVramTotalBytes = parseGpuVramTotalBytes(raw.gpu_vram_total);
  const gpuVramAvailable =
    typeof raw.gpu_vram_available === 'number' && Number.isFinite(raw.gpu_vram_available)
      ? raw.gpu_vram_available
      : null;
  const gpuVramUsedBytes =
    gpuVramTotalBytes != null && gpuVramAvailable != null
      ? Math.max(0, gpuVramTotalBytes - gpuVramAvailable)
      : null;

  return {
    nodeType,
    address,
    cpuUsagePercent,
    cpuCount,
    memUsedBytes,
    memTotalBytes,
    gpuCount,
    gpuUtilization,
    gpuVramUsedBytes,
    gpuVramTotalBytes,
  };
}

export function normalizeClusterDeviceInfo(raw: unknown): XinferenceClusterNodeMetrics[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === 'object')
    .map((item) => normalizeClusterDeviceNode(item as XinferenceClusterNodeRaw));
}

export function normalizeClusterVersion(raw: unknown): { release?: string; commit?: string } {
  if (!raw || typeof raw !== 'object') return {};
  const o = raw as Record<string, unknown>;
  const release = o.version != null ? String(o.version) : undefined;
  const commitRaw = o['full-revisionid'] ?? o.fullRevisionId ?? o.commit;
  const commit = commitRaw != null ? String(commitRaw) : undefined;
  return { release, commit };
}

function buildNodeSummary(
  nodes: XinferenceClusterNodeMetrics[],
  version?: { release?: string; commit?: string },
): XinferenceClusterSummary {
  const count = nodes.length;
  const address = count === 1 ? nodes[0]?.address : count > 1 ? `${count} 个节点` : undefined;
  return {
    count,
    address,
    cpuUsagePercent: weightedCpuUsagePercent(nodes),
    cpuCount: sumNullable(nodes.map((n) => n.cpuCount)),
    memUsedBytes: sumNullable(nodes.map((n) => n.memUsedBytes)),
    memTotalBytes: sumNullable(nodes.map((n) => n.memTotalBytes)),
    gpuCount: sumNullable(nodes.map((n) => n.gpuCount)) ?? 0,
    gpuUtilization: weightedGpuUtilization(nodes),
    gpuVramUsedBytes: sumNullable(nodes.map((n) => n.gpuVramUsedBytes)),
    gpuVramTotalBytes: sumNullable(nodes.map((n) => n.gpuVramTotalBytes)),
    versionRelease: version?.release,
    versionCommit: version?.commit,
  };
}

/** 将 cluster/info 节点列表拆分为主管 / 工作节点汇总 / 工作节点详情 */
export function buildClusterInfoView(
  nodes: XinferenceClusterNodeMetrics[],
  version: { release?: string; commit?: string },
): {
  supervisor: XinferenceClusterSummary;
  workersSummary: XinferenceClusterSummary;
  workerDetails: XinferenceClusterNodeMetrics[];
} {
  const supervisors = nodes.filter((n) => n.nodeType.toLowerCase() === 'supervisor');
  const workers = nodes.filter((n) => n.nodeType.toLowerCase() === 'worker');
  return {
    supervisor: buildNodeSummary(supervisors, version),
    workersSummary: buildNodeSummary(workers),
    workerDetails: workers,
  };
}
