/**
 * Cloudmap 池数据加载公共出口。
 *
 * - `runPoolEssentials`：进入池首屏，多域共用的底稿数据。
 * - `runPathResourceLoad`：随路由内层段按需补拉（与 `panels/<域>/` 视图配套）。
 *
 * 业务域命名以 `layouts/admin/cloudmap/cloudPoolSidebar` 的 `CLOUDMAP_POOL_NAV_KEYS` 为准；
 * 实现按域拆在 `pathResource/*PathLoads.ts`，与池内视图按需拉取的 pathSeg / 路由内层一致。
 */
export type { PoolEssentialsDeps, PoolPathResourceDeps } from './poolDataDeps';
export { runPoolEssentials } from './runPoolEssentials';
export { runPathResourceLoad } from './runPathResourceLoad';
export {
  createComputeTabOnRefresh,
  type ComputeInnerTabKey,
  type ComputeTabRefreshDeps,
} from './computeRefresh';
export {
  createClusterTabOnRefresh,
  type ClusterInnerTabKey,
  type ClusterTabRefreshDeps,
  type ClusterSectionOnRefresh,
} from './clusterRefresh';
export {
  fetchComputeEcsList,
  parseEcsListFromJson,
  syncCloudEcsBeforeLoad,
} from './pathResource/computeEcsListLoad';
