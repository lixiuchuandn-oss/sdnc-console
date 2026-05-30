import { assertLegacyConsoleWsAccess } from './wsConsoleAccess';

describe('assertLegacyConsoleWsAccess', () => {
  it('allows tenant role without clouds.console:write', () => {
    expect(() => assertLegacyConsoleWsAccess({ role: 'tenant' })).not.toThrow();
  });

  it('allows super_admin', () => {
    expect(() => assertLegacyConsoleWsAccess({ role: 'super_admin' })).not.toThrow();
  });

  it('requires clouds.console:write for system admin without permissions in JWT', () => {
    expect(() => assertLegacyConsoleWsAccess({ role: 'admin', permissions: [] })).toThrow(
      /clouds\.console:write/,
    );
  });

  it('allows system user with clouds.console:write in token payload', () => {
    expect(() =>
      assertLegacyConsoleWsAccess({ role: 'admin', permissions: ['clouds.console:write'] }),
    ).not.toThrow();
  });
});
