import {
  buildSrv6PeerRouteDestination,
  extractWanIpv6Gateway,
  maskToIpv6Network,
  resolveSid64Via,
} from './srv6Ipv6';

describe('srv6Ipv6', () => {
  it('masks SID host to /64 network', () => {
    expect(maskToIpv6Network('240f:2033::1235', 64)).toBe('240f:2033::');
    expect(buildSrv6PeerRouteDestination('240f:2033::1235')).toBe('240f:2033::/64');
  });

  it('does not keep host bits (97f843f regression)', () => {
    expect(buildSrv6PeerRouteDestination('240f:2033::1235')).not.toBe('240f:2033::1235/64');
  });

  it('handles expanded form without ::', () => {
    expect(buildSrv6PeerRouteDestination('240f:2033:0:0:0:0:0:1235')).toBe('240f:2033::/64');
  });

  it('uses configured plen when in 40–88', () => {
    expect(buildSrv6PeerRouteDestination('240f:2033::/48')).toBe('240f:2033::/48');
    expect(buildSrv6PeerRouteDestination('240f:2033::1235/64')).toBe('240f:2033::/64');
  });

  it('falls back to /64 when plen omitted or out of phase-1 range', () => {
    expect(buildSrv6PeerRouteDestination('240f:2033::')).toBe('240f:2033::/64');
    expect(buildSrv6PeerRouteDestination('240f:2033::/32')).toBe('240f:2033::/64');
  });

  describe('resolveSid64Via §14.14.1', () => {
    const peerCfg = {
      interfaces_eth0: [{ ipv6_static: '203::44/64' }],
    };

    it('uses peer public IPv6 when no WAN gateway (direct connect)', () => {
      expect(resolveSid64Via({}, peerCfg)).toBe('203::44');
      expect(resolveSid64Via({ ipv6_route: [] }, peerCfg)).toBe('203::44');
    });

    it('uses self WAN ipv6_route via when configured', () => {
      const selfCfg = {
        ipv6_route: [{ destination: '::/0', via: '500::1' }],
      };
      expect(resolveSid64Via(selfCfg, peerCfg)).toBe('500::1');
    });

    it('ignores vrf-scoped routes and nexthop-vrf via', () => {
      const selfCfg = {
        ipv6_route: [
          { destination: '::/0', vrf: 7777, via: 'nexthop-vrf 0' },
          { destination: '240f::/64', via: '600::1' },
        ],
      };
      expect(extractWanIpv6Gateway(selfCfg)).toBe('600::1');
      expect(resolveSid64Via(selfCfg, peerCfg)).toBe('600::1');
    });

    it('prefers inventory ipv6Via for selected Hub WAN (P2b)', () => {
      const selfCfg = {
        _towerHubInventory: {
          wan: [
            { ifName: 'ge0', ipv6Via: '203::33' },
            { ifName: 'ge1', ipv6Via: '203::44' },
          ],
          lan: [],
        },
        ipv6_route: [
          { destination: '::/0', via: '203::33' },
          { destination: '::/0', via: '203::44' },
        ],
      };
      expect(extractWanIpv6Gateway(selfCfg, 'ge1')).toBe('203::44');
      expect(resolveSid64Via(selfCfg, peerCfg, 'ge1')).toBe('203::44');
      expect(extractWanIpv6Gateway(selfCfg, 'ge0')).toBe('203::33');
    });

    it('matches ipv6_route by WAN ordinal when inventory has no ipv6Via', () => {
      const selfCfg = {
        _towerHubInventory: {
          wan: [{ ifName: 'ge0' }, { ifName: 'ge1' }],
          lan: [],
        },
        ipv4_route: [
          { destination: '0.0.0.0/0', dev: 'ge0', priority: 100 },
          { destination: '0.0.0.0/0', dev: 'ge1', priority: 100 },
        ],
        ipv6_route: [
          { destination: '::/0', via: '203::33' },
          { destination: '::/0', via: '203::44' },
        ],
      };
      expect(extractWanIpv6Gateway(selfCfg, 'ge1')).toBe('203::44');
    });

    it('falls back to peer public IPv6 when local WAN has no ipv6_route', () => {
      expect(resolveSid64Via({}, peerCfg, 'ge0')).toBe('203::44');
      expect(resolveSid64Via({ ipv6_route: [] }, peerCfg, 'ge1')).toBe('203::44');
    });
  });
});
