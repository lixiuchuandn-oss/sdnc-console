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

  it('canAccessTenantConsole — 方案 A：仅 tenant 账号', () => {
    expect(canAccessTenantConsole({ role: 'tenant' })).toBe(true);
    expect(canAccessTenantConsole({ role: 'super_admin' })).toBe(false);
    expect(canAccessTenantConsole({ role: 'admin' })).toBe(false);
    expect(canAccessTenantConsole({ role: 'admin', accountType: 'system' })).toBe(false);
  });

  it('resolvePostLoginPath', () => {
    expect(resolvePostLoginPath({ role: 'tenant' })).toBe('/console');
    expect(resolvePostLoginPath({ role: 'tenant', defaultPath: '/console' })).toBe('/console');
    expect(resolvePostLoginPath({ role: 'admin' })).toBe('/admin');
    expect(resolvePostLoginPath({ role: 'super_admin' })).toBe('/admin');
  });
});
