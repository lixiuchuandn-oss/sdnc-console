import {
  buildSrv6PeerRouteDestination,
  extractWanIpv6Gateway,
  isIpv6HostInCidr,
  maskToIpv6Network,
  resolveSid64Via,
  SID64_SKIP_ONLINK_MESSAGE,
  SID64_VIA_IN_DEST_MESSAGE,
  decideSid64Route,
  describeSid64InvalidRoute,
  formatPairedEndpointNotes,
  formatSid64InjectPlanNote,
  validateSid64NextHop,
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

    it('prefers ::/0 gateway over a SID-shaped public route', () => {
      const selfCfg = {
        ipv6_route: [
          { destination: '240f:2033::/64', via: '240f:2033::1' },
          { destination: '::/0', via: '500::1' },
        ],
      };
      expect(extractWanIpv6Gateway(selfCfg)).toBe('500::1');
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

  describe('validateSid64NextHop', () => {
    it('rejects via inside SID destination CIDR', () => {
      expect(isIpv6HostInCidr('2200::100', '2200::/64')).toBe(true);
      expect(validateSid64NextHop('2200::/64', '2200::100')).toBe(SID64_VIA_IN_DEST_MESSAGE);
    });

    it('allows via outside destination (direct or gateway)', () => {
      expect(isIpv6HostInCidr('203::44', '240f:2033::/64')).toBe(false);
      expect(validateSid64NextHop('240f:2033::/64', '203::44')).toBeUndefined();
      expect(validateSid64NextHop('240f:2033::/64', '500::1')).toBeUndefined();
    });

    it('ignores nexthop-vrf and incomplete pairs', () => {
      expect(validateSid64NextHop('::/0', 'nexthop-vrf 0')).toBeUndefined();
      expect(validateSid64NextHop('2200::/64', '')).toBeUndefined();
      expect(validateSid64NextHop('', '2200::100')).toBeUndefined();
    });
  });

  describe('decideSid64Route', () => {
    it('skips SID static when local WAN is on-link with peer SID prefix', () => {
      const out = decideSid64Route('2200::/64', '2200::100', '2200::1');
      expect(out.decision).toBe('skip_onlink');
      expect(out.message).toBe(SID64_SKIP_ONLINK_MESSAGE);
    });

    it('still rejects cross-subnet via-in-dest when local WAN is outside SID prefix', () => {
      const out = decideSid64Route('2200::/64', '2200::100', '2100::1');
      expect(out.decision).toBe('invalid');
      expect(out.message).toBe(describeSid64InvalidRoute('2200::/64', '2200::100'));
      expect(out.message).toContain('"destination": "2200::/64"');
      expect(out.message).toContain('"via": "2200::100"');
      expect(out.message).toContain(SID64_VIA_IN_DEST_MESSAGE);
    });

    it('formatSid64InjectPlanNote shows blocked SID snippet and VRF default', () => {
      const note = formatSid64InjectPlanNote({
        sid: { destination: '2200::/64', via: '2100::1' },
        sidDecision: 'invalid',
        vrfDefault: { destination: '::/0', vrf: 10, via: 'nexthop-vrf 0' },
      });
      expect(note).toContain('拦截未下发');
      expect(note).toContain('"destination": "2200::/64"');
      expect(note).toContain('"via": "2100::1"');
      expect(note).toContain('nexthop-vrf 0');
    });

    it('injects when via is outside destination', () => {
      expect(decideSid64Route('240f:2033::/64', '203::44', '203::22').decision).toBe('inject');
    });
  });

  describe('formatPairedEndpointNotes', () => {
    it('dedupes identical PE-A and PE-B reasons', () => {
      expect(formatPairedEndpointNotes('同一原因', '同一原因')).toBe('PE-A：同一原因\nPE-B：同 PE-A');
    });

    it('keeps distinct reasons', () => {
      expect(formatPairedEndpointNotes('A因', 'B因')).toBe('PE-A：A因\nPE-B：B因');
    });
  });
});
