/** 物理网络页 · Tab 与 URL `operateTab` */

export type PhysicalNetworkOperateTabKey =
  | 'switches'
  | 'provider_networks'
  | 'public_subnets'
  | 'vlans';

const OPERATE_TAB_KEYS = new Set<string>([
  'switches',
  'provider_networks',
  'public_subnets',
  'vlans',
]);

export function parsePhysicalNetworkOperateTabKey(
  raw: string | null | undefined,
): PhysicalNetworkOperateTabKey | null {
  const k = String(raw || '').trim();
  if (!k || !OPERATE_TAB_KEYS.has(k)) return null;
  return k as PhysicalNetworkOperateTabKey;
}

/** 历史独立 pathSeg → operateTab */
export const LEGACY_PHYSICAL_NETWORK_OPERATE_TAB: Readonly<
  Record<string, PhysicalNetworkOperateTabKey>
> = {
  cluster_physical_switches: 'switches',
  kubeovn_public_networks: 'provider_networks',
  kubeovn_public_subnets: 'public_subnets',
  cluster_vlans: 'vlans',
};

export function legacyPhysicalNetworkOperateTab(
  innerSeg: string,
): PhysicalNetworkOperateTabKey | null {
  return LEGACY_PHYSICAL_NETWORK_OPERATE_TAB[innerSeg] ?? null;
}

export const PHYSICAL_NETWORK_TAB_LOAD_KEY: Readonly<
  Record<PhysicalNetworkOperateTabKey, string>
> = {
  switches: 'cluster_physical_switches',
  provider_networks: 'kubeovn_public_networks',
  public_subnets: 'kubeovn_public_subnets',
  vlans: 'cluster_vlans',
};
