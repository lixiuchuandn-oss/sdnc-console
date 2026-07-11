/**
 * 与 seeders/initRoles.ts 中 ensureRole 写入的预置角色名称保持一致。
 */
export const BUILT_IN_RBAC_ROLE_NAMES: readonly string[] = [
  '三权-审计管理员',
  '三权-安全管理员',
  '三权-系统管理员',
];

export function isBuiltInRbacRoleName(name: string): boolean {
  return BUILT_IN_RBAC_ROLE_NAMES.includes(name);
}
