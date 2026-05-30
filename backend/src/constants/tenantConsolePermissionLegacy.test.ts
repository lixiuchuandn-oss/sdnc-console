import {
  isTenantConsoleUmbrellaPermission,
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
});
