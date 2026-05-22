/**
 * Harvester cluster · ClusterNetwork 列表纯逻辑（就绪判断、过滤）。
 */

export type ClusterNetworkRow = {
  metadata?: {
    name?: string;
    uid?: string;
    creationTimestamp?: string;
    annotations?: Record<string, string>;
  };
  status?: { conditions?: Array<{ type?: string; status?: string }> };
  vlanConfigs?: unknown[];
  links?: { view?: string };
  kind?: string;
};

function isConditionReadyTrue(c: { type?: string; status?: string }): boolean {
  return (
    String(c?.type || '').toLowerCase() === 'ready' && String(c?.status || '').toLowerCase() === 'true'
  );
}

export function isClusterNetworkReady(record: ClusterNetworkRow): boolean {
  const conditions = record?.status?.conditions;
  return Array.isArray(conditions) && conditions.some(isConditionReadyTrue);
}

export type ClusterNetworksFilterState = {
  keyword: string;
  statusFilter: string;
};

export function filterClusterNetworksForTable(
  rows: readonly ClusterNetworkRow[],
  f: ClusterNetworksFilterState,
): ClusterNetworkRow[] {
  const kw = f.keyword.trim().toLowerCase();
  return (rows || []).filter((r) => {
    const name = String(r?.metadata?.name || '').toLowerCase();
    if (kw && !name.includes(kw)) return false;

    if (f.statusFilter) {
      const ready = isClusterNetworkReady(r);
      if (f.statusFilter === 'active' && !ready) return false;
      if (f.statusFilter === 'unknown' && ready) return false;
    }

    return true;
  });
}
