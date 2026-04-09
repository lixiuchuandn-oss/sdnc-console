/**
 * =============================================================================
 * 模块名称: Kube-OVN 命名、分域与集群保留名
 * 文件路径: backend/src/services/clouds/harvester/kubeOvnNetworkScope.ts
 * =============================================================================
 *
 * [职责]
 * 1. 内置 VPC 常量、FIP/DNAT/SNAT 语义上的 underlay / vpc 分域（纯函数）。
 * 2. 集群内置或控制台保留的 Kube-OVN CR 名（Subnet、Vlan 等），供列表过滤与 API 校验。
 * 3. Tower 写在 OVN 相关 CR 上的 **注解键**、**命名空间列表格式化**，以及从集群 **GET Vpc/Subnet** 拉取
 *    `spec.namespaces` 供创建 EIP/FIP/NAT/子网 时写入 `tower.io/namespaces`（与 `network.ts`、
 *    `ovn-direct-*.handlers` 配合；前端常量见 `kubeOvnSubnetConstants.ts`）。
 *
 * [Tower 注解与 OvnNetworkScope 对齐]
 * - `tower.io/ovn-network-scope`：**扁平/VPC 分列表的唯一依据**（读各 CR 自身 metadata.annotations，不用 spec 推断）。
 *   取值：`underlay` | `vpc`。无注解视为 unknown；**扁平 API**（underlay）仍展示 unknown；**VPC API** 仅展示注解为 vpc 的项（见 `filterItemsByOvnNetworkScopeForApi`）。
 * - `tower.io/namespaces`：逗号分隔、排序后的业务命名空间列表（与 Vpc/Subnet spec 语义一致）。
 *
 * [仅创建 API 校验]
 * - `inferOvnScopeFromSnatSubnetRef`：按子网库存校验「请求里的 vpcSubnet 属于哪一域」，只用于 SNAT 创建路径与 body 校验，**不**作为列表分域依据。
 *
 * [与兄弟模块区分]
 * - `utils.ts`：Harvester/K8s HTTP 通用请求与 Watch；本文件仅 import 其 `getJsonOnce` 做只读 GET。
 * - `network.ts`：子网/NAD/VPC 等高层 CRUD 封装，消费本文件的常量与格式化函数。
 *
 * 历史 VPC 名 `ovn-vpc-external-network` 已废弃，不在此维护。
 * =============================================================================
 */

import { getJsonOnce } from './utils';

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

/** 与 {@link OvnNetworkScope} 一致，便于在 YAML 中区分扁平域 / 业务 VPC 域（对齐子网 tower.io/subnet-type 产品二分） */
export const TOWER_IO_OVN_NETWORK_SCOPE_ANNOTATION = 'tower.io/ovn-network-scope';

/** 业务命名空间列表镜像（逗号分隔、排序），与 spec.namespaces 同语义 */
export const TOWER_IO_NAMESPACES_ANNOTATION = 'tower.io/namespaces';

/** 子网引用可能是 name 或 ns/name，取 CR 名段 */
function subnetCrNameFromRef(ref: string | undefined | null): string {
  const s = String(ref ?? '').trim();
  if (!s) return '';
  const parts = s.split('/');
  return parts[parts.length - 1] || s;
}

/**
 * 规范为逗号分隔、去重、字典序，便于展示与字符串比较。
 */
export function formatTowerNamespacesAnnotation(
  input: string | string[] | Iterable<string> | null | undefined,
): string {
  const set = new Set<string>();
  if (input == null) return '';
  if (typeof input === 'string') {
    input.split(',').forEach((s) => {
      const t = s.trim();
      if (t) set.add(t);
    });
  } else {
    for (const x of input) {
      const t = String(x ?? '').trim();
      if (t) set.add(t);
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b)).join(',');
}

/** 从 Vpc CR JSON（GET 响应）解析 spec.namespaces */
export function listNamespacesFromVpcObject(vpcObj: unknown): string[] {
  if (vpcObj == null || typeof vpcObj !== 'object') return [];
  const o = vpcObj as { spec?: { namespaces?: unknown }; namespaces?: unknown };
  const raw = o.spec?.namespaces ?? o.namespaces;
  if (!Array.isArray(raw)) return [];
  return raw.map((x: unknown) => String(x).trim()).filter(Boolean);
}

export async function getNamespacesFromKubeOvnVpc(
  apiBase: string,
  vpcName: string,
  token: string,
  insecure: boolean,
): Promise<string[]> {
  const v = String(vpcName ?? '').trim();
  if (!v) return [];
  try {
    const url = `${apiBase}/apis/kubeovn.io/v1/vpcs/${encodeURIComponent(v)}`;
    const vpc = await getJsonOnce(url, token, insecure);
    return listNamespacesFromVpcObject(vpc);
  } catch {
    return [];
  }
}

export async function getNamespacesFromKubeOvnSubnet(
  apiBase: string,
  subnetRef: string,
  token: string,
  insecure: boolean,
): Promise<string[]> {
  const name = subnetCrNameFromRef(subnetRef);
  if (!name) return [];
  try {
    const url = `${apiBase}/apis/kubeovn.io/v1/subnets/${encodeURIComponent(name)}`;
    const sn = await getJsonOnce(url, token, insecure);
    const raw = sn?.spec?.namespaces;
    if (!Array.isArray(raw)) return [];
    return raw.map((x: unknown) => String(x).trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function normalizeVpcName(v: string | undefined | null): string {
  const s = String(v ?? '').trim();
  return s || KUBE_OVN_PUBLIC_VPC;
}

/** 是否为 FIP/DNAT/SNAT 规则语义上的「扁平域」VPC（含历史 ovn-cluster 扁平） */
export function isUnderlayVpcName(vpc: string | undefined | null): boolean {
  const n = normalizeVpcName(vpc);
  return n === KUBE_OVN_FLAT_VPC || n === KUBE_OVN_PUBLIC_VPC;
}

/**
 * 仅从 metadata.annotations[`tower.io/ovn-network-scope`] 解析分域。
 * 无注解或非法值返回 null（不做 spec 推断）。
 */
export function ovnNetworkScopeFromAnnotations(raw: any): OvnNetworkScope | null {
  const v = String(
    raw?.metadata?.annotations?.[TOWER_IO_OVN_NETWORK_SCOPE_ANNOTATION] ?? '',
  )
    .trim()
    .toLowerCase();
  if (v === 'underlay' || v === 'vpc') return v;
  return null;
}

/**
 * FIP/DNAT 列表分域：**仅认注解** `tower.io/ovn-network-scope`；无注解为 `unknown`。
 */
export function classifyFipOrDnat(raw: any): OvnNetworkScope | 'unknown' {
  return ovnNetworkScopeFromAnnotations(raw) ?? 'unknown';
}

/**
 * SNAT 列表分域：**仅认注解**；无注解为 `unknown`。第二参数保留兼容，已忽略。
 */
export function classifySnatRule(
  raw: any,
  _subnetVpcByName?: Map<string, string | undefined>,
): OvnNetworkScope | 'unknown' {
  return ovnNetworkScopeFromAnnotations(raw) ?? 'unknown';
}

/** SNAT spec 里子网引用可能是 name 或 ns/name */
export function subnetRefToName(ref: string | undefined | null): string | null {
  if (ref == null || ref === '') return null;
  const s = String(ref).trim();
  const parts = s.split('/');
  return parts[parts.length - 1] || null;
}

/**
 * 仅用于 SNAT **创建**时：按子网库存解析 vpcSubnet 所属域，校验请求与路由 scope 是否一致（不作为列表分域依据）。
 */
export function inferOvnScopeFromSnatSubnetRef(
  raw: any,
  subnetVpcByName: Map<string, string | undefined>,
): OvnNetworkScope | 'unknown' {
  const key =
    raw?.spec?.vpcSubnet ?? raw?.spec?.subnet ?? raw?.spec?.subnetName;
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

/**
 * 内部：按注解分域；无注解视为与任一侧兼容（unknown），用于 **underlay** 列表。
 */
function filterItemsByOvnNetworkScopeAnnotation(
  items: any[],
  scope: OvnNetworkScope,
): any[] {
  return items.filter((item) => {
    const ann = ovnNetworkScopeFromAnnotations(item);
    if (ann === null) return true;
    return ann === scope;
  });
}

/**
 * GET `.../resources/subnets|vpcs|ovn*` 列表：按 `tower.io/ovn-network-scope` 筛行（`all` 不筛）。
 * - `vpc`：仅保留注解值为 `vpc` 的 CR（无注解、underlay 均排除）。
 * - `underlay`：保留 `underlay` 与 **无注解**（unknown 归入扁平侧展示）。
 */
export function filterItemsByOvnNetworkScopeForApi(
  items: any[],
  scope: OvnNetworkScope,
): any[] {
  if (scope === 'vpc') {
    return items.filter((item) => ovnNetworkScopeFromAnnotations(item) === 'vpc');
  }
  return filterItemsByOvnNetworkScopeAnnotation(items, 'underlay');
}

/** GET 列表必填：`ovnNetworkScope=vpc|underlay|all`（见 deployment/docs/specs/api/Harvester-OVN-网络接口分域规范.md） */
export type OvnNetworkScopeListQuery = 'vpc' | 'underlay' | 'all';

export function parseRequiredOvnNetworkScopeListQuery(req: {
  query?: Record<string, unknown>;
}):
  | { ok: true; scope: OvnNetworkScopeListQuery }
  | { ok: false; status: number; message: string } {
  const raw = String(req.query?.ovnNetworkScope ?? '').trim().toLowerCase();
  if (!raw) {
    return {
      ok: false,
      status: 400,
      message: '缺少必填查询参数 ovnNetworkScope，允许值：vpc、underlay、all',
    };
  }
  if (raw === 'vpc' || raw === 'underlay' || raw === 'all') {
    return { ok: true, scope: raw };
  }
  return {
    ok: false,
    status: 400,
    message: 'ovnNetworkScope 无效，允许值：vpc、underlay、all',
  };
}

/** POST 创建 OVN EIP/FIP/NAT 等：必填 `ovnNetworkScope=vpc|underlay` */
export function parseRequiredOvnNetworkScopeCreateQuery(req: {
  query?: Record<string, unknown>;
}):
  | { ok: true; scope: OvnNetworkScope }
  | { ok: false; status: number; message: string } {
  const raw = String(req.query?.ovnNetworkScope ?? '').trim().toLowerCase();
  if (!raw) {
    return {
      ok: false,
      status: 400,
      message: '缺少必填查询参数 ovnNetworkScope，允许值：vpc、underlay',
    };
  }
  if (raw === 'vpc' || raw === 'underlay') {
    return { ok: true, scope: raw };
  }
  return {
    ok: false,
    status: 400,
    message: 'ovnNetworkScope 无效，允许值：vpc、underlay',
  };
}
