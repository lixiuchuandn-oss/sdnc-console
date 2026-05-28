/**
 * 虚拟网元（oniaas_network / `vne`）统一刷新约定（与 paas_databases / compute 样板对称）：
 * - 池层：`loadTabResource('virtual_routers' | 'slb', force)` → `oniaasNetworkPathLoads`
 * - Section：`createHarvesterToolbarRefresh` / `runHarvesterSectionRefresh`
 */
export type OniaasNetworkInnerTabKey = 'virtual_routers' | 'slb';

export type OniaasNetworkTabRefreshDeps = {
  loadTabResource: (
    key: string,
    force?: boolean,
    skipSync?: boolean,
  ) => void | Promise<void>;
  /** 强制刷新虚拟路由列表时顺带拉镜像/子网/NAD/存储类（与 compute `ecs` Tab 一致） */
  refreshVmSectionAuxiliaries?: () => void;
};

export type OniaasNetworkSectionOnRefresh = (
  force?: boolean,
  silent?: boolean,
) => void | Promise<void>;

export function createOniaasNetworkTabOnRefresh(
  tab: OniaasNetworkInnerTabKey,
  deps: OniaasNetworkTabRefreshDeps,
): OniaasNetworkSectionOnRefresh {
  const { loadTabResource, refreshVmSectionAuxiliaries } = deps;

  switch (tab) {
    case 'virtual_routers':
      return async (force?: boolean) => {
        const shouldForce = force !== false;
        await loadTabResource('virtual_routers', shouldForce);
        if (shouldForce) refreshVmSectionAuxiliaries?.();
      };
    case 'slb':
      return async (force?: boolean) => {
        await loadTabResource('slb', force !== false);
      };
    default:
      return async () => {};
  }
}
