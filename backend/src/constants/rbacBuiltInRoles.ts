/**
 * 与 seeders/initRoles.ts 中 ensureRole 写入的预置角色名称保持一致。
 * 用于：列表 type 字段、禁止删除、禁止改名（避免改名后绕过内置保护）。
 * 若新增种子角色，请同时改 initRoles 与本数组。
 */
export const BUILT_IN_RBAC_ROLE_NAMES: readonly string[] = [
  '云租户根用户',
  '三权-审计管理员',
  '三权-安全管理员',
  '三权-系统管理员',
];

export function isBuiltInRbacRoleName(name: string): boolean {
  return BUILT_IN_RBAC_ROLE_NAMES.includes(name);
}
