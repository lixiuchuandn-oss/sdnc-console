/**
 * 块存储（storage / ebs）业务域统一刷新约定（与 `computeRefresh.ts`、`clusterRefresh.ts` 对称，Cloudmap 样板域）：
 * - 池层：一律 `loadTabResource(innerKey, force, skipSync)`，实现见 `pathResource/storagePathLoads.ts`
 * - Section：工具栏 `createHarvesterToolbarRefresh(onRefresh)`；写成功/删改后**禁止**裸调 `onRefresh(...)`，一律 `runHarvesterSectionRefresh(onRefresh, { force: true [, silent: true] })`
 */
export type StorageInnerTabKey = 'volumes' | 'snapshots';

export type StorageTabRefreshDeps = {
  loadTabResource: (
    key: string,
    force?: boolean,
    skipSync?: boolean,
  ) => void | Promise<void>;
  /** 云盘 Tab 强制刷新时顺带拉 storage_classes（创建/挂载依赖） */
  refreshVolumesTabAuxiliaries?: () => void;
};

export type StorageSectionOnRefresh = (
  force?: boolean,
  silent?: boolean,
) => void | Promise<void>;

export function createStorageTabOnRefresh(
  tab: StorageInnerTabKey,
  deps: StorageTabRefreshDeps,
): StorageSectionOnRefresh {
  const { loadTabResource, refreshVolumesTabAuxiliaries } = deps;

  switch (tab) {
    case 'volumes':
      return (force?: boolean, skipSync?: boolean) => {
        const shouldForce = force !== false;
        void loadTabResource('volumes', shouldForce, skipSync);
        if (shouldForce) refreshVolumesTabAuxiliaries?.();
      };
    case 'snapshots':
      return (force?: boolean, skipSync?: boolean) => {
        void loadTabResource('snapshots', force !== false, skipSync);
      };
    default:
      return () => {};
  }
}
