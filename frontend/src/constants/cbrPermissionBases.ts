/**
 * 云备份·定时策略权限 ID（与 backend cbrPermissionBases 对齐）
 */

export const CBR_BACKUP_SCHEDULES_BASE = 'clouds.schedules';
export const LEGACY_CBR_BACKUP_SCHEDULES_BASE = 'clouds.backup-schedules';

const CBR_BACKUP_SCHEDULE_RESOURCE_BASES = new Set<string>([
  CBR_BACKUP_SCHEDULES_BASE,
  LEGACY_CBR_BACKUP_SCHEDULES_BASE,
]);

export function isCbrBackupScheduleResourceBase(base: string): boolean {
  return CBR_BACKUP_SCHEDULE_RESOURCE_BASES.has(base);
}

export function cbrBackupScheduleAliasSatisfied(
  permissions: string[],
  requiredBase: string,
  verb: 'read' | 'write',
): boolean {
  if (!isCbrBackupScheduleResourceBase(requiredBase)) return false;
  const alternate =
    requiredBase === CBR_BACKUP_SCHEDULES_BASE
      ? LEGACY_CBR_BACKUP_SCHEDULES_BASE
      : CBR_BACKUP_SCHEDULES_BASE;
  return permissions.includes(`${alternate}:${verb}`);
}

/** 角色授权抽屉：历史 ID → 权威 ID */
export function mapLegacyBackupSchedulesToCanonical(ids: string[]): string[] {
  const out = new Set(ids);
  const pairs: Array<[string, string]> = [
    [`${LEGACY_CBR_BACKUP_SCHEDULES_BASE}:read`, `${CBR_BACKUP_SCHEDULES_BASE}:read`],
    [`${LEGACY_CBR_BACKUP_SCHEDULES_BASE}:write`, `${CBR_BACKUP_SCHEDULES_BASE}:write`],
  ];
  for (const [legacy, canonical] of pairs) {
    if (out.has(legacy)) {
      out.add(canonical);
      out.delete(legacy);
    }
  }
  return Array.from(out);
}
