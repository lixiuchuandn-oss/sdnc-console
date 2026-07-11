import {
  canAccessTenantConsole,
  isTenantAccount,
  resolveAccountType,
  resolvePostLoginPath,
} from './accountType';

describe('accountType', () => {
  it('resolveAccountType prefers explicit accountType', () => {
    expect(resolveAccountType({ role: 'admin', accountType: 'tenant' })).toBe('tenant');
    expect(resolveAccountType({ role: 'tenant' })).toBe('tenant');
    expect(resolveAccountType({ role: 'admin' })).toBe('system');
  });

  it('isTenantAccount', () => {
    expect(isTenantAccount({ role: 'tenant' })).toBe(true);
    expect(isTenantAccount({ role: 'admin' })).toBe(false);
  });

  it('canAccessTenantConsole — SDNC 无租户控制台', () => {
    expect(canAccessTenantConsole({ role: 'tenant' })).toBe(false);
    expect(canAccessTenantConsole({ role: 'super_admin' })).toBe(false);
  });

  it('resolvePostLoginPath', () => {
    expect(resolvePostLoginPath({ role: 'tenant' })).toBe('/admin');
    expect(resolvePostLoginPath({ role: 'tenant', defaultPath: '/admin/interconnect/vr' })).toBe(
      '/admin/interconnect/vr',
    );
    expect(resolvePostLoginPath({ role: 'admin' })).toBe('/admin');
    expect(resolvePostLoginPath({ role: 'super_admin' })).toBe('/admin');
  });
});
