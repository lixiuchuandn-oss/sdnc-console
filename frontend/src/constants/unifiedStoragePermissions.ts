/**
 * 统一存储（Rook / RGW）权限基：与 backend/src/constants/permissions.ts 对齐。
 * 权限 ID 不含 ceph；历史 clouds.ceph:* 由 accessMapping / checker 兼容。
 */

export const CLOUD_UNIFIED_STORAGE_READ = 'clouds.unified-storage:read';
export const CLOUD_UNIFIED_STORAGE_WRITE = 'clouds.unified-storage:write';

/** @deprecated 仅兼容存量角色；新授权请用 CLOUD_UNIFIED_STORAGE_* 或下列子域 */
export const LEGACY_CLOUD_CEPH_READ = 'clouds.ceph:read';
export const LEGACY_CLOUD_CEPH_WRITE = 'clouds.ceph:write';

export const CLOUD_STORAGE_DASHBOARD_READ = 'clouds.storage-dashboard:read';
export const CLOUD_STORAGE_DASHBOARD_WRITE = 'clouds.storage-dashboard:write';
export const CLOUD_STORAGE_ADDON_READ = 'clouds.storage-addon:read';
export const CLOUD_STORAGE_ADDON_WRITE = 'clouds.storage-addon:write';

/** Cloudmap 集群 · 存储配置页（概览 / Addon / RBD Mirror 扁平 Tab）唯一读入口 */
export const CLOUD_STORAGE_CONFIG_PAGE_READ = CLOUD_STORAGE_ADDON_READ;
export const CLOUD_STORAGE_CONFIG_PAGE_WRITE = CLOUD_STORAGE_ADDON_WRITE;
export const CLOUD_STORAGE_RBD_MIRROR_READ = 'clouds.storage-rbd-mirror:read';
export const CLOUD_STORAGE_RBD_MIRROR_WRITE = 'clouds.storage-rbd-mirror:write';
export const CLOUD_STORAGE_S3_BUCKETS_READ = 'clouds.storage-s3-buckets:read';
export const CLOUD_STORAGE_S3_BUCKETS_WRITE = 'clouds.storage-s3-buckets:write';
export const CLOUD_STORAGE_RGW_USERS_READ = 'clouds.storage-rgw-users:read';
export const CLOUD_STORAGE_RGW_USERS_WRITE = 'clouds.storage-rgw-users:write';
export const CLOUD_STORAGE_OBJECT_GATEWAY_READ = 'clouds.storage-object-gateway:read';
export const CLOUD_STORAGE_OBJECT_GATEWAY_WRITE = 'clouds.storage-object-gateway:write';
export const CLOUD_STORAGE_COSI_READ = 'clouds.storage-cosi:read';
export const CLOUD_STORAGE_COSI_WRITE = 'clouds.storage-cosi:write';

/** @deprecated 已并入 clouds.storage-addon；checker / accessMapping 仍兼容存量角色 */
export const LEGACY_CLOUD_STORAGE_DRS_READ = 'clouds.storage-drs:read';
/** @deprecated 已并入 clouds.storage-addon */
export const LEGACY_CLOUD_STORAGE_DRS_WRITE = 'clouds.storage-drs:write';
/** @deprecated 已并入 clouds.storage-addon */
export const LEGACY_CLOUD_UNIFIED_STORAGE_POOLS_READ = 'clouds.unified-storage-pools:read';
/** @deprecated 已并入 clouds.storage-addon */
export const LEGACY_CLOUD_UNIFIED_STORAGE_POOLS_WRITE = 'clouds.unified-storage-pools:write';

/** 子域 read 的权限基（不含 :read），用于兼容层判定 */
export const UNIFIED_STORAGE_READ_BASES: readonly string[] = [
  'clouds.unified-storage',
  'clouds.storage-dashboard',
  'clouds.storage-addon',
  'clouds.storage-rbd-mirror',
  'clouds.storage-s3-buckets',
  'clouds.storage-rgw-users',
  'clouds.storage-object-gateway',
  'clouds.storage-cosi',
] as const;

export function isUnifiedStorageReadBase(base: string): boolean {
  return (UNIFIED_STORAGE_READ_BASES as readonly string[]).includes(base);
}

/** 存储配置 Hub（含历史 overview / rbd_mirror pathSeg）是否可读 */
export function canReadStorageConfigPage(checkPerm: (action: string) => boolean): boolean {
  if (checkPerm(CLOUD_STORAGE_CONFIG_PAGE_READ)) return true;
  if (checkPerm(CLOUD_STORAGE_CONFIG_PAGE_WRITE)) return true;
  if (checkPerm(CLOUD_UNIFIED_STORAGE_READ) || checkPerm(CLOUD_UNIFIED_STORAGE_WRITE)) return true;
  if (checkPerm(LEGACY_CLOUD_CEPH_READ) || checkPerm(LEGACY_CLOUD_CEPH_WRITE)) return true;
  /** 收敛前存量子域读权限仍放行本页 */
  if (checkPerm(CLOUD_STORAGE_DASHBOARD_READ)) return true;
  if (checkPerm(CLOUD_STORAGE_RBD_MIRROR_READ)) return true;
  if (checkPerm(LEGACY_CLOUD_STORAGE_DRS_READ)) return true;
  if (checkPerm(LEGACY_CLOUD_UNIFIED_STORAGE_POOLS_READ)) return true;
  return false;
}

/** 集群 · 存储服务 pathSeg → 入口 read */
export const CLUSTER_STORAGE_INNER_READ: Readonly<Record<string, string>> = {
  overview: CLOUD_STORAGE_CONFIG_PAGE_READ,
  harvester_addon: CLOUD_STORAGE_CONFIG_PAGE_READ,
  /** 历史 URL `cluster/storage_pools` 与存储配置同权 */
  storage_pools: CLOUD_STORAGE_CONFIG_PAGE_READ,
  rbd_mirror: CLOUD_STORAGE_CONFIG_PAGE_READ,
  rgw_s3_buckets: CLOUD_STORAGE_S3_BUCKETS_READ,
  rgw_users: CLOUD_STORAGE_RGW_USERS_READ,
  object_gateways: CLOUD_STORAGE_OBJECT_GATEWAY_READ,
  cosi: CLOUD_STORAGE_COSI_READ,
};
