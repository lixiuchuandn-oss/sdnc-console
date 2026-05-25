/** 节点列表 Section 纯函数：角色/就绪、资源单位解析、View Link */

import type { NodeRow } from 'services/harvester/types/inventoryRows';

export type { NodeRow };

/** Steve `links.view` 或 `/api/v1/nodes/{name}` */
export function nodeRowToViewLink(row: unknown): string | undefined {
  const r = row as NodeRow & { metadata?: NodeRow['metadata'] };
  if (r?.links?.view) return String(r.links.view).trim();
  const n = r?.metadata?.name || r?.name;
  if (n) return `/api/v1/nodes/${encodeURIComponent(String(n).trim())}`;
  return undefined;
}

/**
 * 从节点对象中解析所有角色信息
 * - 兼容 labels["kubernetes.io/role"] 以及 node-role.kubernetes.io/* 多种写法
 */
export function getRoles(r: unknown): string[] {
  const row = r as NodeRow & { roles?: unknown };
  const base: string[] = (Array.isArray(row?.roles) ? row.roles : []).map((s: string) => {
    if (s.startsWith('node-role.kubernetes.io/')) return s.split('/').pop() || s;
    return s;
  });
  const labels: Record<string, string> = row?.metadata?.labels || {};
  const legacy = String(labels?.['kubernetes.io/role'] || '').trim();
  const extra = Object.keys(labels || {})
    .filter(k => k.startsWith('node-role.kubernetes.io/'))
    .map(k => k.split('/').pop() || k);
  const all = [...base, ...(legacy ? [legacy] : []), ...extra]
    .map(s => String(s || '').trim())
    .filter(Boolean);
  return Array.from(new Set(all));
}

/**
 * 判断节点是否 Ready
 * - 优先使用 r.ready 布尔字段
 * - 否则回退到 status.conditions 中查找 Ready=True 条目
 */
export function isReady(r: unknown): boolean {
  const row = r as NodeRow;
  if (typeof row?.ready === 'boolean') return row.ready;
  const conds: Array<{ type?: string; status?: string }> = Array.isArray(row?.status?.conditions)
    ? row.status!.conditions!
    : [];
  return conds.some(
    c => String(c?.type || '') === 'Ready' && String(c?.status || '').toLowerCase() === 'true',
  );
}

/** 解析 CPU 字符串为核数（支持 m / n / u 等） */
export function parseCpuToCores(s?: string): number {
  if (!s) return 0;
  const t = String(s).trim();
  if (/m$/i.test(t)) {
    const v = Number(t.replace(/m$/i, ''));
    return isFinite(v) ? v / 1000 : 0;
  }
  if (/n$/i.test(t)) {
    const v = Number(t.replace(/n$/i, ''));
    return isFinite(v) ? v / 1e9 : 0;
  }
  if (/u$/i.test(t)) {
    const v = Number(t.replace(/u$/i, ''));
    return isFinite(v) ? v / 1e6 : 0;
  }
  const v = Number(t);
  return isFinite(v) ? v : 0;
}

/** 解析内存字符串为字节数（Ki/Mi/Gi/Ti 与 K/M/G/T） */
export function parseMemoryToBytes(s?: string): number {
  if (!s) return 0;
  const t = String(s).trim();
  const m = t.match(/^(\d+(?:\.\d+)?)([KMGTP]i?)?$/i);
  if (!m) return 0;
  const val = Number(m[1]);
  const unit = (m[2] || '').toLowerCase();
  let bytes = val;
  if (unit === 'ki') bytes = val * 1024;
  else if (unit === 'mi') bytes = val * 1024 * 1024;
  else if (unit === 'gi') bytes = val * 1024 * 1024 * 1024;
  else if (unit === 'ti') bytes = val * 1024 * 1024 * 1024 * 1024;
  else if (unit === 'k') bytes = val * 1000;
  else if (unit === 'm') bytes = val * 1e6;
  else if (unit === 'g') bytes = val * 1e9;
  else if (unit === 't') bytes = val * 1e12;
  return bytes;
}

export type NodeDetailAlloc = {
  allocatableCpu?: string;
  allocatableMemory?: string;
  capacityCpu?: string;
  capacityMemory?: string;
};

export type NodeMetricUsage = {
  cpuUsedCores?: number;
  memUsedBytes?: number;
};

export type NodeRequests = {
  cpuRequestCores?: number;
  memRequestBytes?: number;
};

export function nodeRowKey(row: NodeRow, index: number): string {
  const r = row as NodeRow & { metadata?: { uid?: string; name?: string } };
  return (
    String(r?.metadata?.uid || r?.metadata?.name || r?.name || '') ||
    `row-${Number.isFinite(index) ? index : 0}`
  );
}

export function nodeInternalIp(row: NodeRow): string {
  return (
    row?.internalIP ||
    row?.status?.addresses?.find((a) => String(a?.type) === 'InternalIP')?.address ||
    '-'
  );
}

export type NodesTableFilters = {
  keyword: string;
  roleFilter: string;
  readyFilter: string;
};

export function filterNodesForTable(nodes: readonly NodeRow[], f: NodesTableFilters): NodeRow[] {
  const kw = f.keyword.trim().toLowerCase();
  const role = f.roleFilter.trim().toLowerCase();
  const rf = f.readyFilter.trim().toLowerCase();
  return (nodes || []).filter((r) => {
    const name = String(r?.name || r?.metadata?.name || '').toLowerCase();
    if (kw && !name.includes(kw)) return false;
    if (role) {
      const rolesLower = getRoles(r).map((s) => s.toLowerCase());
      if (!rolesLower.includes(role)) return false;
    }
    if (rf) {
      const ok = isReady(r);
      if (rf === 'ready' && !ok) return false;
      if (rf === 'notready' && ok) return false;
    }
    return true;
  });
}

export function buildNodeRoleFilterOptions(nodes: readonly NodeRow[]): Array<{ label: string; value: string }> {
  const set = new Set<string>();
  for (const n of nodes || []) {
    for (const r of getRoles(n)) set.add(r);
  }
  return Array.from(set).map((x) => ({ label: x, value: x }));
}
