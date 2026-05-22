/**
 * 租户云控制台（/console）页面读权限：与 Cloudmap 池内 `poolPageAction` 对齐。
 * 规范见 deployment/docs/specs/cloudmap-pool-page-rbac.md
 */
import { checkPoolPageReadPerm, getPoolPageReadAction } from '../../clouds/Cloudmap/pool/lib/poolPageReadAccess';

export type TenantConsoleLeftNavKey = 'host' | 'container' | 'flat' | 'vpc' | 'rds';

/** 主面板资源 key → cloudmapPoolNavRows.pathSuffix */
export const TENANT_CONSOLE_MAIN_RESOURCE_PATH: Record<string, string> = {
  vm: 'compute/ecs',
  'recycle-bin': 'compute/recycle_bin',
  template: 'compute/templates',
  image: 'compute/images',
  ssh: 'compute/ssh_keys',
  volume: 'storage/volumes',
  'volume-snapshot': 'storage/snapshots',
  snapshot: 'backups/vm_snapshots',
  backup: 'backups/backups',
  schedule: 'backups/schedule_vm_backups',
  'flat-subnet': 'flat_network/flat_public_subnets',
  /** 控制台「VPC · 网络」合并 VPC/子网视图，读权限对齐池内 VPC 或 VPC 子网任一侧栏叶 */
  'vpc-subnet': 'kube_ovn/vpcs',
  eip: 'kube_ovn/kubeovn_eips',
  snat: 'kube_ovn/kubeovn_snat',
  dnat: 'kube_ovn/kubeovn_dnat',
};

/** VPC 子网独立叶（与 vpc-subnet 合并视图互补） */
const VPC_SUBNET_PATH_SUFFIX = 'kube_ovn/subnets';

/** 容器控制台资源 key → pathSuffix */
export const TENANT_CONSOLE_CONTAINER_RESOURCE_PATH: Record<string, string> = {
  'ctr-workloads': 'containers/workloads',
  'ctr-pods': 'containers/pods',
  'ctr-jobs': 'containers/jobs',
  'ctr-services': 'containers/services',
  'ctr-ingresses': 'containers/ingresses',
  'ctr-gateway': 'containers/gateway_api',
  'ctr-configs': 'containers/configs',
  'ctr-registries': 'containers/registries',
  'ctr-pdbs': 'containers/pdbs',
  'ctr-netpol': 'containers/networkpolicies',
};

const HOST_MAIN_RESOURCES = [
  'vm',
  'recycle-bin',
  'template',
  'image',
  'ssh',
  'volume',
  'volume-snapshot',
  'snapshot',
  'backup',
  'schedule',
] as const;

const VPC_MAIN_RESOURCES = ['vpc-subnet', 'eip', 'snat', 'dnat'] as const;

/** 拉取云主机列表（ECS）所依赖的控制台资源 */
export const TENANT_CONSOLE_RESOURCES_NEEDING_ECS = new Set<string>([
  'vm',
  'recycle-bin',
  'volume',
  'snapshot',
  'backup',
  'schedule',
]);

function canAccessByPathSuffix(permissions: string[], pathSuffix: string): boolean {
  const act = getPoolPageReadAction(pathSuffix);
  if (!act) return true;
  return checkPoolPageReadPerm(permissions, act);
}

export function canAccessTenantConsoleMainResource(
  permissions: string[],
  resourceKey: string,
): boolean {
  const suffix = TENANT_CONSOLE_MAIN_RESOURCE_PATH[resourceKey];
  if (!suffix) return false;
  if (resourceKey === 'vpc-subnet') {
    return (
      canAccessByPathSuffix(permissions, suffix) ||
      canAccessByPathSuffix(permissions, VPC_SUBNET_PATH_SUFFIX)
    );
  }
  return canAccessByPathSuffix(permissions, suffix);
}

export function canAccessTenantConsoleContainerResource(
  permissions: string[],
  resourceKey: string,
): boolean {
  const suffix = TENANT_CONSOLE_CONTAINER_RESOURCE_PATH[resourceKey];
  if (!suffix) return false;
  return canAccessByPathSuffix(permissions, suffix);
}

export function firstAccessibleTenantConsoleMainResource(
  permissions: string[],
  resourceKeys: readonly string[],
): string | null {
  for (const k of resourceKeys) {
    if (canAccessTenantConsoleMainResource(permissions, k)) return k;
  }
  return null;
}

export function firstAccessibleTenantConsoleMainResourceForScope(
  permissions: string[],
  scope: 'host' | 'flat' | 'vpc',
): string | null {
  if (scope === 'host') return firstAccessibleTenantConsoleMainResource(permissions, HOST_MAIN_RESOURCES);
  if (scope === 'flat') return firstAccessibleTenantConsoleMainResource(permissions, ['flat-subnet']);
  return firstAccessibleTenantConsoleMainResource(permissions, VPC_MAIN_RESOURCES);
}

export function firstAccessibleTenantConsoleContainerResource(
  permissions: string[],
): string | null {
  for (const k of Object.keys(TENANT_CONSOLE_CONTAINER_RESOURCE_PATH)) {
    if (canAccessTenantConsoleContainerResource(permissions, k)) return k;
  }
  return null;
}

export function canAccessTenantConsoleHostNav(permissions: string[]): boolean {
  return HOST_MAIN_RESOURCES.some((k) => canAccessTenantConsoleMainResource(permissions, k));
}

export function canAccessTenantConsoleFlatNav(permissions: string[]): boolean {
  return canAccessTenantConsoleMainResource(permissions, 'flat-subnet');
}

export function canAccessTenantConsoleVpcNav(
  permissions: string[],
  ovnVpcEnabled: boolean,
): boolean {
  if (!ovnVpcEnabled) return false;
  return VPC_MAIN_RESOURCES.some((k) => canAccessTenantConsoleMainResource(permissions, k));
}

export function canAccessTenantConsoleContainerNav(permissions: string[]): boolean {
  return Object.keys(TENANT_CONSOLE_CONTAINER_RESOURCE_PATH).some((k) =>
    canAccessTenantConsoleContainerResource(permissions, k),
  );
}

export function canAccessTenantConsoleDatabaseNav(permissions: string[]): boolean {
  return canAccessByPathSuffix(permissions, 'paas_databases/rds');
}

export function canAccessTenantConsoleLeftNav(
  permissions: string[],
  navKey: TenantConsoleLeftNavKey,
  ovnVpcEnabled: boolean,
): boolean {
  switch (navKey) {
    case 'host':
      return canAccessTenantConsoleHostNav(permissions);
    case 'container':
      return canAccessTenantConsoleContainerNav(permissions);
    case 'flat':
      return canAccessTenantConsoleFlatNav(permissions);
    case 'vpc':
      return canAccessTenantConsoleVpcNav(permissions, ovnVpcEnabled);
    case 'rds':
      return canAccessTenantConsoleDatabaseNav(permissions);
    default:
      return false;
  }
}

const LEFT_NAV_ORDER: TenantConsoleLeftNavKey[] = ['host', 'container', 'flat', 'vpc', 'rds'];

export function firstAccessibleTenantConsoleLeftNav(
  permissions: string[],
  ovnVpcEnabled: boolean,
): TenantConsoleLeftNavKey | null {
  for (const key of LEFT_NAV_ORDER) {
    if (canAccessTenantConsoleLeftNav(permissions, key, ovnVpcEnabled)) return key;
  }
  return null;
}
