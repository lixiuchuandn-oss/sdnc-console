/** Steve / 后端封装：根据 CephCluster 列表探测应展示 Ceph 还是 Longhorn 存储总览 */
export type StorageDashboardBackend = 'ceph' | 'longhorn' | 'forbidden';

export function interpretCephClusterProbe(payload: unknown): StorageDashboardBackend {
  if (!payload || typeof payload !== 'object') return 'longhorn';
  const o = payload as { _tower?: { cephHint?: string }; data?: unknown; items?: unknown };
  if (o._tower?.cephHint === 'forbidden') return 'forbidden';
  const raw = Array.isArray(o.data) ? o.data : Array.isArray(o.items) ? o.items : [];
  return raw.length > 0 ? 'ceph' : 'longhorn';
}
