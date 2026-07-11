import { UserRole } from '../entities/User';

/**
 * WebSSH（/ws/ssh）鉴权。
 * super_admin / tenant 放行；其它系统账号需 networks.vr-config:write。
 */
export function assertConsoleWsAccess(decoded: {
  role?: string;
  permissions?: string[];
}): void {
  const role = String(decoded?.role || '').toLowerCase();
  if (role === UserRole.SUPER_ADMIN || role === 'super_admin') return;
  if (role === UserRole.TENANT || role === 'tenant') return;

  const perms = Array.isArray(decoded.permissions) ? decoded.permissions : [];
  if (perms.includes('networks.vr-config:write') || perms.includes('*')) {
    return;
  }

  throw new Error('缺少 networks.vr-config:write 权限，无法建立远程连接');
}

/** @deprecated 兼容旧引用 */
export const assertLegacyConsoleWsAccess = assertConsoleWsAccess;
