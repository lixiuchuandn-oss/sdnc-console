import { CLOUD_PROVIDER_NETWORKS_READ } from '../../../../constants/cloudPermissions';

export type ClusterMainTabVisibleCtx = {
  checkPerm: (act: string) => boolean;
  canReadPublicSubnets: boolean;
  clusterNetworkSegmentOptionsLength: number;
};

/**
 * 与 `tabs/cluster/index.tsx` 的 Tab 过滤、`loadTabResource/handlers/clusterTabs` 的 gate 对齐。
 */
export function isCloudmapClusterMainTabVisible(
  key: string,
  ctx: ClusterMainTabVisibleCtx,
): boolean {
  const { checkPerm, canReadPublicSubnets, clusterNetworkSegmentOptionsLength } =
    ctx;
  switch (key) {
    case 'cluster_nodes':
      return (
        checkPerm('clouds.cluster-nodes:read') || checkPerm('clouds.ecs:read')
      );
    case 'cluster_physical_switches':
      return checkPerm('clouds.cluster-networks:read');
    case 'kubeovn_public_networks':
      return checkPerm(CLOUD_PROVIDER_NETWORKS_READ);
    case 'namespaces':
      return (
        checkPerm('clouds.namespaces:read') ||
        checkPerm('clouds:read') ||
        checkPerm('clouds.ecs:read')
      );
    case 'kubeovn_public_subnets':
      return canReadPublicSubnets;
    case 'cluster_vlans':
      return (
        checkPerm('clouds.vlans:read') || checkPerm(CLOUD_PROVIDER_NETWORKS_READ)
      );
    case 'gpu':
      return checkPerm('clouds.gpus:read') || checkPerm('clouds.ecs:read');
    case 'cluster_usb':
      return (
        checkPerm('clouds.usb-devices:read') || checkPerm('clouds.ecs:read')
      );
    case 'clusterNetworks':
      return clusterNetworkSegmentOptionsLength > 0;
    default:
      return false;
  }
}

export function readClusterStateFromUrl(
  sp: URLSearchParams,
  opts: {
    defaultSubKey: string;
    checkPerm: (act: string) => boolean;
    canReadPublicSubnets: boolean;
    networkSegmentOptions: { value: string; label: string }[];
  },
): { innerKey: string; networkSegment?: string } {
  const { defaultSubKey, checkPerm, canReadPublicSubnets, networkSegmentOptions } =
    opts;
  const rawSub = (sp.get('cluster_sub') || '').trim();
  const rawSeg = (sp.get('cluster_segment') || '').trim();

  const ctx: ClusterMainTabVisibleCtx = {
    checkPerm,
    canReadPublicSubnets,
    clusterNetworkSegmentOptionsLength: networkSegmentOptions.length,
  };

  let innerKey = defaultSubKey;
  if (rawSub && isCloudmapClusterMainTabVisible(rawSub, ctx)) {
    innerKey = rawSub;
  }

  let networkSegment: string | undefined;
  if (innerKey === 'clusterNetworks' && rawSeg) {
    if (networkSegmentOptions.some((o) => o.value === rawSeg)) {
      networkSegment = rawSeg;
    }
  }

  return { innerKey, networkSegment };
}
