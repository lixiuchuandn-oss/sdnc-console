import {
  buildOrderedDeviceEjectPushStages,
  cleanupBgpAfterTunnelEject,
  ejectInjectedDeltaFromConfig,
} from './srv6.eject';

describe('srv6.eject', () => {
  it('removes matching neighbor and ipv6_route', () => {
    const cfg = {
      bgp: [
        {
          vrf: 0,
          neighbor: [
            { remote_ip: '2001:db8::2', remote_as: 65002 },
            { remote_ip: '10.0.0.9', remote_as: 65009 },
          ],
        },
        {
          vrf: 10,
          neighbor: [{ remote_ip: '203.0.113.5', remote_as: 65020 }],
        },
      ],
      ipv6_route: [
        { destination: '240f:2033::/64', via: '2001:db8::2' },
        { destination: '::/0', vrf: 10, via: 'nexthop-vrf 0' },
      ],
    };
    const { config } = ejectInjectedDeltaFromConfig(cfg, {
      neighbors: [
        { bgpIndex: 0, remote_ip: '2001:db8::2' },
        { bgpIndex: 1, remote_ip: '203.0.113.5' },
      ],
      ipv6Routes: [
        { destination: '240f:2033::/64', via: '2001:db8::2' },
        { destination: '::/0', vrf: 10, via: 'nexthop-vrf 0' },
      ],
    });
    expect((config.bgp as any[])[0].neighbor).toHaveLength(1);
    expect((config.bgp as any[])[1].neighbor).toBeUndefined();
    expect(config.ipv6_route).toBeUndefined();
  });

  it('ejects PE peer neighbor + activate at public bgp index 1 (inner at 0)', () => {
    const peerIp = '2408:1111::1';
    const cfg = {
      bgp: [
        { vrf: 10, asn: 65001, neighbor: [{ remote_ip: '10.1.1.2', remote_as: 65002 }] },
        {
          vrf: 0,
          asn: 65000,
          neighbor: [{ remote_ip: peerIp, remote_as: 65003 }],
          neighbor_disable_connected_check: [peerIp],
          address_family: [
            {
              address_family: 'ipv4',
              modifiler: 'vpn',
              activate_address_family: [peerIp],
            },
          ],
        },
      ],
    };
    const delta = {
      neighbors: [{ bgpIndex: 1, remote_ip: peerIp, remote_as: 65003 }],
      activateAddressFamily: [{ bgpIndex: 1, peerIp }],
      neighborDisableConnectedCheck: [{ bgpIndex: 1, remote_ip: peerIp }],
    };
    const { config, skipped } = ejectInjectedDeltaFromConfig(cfg, delta);
    expect(skipped).toEqual([]);
    const pub = (config.bgp as any[])[1];
    expect(pub.neighbor).toBeUndefined();
    expect(pub.neighbor_disable_connected_check).toBeUndefined();
    expect(pub.address_family).toBeUndefined();
    expect((config.bgp as any[])[0].neighbor).toHaveLength(1);
  });

  it('cleanup strips ipv4 vpn activate when no neighbors remain', () => {
    const bgp: Record<string, unknown> = {
      vrf: 0,
      address_family: [
        {
          address_family: 'ipv4',
          modifiler: 'vpn',
          activate_address_family: ['2408:1111::1'],
        },
        { address_family: 'ipv4', modifiler: 'unicast', export_route: 'enable' },
      ],
    };
    cleanupBgpAfterTunnelEject(bgp);
    const afList = bgp.address_family as any[];
    expect(afList).toHaveLength(1);
    expect(afList[0].modifiler).toBe('unicast');
  });

  it('reports skipped when activate peerIp not found at declared bgpIndex', () => {
    const cfg = {
      bgp: [
        {
          vrf: 0,
          neighbor: [{ remote_ip: '2408:1111::1', remote_as: 65003 }],
          address_family: [
            {
              address_family: 'ipv4',
              modifiler: 'vpn',
              activate_address_family: ['2408:1111::1'],
            },
          ],
        },
      ],
    };
    const { skipped } = ejectInjectedDeltaFromConfig(cfg, {
      neighbors: [{ bgpIndex: 0, remote_ip: '2408:1111::1' }],
      activateAddressFamily: [{ bgpIndex: 0, peerIp: '2408:9999::9' }],
    });
    expect(skipped).toContain('activate:2408:9999::9 not found');
  });

  it('roundtrip: correct bgpIndex delta fully ejects PE peer without orphan activate', () => {
    const peerIp = '2408:2222::2';
    const cfg = {
      bgp: [
        { vrf: 10, asn: 65001, neighbor: [{ remote_ip: '10.1.1.2', remote_as: 65002 }] },
        {
          vrf: 0,
          asn: 65000,
          neighbor: [{ remote_ip: peerIp, remote_as: 65003 }],
          neighbor_disable_connected_check: [peerIp],
          address_family: [
            {
              address_family: 'ipv4',
              modifiler: 'vpn',
              activate_address_family: [peerIp],
            },
          ],
        },
      ],
    };
    const delta = {
      neighbors: [{ bgpIndex: 1, remote_ip: peerIp, remote_as: 65003 }],
      activateAddressFamily: [{ bgpIndex: 1, peerIp }],
      neighborDisableConnectedCheck: [{ bgpIndex: 1, remote_ip: peerIp }],
    };
    const { config, skipped } = ejectInjectedDeltaFromConfig(cfg, delta);
    expect(skipped).toEqual([]);
    const pub = (config.bgp as any[])[1];
    expect(pub.neighbor).toBeUndefined();
    expect(pub.neighbor_disable_connected_check).toBeUndefined();
    expect(pub.address_family).toBeUndefined();
    expect((config.bgp as any[])[0].neighbor).toHaveLength(1);
  });

  it('wrong bgpIndex 0 for peer at index 1 leaves activate until cleanup removes vpn af', () => {
    const peerIp = '2408:2222::2';
    const cfg = {
      bgp: [
        { vrf: 10, asn: 65001 },
        {
          vrf: 0,
          neighbor: [{ remote_ip: peerIp, remote_as: 65003 }],
          address_family: [
            {
              address_family: 'ipv4',
              modifiler: 'vpn',
              activate_address_family: [peerIp],
            },
          ],
        },
      ],
    };
    const wrongDelta = {
      neighbors: [{ bgpIndex: 0, remote_ip: peerIp }],
      activateAddressFamily: [{ bgpIndex: 0, peerIp }],
    };
    const { config, skipped } = ejectInjectedDeltaFromConfig(cfg, wrongDelta);
    expect(skipped.some((s) => s.includes('not found'))).toBe(true);
    const pub = (config.bgp as any[])[1];
    expect(pub.neighbor).toHaveLength(1);
    expect(
      (pub.address_family as any[]).some(
        (af) =>
          String(af.modifiler).toLowerCase() === 'vpn' &&
          Array.isArray(af.activate_address_family) &&
          af.activate_address_family.includes(peerIp),
      ),
    ).toBe(true);
  });

  it('buildOrderedDeviceEjectPushStages applies activate → ndc → neighbor', () => {
    const peerIp = '203::11';
    const cfg = {
      bgp: [
        {
          vrf: 0,
          asn: 430,
          neighbor: [
            { remote_ip: '203::22', remote_as: 429 },
            { remote_ip: peerIp, remote_as: 430 },
          ],
          neighbor_disable_connected_check: ['203::22', peerIp],
          address_family: [
            {
              address_family: 'ipv4',
              modifiler: 'vpn',
              activate_address_family: ['203::22', peerIp],
            },
          ],
        },
      ],
    };
    const delta = {
      neighbors: [{ bgpIndex: 0, remote_ip: peerIp, remote_as: 430 }],
      activateAddressFamily: [{ bgpIndex: 0, peerIp }],
      neighborDisableConnectedCheck: [{ bgpIndex: 0, remote_ip: peerIp }],
    };
    const stages = buildOrderedDeviceEjectPushStages(cfg, delta);
    expect(stages.length).toBeGreaterThanOrEqual(3);
    const afterActivate = stages[0];
    const vpnAf = ((afterActivate.bgp as any[])[0].address_family as any[]).find(
      (af) => String(af.modifiler).toLowerCase() === 'vpn',
    );
    expect(vpnAf.activate_address_family).toEqual(['203::22']);
    const finalStage = stages[stages.length - 1];
    const pub = (finalStage.bgp as any[])[0];
    expect(pub.neighbor).toHaveLength(1);
    expect(pub.neighbor[0].remote_ip).toBe('203::22');
    expect(pub.neighbor_disable_connected_check).toEqual(['203::22']);
  });
});
