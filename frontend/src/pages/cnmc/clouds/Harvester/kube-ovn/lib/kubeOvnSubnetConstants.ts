/** Kube-OVN 子网（扁平/公共/VPC）在 Tower 侧的统一注解与 finalizer */
export const TOWER_ALIAS_ANNOTATION = 'tower.io/alias';
/** 逗号分隔、排序后的业务 K8s 命名空间列表（与 Vpc/Subnet spec.namespaces 对齐，便于集群级 CR 可读） */
export const TOWER_IO_NAMESPACES_ANNOTATION = 'tower.io/namespaces';
/** 与后端 OvnNetworkScope 一致：`underlay` | `vpc`，区分扁平域与业务 VPC 域 */
export const TOWER_IO_OVN_NETWORK_SCOPE_ANNOTATION = 'tower.io/ovn-network-scope';

/** 分域识别只读 `tower.io/ovn-network-scope`，不做 spec 推断；无注解返回 null */
export function parseTowerOvnNetworkScopeFromAnnotations(
  resource: { metadata?: { annotations?: Record<string, string> } } | null | undefined,
): 'underlay' | 'vpc' | null {
  const v = String(
    resource?.metadata?.annotations?.[TOWER_IO_OVN_NETWORK_SCOPE_ANNOTATION] ?? '',
  )
    .trim()
    .toLowerCase();
  if (v === 'underlay' || v === 'vpc') return v;
  return null;
}

export const SUBNET_TYPE_ANNOTATION_KEY = 'tower.io/subnet-type';

/**
 * VPC 子网表格：仅当 `metadata.annotations['tower.io/ovn-network-scope']` 规范化后为 `vpc`。
 * 无该注解或仅为 subnet-type=vpc 的旧数据不再视为 VPC 域行（与后端列表分域一致，避免混入扁平域）。
 */
export function isVpcOvnSubnetTableRow(r: any): boolean {
  return parseTowerOvnNetworkScopeFromAnnotations(r) === 'vpc';
}

/** 扁平子网挂 VLAN（underlay）；与 `tower.io/subnet-type=flat` 并用 */
export const SUBNET_TYPE_FLAT_UNDERLAY_ANNOTATION_KEY = 'tower.io/subnet-type-flat-underlay';
/** 扁平子网不挂 VLAN（overlay）；与 `tower.io/subnet-type=flat` 并用 */
export const SUBNET_TYPE_FLAT_OVERLAY_ANNOTATION_KEY = 'tower.io/subnet-type-flat-overlay';
export const SUBNET_FINALIZER = 'tower.io/managed';

/**
 * ovn-internal VPC 静态路由 policyDst 网段（可访问范围）：不限为 0.0.0.0/0；指定时为 IPv4 CIDR。
 * 未注解的旧数据在服务端回退为 spec.cidrBlock。
 */
export const OVN_INTERNAL_ROUTE_CIDR_ANNOTATION = 'tower.io/ovn-internal-route-cidr';

/** 创建/展示用备注，写入 Subnet metadata.annotations */
export const TOWER_SUBNET_DESCRIPTION_ANNOTATION = 'tower.io/description';

/** 按是否配置 VLAN 写入 underlay / overlay 标记（二者互斥，仅应存在其一为 `true`） */
export function buildFlatUnderlayOverlayAnnotations(hasVlan: boolean): Record<string, string> {
  if (hasVlan) {
    return { [SUBNET_TYPE_FLAT_UNDERLAY_ANNOTATION_KEY]: 'true' };
  }
  return { [SUBNET_TYPE_FLAT_OVERLAY_ANNOTATION_KEY]: 'true' };
}

/** 注解值为 true / 1 视为启用 */
function annTruthy(v: string | undefined): boolean {
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'true' || s === '1';
}

export type TowerUnderlaySubnetCategory = 'public' | 'flat-underlay' | 'flat-overlay' | 'unknown';

/**
 * 仅按 metadata.annotations 解析 Underlay 列表中的子网分类（不做 spec 推断）。
 * `mode=public`：期望 tower.io/subnet-type=public；
 * `mode=flat`：期望 subnet-type=flat，且 underlay / overlay 二选一注解为真。
 */
export function resolveTowerUnderlaySubnetCategory(
  record: { metadata?: { annotations?: Record<string, string> } } | null | undefined,
  mode: 'flat' | 'public',
): { category: TowerUnderlaySubnetCategory; label: string; detail: string } {
  const ann = record?.metadata?.annotations || {};
  const st = String(ann[SUBNET_TYPE_ANNOTATION_KEY] ?? '').trim().toLowerCase();

  if (mode === 'public') {
    if (st === 'public') {
      return { category: 'public', label: '公共子网', detail: 'tower.io/subnet-type=public' };
    }
    return {
      category: 'unknown',
      label: st ? `其他（${st}）` : '未标注',
      detail: st ? `tower.io/subnet-type=${st}` : '缺少 tower.io/subnet-type',
    };
  }

  if (st !== 'flat') {
    return {
      category: 'unknown',
      label: st ? `其他（${st}）` : '未标注',
      detail: st ? `tower.io/subnet-type=${st}` : '缺少 tower.io/subnet-type',
    };
  }

  if (annTruthy(ann[SUBNET_TYPE_FLAT_UNDERLAY_ANNOTATION_KEY])) {
    return {
      category: 'flat-underlay',
      label: '扁平 underlay',
      detail: 'tower.io/subnet-type-flat-underlay=true',
    };
  }
  if (annTruthy(ann[SUBNET_TYPE_FLAT_OVERLAY_ANNOTATION_KEY])) {
    return {
      category: 'flat-overlay',
      label: '扁平 overlay',
      detail: 'tower.io/subnet-type-flat-overlay=true',
    };
  }

  return {
    category: 'unknown',
    label: '未标注',
    detail: '缺少 tower.io/subnet-type-flat-underlay 或 tower.io/subnet-type-flat-overlay',
  };
}

/** 公共子网、EIP 外网：内置 VPC */
export const KUBE_OVN_PUBLIC_VPC = 'ovn-cluster';
/** 扁平子网：内置 VPC（与公共子网分域） */
export const KUBE_OVN_FLAT_VPC = 'ovn-internal';
/** Provider 等内置 VPC（集群侧保留；UI 不展示、业务 VPC 选择器排除） */
export const KUBE_OVN_PROVIDER_VPC = 'ovn-provider';

/**
 * 集群内置 / 控制台保留的 Kube-OVN CR 名（与后端 `kubeOvnNetworkScope.ts` 对齐）。
 * 非 Harvester 其它云资源；仅 Kube-OVN 领域。
 */
export const KUBE_OVN_BUILTIN_VPC_NAMES = [
  KUBE_OVN_PUBLIC_VPC,
  KUBE_OVN_FLAT_VPC,
  KUBE_OVN_PROVIDER_VPC,
] as const;

export const KUBE_OVN_BUILTIN_SUBNET_CR_NAMES = ['external'] as const;

export const KUBE_OVN_RESERVED_VLAN_CR_NAMES = ['hci-external'] as const;

/** 子网 spec.vpc 是否为承载扁平/公共/Provider 的内置 VPC（非租户业务 VPC） */
export function isBuiltInKubeOvnVpc(vpc: string | undefined | null): boolean {
  const v = String(vpc ?? '').trim();
  return v === KUBE_OVN_PUBLIC_VPC || v === KUBE_OVN_FLAT_VPC || v === KUBE_OVN_PROVIDER_VPC;
}

/** 可作为「扁平子网」挂载的 VPC：ovn-internal 或历史 ovn-cluster 上的 flat（不含 ovn-provider） */
export function isFlatKubeOvnSubnetVpc(vpc: string | undefined | null): boolean {
  const v = String(vpc ?? '').trim();
  return v === KUBE_OVN_PUBLIC_VPC || v === KUBE_OVN_FLAT_VPC;
}
