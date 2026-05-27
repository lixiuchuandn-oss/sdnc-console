/**
 * 云数据库（paas_databases / `database`）统一刷新约定（与 compute/cluster 样板对称）：
 * - 池层：RDS 列表 `loadTabResource('rds', force)` → `paasDatabasesPathLoads` → `ecs` 拉取
 * - Section：`createHarvesterToolbarRefresh` / `runHarvesterSectionRefresh`
 */
export type PaasDatabasesInnerTabKey = 'rds';

export type PaasDatabasesTabRefreshDeps = {
  loadTabResource: (
    key: string,
    force?: boolean,
    skipSync?: boolean,
  ) => void | Promise<void>;
  /** 强制刷新 RDS 列表时顺带拉镜像/卷/命名空间（与 compute `ecs` Tab 一致） */
  refreshVmSectionAuxiliaries?: () => void;
};

export type PaasDatabasesSectionOnRefresh = (
  force?: boolean,
  silent?: boolean,
) => void | Promise<void>;

export function createPaasDatabasesTabOnRefresh(
  tab: PaasDatabasesInnerTabKey,
  deps: PaasDatabasesTabRefreshDeps,
): PaasDatabasesSectionOnRefresh {
  const { loadTabResource, refreshVmSectionAuxiliaries } = deps;

  switch (tab) {
    case 'rds':
      return (force?: boolean) => {
        const shouldForce = force !== false;
        void loadTabResource('rds', shouldForce);
        if (shouldForce) refreshVmSectionAuxiliaries?.();
      };
    default:
      return () => {};
  }
}
