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

function getNodeList(nodesResponse: any): any[] {
  if (!nodesResponse) return [];
  if (Array.isArray(nodesResponse)) return nodesResponse;
  if (Array.isArray(nodesResponse.data)) return nodesResponse.data;
  if (nodesResponse.data?.items && Array.isArray(nodesResponse.data.items)) return nodesResponse.data.items;
  if (nodesResponse.items && Array.isArray(nodesResponse.items)) return nodesResponse.items;
  return [];
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
    { name: '隔离中', count: 0, color: '#1890FF', pct: 0, key: 'cordoned' },
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
