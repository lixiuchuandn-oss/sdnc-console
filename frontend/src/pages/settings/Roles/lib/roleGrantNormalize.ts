import {
  CLOUD_CONTAINERS_READ,
  CLOUD_CONTAINERS_WRITE,
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

/** 旧 /actions 未带齐容器子域时，抽屉仍展示完整容器 Tab 卡片 */
export const CONTAINER_ACTIONS_INJECT: readonly string[] = [
  CLOUD_CONTAINERS_READ,
  CLOUD_CONTAINERS_WRITE,
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

export function normalizeRoleGrantForBackendSave(
  ids: string[],
  backendSupportsSubnetSplit: boolean,
): string[] {
  if (backendSupportsSubnetSplit) return ids;
  const out = new Set(ids.filter((id) => !SUBNET_SPLIT_SET.has(id)));
  const hasAnyRead = [CLOUD_SUBNETS_VPC_READ, CLOUD_SUBNETS_FLAT_READ, CLOUD_SUBNETS_PUBLIC_READ].some(
    (id) => ids.includes(id),
  );
  const hasAnyWrite = [CLOUD_SUBNETS_VPC_WRITE, CLOUD_SUBNETS_FLAT_WRITE, CLOUD_SUBNETS_PUBLIC_WRITE].some(
    (id) => ids.includes(id),
  );
  if (hasAnyRead) out.add('clouds.subnets:read');
  if (hasAnyWrite) out.add('clouds.subnets:write');
  return Array.from(out);
}

export function expandActionAtomsForDrawer(
  actionAtoms: string[],
  backendSupportsSubnetSplit: boolean,
): string[] {
  const withFrontendSubnetSplit =
    !backendSupportsSubnetSplit &&
    (actionAtoms.includes('clouds.subnets:read') || actionAtoms.includes('clouds.subnets:write'))
      ? Array.from(new Set([...actionAtoms, ...SUBNET_SPLIT_ACTIONS]))
      : actionAtoms;
  const needsContainerInject = CONTAINER_ACTIONS_INJECT.some(
    (id) => !withFrontendSubnetSplit.includes(id),
  );
  return needsContainerInject
    ? Array.from(new Set([...withFrontendSubnetSplit, ...CONTAINER_ACTIONS_INJECT]))
    : withFrontendSubnetSplit;
}
