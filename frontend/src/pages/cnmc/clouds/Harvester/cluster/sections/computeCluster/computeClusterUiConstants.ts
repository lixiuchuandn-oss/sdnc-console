/** 计算配置页 · Tab 与 URL `operateTab` */

export type ComputeClusterOperateTabKey =
  | 'nodes'
  | 'failure_domains'
  | 'drs_rules'
  | 'migrations';

const OPERATE_TAB_KEYS = new Set<string>(['nodes', 'failure_domains', 'drs_rules', 'migrations']);

export function parseComputeClusterOperateTabKey(
  raw: string | null | undefined,
): ComputeClusterOperateTabKey | null {
  const k = String(raw || '').trim();
  if (!k || !OPERATE_TAB_KEYS.has(k)) return null;
  return k as ComputeClusterOperateTabKey;
}

/** 历史独立 pathSeg → operateTab */
export const LEGACY_COMPUTE_CLUSTER_OPERATE_TAB: Readonly<
  Record<string, ComputeClusterOperateTabKey>
> = {
  compute_nodes: 'nodes',
  cluster_nodes: 'nodes',
  compute_failure_domains: 'failure_domains',
  failure_domains: 'failure_domains',
  ha_failure_domains: 'failure_domains',
  compute_drs_rules: 'drs_rules',
  drs: 'drs_rules',
  compute_migrations: 'migrations',
};

export function legacyComputeClusterOperateTab(innerSeg: string): ComputeClusterOperateTabKey | null {
  return LEGACY_COMPUTE_CLUSTER_OPERATE_TAB[innerSeg] ?? null;
}
