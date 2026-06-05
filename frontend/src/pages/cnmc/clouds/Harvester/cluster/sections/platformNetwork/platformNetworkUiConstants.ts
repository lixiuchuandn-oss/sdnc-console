/** 集群网络页 · Tab 与 URL `operateTab` */

export type PlatformNetworkOperateTabKey =
  | 'cluster_networks'
  | 'nads'
  | 'load_balancers'
  | 'ippools';

const OPERATE_TAB_KEYS = new Set<string>([
  'cluster_networks',
  'nads',
  'load_balancers',
  'ippools',
]);

export function parsePlatformNetworkOperateTabKey(
  raw: string | null | undefined,
): PlatformNetworkOperateTabKey | null {
  const k = String(raw || '').trim();
  if (!k || !OPERATE_TAB_KEYS.has(k)) return null;
  return k as PlatformNetworkOperateTabKey;
}

/** 历史独立 pathSeg → operateTab */
export const LEGACY_PLATFORM_NETWORK_OPERATE_TAB: Readonly<
  Record<string, PlatformNetworkOperateTabKey>
> = {
  clusterNetworks: 'cluster_networks',
  nads: 'nads',
  load_balancers: 'load_balancers',
  ippools: 'ippools',
};

export function legacyPlatformNetworkOperateTab(
  innerSeg: string,
): PlatformNetworkOperateTabKey | null {
  return LEGACY_PLATFORM_NETWORK_OPERATE_TAB[innerSeg] ?? null;
}

export const PLATFORM_NETWORK_TAB_LOAD_KEY: Readonly<
  Record<PlatformNetworkOperateTabKey, string>
> = {
  cluster_networks: 'clusterNetworks',
  nads: 'nads',
  load_balancers: 'load_balancers',
  ippools: 'ippools',
};
