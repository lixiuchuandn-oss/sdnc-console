/**
 * 角色授权勾选：勾选 write 时自动带上同资源 read。
 * SETTINGS 角色抽屉与 Cloudmap 池 RBAC 共用。
 */
export function expandRoleGrantOnCheck(action: string, selectedIds: string[]): string[] {
  const out = new Set(selectedIds);
  if (action.endsWith(':write')) {
    out.add(action.replace(':write', ':read'));
  }
  out.add(action);
  return Array.from(out);
}
