/**
 * 集群 · 计算配置（节点 / 故障域 / DRS / 迁移）权限基。
 */

export const CLOUD_COMPUTE_CLUSTER_READ = 'clouds.compute-cluster:read';
export const CLOUD_COMPUTE_CLUSTER_WRITE = 'clouds.compute-cluster:write';

/** @deprecated 已并入 clouds.compute-cluster；checker / accessMapping 仍兼容存量角色 */
export const LEGACY_CLOUD_CLUSTER_NODES_READ = 'clouds.cluster-nodes:read';
export const LEGACY_CLOUD_CLUSTER_NODES_WRITE = 'clouds.cluster-nodes:write';
export const LEGACY_CLOUD_FAILURE_DOMAINS_READ = 'clouds.failure-domains:read';
export const LEGACY_CLOUD_FAILURE_DOMAINS_WRITE = 'clouds.failure-domains:write';
export const LEGACY_CLOUD_DRS_READ = 'clouds.drs:read';
export const LEGACY_CLOUD_DRS_WRITE = 'clouds.drs:write';

const LEGACY_COMPUTE_CLUSTER_READ = [
  LEGACY_CLOUD_CLUSTER_NODES_READ,
  LEGACY_CLOUD_FAILURE_DOMAINS_READ,
  LEGACY_CLOUD_DRS_READ,
  'clouds.migrations:read',
] as const;

const LEGACY_COMPUTE_CLUSTER_WRITE = [
  LEGACY_CLOUD_CLUSTER_NODES_WRITE,
  LEGACY_CLOUD_FAILURE_DOMAINS_WRITE,
  LEGACY_CLOUD_DRS_WRITE,
  'clouds.migrations:write',
] as const;

export function canReadComputeCluster(checkPerm: (act: string) => boolean): boolean {
  if (checkPerm(CLOUD_COMPUTE_CLUSTER_READ)) return true;
  return LEGACY_COMPUTE_CLUSTER_READ.some((act) => checkPerm(act));
}

export function canWriteComputeCluster(checkPerm: (act: string) => boolean): boolean {
  if (checkPerm(CLOUD_COMPUTE_CLUSTER_WRITE)) return true;
  return LEGACY_COMPUTE_CLUSTER_WRITE.some((act) => checkPerm(act));
}

export function canWriteClusterNodes(checkPerm: (act: string) => boolean): boolean {
  return canWriteComputeCluster(checkPerm) || checkPerm(LEGACY_CLOUD_CLUSTER_NODES_WRITE);
}

export function canWriteFailureDomains(checkPerm: (act: string) => boolean): boolean {
  return canWriteComputeCluster(checkPerm) || checkPerm(LEGACY_CLOUD_FAILURE_DOMAINS_WRITE);
}

export function canWriteDrs(checkPerm: (act: string) => boolean): boolean {
  return canWriteComputeCluster(checkPerm) || checkPerm(LEGACY_CLOUD_DRS_WRITE);
}

export function canReadFailureDomainsTab(checkPerm: (act: string) => boolean): boolean {
  return (
    canReadComputeCluster(checkPerm) ||
    checkPerm(LEGACY_CLOUD_FAILURE_DOMAINS_READ) ||
    checkPerm(LEGACY_CLOUD_CLUSTER_NODES_READ)
  );
}

export function canReadDrsTab(checkPerm: (act: string) => boolean): boolean {
  return canReadComputeCluster(checkPerm) || checkPerm(LEGACY_CLOUD_DRS_READ);
}

export function canReadMigrationsTab(checkPerm: (act: string) => boolean): boolean {
  return (
    canReadComputeCluster(checkPerm) ||
    checkPerm('clouds.migrations:read') ||
    checkPerm(LEGACY_CLOUD_DRS_READ) ||
    checkPerm('clouds.ecs:read')
  );
}

export function canWriteMigrationsTab(checkPerm: (act: string) => boolean): boolean {
  return (
    canWriteComputeCluster(checkPerm) ||
    checkPerm('clouds.migrations:write') ||
    checkPerm('clouds.ecs:write')
  );
}

export function computeClusterLegacyReadGranted(perms: string[]): boolean {
  return LEGACY_COMPUTE_CLUSTER_READ.some((act) => perms.includes(act));
}

export function computeClusterLegacyWriteGranted(perms: string[]): boolean {
  return LEGACY_COMPUTE_CLUSTER_WRITE.some((act) => perms.includes(act));
}
