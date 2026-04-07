/**
 * 平台预置系统用户（与 seeders/initAdmin.ts 一致）。
 * 用于：列表 builtIn 字段、禁止删除等。
 */
const NAMES = ['admin', 'sysadmin', 'auditor', 'secadmin'] as const;

export type BuiltInSystemUsername = (typeof NAMES)[number];

export const BUILT_IN_SYSTEM_USERNAMES: ReadonlySet<string> = new Set(NAMES);

export function isBuiltInSystemUser(username: string): boolean {
  return BUILT_IN_SYSTEM_USERNAMES.has(username);
}
