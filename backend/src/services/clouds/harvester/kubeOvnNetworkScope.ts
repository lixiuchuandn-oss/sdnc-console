/**
 * Kube-OVN 内置 VPC 分域：
 * - ovn-cluster：公共子网（EIP 外网等）
 * - ovn-internal：扁平子网（与公共分 VPC，避免扁平流量误直连公网侧）
 * FIP/SNAT/DNAT 的「扁平域」校验接受 ovn-internal；兼容历史仍挂在 ovn-cluster 上的扁平子网。
 */

/** 公共子网 / 默认集群 VPC 名（与 Kube-OVN 常见默认一致） */
export const KUBE_OVN_PUBLIC_VPC = 'ovn-cluster';
/** 扁平子网所在内置 VPC */
export const KUBE_OVN_FLAT_VPC = 'ovn-internal';

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
