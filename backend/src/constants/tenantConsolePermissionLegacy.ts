/** 租户控制台入口已改由账号类型判定；租户 scope 角色不再配置 umbrella 权限 */
export const TENANT_CONSOLE_UMBRELLA_ACTIONS = [
  'clouds.console:read',
  'clouds.console:write',
] as const;

const TENANT_CONSOLE_UMBRELLA_SET = new Set<string>(TENANT_CONSOLE_UMBRELLA_ACTIONS);

export function isTenantConsoleUmbrellaPermission(permission: string): boolean {
  const base = String(permission || '').split(':')[0];
  return base === 'clouds.console';
}

export function stripTenantConsoleUmbrellaPermissions(permissions: string[]): string[] {
  if (!Array.isArray(permissions) || permissions.length === 0) return [];
  return permissions.filter((p) => !TENANT_CONSOLE_UMBRELLA_SET.has(p) && !isTenantConsoleUmbrellaPermission(p));
}

export function stripTenantConsoleUmbrellaIfTenantScope(
  scope: string | undefined,
  permissions: string[],
): string[] {
  if (String(scope || '') !== 'tenant') return permissions;
  return stripTenantConsoleUmbrellaPermissions(permissions);
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
