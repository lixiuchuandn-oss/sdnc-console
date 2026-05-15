import type { PoolPathResourceDeps } from '../poolDataDeps';

/** 对象存储域（`panels/object_storage`）：列表由各 Section 自拉 */
export async function tryLoadObjectStorageTab(
  key: string,
  _force: boolean,
  _skipSync: boolean,
  _deps: PoolPathResourceDeps,
): Promise<boolean> {
  if (key === 'object_gateways' || key === 'cosi' || key === 'storage_pools') return true;
  return false;
}
