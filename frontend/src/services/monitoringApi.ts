/**
 * 监控 API：概览 + 监控告警，按 cloudId 请求 /api/clouds/:id/monitoring/*
 * 设计文档：plan/设计-监控服务-概览.md、设计-监控服务-监控告警.md
 */
import { API_BASE_URL, getAuthHeaders } from './api';

const base = (cloudId: string) => `${API_BASE_URL}/api/clouds/${encodeURIComponent(cloudId)}/monitoring`;

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

export function fetchStorageNodes(cloudId: string, options?: { signal?: AbortSignal }) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiGet(`${base(cloudId)}/storage-nodes`, options);
}

export function fetchNodeResources(cloudId: string, options?: { signal?: AbortSignal }) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiGet(`${base(cloudId)}/node-resources`, options);
}

export function fetchNodeMetrics(cloudId: string, options?: { signal?: AbortSignal }) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiGet(`${base(cloudId)}/node-metrics`, options);
}

export function fetchAlertsRules(
  cloudId: string,
  options?: { signal?: AbortSignal; namespace?: string; page?: number; pageSize?: number }
) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  const params = new URLSearchParams();
  if (options?.namespace) params.set('namespace', options.namespace);
  if (options?.page != null) params.set('page', String(options.page));
  if (options?.pageSize != null) params.set('pageSize', String(options.pageSize));
  const q = params.toString();
  return apiGet(`${base(cloudId)}/alerts-rules${q ? `?${q}` : ''}`, options);
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

export function createAlertmanagerconfig(cloudId: string, body: unknown) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiPostPut(`${base(cloudId)}/alertmanagerconfigs`, 'POST', body);
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

export function fetchPrometheusRuleVmCustomRules(cloudId: string, options?: { signal?: AbortSignal }) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiGet(`${base(cloudId)}/prometheusrules/vm-custom-rules`, options);
}

export interface PrometheusRuleItem {
  id?: string;
  name?: string;
  group?: string;
  severity?: string;
  state?: string;
  message?: string;
  duration?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  activeAt?: string;
  value?: string;
  // New fields from backend normalization
  datasource?: string;
  groupName?: string;
  groupAliasName?: string;
  aliasName?: string;
  expression?: string;
  interval?: string;
  namespace?: string;
}

export function fetchPrometheusRules(cloudId: string, options?: { signal?: AbortSignal }) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiGet<{ rules: PrometheusRuleItem[] }>(`${base(cloudId)}/prometheusrules?datasource=prometheus`, options);
}

export function fetchPrometheusRulesGroups(cloudId: string, options?: { signal?: AbortSignal }) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiGet<{ rulesGroupMap: Record<string, string> }>(`${base(cloudId)}/prometheusrules-groups?datasource=prometheus`, options);
}
