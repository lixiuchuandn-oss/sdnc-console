import type { RBACRole } from '../types';
import {
  clampActionsToTenantBoundary,
  shouldUseTenantPermissionBoundary,
} from './builtinRolePermissionView';
import { normalizeRoleGrantIds } from './roleGrantNormalize';
import { stripTenantConsoleUmbrellaPermissions } from './tenantConsoleUmbrellaPermissions';

/** 从源角色解析权限原子，供复制后赋权抽屉初始勾选 */
export function cloneRoleGrantIds(
  source: RBACRole,
  tenantRootBoundaryAtoms: string[],
): string[] {
  let ids = stripTenantConsoleUmbrellaPermissions(normalizeRoleGrantIds(source.actions || []));
  if (shouldUseTenantPermissionBoundary(source)) {
    ids = clampActionsToTenantBoundary(ids, tenantRootBoundaryAtoms);
  }
  return ids;
}
