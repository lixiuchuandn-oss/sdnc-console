/**
 * 集群日志 API：ClusterFlow、ClusterOutput、节点列表；资源组日志外发：Output
 * 按 cloudId 请求 /api/clouds/:id/logging/*
 * 设计文档：plan/设计-监控服务-集群日志配置.md、设计-监控服务-资源组日志外发.md
 */
import { apiRequest, apiPost, apiPatch, apiDelete as apiDeleteUnified } from './api';

const base = (cloudId: string) => `/api/clouds/${encodeURIComponent(cloudId)}/logging`;

// 包装统一 API 函数，保持向后兼容的返回格式 { data, ok, error }
async function apiGet<T = unknown>(url: string, options?: { signal?: AbortSignal }): Promise<{ data: T | null; ok: boolean; error?: string }> {
  try {
    // 注意：统一 API 函数目前不支持 signal，但保留参数以保持接口兼容
    const data = await apiRequest(url, { skipCache: false });
    return { data, ok: true };
  } catch (e: any) {
    const errorMsg = e?.message || e?.error || '请求失败';
    return { data: null, ok: false, error: errorMsg };
  }
}

async function apiPostPut<T = unknown>(url: string, method: 'POST' | 'PUT', body: unknown): Promise<{ data: T | null; ok: boolean; error?: string }> {
  try {
    const data = method === 'POST' 
      ? await apiPost(url, body)
      : await apiPatch(url, body);
    return { data, ok: true };
  } catch (e: any) {
    const errorMsg = e?.message || e?.error || '请求失败';
    return { data: null, ok: false, error: errorMsg };
  }
}

async function apiDelete(url: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await apiDeleteUnified(url);
    return { ok: true };
  } catch (e: any) {
    const errorMsg = e?.message || e?.error || '请求失败';
    return { ok: false, error: errorMsg };
  }
}

export function fetchClusterflows(cloudId: string, options?: { signal?: AbortSignal }) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiGet(`${base(cloudId)}/clusterflows`, options);
}

export function fetchClusterflowDetail(cloudId: string, name: string, options?: { signal?: AbortSignal }) {
  if (!cloudId || !name) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId 或 name' });
  return apiGet(`${base(cloudId)}/clusterflows/${encodeURIComponent(name)}`, options);
}

export function createClusterflow(cloudId: string, payload: Record<string, unknown>) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiPostPut(`${base(cloudId)}/clusterflows`, 'POST', payload);
}

export function updateClusterflow(cloudId: string, name: string, payload: Record<string, unknown>) {
  if (!cloudId || !name) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId 或 name' });
  return apiPostPut(`${base(cloudId)}/clusterflows/${encodeURIComponent(name)}`, 'PUT', payload);
}

export function deleteClusterflow(cloudId: string, name: string) {
  if (!cloudId || !name) return Promise.resolve({ ok: false, error: '缺少 cloudId 或 name' });
  return apiDelete(`${base(cloudId)}/clusterflows/${encodeURIComponent(name)}`);
}

export function fetchClusteroutputs(cloudId: string, options?: { signal?: AbortSignal }) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiGet(`${base(cloudId)}/clusteroutputs`, options);
}

export function fetchClusteroutputDetail(cloudId: string, name: string, options?: { signal?: AbortSignal }) {
  if (!cloudId || !name) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId 或 name' });
  return apiGet(`${base(cloudId)}/clusteroutputs/${encodeURIComponent(name)}`, options);
}

export function createClusteroutput(cloudId: string, payload: Record<string, unknown>) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiPostPut(`${base(cloudId)}/clusteroutputs`, 'POST', payload);
}

export function updateClusteroutput(cloudId: string, name: string, payload: Record<string, unknown>) {
  if (!cloudId || !name) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId 或 name' });
  return apiPostPut(`${base(cloudId)}/clusteroutputs/${encodeURIComponent(name)}`, 'PUT', payload);
}

export function deleteClusteroutput(cloudId: string, name: string) {
  if (!cloudId || !name) return Promise.resolve({ ok: false, error: '缺少 cloudId 或 name' });
  return apiDelete(`${base(cloudId)}/clusteroutputs/${encodeURIComponent(name)}`);
}

export function fetchLoggingNodes(cloudId: string, options?: { signal?: AbortSignal }) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiGet(`${base(cloudId)}/nodes`, options);
}

// ---------- 资源组日志外发（Output，namespaced）----------

export function fetchOutputs(
  cloudId: string,
  options?: { signal?: AbortSignal; namespace?: string }
) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  const params = new URLSearchParams();
  if (options?.namespace) params.set('namespace', options.namespace);
  const q = params.toString();
  return apiGet(`${base(cloudId)}/outputs${q ? `?${q}` : ''}`, options);
}

export function fetchOutputDetail(
  cloudId: string,
  namespace: string,
  name: string,
  options?: { signal?: AbortSignal }
) {
  if (!cloudId || !namespace || !name) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId/namespace/name' });
  return apiGet(
    `${base(cloudId)}/outputs/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
    options
  );
}

export function createOutput(cloudId: string, payload: Record<string, unknown>) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiPostPut(`${base(cloudId)}/outputs`, 'POST', payload);
}

export function updateOutput(
  cloudId: string,
  namespace: string,
  name: string,
  payload: Record<string, unknown>
) {
  if (!cloudId || !namespace || !name) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId/namespace/name' });
  return apiPostPut(
    `${base(cloudId)}/outputs/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
    'PUT',
    payload
  );
}

export function deleteOutput(cloudId: string, namespace: string, name: string) {
  if (!cloudId || !namespace || !name) return Promise.resolve({ ok: false, error: '缺少 cloudId/namespace/name' });
  return apiDelete(
    `${base(cloudId)}/outputs/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`
  );
}

// ---------- 资源组日志配置（Flow，namespaced）----------

export function fetchFlows(
  cloudId: string,
  options?: { signal?: AbortSignal; namespace?: string }
) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  const params = new URLSearchParams();
  if (options?.namespace) params.set('namespace', options.namespace);
  const q = params.toString();
  return apiGet(`${base(cloudId)}/flows${q ? `?${q}` : ''}`, options);
}

export function fetchFlowDetail(
  cloudId: string,
  namespace: string,
  name: string,
  options?: { signal?: AbortSignal }
) {
  if (!cloudId || !namespace || !name) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId/namespace/name' });
  return apiGet(
    `${base(cloudId)}/flows/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
    options
  );
}

export function createFlow(cloudId: string, payload: Record<string, unknown>) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiPostPut(`${base(cloudId)}/flows`, 'POST', payload);
}

export function updateFlow(
  cloudId: string,
  namespace: string,
  name: string,
  payload: Record<string, unknown>
) {
  if (!cloudId || !namespace || !name) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId/namespace/name' });
  return apiPostPut(
    `${base(cloudId)}/flows/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
    'PUT',
    payload
  );
}

export function deleteFlow(cloudId: string, namespace: string, name: string) {
  if (!cloudId || !namespace || !name) return Promise.resolve({ ok: false, error: '缺少 cloudId/namespace/name' });
  return apiDelete(
    `${base(cloudId)}/flows/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`
  );
}

// ---------- Harvester VM virt-launcher Pod (for log stream) ----------

/**
 * 获取 VM 对应的 virt-launcher Pod 名称，用于日志流
 */
export async function fetchHarvesterVmPod(
  cloudId: string,
  namespace: string,
  vmName: string,
  options?: { signal?: AbortSignal }
): Promise<{ podName: string }> {
  const params = new URLSearchParams({ namespace, vmName });
  const result = await apiGet<{ podName: string }>(
    `${base(cloudId)}/harvester/vm-pod?${params}`,
    options
  );
  if (!result.ok || !result.data?.podName) {
    throw new Error(result.error || '未找到 virt-launcher Pod');
  }
  return result.data;
}

// ---------- Harvester Events ----------

/**
 * 查询 Harvester/K8s 事件，支持按 namespace、name、kind 过滤
 */
export async function fetchHarvesterEvents(
  cloudId: string,
  namespace: string,
  name?: string,
  kind?: string,
  options?: { signal?: AbortSignal }
): Promise<{ data: any[] }> {
  const params = new URLSearchParams();
  if (namespace) params.set('namespace', namespace);
  if (name) params.set('name', name);
  if (kind) params.set('kind', kind);
  const q = params.toString();
  const result = await apiGet<{ data: any[] }>(
    `${base(cloudId)}/harvester/events${q ? `?${q}` : ''}`,
    options
  );
  if (!result.ok || !result.data) {
    throw new Error(result.error || '查询事件失败');
  }
  return result.data as { data: any[] };
}
