import {
  clampActionsToTenantBoundary,
  isBuiltInRbacRole,
  isTenantRootBuiltinRole,
  isTenantScopeRole,
  resolveTenantRootBoundaryActionAtoms,
  resolveTenantRootDrawerCatalogAtoms,
  shouldUseTenantPermissionBoundary,
  TENANT_ROOT_BUILTIN_ROLE_NAME,
} from './builtinRolePermissionView';
import type { RBACRole } from '../types';

describe('builtinRolePermissionView', () => {
  it('identifies tenant scope and builtin root role', () => {
    expect(isTenantScopeRole({ scope: 'tenant' })).toBe(true);
    expect(isTenantScopeRole({ scope: 'system' })).toBe(false);
    expect(isBuiltInRbacRole({ type: '系统策略', name: '云计算用户' })).toBe(true);
    expect(isBuiltInRbacRole({ type: '自定义策略', name: '云租户根用户' })).toBe(false);
    expect(
      isTenantRootBuiltinRole({ name: TENANT_ROOT_BUILTIN_ROLE_NAME, type: '系统策略' }),
    ).toBe(true);
  });

  it('uses tenant boundary for tenant roles and builtin tenant root role', () => {
    expect(shouldUseTenantPermissionBoundary({ scope: 'tenant' })).toBe(true);
    expect(
      shouldUseTenantPermissionBoundary({
        scope: 'system',
        name: TENANT_ROOT_BUILTIN_ROLE_NAME,
        type: '系统策略',
      }),
    ).toBe(true);
    expect(shouldUseTenantPermissionBoundary({ scope: 'system' })).toBe(false);
  });

  it('resolves saved permissions from builtin tenant root role (fallback)', () => {
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

  it('drawer catalog uses API boundary even when root role saved without ecs', () => {
    const catalog = ['clouds.ecs:read', 'clouds.ecs:write', 'clouds.disks:read'];
    expect(resolveTenantRootDrawerCatalogAtoms(catalog, [])).toEqual(catalog);
  });

  it('drawer catalog falls back to formula from all actions, not saved role', () => {
    const allActions = [
      'clouds.ecs:read',
      'clouds.ecs:write',
      'clouds.dashboard:read',
      'clouds.cluster-nodes:read',
      'tenants:read',
    ];
    const computed = resolveTenantRootDrawerCatalogAtoms(undefined, allActions);
    expect(computed).toContain('clouds.ecs:read');
    expect(computed).toContain('clouds.ecs:write');
    expect(computed).not.toContain('clouds.dashboard:read');
    expect(computed).not.toContain('clouds.cluster-nodes:read');
    expect(computed).not.toContain('tenants:read');
  });

  it('strips clouds.console from clamp boundary result', () => {
    const boundary = ['clouds.ecs:read', 'clouds.ecs:write'];
    expect(
      clampActionsToTenantBoundary(
        ['clouds.console:read', 'clouds.ecs:read', 'tenants:read'],
        boundary,
      ),
    ).toEqual(['clouds.ecs:read']);
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
