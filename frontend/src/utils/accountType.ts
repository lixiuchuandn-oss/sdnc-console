/**
 * 登录身份：租户账号（TenantUser）与系统账号（User 表）分流。
 * 与 RBAC RoleAssignment.userType 不同——后者表示角色作用域。
 */
import { hasPermissionForAction } from './accessMapping';
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

/** 策略 B：租户账号直达；系统 super_admin 或持有 clouds.console:read 可进入 */
export function canAccessTenantConsole(
  user: { role?: string; accountType?: AccountType | string; permissions?: string[] } | null | undefined,
): boolean {
  if (!user) return false;
  const role = String(user.role || '').toLowerCase();
  if (role === 'super_admin') return true;
  if (isTenantAccount(user)) return true;
  const perms = Array.isArray(user.permissions) ? user.permissions : [];
  return (
    hasPermissionForAction(perms, 'clouds.console:read') ||
    hasPermissionForAction(perms, 'clouds.console:write')
  );
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
  const role = String(user.role || '').toLowerCase();
  if (role === 'super_admin' || role === 'admin') return '/admin';
  return '/admin';
}
