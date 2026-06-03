/**
 * 统一存储权限基（与前端 unifiedStoragePermissions.ts 对齐；ID 不含 ceph）。
 */

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

const LEGACY_CEPH_READ = 'clouds.ceph:read';
const LEGACY_CEPH_WRITE = 'clouds.ceph:write';
const UMBRELLA_READ = 'clouds.unified-storage:read';
const UMBRELLA_WRITE = 'clouds.unified-storage:write';

/** 存量 clouds.ceph 或 umbrella 统一存储权 */
export function hasLegacyOrUmbrellaUnifiedStorageGrant(
  permissions: string[],
  verb: 'read' | 'write',
): boolean {
  if (permissions.includes('*')) return true;
  if (verb === 'read') {
    return (
      permissions.includes(LEGACY_CEPH_READ) ||
      permissions.includes(LEGACY_CEPH_WRITE) ||
      permissions.includes(UMBRELLA_READ) ||
      permissions.includes(UMBRELLA_WRITE)
    );
  }
  return permissions.includes(LEGACY_CEPH_WRITE) || permissions.includes(UMBRELLA_WRITE);
}
