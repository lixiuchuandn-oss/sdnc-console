/**
 * 虚拟机（compute）业务域统一刷新约定（与 `clusterRefresh.ts` 对称，Cloudmap 样板域）：
 * - 池层：一律 `loadTabResource(innerKey, force, skipSync)`，实现见 `pathResource/computePathLoads.ts`
 * - Section：工具栏 `createHarvesterToolbarRefresh(onRefresh)`；写成功/删改后**禁止**裸调 `onRefresh(...)`，一律 `runHarvesterSectionRefresh(onRefresh, { force: true [, silent: true] })`
 */
export type ComputeInnerTabKey =
  | 'ecs'
  | 'images'
  | 'templates'
  | 'ssh_keys'
  | 'cloud_inits'
  | 'recycle_bin'
  | 'migrations';

export type ComputeTabRefreshDeps = {
  loadTabResource: (
    key: string,
    force?: boolean,
    skipSync?: boolean,
  ) => void | Promise<void>;
  /** 云主机 Tab 强制刷新时顺带拉镜像/卷/命名空间 */
  refreshVmSectionAuxiliaries?: () => void;
};

export function createComputeTabOnRefresh(
  tab: ComputeInnerTabKey,
  deps: ComputeTabRefreshDeps,
): (force?: boolean, _silent?: boolean) => void | Promise<void> {
  const { loadTabResource, refreshVmSectionAuxiliaries } = deps;

  switch (tab) {
    case 'ecs':
      return async (force?: boolean) => {
        const shouldForce = force !== false;
        await loadTabResource('ecs', shouldForce);
        if (shouldForce) refreshVmSectionAuxiliaries?.();
      };
    case 'recycle_bin':
      return async (force?: boolean) => {
        await loadTabResource('ecs', force !== false);
      };
    case 'images':
      return async (force?: boolean) => {
        await loadTabResource('images', force !== false);
      };
    case 'templates':
      return async () => {
        await loadTabResource('templates', true);
      };
    case 'ssh_keys':
      return async () => {
        await loadTabResource('ssh_keys', true);
      };
    case 'cloud_inits':
      return async () => {
        await loadTabResource('cloud_inits', true);
      };
    case 'migrations':
      return async (force?: boolean) => {
        await loadTabResource('migrations', force !== false);
      };
    default:
      return () => {};
  }
}
