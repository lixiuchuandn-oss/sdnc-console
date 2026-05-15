/**
 * 监控 API：概览 + 监控告警，按 cloudId 请求 /api/clouds/:id/monitoring/*
 * 设计文档：plan/设计-监控服务-概览.md、设计-监控服务-监控告警.md
 */
import { API_BASE_URL, getAuthHeaders } from './api';

const base = (cloudId: string) => `${API_BASE_URL}/api/clouds/${encodeURIComponent(cloudId)}/monitoring`;

async function apiGet<T = unknown>(
  url: string,
  options?: { signal?: AbortSignal; cache?: RequestCache },
): Promise<{ data: T | null; ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: getAuthHeaders(),
      credentials: 'include',
      signal: options?.signal,
      cache: options?.cache ?? 'default',
    });
    if (!res.ok) {
      const text = await res.text();
      let msg = res.statusText;
      try {
        const j = JSON.parse(text);
        msg = j?.message || msg;
      } catch {
        if (text) msg = text.slice(0, 200);
      }
      return { data: null, ok: false, error: msg };
    }
    const data = await res.json();
    return { data, ok: true };
  } catch (e: any) {
    return { data: null, ok: false, error: e?.message || '请求失败' };
  }
}

async function apiPostPut<T = unknown>(url: string, method: 'POST' | 'PUT', body: unknown): Promise<{ data: T | null; ok: boolean; error?: string }> {
  try {
    const headers = { ...getAuthHeaders(), 'Content-Type': 'application/json' };
    const res = await fetch(url, {
      method,
      headers,
      credentials: 'include',
      body: body != null ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      let msg = res.statusText;
      try {
        const j = JSON.parse(text);
        msg = j?.message || msg;
      } catch {
        if (text) msg = text.slice(0, 200);
      }
      return { data: null, ok: false, error: msg };
    }
    if (res.status === 204) return { data: null as any, ok: true };
    const data = await res.json();
    return { data, ok: true };
  } catch (e: any) {
    return { data: null, ok: false, error: e?.message || '请求失败' };
  }
}

async function apiDelete(url: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, { method: 'DELETE', headers: getAuthHeaders(), credentials: 'include' });
    if (!res.ok) {
      const text = await res.text();
      let msg = res.statusText;
      try {
        const j = JSON.parse(text);
        msg = j?.message || msg;
      } catch {
        if (text) msg = text.slice(0, 200);
      }
      return { ok: false, error: msg };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || '请求失败' };
  }
}

export function fetchStorageNodes(cloudId: string, options?: { signal?: AbortSignal }) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiGet(`${base(cloudId)}/storage-nodes`, options);
}

/** Rook CephCluster 列表（Steve：`cephclusters.ceph.rook.io` 等，由后端选择路径） */
export function fetchCephClusters(cloudId: string, options?: { signal?: AbortSignal }) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiGet(`${base(cloudId)}/ceph-clusters`, options);
}

/** Rook Ceph 聚合：CephCluster、CephBlockPool、CephBlockPoolRadosNamespace、CephFilesystem、CephObjectStore */
export function fetchCephResources(cloudId: string, options?: { signal?: AbortSignal; force?: boolean }) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  const q = options?.force ? `?_=${Date.now()}` : '';
  return apiGet(`${base(cloudId)}/ceph-resources${q}`, { signal: options?.signal, cache: options?.force ? 'no-store' : 'default' });
}

/** 经 K8s Service proxy 调用 Ceph mgr Dashboard REST（默认 GET api/summary） */
export interface CephDashboardSummaryEnvelope {
  data: unknown | null;
  _tower?: {
    source?: string;
    proxyPath?: string;
    namespace?: string;
    /** 为 request-body 时表示本次使用 POST 提交的 Kube Token / Dashboard 账号 */
    credentialMode?: string;
    cephDashboardError?: boolean | string;
    status?: number;
    message?: string;
  };
}

export function fetchCephDashboardSummary(
  cloudId: string,
  options?: { signal?: AbortSignal; force?: boolean; namespace?: string; path?: string },
) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  const sp = new URLSearchParams();
  if (options?.force) sp.set('_', String(Date.now()));
  if (options?.namespace) sp.set('namespace', options.namespace);
  if (options?.path) sp.set('path', options.path);
  const qs = sp.toString();
  const suffix = qs ? `?${qs}` : '';
  return apiGet<CephDashboardSummaryEnvelope>(`${base(cloudId)}/ceph-dashboard/summary${suffix}`, {
    signal: options?.signal,
    cache: options?.force ? 'no-store' : 'default',
  });
}

/** 页面填写 Kube Token / Dashboard 账号时使用（POST body，避免出现在 URL） */
export function postCephDashboardSummary(
  cloudId: string,
  body: {
    kubeToken?: string;
    dashboardUsername?: string;
    dashboardPassword?: string;
    namespace?: string;
    path?: string;
  },
  options?: { force?: boolean },
) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  const sp = new URLSearchParams();
  if (options?.force) sp.set('_', String(Date.now()));
  const qs = sp.toString();
  const suffix = qs ? `?${qs}` : '';
  const payload: Record<string, string> = {};
  const kt = body.kubeToken?.trim();
  if (kt) payload.kubeToken = kt;
  const du = body.dashboardUsername?.trim();
  if (du) payload.dashboardUsername = du;
  if (body.dashboardPassword != null && body.dashboardPassword !== '') {
    payload.dashboardPassword = body.dashboardPassword;
  }
  const ns = body.namespace?.trim();
  if (ns) payload.namespace = ns;
  const p = body.path?.trim();
  if (p) payload.path = p;
  return apiPostPut<CephDashboardSummaryEnvelope>(
    `${base(cloudId)}/ceph-dashboard/summary${suffix}`,
    'POST',
    payload,
  );
}

/**
 * 通用 Ceph mgr Dashboard REST 代理（后端经 K8s Service → mgr）。
 * `path` 须以 `api/` 开头，与 Ceph OpenAPI 路径一致，例如：`api/summary`、`api/health/full`、`api/docs`。
 */
/** Ceph Dashboard `GET /api/pool?stats=true`：与 UI 一致的 RADOS 池列表（含 pg_status、stats） */
export function fetchCephDashboardPools(
  cloudId: string,
  options?: { signal?: AbortSignal; namespace?: string; force?: boolean },
) {
  if (!cloudId) {
    return Promise.resolve({ ok: false, status: 0, data: null, rawText: '', error: '缺少 cloudId' });
  }
  // 勿在 path 上追加 &_= 缓存破坏参数：Ceph mgr Dashboard 的 api/pool 对多余 query 可能直接 500。
  // 强制刷新用 fetch cache: 'no-store'（见 cephDashboardProxy.skipBrowserCache）。
  return cephDashboardProxy(cloudId, {
    path: 'api/pool?stats=true',
    accept: 'application/vnd.ceph.api.v1.0+json',
    signal: options?.signal,
    namespace: options?.namespace,
    skipBrowserCache: !!options?.force,
  });
}

/** Ceph Dashboard `GET /api/pool/{pool_name}`：单池详情（可选 stats；含 configuration 等，与官方编辑前拉取一致） */
export function fetchCephDashboardPoolByName(
  cloudId: string,
  poolName: string,
  options?: { signal?: AbortSignal; namespace?: string; stats?: boolean },
) {
  if (!cloudId || !poolName.trim()) {
    return Promise.resolve({ ok: false, status: 0, data: null, rawText: '', error: '缺少 cloudId 或池名称' });
  }
  const enc = encodeURIComponent(poolName);
  const st = options?.stats !== false;
  const path = st ? `api/pool/${enc}?stats=true` : `api/pool/${enc}`;
  return cephDashboardProxy(cloudId, {
    path,
    accept: 'application/vnd.ceph.api.v1.0+json',
    signal: options?.signal,
    namespace: options?.namespace,
  });
}

/** Ceph Dashboard `POST /api/pool`：创建 RADOS 池（异步任务时可能返回 202） */
export function createCephDashboardPool(
  cloudId: string,
  body: Record<string, unknown>,
  options?: { signal?: AbortSignal; namespace?: string },
) {
  if (!cloudId) {
    return Promise.resolve({ ok: false, status: 0, data: null, rawText: '', error: '缺少 cloudId' });
  }
  return cephDashboardProxy(cloudId, {
    method: 'POST',
    path: 'api/pool',
    body,
    accept: 'application/vnd.ceph.api.v1.0+json',
    signal: options?.signal,
    namespace: options?.namespace,
  });
}

/** Ceph Dashboard `PUT /api/pool/{pool_name}`：更新池（副本、PG、配额、应用、重命名等） */
export function updateCephDashboardPool(
  cloudId: string,
  poolName: string,
  body: Record<string, unknown>,
  options?: { signal?: AbortSignal; namespace?: string },
) {
  if (!cloudId || !poolName.trim()) {
    return Promise.resolve({ ok: false, status: 0, data: null, rawText: '', error: '缺少 cloudId 或池名称' });
  }
  const enc = encodeURIComponent(poolName);
  return cephDashboardProxy(cloudId, {
    method: 'PUT',
    path: `api/pool/${enc}`,
    body,
    accept: 'application/vnd.ceph.api.v1.0+json',
    signal: options?.signal,
    namespace: options?.namespace,
  });
}

/** Ceph Dashboard `GET ui/pool/info`：创建池对话框用（CRUSH 规则、压缩枚举、PG 自动伸缩默认值等，非公开 REST 但只读） */
export function fetchCephPoolUiInfo(
  cloudId: string,
  options?: { signal?: AbortSignal; namespace?: string },
) {
  if (!cloudId) {
    return Promise.resolve({ ok: false, status: 0, data: null, rawText: '', error: '缺少 cloudId' });
  }
  return cephDashboardProxy(cloudId, {
    path: 'ui/pool/info',
    accept: 'application/json, application/vnd.ceph.api.v1.0+json',
    signal: options?.signal,
    namespace: options?.namespace,
  });
}

/** Ceph Dashboard `GET /api/pool/{pool_name}/configuration`：RBD 池级配置（官方 Pools 页「配置」Tab，主要为 QoS） */
export function fetchCephPoolRbdConfiguration(
  cloudId: string,
  poolName: string,
  options?: { signal?: AbortSignal; namespace?: string },
) {
  if (!cloudId || !poolName.trim()) {
    return Promise.resolve({ ok: false, status: 0, data: null, rawText: '', error: '缺少 cloudId 或池名称' });
  }
  const enc = encodeURIComponent(poolName);
  return cephDashboardProxy(cloudId, {
    path: `api/pool/${enc}/configuration`,
    accept: 'application/vnd.ceph.api.v1.0+json',
    signal: options?.signal,
    namespace: options?.namespace,
  });
}

export async function cephDashboardProxy(
  cloudId: string,
  options: {
    method?: string;
    path: string;
    namespace?: string;
    body?: unknown;
    accept?: string;
    contentType?: string;
    signal?: AbortSignal;
    /** 为 true 时 fetch 使用 no-store，避免改 path 触发 Dashboard 对未知 query 的 500 */
    skipBrowserCache?: boolean;
  },
): Promise<{
  ok: boolean;
  status: number;
  data: unknown | null;
  rawText: string;
  error?: string;
}> {
  if (!cloudId) {
    return { ok: false, status: 0, data: null, rawText: '', error: '缺少 cloudId' };
  }
  const path = String(options.path || '').replace(/^\/+/, '');
  const sp = new URLSearchParams();
  sp.set('path', path);
  if (options.namespace) sp.set('namespace', options.namespace);
  const url = `${base(cloudId)}/ceph-dashboard/proxy?${sp.toString()}`;
  const headers: Record<string, string> = { ...getAuthHeaders() };
  if (options.accept) headers.Accept = options.accept;
  const method = (options.method || 'GET').toUpperCase();
  let body: string | undefined;
  if (options.body != null && !['GET', 'HEAD'].includes(method)) {
    headers['Content-Type'] = options.contentType?.trim() || 'application/json';
    body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }
  try {
    const res = await fetch(url, {
      method,
      headers,
      credentials: 'include',
      body,
      signal: options.signal,
      cache: options.skipBrowserCache ? 'no-store' : 'default',
    });
    const rawText = await res.text();
    let data: unknown = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json') || /^\s*[\[{]/.test(rawText)) {
      try {
        data = JSON.parse(rawText);
      } catch {
        data = null;
      }
    }
    if (!res.ok) {
      const msg =
        typeof data === 'object' && data && (data as { detail?: string }).detail
          ? String((data as { detail?: string }).detail)
          : rawText.slice(0, 400);
      return { ok: false, status: res.status, data, rawText, error: msg || res.statusText };
    }
    return { ok: true, status: res.status, data, rawText };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '请求失败';
    return { ok: false, status: 0, data: null, rawText: '', error: msg };
  }
}

export function fetchNodeResources(cloudId: string, options?: { signal?: AbortSignal }) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiGet(`${base(cloudId)}/node-resources`, options);
}

export function fetchNodeMetrics(cloudId: string, options?: { signal?: AbortSignal }) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiGet(`${base(cloudId)}/node-metrics`, options);
}

/** Prometheus query_range 响应格式 */
export interface PrometheusQueryRangeResponse {
  status?: string;
  data?: {
    resultType?: string;
    result?: Array<{ metric?: Record<string, string>; values?: [number, string][] }>;
  };
}

/** Prometheus 范围查询：用于 VM 性能图表等，query/start/end/step 对应 Prometheus query_range API */
export function fetchMetricRange(
  cloudId: string,
  params: { query: string; start: number; end: number; step: number },
  options?: { signal?: AbortSignal }
): Promise<{ data: PrometheusQueryRangeResponse | null; ok: boolean; error?: string }> {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  const q = new URLSearchParams({
    query: params.query,
    start: String(params.start),
    end: String(params.end),
    step: String(params.step),
  });
  return apiGet<PrometheusQueryRangeResponse>(`${base(cloudId)}/metric-range?${q.toString()}`, options);
}

export function fetchAlertsRules(
  cloudId: string,
  options?: { signal?: AbortSignal; datasource?: string; namespace?: string; page?: number; pageSize?: number }
) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  const params = new URLSearchParams();
  if (options?.datasource) params.set('datasource', options.datasource);
  if (options?.namespace) params.set('namespace', options.namespace);
  if (options?.page != null) params.set('page', String(options.page));
  if (options?.pageSize != null) params.set('pageSize', String(options.pageSize));
  const q = params.toString();
  return apiGet(`${base(cloudId)}/alerts-rules${q ? `?${q}` : ''}`, options);
}

export function fetchVirtualMachines(cloudId: string, options?: { signal?: AbortSignal }) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiGet(`${base(cloudId)}/virtualmachines`, options);
}

export function fetchVirtualMachineInstances(cloudId: string, options?: { signal?: AbortSignal }) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiGet(`${base(cloudId)}/virtualmachineinstances`, options);
}

export function fetchBlockDevices(cloudId: string, options?: { signal?: AbortSignal }) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiGet(`${base(cloudId)}/blockdevices`, options);
}

// --- 监控告警：租户 allowed-namespaces、AlertmanagerConfig、PrometheusRule ---

export function fetchAllowedNamespaces(cloudId: string, options?: { signal?: AbortSignal }) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiGet<{ isAdmin: boolean; namespaces: string[] }>(`${base(cloudId)}/allowed-namespaces`, options);
}

export function fetchAlertmanagerconfigs(cloudId: string, options?: { signal?: AbortSignal }) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiGet(`${base(cloudId)}/alertmanagerconfigs`, options);
}

export function fetchAlertmanagerconfigDetail(
  cloudId: string,
  namespace: string,
  name: string,
  options?: { signal?: AbortSignal }
) {
  if (!cloudId || !namespace || !name) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId/namespace/name' });
  return apiGet(`${base(cloudId)}/alertmanagerconfigs/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, options);
}

/** 邮件通知对象（receiverName = email-receiver，对齐 AlertmanagerConfig spec.receivers[]） */
export interface NotificationTargetEmailReceiver {
  namespace?: string;
  receiverName: 'email-receiver';
  specReceivers: Array<{
    name: string;
    emailConfigs?: Array<{
      to?: string;
      from?: string;
      smarthost?: string;
      authUsername?: string;
      authPassword?: { name: string; key: string };
      requireTLS?: boolean;
      tlsConfig?: Record<string, unknown>;
      sendResolved?: boolean;
    }>;
  }>;
}

/** 钉钉通知对象（receiverName = dingtalk-receiver，对齐 AlertmanagerConfig spec.receivers[]，webhookConfigs 为代理 URL） */
export interface NotificationTargetDingtalkReceiver {
  namespace?: string;
  receiverName: 'dingtalk-receiver';
  specReceivers: Array<{
    name: string;
    webhookConfigs?: Array<{
      url?: string;
      robotUrl?: string;
      robotAccount?: string;
      robotAccessToken?: string;
      sendResolved?: boolean;
    }>;
  }>;
}

/** 告警通知对象（邮件与钉钉分类型，便于 UI 区分；后端列表接口返回此联合类型） */
export type NotificationTargetReceiver = NotificationTargetEmailReceiver | NotificationTargetDingtalkReceiver;

/** 告警通知对象：按命名空间拉取 receivers 列表（后端返回新结构），receiverName 为 email-receiver / dingtalk-receiver / website-receiver */
export function fetchNotificationTargets(
  cloudId: string,
  namespace: string,
  options?: { signal?: AbortSignal; receiverName?: string }
) {
  if (!cloudId || !namespace) return Promise.resolve({ data: null, ok: false, error: '缺少资源ID或命名空间' });
  const params = new URLSearchParams();
  if (options?.receiverName) params.set('receiverName', options.receiverName);
  const q = params.toString();
  return apiGet<{ receivers: NotificationTargetReceiver[] }>(
    `${base(cloudId)}/alertmanagerconfigs/${encodeURIComponent(namespace)}/receivers${q ? `?${q}` : ''}`,
    options
  );
}

/** 通过数据库验证通知对象名称是否已存在（不调用 Harvester） */
export function checkReceiverNameExists(
  cloudId: string,
  namespace: string,
  specReceiverName: string,
  receiverType: string,
  options?: { signal?: AbortSignal }
) {
  if (!cloudId || !namespace || !specReceiverName) return Promise.resolve({ data: null, ok: false, error: '缺少参数' });
  const params = new URLSearchParams({ namespace, specReceiverName, receiverType });
  return apiGet<{ exists: boolean }>(
    `${base(cloudId)}/alertmanagerconfigs/receivers/check?${params}`,
    options
  );
}

/** 告警通知对象：从 Harvester API 获取（GET .../alertmanagerconfigs/receivers，labelSelector: monitoring-receiver=true），按 namespaces/receiverName 过滤 */
export function fetchNotificationTargetsList(
  cloudId: string,
  options?: { signal?: AbortSignal; namespaces?: string[]; receiverName?: string[] }
) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  const params = new URLSearchParams();
  (options?.namespaces ?? []).forEach((ns) => params.append('namespaces', ns));
  (options?.receiverName ?? []).forEach((r) => params.append('receiverName', r));
  const q = params.toString();
  return apiGet<{ receivers: NotificationTargetReceiver[] }>(
    `${base(cloudId)}/alertmanagerconfigs/receivers${q ? `?${q}` : ''}`,
    options
  );
}

export function createAlertmanagerconfig(cloudId: string, body: unknown) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiPostPut(`${base(cloudId)}/alertmanagerconfigs`, 'POST', body);
}

/** 告警通知对象：新增/更新配置。URL 指定 namespace 与 name（email-receiver / dingtalk-receiver / website-receiver），不存在则创建对应 AlertmanagerConfig，存在则在其 spec.receivers 下追加/更新；body 为完整 AlertmanagerConfig。 */
export function postAlertmanagerconfigReceivers(
  cloudId: string,
  namespace: string,
  name: string,
  body: unknown
) {
  if (!cloudId || !namespace || !name) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId/namespace/name' });
  return apiPostPut(
    `${base(cloudId)}/alertmanagerconfigs/receivers/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
    'POST',
    body
  );
}

export function updateAlertmanagerconfig(cloudId: string, namespace: string, name: string, body: unknown) {
  if (!cloudId || !namespace || !name) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId/namespace/name' });
  return apiPostPut(
    `${base(cloudId)}/alertmanagerconfigs/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
    'PUT',
    body
  );
}

export function deleteAlertmanagerconfig(cloudId: string, namespace: string, name: string) {
  if (!cloudId || !namespace || !name) return Promise.resolve({ ok: false, error: '缺少 cloudId/namespace/name' });
  return apiDelete(`${base(cloudId)}/alertmanagerconfigs/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
}

/** 告警策略与通知对象关联：从 Harvester 查询引用某 receiver 的策略（namespace + specReceiverName） */
export interface AlertPolicyReceiverItem {
  namespace: string;
  policyName: string;
}

export function fetchAlertPolicyReceivers(
  cloudId: string,
  options?: { namespace?: string; specReceiverName?: string; signal?: AbortSignal }
) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  const params = new URLSearchParams();
  if (options?.namespace) params.set('namespace', options.namespace);
  if (options?.specReceiverName) params.set('specReceiverName', options.specReceiverName);
  const q = params.toString();
  return apiGet<{ data: AlertPolicyReceiverItem[] }>(
    `${base(cloudId)}/alertmanagerconfigs/policy-receivers${q ? `?${q}` : ''}`,
    { signal: options?.signal }
  );
}

/** 告警通知对象：删除指定接收器（仅从 spec.receivers 中移除 specReceiverName，不删除整个 AlertmanagerConfig） */
export function deleteAlertmanagerconfigReceiver(
  cloudId: string,
  namespace: string,
  name: string,
  specReceiverName: string
) {
  if (!cloudId || !namespace || !name || !specReceiverName) return Promise.resolve({ ok: false, error: '缺少 cloudId/namespace/name/specReceiverName' });
  const q = `specReceiverName=${encodeURIComponent(specReceiverName)}`;
  return apiDelete(`${base(cloudId)}/alertmanagerconfigs/receivers/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}?${q}`);
}

/** 获取指定命名空间下的 ConfigMap（GET /monitoring/configmaps/:namespace/:name） */
export function fetchConfigMap(
  cloudId: string,
  namespace: string,
  name: string,
  options?: { signal?: AbortSignal }
) {
  if (!cloudId || !namespace || !name) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId/namespace/name' });
  return apiGet(
    `${base(cloudId)}/configmaps/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
    options
  );
}

export function fetchPrometheusRuleVmCustomRules(cloudId: string, options?: { signal?: AbortSignal }) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiGet(`${base(cloudId)}/prometheusrules/vm-custom-rules`, options);
}

/** 告警密钥项：与后端 GET /monitoring/secrets 列表元素、GET /monitoring/secrets/:namespace/:name 详情一致。data 的值为 Base64 编码。 */
export interface OpaqueSecretItem {
  name: string;
  type?: string;
  data: Record<string, string>;
}

/** 查-列表：告警密钥（labels: monitoring-receiver-secret=true）。GET /monitoring/secrets?namespace=&datasource=，返回 { name, data, type }[] */
export function fetchSecrets(
  cloudId: string,
  options?: { signal?: AbortSignal; namespace?: string; datasource?: string }
) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  const params = new URLSearchParams();
  if (options?.namespace) params.set('namespace', options.namespace);
  if (options?.datasource) params.set('datasource', options.datasource ?? 'prometheus');
  const q = params.toString();
  return apiGet<OpaqueSecretItem[]>(`${base(cloudId)}/secrets${q ? `?${q}` : ''}`, options);
}

/** 查-详情：单个告警密钥。GET /monitoring/secrets/:namespace/:name，返回 { name, namespace, data, type }，data 为 Base64 键值对 */
export function fetchSecretDetail(
  cloudId: string,
  namespace: string,
  name: string,
  options?: { signal?: AbortSignal }
) {
  if (!cloudId || !namespace || !name) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId/namespace/name' });
  return apiGet<OpaqueSecretItem & { namespace?: string }>(
    `${base(cloudId)}/secrets/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
    options
  );
}

/** 增：新增告警密钥。POST /monitoring/secrets，body.metadata.namespace/name 必填，body.data 为键值对且值需已 Base64 编码 */
export function createSecret(cloudId: string, body: { metadata: { namespace: string; name: string; labels?: Record<string, string> }; data: Record<string, string>; type?: string }) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiPostPut(`${base(cloudId)}/secrets`, 'POST', body);
}

/** 改：修改告警密钥。PUT /monitoring/secrets/:namespace/:name，body.data 为键值对且值需已 Base64 编码 */
export function updateSecret(cloudId: string, namespace: string, name: string, body: { data: Record<string, string>; type?: string }) {
  if (!cloudId || !namespace || !name) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId/namespace/name' });
  return apiPostPut(
    `${base(cloudId)}/secrets/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
    'PUT',
    body
  );
}

/** 删：删除告警密钥。DELETE /monitoring/secrets/:namespace/:name，仅允许带 monitoring-receiver-secret=true 的密钥 */
export function deleteSecret(cloudId: string, namespace: string, name: string) {
  if (!cloudId || !namespace || !name) return Promise.resolve({ ok: false, error: '缺少 cloudId/namespace/name' });
  return apiDelete(`${base(cloudId)}/secrets/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
}

/** 告警规则列表（PrometheusRule 解析结果），需传 datasource=prometheus；租户可传 alertNames 只返回对应告警 */
export function fetchPrometheusRules(
  cloudId: string,
  options?: { signal?: AbortSignal; alertNames?: string[] }
) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  const params = new URLSearchParams({ datasource: 'prometheus' });
  if (options?.alertNames?.length) options.alertNames.forEach((a) => params.append('alertNames', a));
  const q = params.toString();
  return apiGet<{ rules: PrometheusRuleItem[] }>(
    `${base(cloudId)}/prometheusrules?${q}`,
    options
  );
}

/** 告警分组映射（后端缓存的 rulesGroupMap），用于告警分组下拉，需先调过 prometheusrules 才有缓存 */
export function fetchPrometheusRulesGroups(cloudId: string, options?: { signal?: AbortSignal }) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiGet<{ rulesGroupMap: Record<string, string> }>(
    `${base(cloudId)}/prometheusrules-groups?datasource=prometheus`,
    options
  );
}

export interface PrometheusRuleItem {
  datasource: string;
  groupName: string;
  groupAliasName: string;
  namespace?: string;
  name: string;
  aliasName: string;
  expression: string;
  interval: string;
  severity: string;
}
