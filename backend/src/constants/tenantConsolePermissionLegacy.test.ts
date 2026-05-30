import {
  isTenantConsoleUmbrellaPermission,
  stripConsoleUmbrellaFromRolePermissions,
  stripTenantConsoleUmbrellaIfTenantScope,
  stripTenantConsoleUmbrellaPermissions,
} from './tenantConsolePermissionLegacy';

describe('tenantConsolePermissionLegacy', () => {
  it('strips clouds.console atoms', () => {
    expect(
      stripTenantConsoleUmbrellaPermissions([
        'clouds.console:read',
        'clouds.console:write',
        'clouds.ecs:read',
      ]),
    ).toEqual(['clouds.ecs:read']);
  });

  it('isTenantConsoleUmbrellaPermission', () => {
    expect(isTenantConsoleUmbrellaPermission('clouds.console:read')).toBe(true);
    expect(isTenantConsoleUmbrellaPermission('clouds.ecs:read')).toBe(false);
  });

  it('stripConsoleUmbrellaFromRolePermissions strips for all scopes', () => {
    const mixed = ['clouds.console:read', 'clouds.ecs:write'];
    expect(stripConsoleUmbrellaFromRolePermissions('tenant', mixed)).toEqual(['clouds.ecs:write']);
    expect(stripConsoleUmbrellaFromRolePermissions('system', mixed)).toEqual(['clouds.ecs:write']);
  });

  it('stripTenantConsoleUmbrellaIfTenantScope is alias for all-scope strip', () => {
    const mixed = ['clouds.console:read', 'clouds.ecs:write'];
    expect(stripTenantConsoleUmbrellaIfTenantScope('system', mixed)).toEqual(['clouds.ecs:write']);
  });
});
