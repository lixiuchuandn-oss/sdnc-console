import { UserRole } from '../entities/User';

/**
 * 旧版 WebSSH / WebVNC（/ws/ssh、/ws/vnc）鉴权。
 * 租户账号按身份放行；系统账号需 clouds.ecs:write（JWT 若未携带 permissions 则仅 super_admin / tenant 可用）。
 */
export function assertLegacyConsoleWsAccess(decoded: {
  role?: string;
  permissions?: string[];
}): void {
  const role = String(decoded?.role || '').toLowerCase();
  if (role === UserRole.SUPER_ADMIN || role === 'super_admin') return;
  if (role === UserRole.TENANT || role === 'tenant') return;

  const perms = Array.isArray(decoded.permissions) ? decoded.permissions : [];
  if (perms.includes('clouds.ecs:write') || perms.includes('clouds:write') || perms.includes('*')) {
    return;
  }

  throw new Error('缺少 clouds.ecs:write 权限，无法建立远程连接');
}
