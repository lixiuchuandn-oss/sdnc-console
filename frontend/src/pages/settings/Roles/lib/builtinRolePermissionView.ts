import { normalizeRoleGrantIds } from './roleGrantNormalize';
import { stripTenantConsoleUmbrellaPermissions } from './tenantConsoleUmbrellaPermissions';
import { buildTenantRootRoleCatalogBoundaryFromActions } from './tenantRootBuiltinCatalog';
import type { RBACRole } from '../types';

/** 与 backend constants/rbacBuiltInRoles、seeders/initRoles 保持一致 */
export const TENANT_ROOT_BUILTIN_ROLE_NAME = '云租户根用户';

/** 系统预置角色（type=系统策略）：不可删除、不可改名、不可改权限 */
export function isBuiltInRbacRole(
  role: Partial<Pick<RBACRole, 'type' | 'name'>> | null | undefined,
): boolean {
  return role?.type === '系统策略';
}

export function isTenantRootBuiltinRole(
  role: Partial<Pick<RBACRole, 'name' | 'type'>> | null | undefined,
): boolean {
  return role?.name === TENANT_ROOT_BUILTIN_ROLE_NAME && role?.type === '系统策略';
}

export function isTenantScopeRole(
  role: Partial<Pick<RBACRole, 'scope'>> | null | undefined,
): boolean {
  return role?.scope === 'tenant';
}

/** 租户角色配置权限时，抽屉可选范围 = 租户角色固定目录（含镜像 write，非已保存勾选结果） */
export function shouldUseTenantPermissionBoundary(
  role: Partial<Pick<RBACRole, 'scope' | 'name' | 'type'>> | null | undefined,
): boolean {
  return isTenantScopeRole(role) || isTenantRootBuiltinRole(role);
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

/** 从角色列表读取内置云租户根用户当前已保存权限（仅作 catalog 未加载时的兜底） */
export function resolveTenantRootBoundaryActionAtoms(roles: RBACRole[]): string[] {
  const root = findTenantRootBuiltinRole(roles);
  if (!root) return [];
  return stripTenantConsoleUmbrellaPermissions(normalizeRoleGrantIds(parseRoleActionAtoms(root)));
}

/**
 * 租户角色权限抽屉的固定菜单目录。
 * 优先 /rbac/actions.tenantRootBoundary；否则按种子公式从全量 actions 计算。
 * 与角色当前勾选无关，取消勾选后再次打开仍展示对应卡片。
 */
export function resolveTenantRootDrawerCatalogAtoms(
  catalogFromApi: string[] | undefined,
  allActions: string[] | undefined,
): string[] {
  const raw =
    Array.isArray(catalogFromApi) && catalogFromApi.length > 0
      ? catalogFromApi
      : buildTenantRootRoleCatalogBoundaryFromActions(allActions || []);
  return stripTenantConsoleUmbrellaPermissions(normalizeRoleGrantIds(raw));
}

/** 保存租户自定义角色时，剔除超出边界的权限 */
export function clampActionsToTenantBoundary(ids: string[], boundary: string[]): string[] {
  if (!boundary.length) return stripTenantConsoleUmbrellaPermissions(ids);
  const allowed = new Set(boundary);
  return stripTenantConsoleUmbrellaPermissions(ids.filter((id) => allowed.has(id)));
}
