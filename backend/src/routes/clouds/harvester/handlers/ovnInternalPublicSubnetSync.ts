/**
 * 公共子网（tower.io/subnet-type=public，挂 ovn-cluster）与 ovn-internal VPC 的联动：
 * - spec.extraExternalSubnets：登记公共子网 CR 名
 * - spec.staticRoutes：policyDst + cidr（可访问范围，见注解 tower.io/ovn-internal-route-cidr，不限时为 0.0.0.0/0）+ nextHopIP=子网 gateway
 * - 注解 tower.io/ovn-internal-route-cidr 存路由目的网段；未设置时兼容旧数据用 spec.cidrBlock
 */
import { getJsonOnce } from '../../../../services/clouds/harvester/utils';
import { updateKubeOvnVpc, type HarvesterTestParams } from '../../../../services/clouds/harvester/client';
import {
  KUBE_OVN_FLAT_VPC,
  KUBE_OVN_PUBLIC_VPC,
} from '../../../../services/clouds/harvester/kubeOvnNetworkScope';

export const OVN_INTERNAL_ROUTE_CIDR_ANNOTATION = 'tower.io/ovn-internal-route-cidr';

const POLICY_DST = 'policyDst';

/** ovn-internal 静态路由 policyDst 的 cidr：优先注解可访问范围，否则兼容旧数据用子网 spec.cidrBlock */
export function ovnInternalRouteCidrFromSubnet(
  subnet: {
    metadata?: { annotations?: Record<string, unknown> };
    spec?: { cidrBlock?: string; cidr?: string };
  } | null | undefined,
): string {
  const fromAnn = String(
    (subnet?.metadata?.annotations as Record<string, unknown> | undefined)?.[
      OVN_INTERNAL_ROUTE_CIDR_ANNOTATION
    ] ?? '',
  ).trim();
  if (fromAnn) return fromAnn;
  const fromSpec = String(subnet?.spec?.cidrBlock ?? subnet?.spec?.cidr ?? '').trim();
  if (fromSpec) return fromSpec;
  return '0.0.0.0/0';
}

/** 占用指定 externalSubnet 且 type 非 lrp 的 EIP（用于编辑/删除拦截） */
export function eipsReferencingSubnetExcludingLrp(eips: any[], subnetName: string): any[] {
  const n = String(subnetName || '').trim();
  return (Array.isArray(eips) ? eips : []).filter((eip) => {
    const sub = eip?.spec?.externalSubnet || eip?.externalSubnet;
    if (String(sub || '').trim() !== n) return false;
    const t = String(eip?.spec?.type ?? eip?.type ?? '').trim().toLowerCase();
    return t !== 'lrp';
  });
}

function routeTriple(r: any): { cidr: string; nextHopIP: string; policy: string } {
  return {
    cidr: String(r?.cidr ?? '').trim(),
    nextHopIP: String(r?.nextHopIP ?? '').trim(),
    policy: String(r?.policy ?? '').trim(),
  };
}

function sameRoute(
  a: { cidr: string; nextHopIP: string; policy: string },
  b: { cidr: string; nextHopIP: string; policy: string },
): boolean {
  return a.cidr === b.cidr && a.nextHopIP === b.nextHopIP && a.policy === b.policy;
}

/**
 * 创建/更新后：确保 extraExternalSubnets 含子网名，并维护一条 policyDst 静态路由。
 * 若提供 prev*，先按旧三元组移除一条路由（网关或路由 CIDR 变更时）。
 */
export async function upsertOvnInternalForPublicSubnet(params: {
  harvesterParams: HarvesterTestParams;
  subnetName: string;
  gateway: string;
  routeCidr: string;
  prevGateway?: string;
  prevRouteCidr?: string;
}): Promise<void> {
  const { harvesterParams, subnetName, gateway, routeCidr, prevGateway, prevRouteCidr } = params;
  const { endpoint, token, insecure = false } = harvesterParams;
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const getUrl = `${origin}/apis/kubeovn.io/v1/vpcs/${encodeURIComponent(KUBE_OVN_FLAT_VPC)}`;
  const vpc = await getJsonOnce(getUrl, token, insecure);
  if (!vpc?.spec) {
    throw new Error(`VPC ${KUBE_OVN_FLAT_VPC} 不存在或无法读取`);
  }

  let extra: string[] = Array.isArray(vpc.spec.extraExternalSubnets)
    ? [...vpc.spec.extraExternalSubnets]
    : [];
  if (!extra.includes(subnetName)) {
    extra.push(subnetName);
  }

  let routes: any[] = Array.isArray(vpc.spec.staticRoutes) ? [...vpc.spec.staticRoutes] : [];

  if (prevGateway && prevRouteCidr) {
    const prevT = {
      cidr: String(prevRouteCidr).trim(),
      nextHopIP: String(prevGateway).trim(),
      policy: POLICY_DST,
    };
    routes = routes.filter((r) => !sameRoute(routeTriple(r), prevT));
  }

  const newT = {
    cidr: String(routeCidr).trim(),
    nextHopIP: String(gateway).trim(),
    policy: POLICY_DST,
  };
  routes = routes.filter((r) => !sameRoute(routeTriple(r), newT));
  routes.push({
    bfdId: '',
    cidr: newT.cidr,
    ecmpMode: '',
    nextHopIP: newT.nextHopIP,
    policy: POLICY_DST,
    routeTable: '',
  });

  await updateKubeOvnVpc(harvesterParams, KUBE_OVN_FLAT_VPC, {
    extraExternalSubnets: extra,
    staticRoutes: routes,
  });
}

/**
 * 业务 VPC 使用公共外网子网（EIP 场景）：在目标 VPC 上登记 extraExternalSubnets，
 * 并维护一条 policyDst 静态路由（cidr + nextHopIP=公共子网网关）。
 * 与 ovn-internal 侧 upsertOvnInternalForPublicSubnet 合并规则一致。
 */
export async function upsertVpcPolicyDstRouteForExternalSubnet(params: {
  harvesterParams: HarvesterTestParams;
  vpcName: string;
  externalSubnetName: string;
  gateway: string;
  routeCidr: string;
}): Promise<void> {
  const { harvesterParams, vpcName, externalSubnetName, gateway, routeCidr } = params;
  const { endpoint, token, insecure = false } = harvesterParams;
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const getUrl = `${origin}/apis/kubeovn.io/v1/vpcs/${encodeURIComponent(vpcName)}`;
  const vpc = await getJsonOnce(getUrl, token, insecure);
  if (!vpc?.spec) {
    throw new Error(`VPC ${vpcName} 不存在或无法读取`);
  }

  let extra: string[] = Array.isArray(vpc.spec.extraExternalSubnets)
    ? [...vpc.spec.extraExternalSubnets]
    : [];
  if (!extra.includes(externalSubnetName)) {
    extra.push(externalSubnetName);
  }

  let routes: any[] = Array.isArray(vpc.spec.staticRoutes) ? [...vpc.spec.staticRoutes] : [];

  const newT = {
    cidr: String(routeCidr).trim(),
    nextHopIP: String(gateway).trim(),
    policy: POLICY_DST,
  };
  routes = routes.filter((r) => !sameRoute(routeTriple(r), newT));
  routes.push({
    bfdId: '',
    cidr: newT.cidr,
    ecmpMode: '',
    nextHopIP: newT.nextHopIP,
    policy: POLICY_DST,
    routeTable: '',
  });

  await updateKubeOvnVpc(harvesterParams, vpcName, {
    extraExternalSubnets: extra,
    staticRoutes: routes,
  });
}

export async function removeOvnInternalForPublicSubnet(params: {
  harvesterParams: HarvesterTestParams;
  subnetName: string;
  gateway: string;
  routeCidr: string;
}): Promise<void> {
  const { harvesterParams, subnetName, gateway, routeCidr } = params;
  const { endpoint, token, insecure = false } = harvesterParams;
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const getUrl = `${origin}/apis/kubeovn.io/v1/vpcs/${encodeURIComponent(KUBE_OVN_FLAT_VPC)}`;
  const vpc = await getJsonOnce(getUrl, token, insecure);
  if (!vpc?.spec) {
    throw new Error(`VPC ${KUBE_OVN_FLAT_VPC} 不存在或无法读取`);
  }

  const extra: string[] = Array.isArray(vpc.spec.extraExternalSubnets)
    ? vpc.spec.extraExternalSubnets.filter((x: string) => x !== subnetName)
    : [];

  if (!String(gateway).trim()) {
    await updateKubeOvnVpc(harvesterParams, KUBE_OVN_FLAT_VPC, {
      extraExternalSubnets: extra,
    });
    return;
  }

  const matchT = {
    cidr: String(routeCidr).trim(),
    nextHopIP: String(gateway).trim(),
    policy: POLICY_DST,
  };
  const routes: any[] = Array.isArray(vpc.spec.staticRoutes)
    ? vpc.spec.staticRoutes.filter((r: any) => !sameRoute(routeTriple(r), matchT))
    : [];

  await updateKubeOvnVpc(harvesterParams, KUBE_OVN_FLAT_VPC, {
    extraExternalSubnets: extra,
    staticRoutes: routes,
  });
}

export function isPublicSubnetOnOvnCluster(subnet: {
  metadata?: { annotations?: Record<string, string> };
  spec?: { vpc?: string };
} | null): boolean {
  const st = String(subnet?.metadata?.annotations?.['tower.io/subnet-type'] ?? '')
    .trim()
    .toLowerCase();
  const vpc = String(subnet?.spec?.vpc ?? '').trim();
  return st === 'public' && vpc === KUBE_OVN_PUBLIC_VPC;
}
