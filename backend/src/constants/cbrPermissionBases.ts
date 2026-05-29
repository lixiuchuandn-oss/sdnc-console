/**
 * 云备份（CBR）权限域：云主机备份 / 云主机快照 / 定时策略。
 * `clouds.backups` 为历史总权：仍覆盖「云主机快照」子域，**不**覆盖「定时策略」（须显式 `clouds.schedules`）。
 */

export const CBR_VM_BACKUPS_BASE = 'clouds.backups';
export const CBR_VM_SNAPSHOTS_BASE = 'clouds.vm-backup-snapshots';
/** 虚拟机定时备份策略（池内「定时策略」页） */
export const CBR_BACKUP_SCHEDULES_BASE = 'clouds.schedules';

/** 短期曾用 ID，角色库中可能仍存在；运行时与 `clouds.schedules` 双向等价 */
export const LEGACY_CBR_BACKUP_SCHEDULES_BASE = 'clouds.backup-schedules';

const LEGACY_UMBRELLA = CBR_VM_BACKUPS_BASE;

function withVerb(base: string, verb: 'read' | 'write'): string {
  return `${base}:${verb}`;
}

/** GET 备份列表（备份页与快照页共用 inventory） */
export function cbrVmBackupListReadAlternates(): string[] {
  return [
    withVerb(CBR_VM_BACKUPS_BASE, 'read'),
    withVerb(CBR_VM_SNAPSHOTS_BASE, 'read'),
    withVerb(LEGACY_UMBRELLA, 'read'),
  ];
}

export function cbrVmBackupListWriteAlternates(): string[] {
  return [
    withVerb(CBR_VM_BACKUPS_BASE, 'write'),
    withVerb(CBR_VM_SNAPSHOTS_BASE, 'write'),
    withVerb(LEGACY_UMBRELLA, 'write'),
  ];
}

export function cbrBackupScheduleReadAlternates(): string[] {
  return [
    withVerb(CBR_BACKUP_SCHEDULES_BASE, 'read'),
    withVerb(LEGACY_CBR_BACKUP_SCHEDULES_BASE, 'read'),
  ];
}

export function cbrBackupScheduleWriteAlternates(): string[] {
  return [
    withVerb(CBR_BACKUP_SCHEDULES_BASE, 'write'),
    withVerb(LEGACY_CBR_BACKUP_SCHEDULES_BASE, 'write'),
  ];
}

export function cbrVmBackupsReadAlternates(): string[] {
  return [withVerb(CBR_VM_BACKUPS_BASE, 'read'), withVerb(LEGACY_UMBRELLA, 'read')];
}

export function cbrVmBackupsWriteAlternates(): string[] {
  return [withVerb(CBR_VM_BACKUPS_BASE, 'write'), withVerb(LEGACY_UMBRELLA, 'write')];
}

export function cbrVmSnapshotsReadAlternates(): string[] {
  return [withVerb(CBR_VM_SNAPSHOTS_BASE, 'read'), withVerb(LEGACY_UMBRELLA, 'read')];
}

export function cbrVmSnapshotsWriteAlternates(): string[] {
  return [withVerb(CBR_VM_SNAPSHOTS_BASE, 'write'), withVerb(LEGACY_UMBRELLA, 'write')];
}
