/** Cloudmap 集群 · 网络管理：URL pathSeg、侧栏子页与 loadKey 映射 */

export const PHYSICAL_NETWORK_INNER_SEG = 'cluster_physical_network' as const;
export const PLATFORM_NETWORK_INNER_SEG = 'cluster_platform_network' as const;

export function isPhysicalNetworkInnerSeg(seg: string): boolean {
  return seg === PHYSICAL_NETWORK_INNER_SEG;
}

export function isPlatformNetworkInnerSeg(seg: string): boolean {
  return seg === PLATFORM_NETWORK_INNER_SEG;
}

/** 已并入 `cluster_physical_network` 的历史 pathSeg */
export const LEGACY_PHYSICAL_NETWORK_SEG_MAP: Readonly<Record<string, typeof PHYSICAL_NETWORK_INNER_SEG>> = {
  cluster_physical_switches: PHYSICAL_NETWORK_INNER_SEG,
  kubeovn_public_networks: PHYSICAL_NETWORK_INNER_SEG,
  kubeovn_public_subnets: PHYSICAL_NETWORK_INNER_SEG,
  cluster_vlans: PHYSICAL_NETWORK_INNER_SEG,
};

/** 已并入 `cluster_platform_network` 的历史 pathSeg */
export const LEGACY_PLATFORM_NETWORK_SEG_MAP: Readonly<Record<string, typeof PLATFORM_NETWORK_INNER_SEG>> = {
  clusterNetworks: PLATFORM_NETWORK_INNER_SEG,
  nads: PLATFORM_NETWORK_INNER_SEG,
  load_balancers: PLATFORM_NETWORK_INNER_SEG,
  ippools: PLATFORM_NETWORK_INNER_SEG,
};

export function remapLegacyPhysicalNetworkInnerSeg(seg: string): string {
  return LEGACY_PHYSICAL_NETWORK_SEG_MAP[seg] || seg;
}

export function remapLegacyPlatformNetworkInnerSeg(seg: string): string {
  return LEGACY_PLATFORM_NETWORK_SEG_MAP[seg] || seg;
}

export function remapLegacyNetworkInnerSeg(seg: string): string {
  const physical = remapLegacyPhysicalNetworkInnerSeg(seg);
  if (physical !== seg) return physical;
  return remapLegacyPlatformNetworkInnerSeg(seg);
}
