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

export function fetchMetricRange(
  cloudId: string,
  params: { query: string; start: number; end: number; step: number },
  options?: { signal?: AbortSignal }
) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  const q = new URLSearchParams();
  q.set('query', params.query);
  q.set('start', params.start.toString());
  q.set('end', params.end.toString());
  q.set('step', params.step.toString());
  return apiGet<{ data: { result: any[] } }>(`${base(cloudId)}/metrics/range?${q.toString()}`, options);
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

export function fetchPrometheusRules(cloudId: string, options?: { signal?: AbortSignal; alertNames?: string[] }) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiGet<{ rules: PrometheusRuleItem[] }>(`${base(cloudId)}/prometheusrules?datasource=prometheus`, options);
}

export function fetchPrometheusRulesGroups(cloudId: string, options?: { signal?: AbortSignal }) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiGet<{ rulesGroupMap: Record<string, string> }>(`${base(cloudId)}/prometheusrules-groups?datasource=prometheus`, options);
}

export function fetchAlertsRules(
  cloudId: string,
  options?: { signal?: AbortSignal; namespace?: string; page?: number; pageSize?: number }
) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  const query = new URLSearchParams();
  if (options?.namespace) query.set('namespace', options.namespace);
  if (options?.page) query.set('page', String(options.page));
  if (options?.pageSize) query.set('pageSize', String(options.pageSize));
  return apiGet<{ data: any[]; total: number } | any[]>(`${base(cloudId)}/alerts-rules?${query.toString()}`, options);
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
  return apiGet(`${base(cloudId)}/prometheus-rules/vm-custom-rules`, options);
}

export function fetchPrometheusRuleDetail(
  cloudId: string,
  namespace: string,
  name: string,
  options?: { signal?: AbortSignal }
) {
  if (!cloudId || !namespace || !name) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId/namespace/name' });
  return apiGet(`${base(cloudId)}/prometheus-rules/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, options);
}

export function createPrometheusRule(cloudId: string, body: unknown) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiPostPut(`${base(cloudId)}/prometheus-rules`, 'POST', body);
}

export function updatePrometheusRule(cloudId: string, namespace: string, name: string, body: unknown) {
  if (!cloudId || !namespace || !name) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId/namespace/name' });
  return apiPostPut(
    `${base(cloudId)}/prometheus-rules/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
    'PUT',
    body
  );
}

export function deletePrometheusRule(cloudId: string, namespace: string, name: string) {
  if (!cloudId || !namespace || !name) return Promise.resolve({ ok: false, error: '缺少 cloudId/namespace/name' });
  return apiDelete(`${base(cloudId)}/prometheus-rules/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
}

// --- 告警通知策略（Secret + AlertmanagerConfig receiver/route） ---

export function fetchAlertNotifications(cloudId: string, options?: { signal?: AbortSignal }) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiGet(`${base(cloudId)}/notifications`, options);
}

export function saveAlertNotifications(cloudId: string, body: unknown) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiPostPut(`${base(cloudId)}/notifications`, 'POST', body);
}

// --- 日志 API ---

export function fetchClusterFlows(cloudId: string, options?: { signal?: AbortSignal }) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiGet(`${base(cloudId)}/logging/clusterflows`, options);
}

// --- 告警通知对象 & Secret ---

export interface OpaqueSecretItem {
  name: string;
  data: Record<string, string>;
}

export function fetchSecrets(cloudId: string, options?: { namespace?: string; signal?: AbortSignal }) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  const q = new URLSearchParams();
  if (options?.namespace) q.set('namespace', options.namespace);
  return apiGet<OpaqueSecretItem[]>(`${base(cloudId)}/secrets?${q.toString()}`, options);
}

export interface NotificationTargetReceiver {
  namespace: string;
  receiverName: string;
  specReceivers: any[]; // 对应 AlertmanagerConfig spec.receivers
}

export function fetchNotificationTargetsList(
  cloudId: string,
  params?: { namespaces?: string[]; receiverName?: string[] },
  options?: { signal?: AbortSignal }
) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  const q = new URLSearchParams();
  if (params?.namespaces) {
    params.namespaces.forEach((n) => q.append('namespaces', n));
  }
  if (params?.receiverName) {
    params.receiverName.forEach((n) => q.append('receiverName', n));
  }
  return apiGet<{ receivers: NotificationTargetReceiver[] }>(`${base(cloudId)}/alertmanagerconfigs/receivers?${q.toString()}`, options);
}

export function deleteAlertmanagerconfigReceiver(
  cloudId: string,
  namespace: string,
  name: string,
  specReceiverName: string
) {
  if (!cloudId || !namespace || !name || !specReceiverName) return Promise.resolve({ ok: false, error: '缺少必要参数' });
  const q = new URLSearchParams({ specReceiverName });
  return apiDelete(`${base(cloudId)}/alertmanagerconfigs/receivers/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}?${q.toString()}`);
}

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

export function fetchFlows(cloudId: string, options?: { signal?: AbortSignal }) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiGet(`${base(cloudId)}/logging/flows`, options);
}

export function fetchClusterOutputs(cloudId: string, options?: { signal?: AbortSignal }) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiGet(`${base(cloudId)}/logging/clusteroutputs`, options);
}

export function fetchOutputs(cloudId: string, options?: { signal?: AbortSignal }) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiGet(`${base(cloudId)}/logging/outputs`, options);
}

export function createClusterFlow(cloudId: string, body: unknown) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiPostPut(`${base(cloudId)}/logging/clusterflows`, 'POST', body);
}

export function updateClusterFlow(cloudId: string, name: string, body: unknown) {
  if (!cloudId || !name) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId/name' });
  return apiPostPut(`${base(cloudId)}/logging/clusterflows/${encodeURIComponent(name)}`, 'PUT', body);
}

export function deleteClusterFlow(cloudId: string, name: string) {
  if (!cloudId || !name) return Promise.resolve({ ok: false, error: '缺少 cloudId/name' });
  return apiDelete(`${base(cloudId)}/logging/clusterflows/${encodeURIComponent(name)}`);
}

export function createFlow(cloudId: string, body: unknown) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiPostPut(`${base(cloudId)}/logging/flows`, 'POST', body);
}

export function updateFlow(cloudId: string, namespace: string, name: string, body: unknown) {
  if (!cloudId || !namespace || !name) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId/namespace/name' });
  return apiPostPut(`${base(cloudId)}/logging/flows/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, 'PUT', body);
}

export function deleteFlow(cloudId: string, namespace: string, name: string) {
  if (!cloudId || !namespace || !name) return Promise.resolve({ ok: false, error: '缺少 cloudId/namespace/name' });
  return apiDelete(`${base(cloudId)}/logging/flows/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
}

export function createClusterOutput(cloudId: string, body: unknown) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiPostPut(`${base(cloudId)}/logging/clusteroutputs`, 'POST', body);
}

export function updateClusterOutput(cloudId: string, name: string, body: unknown) {
  if (!cloudId || !name) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId/name' });
  return apiPostPut(`${base(cloudId)}/logging/clusteroutputs/${encodeURIComponent(name)}`, 'PUT', body);
}

export function deleteClusterOutput(cloudId: string, name: string) {
  if (!cloudId || !name) return Promise.resolve({ ok: false, error: '缺少 cloudId/name' });
  return apiDelete(`${base(cloudId)}/logging/clusteroutputs/${encodeURIComponent(name)}`);
}

export function createOutput(cloudId: string, body: unknown) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiPostPut(`${base(cloudId)}/logging/outputs`, 'POST', body);
}

export function updateOutput(cloudId: string, namespace: string, name: string, body: unknown) {
  if (!cloudId || !namespace || !name) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId/namespace/name' });
  return apiPostPut(`${base(cloudId)}/logging/outputs/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, 'PUT', body);
}

export function deleteOutput(cloudId: string, namespace: string, name: string) {
  if (!cloudId || !namespace || !name) return Promise.resolve({ ok: false, error: '缺少 cloudId/namespace/name' });
  return apiDelete(`${base(cloudId)}/logging/outputs/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
}
