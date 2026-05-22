import type { PoolPathResourceDeps } from '../poolDataDeps';

/** 对象存储域（`panels/object_storage`）：列表由各 Section 自拉 */
export async function tryLoadObjectStorageTab(
  key: string,
  _force: boolean,
  _skipSync: boolean,
  _deps: PoolPathResourceDeps,
): Promise<boolean> {
  if (
    key === 'rgw_s3_buckets' ||
    key === 'rgw_users' ||
    key === 'object_gateways' ||
    key === 'cosi'
  )
    return true;
  return false;
}
