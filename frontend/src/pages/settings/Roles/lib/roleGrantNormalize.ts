import {
  CLOUD_SUBNETS_FLAT_READ,
  CLOUD_SUBNETS_FLAT_WRITE,
  CLOUD_SUBNETS_PUBLIC_READ,
  CLOUD_SUBNETS_PUBLIC_WRITE,
  CLOUD_SUBNETS_VPC_READ,
  CLOUD_SUBNETS_VPC_WRITE,
} from '../../../../constants/cloudPermissions';
import {
  ALL_CLOUD_CONTAINER_SUB_READ,
  CLOUD_CONTAINER_TAB_WRITE,
  LEGACY_CLOUD_CONTAINERS_READ,
  LEGACY_CLOUD_CONTAINERS_WRITE,
} from '../../../../utils/permissionUtils';

/** 旧后端无拆分子网 atoms 时，前端抽屉仍展示 vpc/flat/public 卡片 */
export const SUBNET_SPLIT_ACTIONS = [
  CLOUD_SUBNETS_VPC_READ,
  CLOUD_SUBNETS_VPC_WRITE,
  CLOUD_SUBNETS_FLAT_READ,
  CLOUD_SUBNETS_FLAT_WRITE,
  CLOUD_SUBNETS_PUBLIC_READ,
  CLOUD_SUBNETS_PUBLIC_WRITE,
] as const;

export const SUBNET_SPLIT_SET = new Set<string>(SUBNET_SPLIT_ACTIONS);

export const SUBNET_SPLIT_RESOURCE_NAME: Record<string, string> = {
  'clouds.subnets.vpc': 'VPC 子网',
  'clouds.subnets.flat': '扁平网络',
  'clouds.subnets.public': '公共子网',
};

/** 旧 /actions 未带齐容器子域时，抽屉仍展示完整容器 Tab 卡片（不含已移除的 clouds.containers 总权） */
export const CONTAINER_ACTIONS_INJECT: readonly string[] = [
  ...ALL_CLOUD_CONTAINER_SUB_READ,
  ...Object.values(CLOUD_CONTAINER_TAB_WRITE),
];

export function mapLegacySubnetsToSplit(ids: string[]): string[] {
  const out = new Set(ids);
  if (out.has('clouds.subnets:read')) {
    out.add(CLOUD_SUBNETS_VPC_READ);
    out.add(CLOUD_SUBNETS_FLAT_READ);
    out.add(CLOUD_SUBNETS_PUBLIC_READ);
  }
  if (out.has('clouds.subnets:write')) {
    out.add(CLOUD_SUBNETS_VPC_WRITE);
    out.add(CLOUD_SUBNETS_FLAT_WRITE);
    out.add(CLOUD_SUBNETS_PUBLIC_WRITE);
  }
  return Array.from(out);
}

/** 历史 clouds.containers 总权 → 各子域（抽屉展示与勾选状态） */
export function mapLegacyContainersToSubdomains(ids: string[]): string[] {
  const out = new Set(ids);
  if (out.has(LEGACY_CLOUD_CONTAINERS_READ)) {
    ALL_CLOUD_CONTAINER_SUB_READ.forEach((p) => out.add(p));
    out.delete(LEGACY_CLOUD_CONTAINERS_READ);
  }
  if (out.has(LEGACY_CLOUD_CONTAINERS_WRITE)) {
    Object.values(CLOUD_CONTAINER_TAB_WRITE).forEach((p) => out.add(p));
    out.delete(LEGACY_CLOUD_CONTAINERS_WRITE);
  }
  return Array.from(out);
}

/** 打开/保存角色授权时的权限 ID 规范化 */
export function normalizeRoleGrantIds(ids: string[]): string[] {
  return mapLegacyContainersToSubdomains(mapLegacySubnetsToSplit(ids));
}

export function normalizeRoleGrantForBackendSave(
  ids: string[],
  backendSupportsSubnetSplit: boolean,
): string[] {
  const expanded = mapLegacyContainersToSubdomains(ids);
  if (backendSupportsSubnetSplit) return expanded;
  const out = new Set(expanded.filter((id) => !SUBNET_SPLIT_SET.has(id)));
  const hasAnyRead = [CLOUD_SUBNETS_VPC_READ, CLOUD_SUBNETS_FLAT_READ, CLOUD_SUBNETS_PUBLIC_READ].some(
    (id) => expanded.includes(id),
  );
  const hasAnyWrite = [CLOUD_SUBNETS_VPC_WRITE, CLOUD_SUBNETS_FLAT_WRITE, CLOUD_SUBNETS_PUBLIC_WRITE].some(
    (id) => expanded.includes(id),
  );
  if (hasAnyRead) out.add('clouds.subnets:read');
  if (hasAnyWrite) out.add('clouds.subnets:write');
  return Array.from(out);
}

export function expandActionAtomsForDrawer(
  actionAtoms: string[],
  backendSupportsSubnetSplit: boolean,
): string[] {
  const withContainers = mapLegacyContainersToSubdomains(actionAtoms);
  const withFrontendSubnetSplit =
    !backendSupportsSubnetSplit &&
    (withContainers.includes('clouds.subnets:read') || withContainers.includes('clouds.subnets:write'))
      ? Array.from(new Set([...withContainers, ...SUBNET_SPLIT_ACTIONS]))
      : withContainers;
  const needsContainerInject = CONTAINER_ACTIONS_INJECT.some(
    (id) => !withFrontendSubnetSplit.includes(id),
  );
  return needsContainerInject
    ? Array.from(new Set([...withFrontendSubnetSplit, ...CONTAINER_ACTIONS_INJECT]))
    : withFrontendSubnetSplit;
}
