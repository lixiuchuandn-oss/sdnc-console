import { isLegacyPeRole, isSrv6PeRole, normalizeVrRole, parseTunnelTopology } from './srv6.roles';

describe('srv6.roles', () => {
  it('recognizes SPOKE_PE and HUB_PE', () => {
    expect(isSrv6PeRole('SPOKE_PE')).toBe(true);
    expect(isSrv6PeRole('hub_pe')).toBe(true);
    expect(isSrv6PeRole('PE')).toBe(false);
    expect(isLegacyPeRole('PE')).toBe(true);
  });

  it('defaults tunnel topology to S', () => {
    expect(parseTunnelTopology(undefined)).toBe('S');
    expect(parseTunnelTopology('H')).toBe('H');
  });

  it('normalizes role text', () => {
    expect(normalizeVrRole(' spoke_pe ')).toBe('SPOKE_PE');
  });
});
