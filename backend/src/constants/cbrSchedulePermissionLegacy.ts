/**
 * 定时策略权限合并：`clouds.schedules` 为权威 ID，`clouds.backup-schedules` 仅运行时/库内兼容。
 */

import {
  CBR_BACKUP_SCHEDULES_BASE,
  LEGACY_CBR_BACKUP_SCHEDULES_BASE,
} from './cbrPermissionBases';

export const CBR_BACKUP_SCHEDULE_RESOURCE_BASES = new Set<string>([
  CBR_BACKUP_SCHEDULES_BASE,
  LEGACY_CBR_BACKUP_SCHEDULES_BASE,
]);

export function isCbrBackupScheduleResourceBase(base: string): boolean {
  return CBR_BACKUP_SCHEDULE_RESOURCE_BASES.has(base);
}

/** 检查持有另一 ID 的 read/write 是否满足当前 required base */
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

/** 角色库迁移：将历史 `clouds.backup-schedules:*` 替换为 `clouds.schedules:*` */
export function expandLegacyBackupSchedulePermissions(permissions: string[]): string[] {
  const out = new Set(permissions);
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
