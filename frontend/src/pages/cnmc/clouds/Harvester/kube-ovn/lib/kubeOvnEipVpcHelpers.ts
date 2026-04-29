/**
 * EIP（Kube-OVN OvnEip）与业务 VPC 的归属关系解析。
 * 与 EipSection 表格列「VPC」及创建时写入的 tower.io/vpc / extraExternalSubnets 一致。
 */
import { isBuiltInKubeOvnVpc } from './kubeOvnSubnetConstants';

export const TOWER_IO_VPC_EIP_ANNOTATION = 'tower.io/vpc';

/**
 * 公共子网 CR 名 → 业务 VPC CR 名（由 VPC.spec.extraExternalSubnets 回填）。
 */
export function buildPublicSubnetNameToVpcNameMap(vpcs: any[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const v of vpcs || []) {
    const vpcName = String(v?.name || v?.metadata?.name || '').trim();
    if (!vpcName || isBuiltInKubeOvnVpc(vpcName)) continue;
    const extraRaw = (v?.spec?.extraExternalSubnets || v?.extraExternalSubnets || []) as unknown[];
    const extra = (Array.isArray(extraRaw) ? extraRaw : [])
      .map((x) => String(x ?? '').trim())
      .filter(Boolean);
    for (const subnetName of extra) {
      if (!m[subnetName]) m[subnetName] = vpcName;
    }
  }
  return m;
}

/**
 * 解析 EIP 归属的业务 VPC（CR name）。无绑定时返回空串。
 */
export function getOvnEipBoundVpcName(
  eip: any,
  publicSubnetNameToVpcName: Record<string, string>,
): string {
  const ann = String(eip?.metadata?.annotations?.[TOWER_IO_VPC_EIP_ANNOTATION] ?? '').trim();
  if (ann) return ann;
  const specVpc = String(eip?.spec?.vpc ?? '').trim();
  if (specVpc) return specVpc;
  const ext = String(eip?.spec?.externalSubnet ?? '').trim();
  if (ext && publicSubnetNameToVpcName[ext]) return publicSubnetNameToVpcName[ext];
  return '';
}
