import { assertLegacyConsoleWsAccess } from './wsConsoleAccess';

describe('assertLegacyConsoleWsAccess', () => {
  it('allows tenant role without clouds.ecs:write', () => {
    expect(() => assertLegacyConsoleWsAccess({ role: 'tenant' })).not.toThrow();
  });

  it('allows super_admin', () => {
    expect(() => assertLegacyConsoleWsAccess({ role: 'super_admin' })).not.toThrow();
  });

  it('requires clouds.ecs:write for system admin without permissions in JWT', () => {
    expect(() => assertLegacyConsoleWsAccess({ role: 'admin', permissions: [] })).toThrow(
      /clouds\.ecs:write/,
    );
  });

  it('allows system user with clouds.ecs:write in token payload', () => {
    expect(() =>
      assertLegacyConsoleWsAccess({ role: 'admin', permissions: ['clouds.ecs:write'] }),
    ).not.toThrow();
  });

  it('allows system user with clouds:write in token payload', () => {
    expect(() =>
      assertLegacyConsoleWsAccess({ role: 'admin', permissions: ['clouds:write'] }),
    ).not.toThrow();
  });
});
