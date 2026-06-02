import {
  buildTenantRootBuiltinPermissions,
  buildTenantRootRoleCatalogBoundary,
} from '../seeders/initRoles';
import { ALL_PERMISSIONS } from '../constants/permissions';

describe('buildTenantRootBuiltinPermissions', () => {
  it('excludes clouds.console umbrella permissions', () => {
    const perms = buildTenantRootBuiltinPermissions(ALL_PERMISSIONS);
    expect(perms).not.toContain('clouds.console:read');
    expect(perms).not.toContain('clouds.console:write');
    expect(perms).toContain('clouds.ecs:read');
    expect(perms).toContain('clouds.ecs:write');
    expect(perms).toContain('clouds.restore-tasks:read');
    expect(perms).toContain('clouds.restore-tasks:write');
  });

  it('excludes clouds.images:write for builtin tenant root seed', () => {
    const perms = buildTenantRootBuiltinPermissions(ALL_PERMISSIONS);
    expect(perms).toContain('clouds.images:read');
    expect(perms).not.toContain('clouds.images:write');
  });
});

describe('buildTenantRootRoleCatalogBoundary', () => {
  it('includes clouds.images:write for tenant role drawer catalog', () => {
    const boundary = buildTenantRootRoleCatalogBoundary(ALL_PERMISSIONS);
    expect(boundary).toContain('clouds.images:read');
    expect(boundary).toContain('clouds.images:write');
  });
});
