import {
  clampActionsToTenantBoundary,
  isTenantRootBuiltinRole,
  isTenantScopeRole,
  resolveTenantRootBoundaryActionAtoms,
  shouldUseTenantPermissionBoundary,
  TENANT_ROOT_BUILTIN_ROLE_NAME,
} from './builtinRolePermissionView';
import type { RBACRole } from '../types';

describe('builtinRolePermissionView', () => {
  it('identifies tenant scope and builtin root role', () => {
    expect(isTenantScopeRole({ scope: 'tenant' })).toBe(true);
    expect(isTenantScopeRole({ scope: 'system' })).toBe(false);
    expect(
      isTenantRootBuiltinRole({ name: TENANT_ROOT_BUILTIN_ROLE_NAME, type: '系统策略' }),
    ).toBe(true);
  });

  it('uses tenant boundary for all tenant-scope roles', () => {
    expect(shouldUseTenantPermissionBoundary({ scope: 'tenant' })).toBe(true);
    expect(shouldUseTenantPermissionBoundary({ scope: 'system' })).toBe(false);
  });

  it('resolves boundary from builtin tenant root role', () => {
    const roles: RBACRole[] = [
      {
        id: '1',
        name: TENANT_ROOT_BUILTIN_ROLE_NAME,
        type: '系统策略',
        scope: 'tenant',
        status: 'active',
        actions: ['clouds.ecs:read', 'clouds.ecs:write'],
      },
      {
        id: '2',
        name: '自定义租户角色',
        type: '自定义策略',
        scope: 'tenant',
        status: 'active',
        actions: ['clouds.console:read'],
      },
    ];
    expect(resolveTenantRootBoundaryActionAtoms(roles)).toEqual([
      'clouds.ecs:read',
      'clouds.ecs:write',
    ]);
  });

  it('clamps save payload to boundary', () => {
    const boundary = ['clouds.ecs:read', 'clouds.ecs:write'];
    expect(
      clampActionsToTenantBoundary(
        ['clouds.ecs:read', 'tenants:read', 'clouds.ecs:write'],
        boundary,
      ),
    ).toEqual(['clouds.ecs:read', 'clouds.ecs:write']);
  });
});
