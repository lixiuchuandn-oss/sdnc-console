/**
 * 监控概览 · 储存空间卡片视图模型（Ceph / Longhorn 分支计算）
 */
import { buildCephLandingModel } from '../../ceph/lib/cephDashboardLanding';
import { normalizeCephBundle } from '../../ceph/lib/cephStorage';
import { formatBytesWithUnit, type LonghornStorageSummary, parseLonghornStorage } from './longhornStorage';
import {
  clusterHasCeph,
  resolveCephOverviewRawCapacity,
  resolveDefaultStorageClassCephPoolProtection,
} from './storageCardCeph';

export type FormattedBytes = { value: number; unit: string } | null;

/** buildStorageCardViewModel 实际读取的快车道字段（测试 mock 不必补全 nodeMetrics 等） */
export type StorageCardViewModelInput = {
  storageNodes?: unknown;
  nodeResources?: { data?: unknown[] } | null;
  cephResourcesRaw?: unknown | null;
  cephHealthMinimal?: unknown | null;
  storageClassesJson?: unknown | null;
};

export type StorageCardViewModel = {
  isCeph: boolean;
  footerIsCephProtectionLayout: boolean;
  usedPercent: number;
  totalFormatted: { value: number; unit: string };
  usedFormatted: { value: number; unit: string };
  remainingFormatted: { value: number; unit: string };
  replicaKnown: boolean;
  replica: number | null;
  distributedFormatted: FormattedBytes;
  cephAvailFormatted: FormattedBytes;
  cephDisplayRaw: ReturnType<typeof resolveCephOverviewRawCapacity>;
  headerNodeCount: number;
  cephCapacityFallbackCr: boolean;
  protectionBadgeText: string;
  showCephCapacityMissingHint: boolean;
  showCephPoolMatchHint: boolean;
  summary: LonghornStorageSummary;
};

export function buildStorageCardViewModel(fast: StorageCardViewModelInput): StorageCardViewModel {
  const summary = parseLonghornStorage(fast?.storageNodes ?? null);
  const cephBundle = normalizeCephBundle(fast?.cephResourcesRaw ?? null);
  const cephLanding = buildCephLandingModel(fast?.cephHealthMinimal ?? null, null);
  const mgrDfRaw = cephLanding.capacity.raw;
  const cephDisplayRaw = resolveCephOverviewRawCapacity(mgrDfRaw, cephBundle);
  const isCeph = clusterHasCeph(cephBundle);

  const cephScPoolProtection = resolveDefaultStorageClassCephPoolProtection(
    summary.defaultStorageClassName,
    cephBundle,
    fast?.storageClassesJson ?? null,
  );

  const footerIsCephProtectionLayout =
    isCeph &&
    (summary.distributedStorageKind === 'ceph' ||
      (summary.distributedStorageKind === 'unknown' && !!cephScPoolProtection));

  const usedPercent =
    isCeph && cephDisplayRaw
      ? Math.round(cephDisplayRaw.pctOfTotal * 10) / 10
      : summary.storageMaximum > 0
        ? Math.round((summary.storageUsed / summary.storageMaximum) * 1000) / 10
        : 0;

  const totalFormatted =
    isCeph && cephDisplayRaw
      ? formatBytesWithUnit(cephDisplayRaw.total)
      : formatBytesWithUnit(summary.storageMaximum);
  const usedFormatted =
    isCeph && cephDisplayRaw
      ? formatBytesWithUnit(cephDisplayRaw.used)
      : formatBytesWithUnit(summary.storageUsed);
  const remainingFormatted =
    isCeph && cephDisplayRaw
      ? formatBytesWithUnit(cephDisplayRaw.avail)
      : formatBytesWithUnit(summary.storageAvailable);

  const replica = summary.defaultStorageClassReplicaCount;
  const replicaKnown = !footerIsCephProtectionLayout && replica != null && replica >= 1;
  const distributedFormatted = replicaKnown ? formatBytesWithUnit(summary.storageAvailable / replica!) : null;
  const cephAvailFormatted = cephDisplayRaw ? formatBytesWithUnit(cephDisplayRaw.avail) : null;

  const nodeList = fast?.nodeResources?.data;
  const headerNodeCount =
    Array.isArray(nodeList) && nodeList.length > 0 ? nodeList.length : summary.nodeCount;

  const cephCapacityFallbackCr = !!(isCeph && cephDisplayRaw && !(mgrDfRaw && mgrDfRaw.total > 0));

  return {
    isCeph,
    footerIsCephProtectionLayout,
    usedPercent,
    totalFormatted,
    usedFormatted,
    remainingFormatted,
    replicaKnown,
    replica,
    distributedFormatted,
    cephAvailFormatted,
    cephDisplayRaw,
    headerNodeCount,
    cephCapacityFallbackCr,
    protectionBadgeText: cephScPoolProtection?.protectionZh ?? '—',
    showCephCapacityMissingHint: isCeph && !cephDisplayRaw,
    showCephPoolMatchHint: summary.distributedStorageKind === 'ceph' && !cephScPoolProtection,
    summary,
  };
}
