/** 已废弃的 clouds.console:* umbrella 权限（/console 仅 tenant 账号；全平台 strip） */
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

export function stripConsoleUmbrellaFromRolePermissions(
  _scope: string | undefined,
  permissions: string[],
): string[] {
  return stripTenantConsoleUmbrellaPermissions(permissions);
}

/** @deprecated 使用 stripConsoleUmbrellaFromRolePermissions */
export function stripTenantConsoleUmbrellaIfTenantScope(
  scope: string | undefined,
  permissions: string[],
): string[] {
  return stripConsoleUmbrellaFromRolePermissions(scope, permissions);
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
