/** Kube-OVN 子网（扁平/公共/VPC）在 Tower 侧的统一注解与 finalizer */
export const TOWER_ALIAS_ANNOTATION = 'tower.io/alias';
export const SUBNET_TYPE_ANNOTATION_KEY = 'tower.io/subnet-type';
export const SUBNET_FINALIZER = 'tower.io/managed';

/** 公共子网、EIP 外网：内置 VPC */
export const KUBE_OVN_PUBLIC_VPC = 'ovn-cluster';
/** 扁平子网：内置 VPC（与公共子网分域） */
export const KUBE_OVN_FLAT_VPC = 'ovn-internal';

/** 子网 spec.vpc 是否为承载扁平/公共的内置 VPC（非租户业务 VPC） */
export function isBuiltInKubeOvnVpc(vpc: string | undefined | null): boolean {
  const v = String(vpc ?? '').trim();
  return v === KUBE_OVN_PUBLIC_VPC || v === KUBE_OVN_FLAT_VPC;
}

/** 可作为「扁平子网」挂载的 VPC：ovn-internal 或历史 ovn-cluster 上的 flat */
export function isFlatKubeOvnSubnetVpc(vpc: string | undefined | null): boolean {
  return isBuiltInKubeOvnVpc(vpc);
}
