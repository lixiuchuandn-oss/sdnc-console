import { ALL_PERMISSIONS } from './permissions';
import { isPermissionInSdncCatalog } from './effectivePermissions';

describe('effectivePermissions (SDNC IBR catalog)', () => {
  const prev = process.env.PRODUCT_FLAVOR;

  afterEach(() => {
    if (prev === undefined) delete process.env.PRODUCT_FLAVOR;
    else process.env.PRODUCT_FLAVOR = prev;
    jest.resetModules();
  });

  it('isPermissionInSdncCatalog includes IBR and SETTINGS only', () => {
    expect(isPermissionInSdncCatalog('networks.srv6:read')).toBe(true);
    expect(isPermissionInSdncCatalog('networks.rr-domains:read')).toBe(true);
    expect(isPermissionInSdncCatalog('networks.vr-config:read')).toBe(true);
    expect(isPermissionInSdncCatalog('system.roles:read')).toBe(true);
    expect(isPermissionInSdncCatalog('users:read')).toBe(true);
    expect(isPermissionInSdncCatalog('networks.security-domain:read')).toBe(false);
  });

  it('getEffectivePermissionCatalog filters when PRODUCT_FLAVOR=sdnc', () => {
    process.env.PRODUCT_FLAVOR = 'sdnc';
    jest.resetModules();
    const { getEffectivePermissionCatalog: getSdncCatalog } = require('./effectivePermissions');
    const catalog = getSdncCatalog(ALL_PERMISSIONS);
    expect(catalog).toContain('networks.vr-config:read');
    expect(catalog).toContain('system.audit:read');
    expect(catalog).not.toContain('networks.security-domain:read');
  });

  it('getEffectivePermissionCatalog returns full list when not sdnc', () => {
    process.env.PRODUCT_FLAVOR = 'tower';
    jest.resetModules();
    const { getEffectivePermissionCatalog: getTowerCatalog } = require('./effectivePermissions');
    expect(getTowerCatalog(ALL_PERMISSIONS)).toEqual([...ALL_PERMISSIONS]);
  });
});
