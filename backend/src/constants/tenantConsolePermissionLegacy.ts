/** 已废弃的 clouds.console:* umbrella 权限（/console 仅 tenant 账号；全平台 strip） */
export const TENANT_CONSOLE_UMBRELLA_ACTIONS = [
  'clouds.console:read',
  'clouds.console:write',
] as const;

export function isTenantConsoleUmbrellaPermission(permission: string): boolean {
  const base = String(permission || '').split(':')[0];
  return base === 'clouds.console';
}

export function stripTenantConsoleUmbrellaPermissions(permissions: string[]): string[] {
  if (!Array.isArray(permissions) || permissions.length === 0) return [];
  return permissions.filter((p) => !isTenantConsoleUmbrellaPermission(p));
}

export function parseRolePermissionsJson(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(String(raw || '[]'));
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.actions)) return parsed.actions;
    return [];
  } catch {
    return [];
  }
}

/** 租户云控制台：是否持有任意 clouds.* 页面权（用于 GET /api/clouds 列表/元数据） */
export function hasAnyTenantCloudConsolePagePermission(permissions: string[]): boolean {
  if (!Array.isArray(permissions) || permissions.length === 0) return false;
  return permissions.some((p) => {
    const s = String(p || '');
    if (s === 'clouds:read' || s === 'clouds:write' || s === '*') return true;
    if (!s.startsWith('clouds.')) return false;
    if (isTenantConsoleUmbrellaPermission(s)) return false;
    return s.endsWith(':read') || s.endsWith(':write');
  });
}

/** GET /api/clouds 或 GET /api/clouds/:id（不含 /resources 子路径） */
export function isCloudPoolListOrMetaReadPath(fullPath: string, method: string): boolean {
  const m = String(method || '').toUpperCase();
  if (m !== 'GET' && m !== 'HEAD') return false;
  const p = String(fullPath || '')
    .toLowerCase()
    .replace(/\/+$/, '');
  if (p === '/api/clouds') return true;
  return /^\/api\/clouds\/[^/]+$/.test(p);
}
