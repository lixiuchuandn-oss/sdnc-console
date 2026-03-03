/**
 * 集群日志 API：ClusterFlow、ClusterOutput、节点列表；资源组日志外发：Output
 * 按 cloudId 请求 /api/clouds/:id/logging/*
 * 设计文档：plan/设计-监控服务-集群日志配置.md、设计-监控服务-资源组日志外发.md
 */
import { API_BASE_URL, getAuthHeaders } from './api';

const base = (cloudId: string) => `${API_BASE_URL}/api/clouds/${encodeURIComponent(cloudId)}/logging`;

async function apiGet<T = unknown>(url: string, options?: { signal?: AbortSignal }): Promise<{ data: T | null; ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: getAuthHeaders(),
      credentials: 'include',
      signal: options?.signal,
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
