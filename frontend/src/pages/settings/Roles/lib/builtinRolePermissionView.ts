import { normalizeRoleGrantIds } from './roleGrantNormalize';
import type { RBACRole } from '../types';

/** 与 backend seeders/initRoles、orgManageConstants 保持一致 */
export const TENANT_ROOT_BUILTIN_ROLE_NAME = '云租户根用户';

export function isTenantRootBuiltinRole(
  role: Pick<RBACRole, 'name' | 'type'> | null | undefined,
): boolean {
  return role?.name === TENANT_ROOT_BUILTIN_ROLE_NAME && role?.type === '系统策略';
}

export function isTenantScopeRole(role: Pick<RBACRole, 'scope'> | null | undefined): boolean {
  return role?.scope === 'tenant';
}

/** 租户角色配置权限时，抽屉可选范围 = 内置「云租户根用户」已授权 atoms */
export function shouldUseTenantPermissionBoundary(
  role: Pick<RBACRole, 'scope'> | null | undefined,
): boolean {
  return isTenantScopeRole(role);
}

export function findTenantRootBuiltinRole(roles: RBACRole[]): RBACRole | undefined {
  return roles.find((r) => isTenantRootBuiltinRole(r));
}

function parseRoleActionAtoms(role: RBACRole): string[] {
  if (Array.isArray(role.actions) && role.actions.length > 0) {
    return role.actions;
  }
  try {
    const parsed = JSON.parse(String(role.permissions || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** 从角色列表解析内置云租户根用户的权限边界（用于租户角色抽屉建树） */
export function resolveTenantRootBoundaryActionAtoms(roles: RBACRole[]): string[] {
  const root = findTenantRootBuiltinRole(roles);
  if (!root) return [];
  return normalizeRoleGrantIds(parseRoleActionAtoms(root));
}

/** 保存租户自定义角色时，剔除超出边界的权限 */
export function clampActionsToTenantBoundary(ids: string[], boundary: string[]): string[] {
  if (!boundary.length) return ids;
  const allowed = new Set(boundary);
  return ids.filter((id) => allowed.has(id));
}
