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
export const CLOUD_UNIFIED_STORAGE_POOLS_READ = 'clouds.unified-storage-pools:read';
export const CLOUD_UNIFIED_STORAGE_POOLS_WRITE = 'clouds.unified-storage-pools:write';
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
export const CLOUD_STORAGE_DRS_READ = 'clouds.storage-drs:read';
export const CLOUD_STORAGE_DRS_WRITE = 'clouds.storage-drs:write';

/** 子域 read 的权限基（不含 :read），用于兼容层判定 */
export const UNIFIED_STORAGE_READ_BASES: readonly string[] = [
  'clouds.unified-storage',
  'clouds.storage-dashboard',
  'clouds.storage-addon',
  'clouds.unified-storage-pools',
  'clouds.storage-drs',
  'clouds.storage-rbd-mirror',
  'clouds.storage-s3-buckets',
  'clouds.storage-rgw-users',
  'clouds.storage-object-gateway',
  'clouds.storage-cosi',
] as const;

export function isUnifiedStorageReadBase(base: string): boolean {
  return (UNIFIED_STORAGE_READ_BASES as readonly string[]).includes(base);
}

/** 集群 · 存储服务 pathSeg → 入口 read */
export const CLUSTER_STORAGE_INNER_READ: Readonly<Record<string, string>> = {
  overview: CLOUD_STORAGE_DASHBOARD_READ,
  harvester_addon: CLOUD_STORAGE_ADDON_READ,
  storage_pools: CLOUD_UNIFIED_STORAGE_POOLS_READ,
  storage_drs: CLOUD_STORAGE_DRS_READ,
  rbd_mirror: CLOUD_STORAGE_RBD_MIRROR_READ,
  rgw_s3_buckets: CLOUD_STORAGE_S3_BUCKETS_READ,
  rgw_users: CLOUD_STORAGE_RGW_USERS_READ,
  object_gateways: CLOUD_STORAGE_OBJECT_GATEWAY_READ,
  cosi: CLOUD_STORAGE_COSI_READ,
};
