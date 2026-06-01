/**
 * 云备份（CBR）读/写权限检查；`clouds.backups` 历史总权仅覆盖快照，定时策略须 `clouds.schedules`。
 */
import { hasPermissionForAction } from '../../../../../../utils/accessMapping';

const LEGACY_UMBRELLA = 'clouds.backups';

export function canReadVmBackups(checkPerm: (a: string) => boolean): boolean {
  return checkPerm('clouds.backups:read') || checkPerm('clouds:read');
}

export function canReadVmBackupSnapshots(checkPerm: (a: string) => boolean): boolean {
  return checkPerm('clouds.vm-backup-snapshots:read') || checkPerm(`${LEGACY_UMBRELLA}:read`) || checkPerm('clouds:read');
}

export function canReadBackupSchedules(checkPerm: (a: string) => boolean): boolean {
  return checkPerm('clouds.schedules:read') || checkPerm('clouds:read');
}

export function canWriteVmBackups(perms: string[]): boolean {
  return (
    hasPermissionForAction(perms, 'clouds.backups:write') ||
    hasPermissionForAction(perms, 'clouds:write')
  );
}

export function canWriteVmBackupSnapshots(perms: string[]): boolean {
  return (
    hasPermissionForAction(perms, 'clouds.vm-backup-snapshots:write') ||
    hasPermissionForAction(perms, `${LEGACY_UMBRELLA}:write`) ||
    hasPermissionForAction(perms, 'clouds:write')
  );
}

export function canWriteBackupSchedules(perms: string[]): boolean {
  return (
    hasPermissionForAction(perms, 'clouds.schedules:write') ||
    hasPermissionForAction(perms, 'clouds:write')
  );
}

export function canViewAnyCbrPage(checkPerm: (a: string) => boolean): boolean {
  return (
    canReadVmBackups(checkPerm) ||
    canReadVmBackupSnapshots(checkPerm) ||
    canReadBackupSchedules(checkPerm) ||
    checkPerm('clouds.restore-tasks:read')
  );
}
