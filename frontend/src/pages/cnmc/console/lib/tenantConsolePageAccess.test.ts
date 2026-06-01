import {
  firstAccessibleTenantConsoleMainResourceForScope,
  firstAccessibleTenantConsoleLeftNav,
} from './tenantConsolePageAccess';

describe('tenantConsolePageAccess fallback', () => {
  it('picks first host resource when vm is not granted (legacy clouds.backups → 快照)', () => {
    const perms = ['clouds.backups:read', 'clouds.backups:write'];
    expect(firstAccessibleTenantConsoleMainResourceForScope(perms, 'host')).toBe('snapshot');
    expect(firstAccessibleTenantConsoleLeftNav(perms, false)).toBe('host');
  });

  it('skips host nav when no host-scope pages are granted', () => {
    const perms = ['clouds.subnets.flat:read'];
    expect(firstAccessibleTenantConsoleLeftNav(perms, false)).toBe('flat');
  });
});
