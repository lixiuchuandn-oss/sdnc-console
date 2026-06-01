import { buildRolePermissionStructure } from './buildRolePermissionStructure';
import { stripTenantConsoleUmbrellaPermissions } from './tenantConsoleUmbrellaPermissions';

describe('tenantConsoleUmbrellaPermissions in role drawer', () => {
  it('always hides deprecated 租户控制台 group', () => {
    const structure = buildRolePermissionStructure({
      actionAtoms: ['clouds.console:read', 'clouds.console:write', 'clouds.ecs:read'],
      backendSupportsSubnetSplit: true,
      permVerb: '全部',
      permissionDefinitions: [],
    });
    const cnmc = structure.find((p) => p.platform === 'CNMC');
    expect(cnmc).toBeDefined();
    expect(cnmc!.groups.map((g) => g.group)).not.toContain('租户控制台');
  });

  it('stripTenantConsoleUmbrellaPermissions', () => {
    expect(
      stripTenantConsoleUmbrellaPermissions(['clouds.console:read', 'clouds.ecs:write']),
    ).toEqual(['clouds.ecs:write']);
  });
});
