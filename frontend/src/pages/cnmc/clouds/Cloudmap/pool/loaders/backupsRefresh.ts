/**
 * 云备份（backups / `cbr`）业务域统一刷新约定（与 compute/cluster 样板对称）：
 * - 池层：一律 `loadTabResource('backups', force, skipSync)`，实现见 `pathResource/backupsPathLoads.ts`
 * - Section：工具栏 `createHarvesterToolbarRefresh(onRefresh)`；写成功/删改后**禁止**裸调 `onRefresh(...)`，一律 `runHarvesterSectionRefresh(onRefresh, { force: true [, silent: true] })`
 */
export type BackupsInnerTabKey =
  | 'backups'
  | 'vm_snapshots'
  | 'schedule_vm_backups';

export type BackupsTabRefreshDeps = {
  loadTabResource: (
    key: string,
    force?: boolean,
    skipSync?: boolean,
  ) => void | Promise<void>;
};

export type BackupsSectionOnRefresh = (
  force?: boolean,
  silent?: boolean,
) => void | Promise<void>;

export function createBackupsTabOnRefresh(
  _tab: BackupsInnerTabKey,
  deps: BackupsTabRefreshDeps,
): BackupsSectionOnRefresh {
  const { loadTabResource } = deps;
  return (force?: boolean, skipSync?: boolean) => {
    void loadTabResource('backups', force !== false, skipSync);
  };
}
