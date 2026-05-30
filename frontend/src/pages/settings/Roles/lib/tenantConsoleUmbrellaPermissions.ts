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
