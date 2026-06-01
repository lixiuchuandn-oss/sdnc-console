/**
 * 公共子网（tower.io/subnet-type=public，挂 ovn-cluster）与 ovn-internal VPC 的联动：
 * - spec.extraExternalSubnets：登记公共子网 CR 名
 * - spec.staticRoutes：policyDst + cidr（可访问范围，见注解 tower.io/ovn-internal-route-cidr，不限时为 0.0.0.0/0）+ nextHopIP=子网 gateway
 * - spec.enableExternal：首条 underlay 且引用该类产品子网的 EIP 创建时置 true；集群内已无任何此类 EIP 引用任一公共外网子网时置 false（与 remove 路径一致）
 * - 注解 tower.io/ovn-internal-route-cidr 存路由目的网段；未设置时兼容旧数据用 spec.cidrBlock
 *
 * 写入时机：由「扁平网络 underlay 弹性公网 IP 创建」触发（见 harvesterOvnEipCreateHandlerScoped）；不再在「仅创建公共子网」时写入。
 * 回收：
 * - 扁平：最后一条引用该公共外网子网的 underlay EIP，或公共子网 CR 删除（ovn-direct-subnets）。
 * - VPC：最后一条引用某外网子网的 VPC 域 EIP（按 annotations 所选业务 VPC）；与 ovn-internal 分离处理。
 */
import { getJsonOnce } from '../../../../services/clouds/harvester/utils';
import {
  updateKubeOvnVpc,
  type HarvesterTestParams,
} from '../../../../services/clouds/harvester/client';
import {
  KUBE_OVN_FLAT_VPC,
  KUBE_OVN_PUBLIC_VPC,
  TOWER_IO_OVN_NETWORK_SCOPE_ANNOTATION,
  isUnderlayVpcName,
} from '../../../../services/clouds/harvester/kubeOvnNetworkScope';

function originFromEndpoint(endpoint: string): string {
  const base = (endpoint || '').replace(/\/+$/, '');
  try {
    const u = new URL(base);
    return `${u.protocol}//${u.host}`;
  } catch {
    return base.replace(/\/v[0-9].*$/, '');
  }
}

export const OVN_INTERNAL_ROUTE_CIDR_ANNOTATION = 'tower.io/ovn-internal-route-cidr';

const POLICY_DST = 'policyDst';

/** EIP metadata.annotations：创建 VPC 域 EIP 时写入所选业务 VPC 名（与扁平 ovn-internal 无关） */
export const TOWER_IO_VPC_ANNOTATION = 'tower.io/vpc';

/** ovn-internal 静态路由 policyDst 的 cidr：优先注解可访问范围，否则兼容旧数据用子网 spec.cidrBlock */
export function ovnInternalRouteCidrFromSubnet(
  subnet:
    | {
        metadata?: { annotations?: Record<string, unknown> };
        spec?: { cidrBlock?: string; cidr?: string };
      }
    | null
    | undefined,
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
    const t = String(eip?.spec?.type ?? eip?.type ?? '')
      .trim()
      .toLowerCase();
    return t !== 'lrp';
  });
}

export function isPublicSubnetOnOvnCluster(
  subnet: {
    metadata?: { annotations?: Record<string, string> };
    spec?: { vpc?: string };
  } | null,
): boolean {
  const st = String(subnet?.metadata?.annotations?.['tower.io/subnet-type'] ?? '')
    .trim()
    .toLowerCase();
  const vpc = String(subnet?.spec?.vpc ?? '').trim();
  return st === 'public' && vpc === KUBE_OVN_PUBLIC_VPC;
}

/** 是否仍存在「纯扁平」underlay EIP（无业务 tower.io/vpc 或仅为内置域）且 externalSubnet 指向 ovn-cluster 上 tower 公共子网（用于 ovn-internal enableExternal） */
export async function hasAnyUnderlayEipReferencingPublicOvnSubnet(
  harvesterParams: HarvesterTestParams,
  eips: any[],
): Promise<boolean> {
  const items = Array.isArray(eips) ? eips : [];
  const { endpoint, token, insecure = false } = harvesterParams;
  const origin = originFromEndpoint(endpoint || '');
  const subnetCache = new Map<string, boolean>();
  for (const eip of items) {
    const t = String(eip?.spec?.type ?? eip?.type ?? '')
      .trim()
      .toLowerCase();
    if (t === 'lrp') continue;
    const ann = (eip?.metadata?.annotations ?? {}) as Record<string, unknown>;
    const scope = String(ann[TOWER_IO_OVN_NETWORK_SCOPE_ANNOTATION] ?? '')
      .trim()
      .toLowerCase();
    if (scope !== 'underlay') continue;
    const vpcAnnFlat = String(ann[TOWER_IO_VPC_ANNOTATION] ?? '').trim();
    if (vpcAnnFlat && !isUnderlayVpcName(vpcAnnFlat)) continue;
    const sn = String(eip?.spec?.externalSubnet ?? '').trim();
    if (!sn || sn === 'external') continue;
    let pub = subnetCache.get(sn);
    if (pub === undefined) {
      const subUrl = `${origin}/apis/kubeovn.io/v1/subnets/${encodeURIComponent(sn)}`;
      let subnet: any = null;
      try {
        subnet = await getJsonOnce(subUrl, token, insecure);
      } catch {
        subnet = null;
      }
      pub = !!(subnet && isPublicSubnetOnOvnCluster(subnet));
      subnetCache.set(sn, pub);
    }
    if (pub) return true;
  }
  return false;
}

/** 指定业务 VPC 上是否仍存在 VPC 域（注解）、非 lrp、且挂载外网子网的 EIP（用于该 VPC.spec.enableExternal） */
export function hasAnyVpcScopedEipWithExternalSubnet(eips: any[], vpcName: string): boolean {
  const vpc = String(vpcName || '').trim();
  if (!vpc) return false;
  for (const eip of Array.isArray(eips) ? eips : []) {
    const t = String(eip?.spec?.type ?? eip?.type ?? '')
      .trim()
      .toLowerCase();
    if (t === 'lrp') continue;
    const ann = (eip?.metadata?.annotations ?? {}) as Record<string, unknown>;
    if (
      String(ann[TOWER_IO_OVN_NETWORK_SCOPE_ANNOTATION] ?? '')
        .trim()
        .toLowerCase() !== 'vpc'
    )
      continue;
    if (String(ann[TOWER_IO_VPC_ANNOTATION] ?? '').trim() !== vpc) continue;
    const sn = String(eip?.spec?.externalSubnet ?? '').trim();
    if (!sn || sn === 'external') continue;
    return true;
  }
  return false;
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
  /** 传入时与 extraExternalSubnets/staticRoutes 一并写入 ovn-internal VPC spec */
  setEnableExternal?: boolean;
}): Promise<void> {
  const {
    harvesterParams,
    subnetName,
    gateway,
    routeCidr,
    prevGateway,
    prevRouteCidr,
    setEnableExternal,
  } = params;
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
    ...(typeof setEnableExternal === 'boolean' ? { enableExternal: setEnableExternal } : {}),
  });
}

/**
 * 对指定 VPC：确保 extraExternalSubnets 含外部子网名，
 * 并维护一条 policyDst 静态路由（cidr + nextHopIP=公共子网网关）。
 * 与 ovn-internal 侧 upsertOvnInternalForPublicSubnet 合并规则一致。
 */
export async function upsertVpcPolicyDstRouteForExternalSubnet(params: {
  harvesterParams: HarvesterTestParams;
  vpcName: string;
  externalSubnetName: string;
  gateway: string;
  routeCidr: string;
  /** 传入时与 extraExternalSubnets/staticRoutes 一并写入该业务 VPC spec（如首条 VPC 域 EIP 时 true） */
  setEnableExternal?: boolean;
}): Promise<void> {
  const { harvesterParams, vpcName, externalSubnetName, gateway, routeCidr, setEnableExternal } =
    params;
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

  const extra: string[] = Array.isArray(vpc.spec.extraExternalSubnets)
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
    ...(typeof setEnableExternal === 'boolean' ? { enableExternal: setEnableExternal } : {}),
  });
}

/**
 * 业务 VPC（用户创建 EIP 时选择的 vpc，非 ovn-internal）：删除「该 VPC + 该 externalSubnet」最后一条 EIP 时调用。
 * - 从 extraExternalSubnets 去掉该子网名；按子网网关移除本次 EIP 场景写入的 policyDst 路由。
 * - 若 setEnableExternal === false：该 VPC 已无其它 VPC 域外网 EIP，置 enableExternal=false、extraExternalSubnets=[]、并清除全部 policyDst 静态路由（与彻底关闭外网联动一致）。
 */
export async function removeVpcExternalSubnetRegistration(params: {
  harvesterParams: HarvesterTestParams;
  vpcName: string;
  externalSubnetName: string;
  subnetGateway: string;
  setEnableExternal?: boolean;
}): Promise<void> {
  const { harvesterParams, vpcName, externalSubnetName, subnetGateway, setEnableExternal } = params;
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

  const sub = String(externalSubnetName || '').trim();
  let extra: string[] = Array.isArray(vpc.spec.extraExternalSubnets)
    ? vpc.spec.extraExternalSubnets.filter((x: string) => x !== sub)
    : [];

  let routes: any[] = Array.isArray(vpc.spec.staticRoutes) ? [...vpc.spec.staticRoutes] : [];
  const gw = String(subnetGateway || '').trim();
  if (gw) {
    routes = routes.filter((r: any) => {
      const t = routeTriple(r);
      return !(t.policy === POLICY_DST && t.nextHopIP === gw);
    });
  }

  if (typeof setEnableExternal === 'boolean' && setEnableExternal === false) {
    extra = [];
    routes = routes.filter((r: any) => routeTriple(r).policy !== POLICY_DST);
  }

  await updateKubeOvnVpc(harvesterParams, vpcName, {
    extraExternalSubnets: extra,
    staticRoutes: routes,
    ...(typeof setEnableExternal === 'boolean' ? { enableExternal: setEnableExternal } : {}),
  });
}

export async function removeOvnInternalForPublicSubnet(params: {
  harvesterParams: HarvesterTestParams;
  subnetName: string;
  gateway: string;
  routeCidr: string;
  setEnableExternal?: boolean;
}): Promise<void> {
  const { harvesterParams, subnetName, gateway, routeCidr, setEnableExternal } = params;
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
      ...(typeof setEnableExternal === 'boolean' ? { enableExternal: setEnableExternal } : {}),
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
    ...(typeof setEnableExternal === 'boolean' ? { enableExternal: setEnableExternal } : {}),
  });
}
