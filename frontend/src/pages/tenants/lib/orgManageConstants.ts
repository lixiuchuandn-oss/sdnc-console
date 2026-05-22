/** 平台预置租户级 RBAC 策略全名（与 backend/constants/rbacBuiltInRoles、seeders/initRoles 同步） */
export const RBAC_BUILTIN_TENANT_ROLE_NAMES = new Set([
  '云租户根用户',
  '三权-审计管理员',
  '三权-安全管理员',
  '三权-系统管理员',
]);

/** 租户用户表单里可能出现的占位/简写角色名（非 RBAC 策略全名时） */
export const TENANT_USER_ROLE_LABEL_FALLBACK: Record<string, string> = {
  admin: '管理员',
  user: '用户',
  viewer: '查看者',
};

export type OrgManageRBACRole = {
  id: string;
  name: string;
  description?: string;
  scope: 'system' | 'tenant';
  status?: 'active' | 'inactive';
};

export type OrgManageAssignment = {
  id: string;
  roleId: string;
  userType: 'system' | 'tenant';
  userId: string;
  createdAt: string;
};

export function formatRoleDisplayName(name: string | undefined): string {
  if (!name) return '';
  if (RBAC_BUILTIN_TENANT_ROLE_NAMES.has(name)) return name;
  return TENANT_USER_ROLE_LABEL_FALLBACK[name] || name;
}
