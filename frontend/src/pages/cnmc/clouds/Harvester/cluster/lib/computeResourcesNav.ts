/** Cloudmap 集群 · 计算资源：URL pathSeg、侧栏子页与 loadKey 映射 */

import { remapLegacyNetworkInnerSeg } from './networkResourcesNav';

export const COMPUTE_RESOURCE_INNER_SEGS = ['compute_projects', 'compute_gpu'] as const;



export type ComputeResourceInnerSeg = (typeof COMPUTE_RESOURCE_INNER_SEGS)[number];



/** 计算配置（节点 / 故障域 / 部署集 / DRS / 迁移）统一入口 */

export const COMPUTE_CLUSTER_INNER_SEG = 'compute_cluster' as const;



export const COMPUTE_RESOURCE_TAB_META: Readonly<

  Record<ComputeResourceInnerSeg, { label: string; loadKey: string }>

> = {

  compute_projects: { label: '项目管理', loadKey: 'namespaces' },

  compute_gpu: { label: 'GPU 管理', loadKey: 'gpu' },

};



/** 已并入 `compute_cluster` 的历史 pathSeg */

export const LEGACY_COMPUTE_CLUSTER_SEG_MAP: Readonly<Record<string, typeof COMPUTE_CLUSTER_INNER_SEG>> =

  {

    compute_nodes: COMPUTE_CLUSTER_INNER_SEG,

    cluster_nodes: COMPUTE_CLUSTER_INNER_SEG,

    compute_failure_domains: COMPUTE_CLUSTER_INNER_SEG,

    compute_deployment_sets: COMPUTE_CLUSTER_INNER_SEG,

    deployment_sets: COMPUTE_CLUSTER_INNER_SEG,

    failure_domains: COMPUTE_CLUSTER_INNER_SEG,

    ha_failure_domains: COMPUTE_CLUSTER_INNER_SEG,

    compute_drs_rules: COMPUTE_CLUSTER_INNER_SEG,

    drs: COMPUTE_CLUSTER_INNER_SEG,

    compute_migrations: COMPUTE_CLUSTER_INNER_SEG,

  };



export const LEGACY_COMPUTE_INNER_SEG_MAP: Readonly<Record<string, ComputeResourceInnerSeg>> = {

  namespaces: 'compute_projects',

  gpu: 'compute_gpu',

};



export function isComputeResourceInnerSeg(seg: string): seg is ComputeResourceInnerSeg {

  return (COMPUTE_RESOURCE_INNER_SEGS as readonly string[]).includes(seg);

}



export function isComputeClusterInnerSeg(seg: string): boolean {

  return seg === COMPUTE_CLUSTER_INNER_SEG;

}



export function remapLegacyComputeInnerSeg(seg: string): string {

  if (isComputeResourceInnerSeg(seg) || isComputeClusterInnerSeg(seg)) return seg;

  const clusterMapped = LEGACY_COMPUTE_CLUSTER_SEG_MAP[seg];

  if (clusterMapped) return clusterMapped;

  return LEGACY_COMPUTE_INNER_SEG_MAP[seg] || seg;

}



/** 已摘除 cluster 壳层 / 跨分组历史书签（在 compute remap 之后） */

const LEGACY_CLUSTER_SHELL_SEG_MAP: Readonly<Record<string, string>> = {

  ha_storage_drs: 'harvester_addon',

  storage_drs: 'harvester_addon',

  storage_pools: 'harvester_addon',

};



/** Cloudmap cluster pathSeg 规范化（侧栏、书签重定向） */

export function remapLegacyClusterInnerSeg(seg: string): string {

  const mapped = remapLegacyComputeInnerSeg(seg);

  const networkMapped = remapLegacyNetworkInnerSeg(mapped);

  return LEGACY_CLUSTER_SHELL_SEG_MAP[networkMapped] || networkMapped;

}



export function computeResourceLoadKey(innerSeg: string): string | null {

  if (isComputeClusterInnerSeg(innerSeg)) return 'compute_nodes';

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


