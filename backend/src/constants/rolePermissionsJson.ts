/** 解析 RBACRole.permissions 列（JSON 字符串 → 权限原子数组） */
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

export function normalizeRolePermissionsInput(permissions: unknown): string[] {
  return Array.isArray(permissions) ? permissions.map(String) : [];
}
