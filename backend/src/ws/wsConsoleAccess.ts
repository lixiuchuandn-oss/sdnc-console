import { UserRole } from '../entities/User';

/**
 * 旧版 WebSSH / WebVNC（/ws/ssh、/ws/vnc）鉴权。
 * 租户账号按身份放行（命名空间等在业务层校验）；系统账号仍依赖 clouds.console:write（JWT 若未携带 permissions 则仅 super_admin / tenant 可用）。
 */
export function assertLegacyConsoleWsAccess(decoded: {
  role?: string;
  permissions?: string[];
}): void {
  const role = String(decoded?.role || '').toLowerCase();
  if (role === UserRole.SUPER_ADMIN || role === 'super_admin') return;
  if (role === UserRole.TENANT || role === 'tenant') return;

  const perms = Array.isArray(decoded.permissions) ? decoded.permissions : [];
  if (perms.includes('clouds.console:write')) return;

  throw new Error('缺少 clouds.console:write 权限，无法建立远程连接');
}
