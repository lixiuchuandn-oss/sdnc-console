import { buildTenantRootBuiltinPermissions } from '../seeders/initRoles';
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
});
