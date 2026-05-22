import type { ResourcePoolAssignment } from '../../../types/tenant';
import { isTenantScenarioNamespace } from '../../../utils/harvesterUtils';

/** 分配计算资源「使用集群已有命名空间」：须 tower.io/scenario=tenant，且未被其它组织占用 */
export function isAssignableExistingNamespaceRecord(ns: any, occupiedLc: Set<string>): boolean {
  if (!isTenantScenarioNamespace(ns)) return false;
  const n = String(ns?.metadata?.name || ns?.name || '').trim();
  if (!n) return false;
  return !occupiedLc.has(n.toLowerCase());
}

export function getCloudPoolProviderRaw(pool: {
  config?: { provider?: string };
  type?: string;
} | null | undefined): string {
  return String(pool?.config?.provider ?? pool?.type ?? '').trim().toLowerCase();
}

/** 界面展示用（保留大小写，与配置一致） */
export function getCloudPoolDisplayProvider(pool: {
  config?: { provider?: string };
  type?: string;
} | null | undefined): string {
  if (!pool) return '';
  return String(pool.config?.provider || pool.type || '-');
}

const HARVESTER_LIKE_OPERATORS = new Set([
  'harvester',
  'cloudmap',
  'cloudmap.private',
  'cloudmap.edge',
]);

export function isHarvesterLikeOperator(pvRaw: string): boolean {
  return HARVESTER_LIKE_OPERATORS.has(pvRaw);
}

/** 分配抽屉内「计算 / 存储 / 安全」Tab 与可选资源池列表一致 */
export function poolMatchesAssignDrawerTab(
  pool: { config?: { provider?: string }; type?: string },
  tab: 'compute' | 'storage' | 'security',
): boolean {
  const pvRaw = getCloudPoolProviderRaw(pool);
  const typeLower = String(pool?.type ?? '').toLowerCase();
  const isSecurity = pvRaw === 'cloudmap.csm';
  const isStorage = typeLower === 'object_storage' || typeLower === 'file_storage';
  if (tab === 'security') return isSecurity;
  if (tab === 'storage') return isStorage;
  return !isSecurity && !isStorage;
}

type AssignableCloudShape = { config?: { provider?: string }; type?: string };

/** 分配记录上的 cloud 与「可分配资源池」同类判定 */
export function assignmentMatchesAssignTab(
  a: ResourcePoolAssignment,
  tab: 'compute' | 'storage' | 'security',
): boolean {
  return poolMatchesAssignDrawerTab((a.cloud as AssignableCloudShape) ?? {}, tab);
}

export function assignmentMatchesKeyword(a: ResourcePoolAssignment, keyword: string): boolean {
  const k = keyword.trim().toLowerCase();
  if (!k) return true;
  const c = a.cloud as { name?: string; type?: string; config?: { provider?: string } } | undefined;
  const name = String(c?.name ?? '').toLowerCase();
  const type = String(c?.type ?? '').toLowerCase();
  const provider = String(c?.config?.provider ?? '').toLowerCase();
  return name.includes(k) || type.includes(k) || provider.includes(k);
}
