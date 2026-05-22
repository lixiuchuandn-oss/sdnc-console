/**
 * 监控概览 · 储存卡片工具：Ceph 判定、容量降级、默认 RBD 存储类 → 块池 CR 数据保护解析。
 */
import type { CephResourceBundle } from '../../ceph/lib/cephStorage';
import {
  cephBlockPoolToRow,
  cephBlockPoolRowToTableRow,
  cephClusterCapacityBytes,
  formatCephPoolDataProtectionShortZh,
} from '../../ceph/lib/cephStorage';

export type CephRawCapacityBar = {
  total: number;
  used: number;
  avail: number;
  pctOfTotal: number;
};

/** 默认 RBD 存储类 → 关联 CephBlockPool CR 的数据保护（中文短文案） */
export type DefaultScCephPoolProtection = {
  protectionZh: string;
  /** 块池 CR 名称（同 metadata.name） */
  poolSummary: string;
};

/** Steve ceph-resources：存在 CephCluster 或 CephBlockPool 即视为集群具备 Rook Ceph */
export function clusterHasCeph(bundle: CephResourceBundle): boolean {
  return (
    (Array.isArray(bundle.clusters) && bundle.clusters.length > 0) ||
    (Array.isArray(bundle.blockPools) && bundle.blockPools.length > 0)
  );
}

function unwrapSteveStorageClasses(payload: unknown): any[] {
  if (!payload || typeof payload !== 'object') return [];
  const root = payload as Record<string, unknown>;
  const data = root.data as Record<string, unknown> | undefined;
  if (data && Array.isArray(data.items)) return data.items as any[];
  if (Array.isArray(root.items)) return root.items as any[];
  if (Array.isArray(payload)) return payload as any[];
  return [];
}

function isRbdCephProvisioner(sc: any): boolean {
  const p = String(sc?.provisioner ?? sc?.spec?.provisioner ?? '').toLowerCase();
  return (
    p.includes('rbd.csi.ceph.com') ||
    (p.includes('rook-ceph') && p.includes('rbd')) ||
    (p.includes('ceph') && p.includes('rbd') && p.includes('csi'))
  );
}

/** Rook CSI：parameters.pool + clusterID（通常为块池 CR 所在命名空间） */
function rbdStorageClassPoolRef(sc: any): { clusterNs: string; poolName: string } | null {
  const params = sc?.parameters ?? {};
  const poolName = String(params.pool ?? params.blockPool ?? '').trim();
  if (!poolName) return null;
  const clusterNs = String(params.clusterID ?? params.clusterNamespace ?? '').trim();
  if (!clusterNs) return null;
  return { clusterNs, poolName };
}

/**
 * 集群默认 StorageClass 为 RBD(Ceph) 时：用 SC 的 pool/clusterID 定位块池 CR，取副本/纠删展示文案。
 */
export function resolveDefaultStorageClassCephPoolProtection(
  defaultStorageClassName: string | null,
  bundle: CephResourceBundle,
  harvesterStorageClassesPayload: unknown,
): DefaultScCephPoolProtection | null {
  const want = defaultStorageClassName?.trim();
  if (!want) return null;
  const scList = unwrapSteveStorageClasses(harvesterStorageClassesPayload);
  const defSc = scList.find((sc) => String(sc?.metadata?.name ?? sc?.name ?? '').trim() === want);
  if (!defSc || !isRbdCephProvisioner(defSc)) return null;
  const ref = rbdStorageClassPoolRef(defSc);
  if (!ref) return null;
  const pools = bundle.blockPools ?? [];
  for (let i = 0; i < pools.length; i++) {
    const rawPool = pools[i];
    const ns = String(rawPool?.metadata?.namespace ?? '').trim();
    const nm = String(rawPool?.metadata?.name ?? '').trim();
    if (ns !== ref.clusterNs || nm !== ref.poolName) continue;
    const row = cephBlockPoolToRow(rawPool, i);
    const table = cephBlockPoolRowToTableRow(row, rawPool);
    const protectionZh = formatCephPoolDataProtectionShortZh(table.dataProtection) || '—';
    return {
      protectionZh,
      poolSummary: nm,
    };
  }
  return null;
}

/** mgr `df.stats`（优先）；否则汇总各 CephCluster.status.ceph.capacity */
export function resolveCephOverviewRawCapacity(
  landingDf: CephRawCapacityBar | null | undefined,
  bundle: CephResourceBundle,
): CephRawCapacityBar | null {
  if (landingDf && landingDf.total > 0) return landingDf;

  let total = 0;
  let used = 0;
  let avail = 0;
  for (const c of bundle.clusters ?? []) {
    const cap = cephClusterCapacityBytes(c);
    total += cap.total;
    used += cap.used;
    avail += cap.available;
  }
  if (total <= 0 && used <= 0 && avail <= 0) return null;
  const pct = total > 0 ? Math.min(100, Math.max(0, (used / total) * 100)) : 0;
  return { total, used, avail, pctOfTotal: pct };
}
