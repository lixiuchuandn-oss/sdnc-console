import {
  fetchHarvesterBackups,
  fetchHarvesterScheduleVmBackups,
} from '../../api';
import type { PoolPathResourceDeps } from '../poolDataDeps';
import {
  canReadBackupSchedules,
  canReadVmBackupSnapshots,
  canReadVmBackups,
} from '../../../../Harvester/cbr/lib/cbrPermissions';

/** 云备份域（`panels/backups`）：`handleTabChange` 将若干内层段统一映射为 `backups` */
export async function tryLoadBackupTab(
  key: string,
  force: boolean,
  skipSync: boolean,
  deps: PoolPathResourceDeps,
): Promise<boolean> {
  if (key !== 'backups') return false;

  const {
    cloudId,
    checkPerm,
    loadResource,
    setHarvesterBackups,
    setRawBackups,
    setHarvesterScheduleVmBackups,
    setRawScheduleVmBackups,
  } = deps;

  const loadBackupsList =
    canReadVmBackups(checkPerm) || canReadVmBackupSnapshots(checkPerm);
  if (loadBackupsList) {
    await loadResource(
      'backups',
      () => fetchHarvesterBackups(cloudId, force, skipSync),
      (json) => {
        const list: any[] = Array.isArray((json as any)?.data?.items)
          ? (json as any).data.items
          : [];
        setHarvesterBackups(Array.isArray(list) ? list : []);
        setRawBackups(json || null);
      },
      force,
    );
  }
  if (canReadBackupSchedules(checkPerm)) {
    await loadResource(
      'scheduleVmBackups',
      () => fetchHarvesterScheduleVmBackups(cloudId, force, skipSync),
      (json) => {
        const list: any[] = Array.isArray((json as any)?.data?.items)
          ? (json as any).data.items
          : [];
        setHarvesterScheduleVmBackups(Array.isArray(list) ? list : []);
        setRawScheduleVmBackups(json || null);
      },
      force,
    );
  }
  return true;
}
