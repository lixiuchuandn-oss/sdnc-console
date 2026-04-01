/**
 * =============================================================================
 * 模块名称: Kube-OVN 命名、分域与集群保留名
 * 文件路径: backend/src/services/clouds/harvester/kubeOvnNetworkScope.ts
 * =============================================================================
 *
 * [职责]
 * 1. 内置 VPC 常量、FIP/DNAT/SNAT 语义上的 underlay / vpc 分域（纯函数）。
 * 2. 集群内置或控制台保留的 Kube-OVN CR 名（Subnet、Vlan 等），供列表过滤与 API 校验。
 *
 * [与兄弟模块区分]
 * - `utils.ts`：Harvester/K8s HTTP 通用请求与 Watch，与本文件领域常量无关。
 * - `network.ts`：子网/NAD 等高层 CRUD 封装。
 *
 * 历史 VPC 名 `ovn-vpc-external-network` 已废弃，不在此维护。
 * =============================================================================
 */

/** 公共子网 / 默认集群 VPC 名（与 Kube-OVN 常见默认一致） */
export const KUBE_OVN_PUBLIC_VPC = 'ovn-cluster';
/** 扁平子网所在内置 VPC */
export const KUBE_OVN_FLAT_VPC = 'ovn-internal';
/** Provider 等内置 VPC（集群侧保留；业务 VPC 选择器排除） */
export const KUBE_OVN_PROVIDER_VPC = 'ovn-provider';

/** 内置 VPC 名称（metadata.name），与 Tower 约定一致 */
export const KUBE_OVN_BUILTIN_VPC_NAMES = [
  KUBE_OVN_PUBLIC_VPC,
  KUBE_OVN_FLAT_VPC,
  KUBE_OVN_PROVIDER_VPC,
] as const;

/** 集群内置 Subnet CR 名（Kube-OVN Subnet.metadata.name） */
export const KUBE_OVN_BUILTIN_SUBNET_CR_NAMES = ['external'] as const;

/** 列表不返回、禁止控制台创建/删除的 Vlan CR 名 */
export const KUBE_OVN_RESERVED_VLAN_CR_NAMES = ['hci-external'] as const;

export const KUBE_OVN_RESERVED_VLAN_CR_NAME_SET = new Set<string>(KUBE_OVN_RESERVED_VLAN_CR_NAMES);

/** @deprecated 请用 KUBE_OVN_PUBLIC_VPC；空 spec.vpc 等历史默认 */
export const KUBE_OVN_UNDERLAY_VPC = KUBE_OVN_PUBLIC_VPC;

export type OvnNetworkScope = 'underlay' | 'vpc';

export function normalizeVpcName(v: string | undefined | null): string {
  const s = String(v ?? '').trim();
  return s || KUBE_OVN_PUBLIC_VPC;
}

/** 是否为 FIP/DNAT/SNAT 规则语义上的「扁平域」VPC（含历史 ovn-cluster 扁平） */
export function isUnderlayVpcName(vpc: string | undefined | null): boolean {
  const n = normalizeVpcName(vpc);
  return n === KUBE_OVN_FLAT_VPC || n === KUBE_OVN_PUBLIC_VPC;
}

export function classifyFipOrDnat(raw: any): OvnNetworkScope {
  return isUnderlayVpcName(raw?.spec?.vpc) ? 'underlay' : 'vpc';
}

/** SNAT spec 里子网引用可能是 name 或 ns/name */
export function subnetRefToName(ref: string | undefined | null): string | null {
  if (ref == null || ref === '') return null;
  const s = String(ref).trim();
  const parts = s.split('/');
  return parts[parts.length - 1] || null;
}

/**
 * 根据子网库存解析 SNAT 所属域：默认 VPC 为 underlay，否则 vpc；找不到子网时返回 unknown（列表策略由调用方决定）
 */
export function classifySnatRule(
  raw: any,
  subnetVpcByName: Map<string, string | undefined>,
): OvnNetworkScope | 'unknown' {
  const key =
    raw?.spec?.vpcSubnet ??
    raw?.spec?.subnet ??
    raw?.spec?.subnetName;
  const name = subnetRefToName(key);
  if (!name) return 'unknown';
  const vpc = subnetVpcByName.get(name);
  if (vpc === undefined) return 'unknown';
  return isUnderlayVpcName(vpc) ? 'underlay' : 'vpc';
}

export function ovnEipNameFromRule(raw: any): string | undefined {
  const n = raw?.spec?.ovnEip ?? raw?.spec?.eip;
  return n != null && String(n).trim() !== '' ? String(n).trim() : undefined;
}

export function filterItemsByScope(
  items: any[],
  scope: OvnNetworkScope,
  classify: (item: any) => OvnNetworkScope | 'unknown',
): any[] {
  return items.filter((item) => {
    const c = classify(item);
    if (c === 'unknown') return scope === 'vpc';
    return c === scope;
  });
}
