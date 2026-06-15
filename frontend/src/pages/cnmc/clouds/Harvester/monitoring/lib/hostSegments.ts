/**
 * 物理主机卡片：从 nodes 列表解析 活跃/维护中/隔离中/其他
 * 与参考项目 Compute.Tower-Monitoring 一致。
 */
const MAINTENANCE_STATUS = 'harvesterhci.io/maintain-status';
const NODE_SCHEDULABLE = 'kubevirt.io/schedulable';
const NODE_ROLE_ETCD = 'node-role.harvesterhci.io/witness';

export type HostSegmentKey = 'active' | 'maintenance' | 'cordoned' | 'other';

export interface HostSegment {
  name: string;
  count: number;
  color: string;
  pct: number;
  key: HostSegmentKey;
}

export interface HostSegmentsSummary {
  total: number;
  segments: HostSegment[];
}

export interface HostStatusTagItem {
  nodeName: string;
  statusName: string;
  color: string;
  key: HostSegmentKey;
}

function getNodeList(nodesResponse: any): any[] {
  if (!nodesResponse) return [];
  if (Array.isArray(nodesResponse)) return nodesResponse;
  if (Array.isArray(nodesResponse.data)) return nodesResponse.data;
  if (nodesResponse.data?.items && Array.isArray(nodesResponse.data.items)) return nodesResponse.data.items;
  if (nodesResponse.items && Array.isArray(nodesResponse.items)) return nodesResponse.items;
  return [];
}

/** 物理主机（cluster_nodes / harvester nodes）总台数 */
export function countPhysicalHosts(nodesResponse: unknown): number {
  return getNodeList(nodesResponse).length;
}

function isMaintenance(node: any): boolean {
  return node?.metadata?.annotations?.[MAINTENANCE_STATUS] === 'completed';
}

function isEnteringMaintenance(node: any): boolean {
  return node?.metadata?.annotations?.[MAINTENANCE_STATUS] === 'running';
}

function isEtcd(node: any): boolean {
  return node?.metadata?.labels?.[NODE_ROLE_ETCD] !== undefined;
}

function isCordoned(node: any): boolean {
  if (isEtcd(node)) return false;
  return node?.spec?.unschedulable === true || node?.metadata?.labels?.[NODE_SCHEDULABLE] === 'false';
}

function isReady(node: any): boolean {
  const conditions = node?.status?.conditions;
  if (!Array.isArray(conditions)) return false;
  const ready = conditions.find((c: any) => c.type === 'Ready');
  return ready?.status === 'True';
}

export function parseNodesToHostSegments(nodesResponse: any): HostSegmentsSummary {
  const list = getNodeList(nodesResponse);
  const segments: HostSegment[] = [
    { name: '活跃', count: 0, color: '#22C55E', pct: 0, key: 'active' },
    { name: '维护中', count: 0, color: '#FAAD14', pct: 0, key: 'maintenance' },
    { name: '隔离中', count: 0, color: '#ff7875', pct: 0, key: 'cordoned' },
    { name: '其他', count: 0, color: '#d9d9d9', pct: 0, key: 'other' },
  ];

  for (const node of list) {
    if (isMaintenance(node)) segments[1].count++;
    else if (isCordoned(node)) segments[2].count++;
    else if (isEnteringMaintenance(node) || !isReady(node)) segments[3].count++;
    else segments[0].count++;
  }

  const total = list.length;
  segments.forEach((s) => {
    s.pct = total > 0 ? s.count / total : 0;
  });
  return { total, segments };
}

/** 所有节点 Tag：按状态着色展示（活跃/维护中/隔离中/其他） */
export function parseNodeStatusTags(nodesResponse: any): HostStatusTagItem[] {
  const list = getNodeList(nodesResponse);
  const tags: HostStatusTagItem[] = [];

  for (const node of list) {
    const nodeName = String(node?.metadata?.name ?? '未知节点');
    if (isMaintenance(node)) {
      tags.push({ nodeName, statusName: '维护中', color: '#FAAD14', key: 'maintenance' });
    } else if (isCordoned(node)) {
      tags.push({ nodeName, statusName: '隔离中', color: '#ff7875', key: 'cordoned' });
    } else if (isEnteringMaintenance(node) || !isReady(node)) {
      tags.push({ nodeName, statusName: '其他', color: '#d9d9d9', key: 'other' });
    } else {
      tags.push({ nodeName, statusName: '活跃', color: '#22C55E', key: 'active' });
    }
  }

  const order: Record<HostSegmentKey, number> = {
    active: 0,
    maintenance: 1,
    cordoned: 2,
    other: 3,
  };
  tags.sort((a, b) => order[a.key] - order[b.key] || a.nodeName.localeCompare(b.nodeName));
  return tags;
}

/** 物理主机与 node-exporter `instance` 标签匹配用（节点名、InternalIP 等） */
export function collectPhysicalHostPromMatchKeys(nodesResponse: unknown): Set<string> {
  const keys = new Set<string>();
  for (const node of getNodeList(nodesResponse)) {
    const name = String(node?.metadata?.name ?? '').trim().toLowerCase();
    if (name) keys.add(name);
    for (const addr of node?.status?.addresses ?? []) {
      const v = String(addr?.address ?? '').trim().toLowerCase();
      if (v) keys.add(v);
    }
  }
  return keys;
}

export function formatPrometheusInstanceLabel(instance: string): string {
  const trimmed = instance.trim();
  if (!trimmed) return '-';
  const colon = trimmed.lastIndexOf(':');
  if (colon > 0 && /^\d+$/.test(trimmed.slice(colon + 1))) {
    return trimmed.slice(0, colon);
  }
  return trimmed;
}

export function isPhysicalHostPrometheusInstance(instance: string, keys: Set<string>): boolean {
  if (keys.size === 0) return true;
  const inst = instance.trim().toLowerCase();
  if (!inst) return false;
  const host = inst.split(':')[0];
  if (keys.has(inst) || keys.has(host)) return true;
  for (const key of keys) {
    if (host === key || inst.startsWith(`${key}:`)) return true;
  }
  return false;
}
