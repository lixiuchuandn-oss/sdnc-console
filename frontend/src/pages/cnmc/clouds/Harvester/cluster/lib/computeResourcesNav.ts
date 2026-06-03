/** Cloudmap 集群 · 计算资源：URL pathSeg、侧栏子页与 loadKey 映射 */

export const COMPUTE_RESOURCE_INNER_SEGS = [
  'compute_nodes',
  'compute_failure_domains',
  'compute_projects',
  'compute_drs_rules',
  'compute_migrations',
  'compute_gpu',
] as const;

export type ComputeResourceInnerSeg = (typeof COMPUTE_RESOURCE_INNER_SEGS)[number];

export const COMPUTE_RESOURCE_TAB_META: Readonly<
  Record<ComputeResourceInnerSeg, { label: string; loadKey: string }>
> = {
  compute_nodes: { label: '计算节点', loadKey: 'cluster_nodes' },
  compute_failure_domains: { label: '故障域', loadKey: 'failure_domains' },
  compute_projects: { label: '项目管理', loadKey: 'namespaces' },
  compute_drs_rules: { label: 'DRS 规则', loadKey: 'drs' },
  compute_migrations: { label: '迁移记录', loadKey: 'drs' },
  compute_gpu: { label: 'GPU 管理', loadKey: 'gpu' },
};

export const LEGACY_COMPUTE_INNER_SEG_MAP: Readonly<Record<string, ComputeResourceInnerSeg>> = {
  cluster_nodes: 'compute_nodes',
  failure_domains: 'compute_failure_domains',
  ha_failure_domains: 'compute_failure_domains',
  namespaces: 'compute_projects',
  drs: 'compute_drs_rules',
  gpu: 'compute_gpu',
};

export function isComputeResourceInnerSeg(seg: string): seg is ComputeResourceInnerSeg {
  return (COMPUTE_RESOURCE_INNER_SEGS as readonly string[]).includes(seg);
}

export function remapLegacyComputeInnerSeg(seg: string): string {
  if (isComputeResourceInnerSeg(seg)) return seg;
  return LEGACY_COMPUTE_INNER_SEG_MAP[seg] || seg;
}

/** 已摘除 cluster 壳层 / 跨分组历史书签（在 compute remap 之后） */
const LEGACY_CLUSTER_SHELL_SEG_MAP: Readonly<Record<string, string>> = {
  ha_storage_drs: 'storage_drs',
};

/** Cloudmap cluster pathSeg 规范化（侧栏、书签重定向） */
export function remapLegacyClusterInnerSeg(seg: string): string {
  const mapped = remapLegacyComputeInnerSeg(seg);
  return LEGACY_CLUSTER_SHELL_SEG_MAP[mapped] || mapped;
}

export function computeResourceLoadKey(innerSeg: string): string | null {
  if (!isComputeResourceInnerSeg(innerSeg)) return null;
  return COMPUTE_RESOURCE_TAB_META[innerSeg].loadKey;
}

export function computeResourcePoolPath(cloudId: string, innerSeg: ComputeResourceInnerSeg): string {
  const base = `/admin/clouds/${encodeURIComponent(cloudId)}`;
  return `${base}/cluster/${encodeURIComponent(innerSeg)}`;
}

export function parseComputeResourcePath(
  pathname: string,
  cloudId: string,
): ComputeResourceInnerSeg | null {
  const base = `/admin/clouds/${encodeURIComponent(cloudId)}/cluster/`;
  const rawBase = `/admin/clouds/${cloudId}/cluster/`;
  let rest: string | null = null;
  if (pathname.startsWith(base)) rest = pathname.slice(base.length);
  else if (pathname.startsWith(rawBase)) rest = pathname.slice(rawBase.length);
  if (!rest) return null;
  const seg = rest.split('/').filter(Boolean)[0] || '';
  const mapped = remapLegacyComputeInnerSeg(seg);
  return isComputeResourceInnerSeg(mapped) ? mapped : null;
}
