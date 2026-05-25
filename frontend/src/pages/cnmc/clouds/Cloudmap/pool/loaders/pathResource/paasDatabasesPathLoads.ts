import type { PoolPathResourceDeps } from '../poolDataDeps';
import { tryLoadComputeTab } from './computePathLoads';

/** Cloudmap `panels/paas_databases`：RDS 实例列表与云主机同源（`ecs`） */
export async function tryLoadPaasDatabasesTab(
  key: string,
  force: boolean,
  skipSync: boolean,
  deps: PoolPathResourceDeps,
): Promise<boolean> {
  if (key === 'rds') {
    return tryLoadComputeTab('ecs', force, skipSync, deps);
  }
  return false;
}
