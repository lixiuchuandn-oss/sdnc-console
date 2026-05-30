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

  it('canAccessTenantConsole — 策略 B', () => {
    expect(canAccessTenantConsole({ role: 'tenant' })).toBe(true);
    expect(canAccessTenantConsole({ role: 'super_admin' })).toBe(true);
    expect(canAccessTenantConsole({ role: 'admin', permissions: [] })).toBe(false);
    expect(
      canAccessTenantConsole({ role: 'admin', permissions: ['clouds.console:read'] }),
    ).toBe(true);
  });

  it('resolvePostLoginPath', () => {
    expect(resolvePostLoginPath({ role: 'tenant' })).toBe('/console');
    expect(resolvePostLoginPath({ role: 'tenant', defaultPath: '/console' })).toBe('/console');
    expect(resolvePostLoginPath({ role: 'admin' })).toBe('/admin');
    expect(resolvePostLoginPath({ role: 'super_admin' })).toBe('/admin');
  });
});
