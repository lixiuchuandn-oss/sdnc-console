/**
 * 登录身份：租户账号（TenantUser）与系统账号（User 表）分流。
 * SDNC 产品已移除租户多云控制台；租户账号登录后进入管理后台索引。
 */
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

/** SDNC：无独立租户控制台 */
export function canAccessTenantConsole(
  _user: { role?: string; accountType?: AccountType | string } | null | undefined,
): boolean {
  return false;
}

export function resolveTenantConsolePath(): string {
  return '/admin';
}

/** 登录后首选落地路径 */
export function resolvePostLoginPath(user: {
  role?: string;
  accountType?: AccountType | string;
  defaultPath?: string;
} | null | undefined): string {
  if (!user) return '/admin/login';
  const explicit = String(user.defaultPath || '').trim();
  if (explicit.startsWith('/')) return explicit;
  return '/admin';
}
