/**
 * Ceph 业务域统一刷新约定（与 paas_databases / oniaas_network 样板对称）：
 * - 池层：`loadTabResource(innerKey, force)` → `pathResource/*PathLoads`（列表仍 Section 自拉时为标记/门控）
 * - Section：`createHarvesterToolbarRefresh` / `runHarvesterSectionRefresh`（`Harvester/ceph/lib/cephSectionRefresh.ts`）
 */
export type CephInnerTabKey =
  | 'overview'
  | 'harvester_addon'
  | 'storage_pools'
  | 'rgw_s3_buckets'
  | 'rgw_users'
  | 'object_gateways'
  | 'cosi'
  | 'rbd_mirror';

export type CephTabRefreshDeps = {
  loadTabResource: (
    key: string,
    force?: boolean,
    skipSync?: boolean,
  ) => void | Promise<void>;
};

export type CephSectionOnRefresh = (
  force?: boolean,
  silent?: boolean,
) => void | Promise<void>;

export function createCephTabOnRefresh(
  tab: CephInnerTabKey,
  deps: CephTabRefreshDeps,
): CephSectionOnRefresh {
  const { loadTabResource } = deps;
  return (force?: boolean, silent?: boolean) => {
    void loadTabResource(tab, force !== false, silent);
  };
}
