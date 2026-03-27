/** 租户角色在「配置权限」中不展示「资源总览」「资源池」两张父级卡片（细分 clouds.* 仍可选） */
export const TENANT_HIDDEN_RESOURCE_PREFIXES = new Set(['clouds.dashboard', 'clouds']);

export function stripTenantForbiddenPermissionIds(ids: string[]): string[] {
  return ids.filter((id) => {
    const resource = String(id).split(':')[0];
    return !TENANT_HIDDEN_RESOURCE_PREFIXES.has(resource);
  });
}
