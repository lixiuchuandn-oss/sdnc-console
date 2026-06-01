import {
  hasAnyTenantCloudConsolePagePermission,
  isCloudPoolListOrMetaReadPath,
} from './tenantConsolePermissionLegacy';

describe('tenantConsolePermissionLegacy', () => {
  it('hasAnyTenantCloudConsolePagePermission accepts clouds page atoms', () => {
    expect(hasAnyTenantCloudConsolePagePermission(['clouds.backups:read'])).toBe(true);
    expect(hasAnyTenantCloudConsolePagePermission(['clouds.ecs:write'])).toBe(true);
    expect(hasAnyTenantCloudConsolePagePermission(['clouds:read'])).toBe(true);
  });

  it('hasAnyTenantCloudConsolePagePermission rejects console umbrella only', () => {
    expect(hasAnyTenantCloudConsolePagePermission(['clouds.console:read'])).toBe(false);
    expect(hasAnyTenantCloudConsolePagePermission([])).toBe(false);
  });

  it('isCloudPoolListOrMetaReadPath matches list and meta only', () => {
    expect(isCloudPoolListOrMetaReadPath('/api/clouds', 'GET')).toBe(true);
    expect(isCloudPoolListOrMetaReadPath('/api/clouds/pool-1', 'GET')).toBe(true);
    expect(isCloudPoolListOrMetaReadPath('/api/clouds/pool-1/resources/ecs', 'GET')).toBe(false);
    expect(isCloudPoolListOrMetaReadPath('/api/clouds', 'POST')).toBe(false);
  });
});
