/**
 * 登录身份：租户账号（TenantUser）与系统账号（User 表）分流。
 * 与 RBAC RoleAssignment.userType 不同——后者表示角色作用域。
 */
import { TENANT_CLOUD_CONSOLE_PATH } from '../pages/cnmc/console/lib/tenantConsolePaths';

export type AccountType = 'tenant' | 'system';

export function resolveAccountType(user: {
  role?: string;
  accountType?: AccountType | string;
} | null | undefined): AccountType {
  if (!user) return 'system';
  if (user.accountType === 'tenant' || user.accountType === 'system') {
    return user.accountType;
  }
  return String(user.role || '').toLowerCase() === 'tenant' ? 'tenant' : 'system';
}

export function isTenantAccount(
  user: { role?: string; accountType?: AccountType | string } | null | undefined,
): boolean {
  return resolveAccountType(user) === 'tenant';
}

/** 方案 A：/console 仅租户账号（role=tenant / accountType=tenant）可进入 */
export function canAccessTenantConsole(
  user: { role?: string; accountType?: AccountType | string } | null | undefined,
): boolean {
  if (!user) return false;
  return isTenantAccount(user);
}

export function resolveTenantConsolePath(): string {
  return TENANT_CLOUD_CONSOLE_PATH;
}

/** 登录后首选落地路径（租户固定 /console；系统管理员走 /admin 索引） */
export function resolvePostLoginPath(user: {
  role?: string;
  accountType?: AccountType | string;
  defaultPath?: string;
} | null | undefined): string {
  if (!user) return '/admin/login';
  const explicit = String(user.defaultPath || '').trim();
  if (explicit.startsWith('/')) return explicit;
  if (isTenantAccount(user)) return resolveTenantConsolePath();
  return '/admin';
}
