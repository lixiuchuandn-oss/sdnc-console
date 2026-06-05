/**
 * Cloudmap 池 · 集群 Tab 权限门控（与 cloudmapPoolNavRows、backend atoms 对齐）。
 */
import { CLOUDMAP_POOL_NAV_ROWS } from '../../../../../../routes/cloudmapPoolNavRows';
import {
  CLUSTER_STORAGE_INNER_READ,
  CLOUD_UNIFIED_STORAGE_READ,
  isUnifiedStorageReadBase,
  LEGACY_CLOUD_CEPH_READ,
  LEGACY_CLOUD_CEPH_WRITE,
} from '../../../../../../constants/unifiedStoragePermissions';
import { isClusterCephPoolInnerSeg } from '../../../../../../layouts/admin/cloudmap/cloudPoolSidebar';
import { CLOUD_PROVIDER_NETWORKS_READ } from '../../../../../../constants/cloudPermissions';
import {
  COMPUTE_RESOURCE_INNER_SEGS,
  isComputeClusterInnerSeg,
  isComputeResourceInnerSeg,
  remapLegacyClusterInnerSeg,
  type ComputeResourceInnerSeg,
} from '../../../Harvester/cluster/lib/computeResourcesNav';
import {
  isPhysicalNetworkInnerSeg,
  isPlatformNetworkInnerSeg,
} from '../../../Harvester/cluster/lib/networkResourcesNav';
import { canReadComputeCluster } from '../../../../../../constants/computeClusterPermissions';

const CLUSTER_INNER_ORDER: readonly string[] = CLOUDMAP_POOL_NAV_ROWS.filter((r) =>
  r.pathSuffix.startsWith('cluster/'),
)
  .sort((a, b) => a.order - b.order)
  .map((r) => r.pathSuffix.slice('cluster/'.length));

function storageUmbrellaOrLegacy(checkPerm: (action: string) => boolean): boolean {
  return (
    checkPerm(CLOUD_UNIFIED_STORAGE_READ) ||
    checkPerm(LEGACY_CLOUD_CEPH_READ) ||
    checkPerm(LEGACY_CLOUD_CEPH_WRITE)
  );
}

export function clusterStorageInnerReadAction(innerSeg: string): string | undefined {
  return CLUSTER_STORAGE_INNER_READ[innerSeg];
}

export function canViewClusterStorageInner(
  innerSeg: string,
  checkPerm: (action: string) => boolean,
): boolean {
  const act = clusterStorageInnerReadAction(innerSeg);
  if (!act) return false;
  if (checkPerm(act)) return true;
  return storageUmbrellaOrLegacy(checkPerm);
}

export function canViewComputeResourceInner(
  innerSeg: ComputeResourceInnerSeg,
  checkPerm: (action: string) => boolean,
): boolean {
  switch (innerSeg) {
    case 'compute_projects':
      return checkPerm('clouds.namespaces:read');
    case 'compute_gpu':
      return checkPerm('clouds.gpus:read');
    default:
      return false;
  }
}

export function canViewComputeClusterInner(checkPerm: (action: string) => boolean): boolean {
  return canReadComputeCluster(checkPerm);
}

export function canViewPhysicalNetworkHub(
  checkPerm: (action: string) => boolean,
  ctx: { canReadPublicSubnets: boolean },
): boolean {
  return (
    checkPerm('clouds.cluster-networks:read') ||
    checkPerm(CLOUD_PROVIDER_NETWORKS_READ) ||
    ctx.canReadPublicSubnets ||
    checkPerm('clouds.vlans:read')
  );
}

export function canViewPlatformNetworkHub(
  checkPerm: (action: string) => boolean,
  ctx: {
    canReadNetworkScope: boolean;
    canReadLoadBalancers: boolean;
  },
): boolean {
  return (
    checkPerm('clouds.cluster-networks:read') ||
    ctx.canReadNetworkScope ||
    ctx.canReadLoadBalancers ||
    checkPerm('clouds.ip-pools:read')
  );
}

export function canViewClusterSidebarLeaf(
  leafKey: string,
  checkPerm: (action: string) => boolean,
  ctx: {
    canReadPublicSubnets: boolean;
    canReadNetworkScope: boolean;
    canReadLoadBalancers: boolean;
  },
): boolean {
  const normalized = remapLegacyClusterInnerSeg(leafKey);
  if (isComputeClusterInnerSeg(normalized)) {
    return canViewComputeClusterInner(checkPerm);
  }
  if (isComputeResourceInnerSeg(normalized)) {
    return canViewComputeResourceInner(normalized, checkPerm);
  }
  if (isPhysicalNetworkInnerSeg(normalized)) {
    return canViewPhysicalNetworkHub(checkPerm, ctx);
  }
  if (isPlatformNetworkInnerSeg(normalized)) {
    return canViewPlatformNetworkHub(checkPerm, ctx);
  }

  const { canReadPublicSubnets, canReadNetworkScope, canReadLoadBalancers } = ctx;
  switch (normalized) {
    case 'cluster_usb':
      return checkPerm('clouds.usb-devices:read');
    case 'storage_classes':
      return checkPerm('clouds.storage-classes:read');
    case 'cluster_pci':
    case 'cluster_sriov':
      return checkPerm('clouds.pci-devices:read');
    default:
      if (isClusterCephPoolInnerSeg(normalized)) {
        return canViewClusterStorageInner(normalized, checkPerm);
      }
      return false;
  }
}

export function firstAccessibleComputeResourceInnerSeg(
  checkPerm: (action: string) => boolean,
): ComputeResourceInnerSeg | null {
  for (const seg of COMPUTE_RESOURCE_INNER_SEGS) {
    if (canViewComputeResourceInner(seg, checkPerm)) return seg;
  }
  return null;
}

export function firstAccessibleClusterPoolInnerSeg(
  checkPerm: (action: string) => boolean,
  ctx: Parameters<typeof canViewClusterSidebarLeaf>[2],
): string | null {
  for (const seg of CLUSTER_INNER_ORDER) {
    if (canViewClusterSidebarLeaf(seg, checkPerm, ctx)) {
      return remapLegacyClusterInnerSeg(seg);
    }
  }
  return null;
}

export function canEnterClusterGroup(
  checkPerm: (action: string) => boolean,
  ctx: Parameters<typeof canViewClusterSidebarLeaf>[2],
): boolean {
  return firstAccessibleClusterPoolInnerSeg(checkPerm, ctx) != null;
}

export function canEnterUnifiedStorageGroup(checkPerm: (action: string) => boolean): boolean {
  if (storageUmbrellaOrLegacy(checkPerm)) return true;
  return Object.keys(CLUSTER_STORAGE_INNER_READ).some((inner) =>
    canViewClusterStorageInner(inner, checkPerm),
  );
}

/** 管理端 hasPermissionForAction 用：umbrella / 历史 ceph 满足任一存储子域 read */
export function unifiedStorageReadGranted(perms: string[], requiredRead: string): boolean {
  if (!requiredRead.endsWith(':read')) return false;
  const base = requiredRead.slice(0, -':read'.length);
  if (!isUnifiedStorageReadBase(base)) return false;
  if (
    perms.includes(LEGACY_CLOUD_CEPH_READ) ||
    perms.includes(LEGACY_CLOUD_CEPH_WRITE) ||
    perms.includes(CLOUD_UNIFIED_STORAGE_READ) ||
    perms.includes('clouds.unified-storage:write')
  ) {
    return true;
  }
  return false;
}
