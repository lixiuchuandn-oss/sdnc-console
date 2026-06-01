import { isTenantConsoleUmbrellaPermission } from './tenantConsoleUmbrellaPermissions';

/**
 * 与 backend/src/seeders/initRoles.ts 中 buildTenantRootBuiltinPermissions 保持一致。
 * 整改后端种子时请同步此处。
 */
const TENANT_ROOT_NON_CNMC_PREFIXES = [
  'tenants',
  'organizations',
  'tenant-users',
  'networks',
  'security',
  'secops',
  'system',
  'users',
] as const;

const TENANT_ROOT_CNMC_EXCLUDED_PREFIXES = [
  'clouds.dashboard',
  'clouds.resource-pools',
  'clouds.monitoring.overview',
  'clouds.dc-topology',
  'clouds.net-topology',
  'clouds.alerts',
  'clouds.alert-rules',
  'clouds.alert-policies',
  'clouds.alert-receivers',
  'clouds.alert-secrets',
  'clouds.log-targets',
  'clouds.log-receivers',
  'clouds.log-configs',
  'clouds.desktop',
  'clouds.cluster-nodes',
  'clouds.namespaces',
  'clouds.cluster-networks',
  'clouds.provider-networks',
  'clouds.subnets.public',
  'clouds.vlans',
  'clouds.nads',
  'clouds.load-balancers',
  'clouds.ip-pools',
  'clouds.storage-dashboard',
  'clouds.storage-addon',
  'clouds.unified-storage-pools',
  'clouds.storage-classes',
  'clouds.storage-rbd-mirror',
  'clouds.storage-s3-buckets',
  'clouds.storage-rgw-users',
  'clouds.storage-object-gateway',
  'clouds.storage-cosi',
  'clouds.gpus',
  'clouds.usb-devices',
  'clouds.pci-devices',
  'clouds.traffic-mirroring.flat',
  'clouds.security-groups.flat',
  'clouds.eips.flat',
  'clouds.snat.flat',
  'clouds.dnat.flat',
  'clouds.vne',
] as const;

function permissionBase(permission: string): string {
  return permission.split(':')[0];
}

function matchesExcludedPrefix(base: string, prefixes: readonly string[]): boolean {
  return prefixes.some((pfx) => base === pfx || base.startsWith(`${pfx}.`));
}

function isTenantRootBuiltinCloudPermission(permission: string): boolean {
  const base = permissionBase(permission);
  if (permission === 'clouds:read' || permission === 'clouds:write') return false;
  if (!base.startsWith('clouds.')) return false;
  if (matchesExcludedPrefix(base, TENANT_ROOT_CNMC_EXCLUDED_PREFIXES)) return false;
  if (base === 'clouds.subnets') return false;
  if (permission === 'clouds.images:write') return false;
  if (permission === 'clouds.subnets.flat:write') return false;
  if (isTenantConsoleUmbrellaPermission(permission)) return false;
  return true;
}

/** 从全量 actions 计算租户角色抽屉固定目录（与种子公式一致） */
export function buildTenantRootBuiltinCatalogFromActions(
  allPermissions: readonly string[],
): string[] {
  return allPermissions.filter((p) => {
    const base = permissionBase(p);
    if (matchesExcludedPrefix(base, TENANT_ROOT_NON_CNMC_PREFIXES)) return false;
    return isTenantRootBuiltinCloudPermission(p);
  });
}
