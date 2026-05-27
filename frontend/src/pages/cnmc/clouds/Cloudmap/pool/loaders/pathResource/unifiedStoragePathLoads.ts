import type { PoolPathResourceDeps } from '../poolDataDeps';

/** 统一存储域（`panels/unified_storage`）：列表/仪表盘由各 Section 自拉 */
export async function tryLoadUnifiedStorageTab(
  key: string,
  _force: boolean,
  _skipSync: boolean,
  _deps: PoolPathResourceDeps,
): Promise<boolean> {
  if (
    key === 'overview' ||
    key === 'harvester_addon' ||
    key === 'storage_pools' ||
    key === 'rbd_mirror' ||
    key === 'rgw_s3_buckets' ||
    key === 'rgw_users' ||
    key === 'object_gateways' ||
    key === 'cosi'
  ) {
    return true;
  }
  return false;
}
