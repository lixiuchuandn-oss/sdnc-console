import { mergeBaselineWithContributions } from './srv6.merge';
import type { Srv6EndpointInjectedDelta } from '../../entities/vRouter/srv6Tunnel.types';
import { TOWER_HUB_INVENTORY_KEY } from './srv6.hubInventory';

/** PE22 类：向导基线（删除后期望态） */
const pe22Baseline = {
  pe: {
    publicConfig: { publicBgpIndex: 0 },
    innerConfig: { innerVrf: 9999 },
  },
  interfaces_GigabitEthernet: [
    { name: 'GigabitEthernet 0/0/0', ipv6_static: '203::22/64' },
    { name: 'GigabitEthernet 0/0/1', ipv4_static: '101.1.1.1/24', vrf: 9999 },
  ],
  ipv4_route: [{ destination: '192.168.22.0/24', via: '101.1.1.22' }],
  segment_routing_srv6: {
    locator: 'pe22-locator',
    sid_prefix: '240f:2022::/64',
  },
  vrf: [{ id: 9999, name: 'inner-vrf' }],
  bgp: [
    {
      vrf: 0,
      asn: 429,
      router_id: '203::22',
      segment_routing_srv6: 'enable',
      bgp_ebgp_requires_policy: 'disable',
      address_family: [],
    },
    {
      vrf: 9999,
      asn: 105,
      bgp_ebgp_requires_policy: 'disable',
      address_family: [
        {
          address_family: 'ipv4',
          modifiler: 'unicast',
          export_route: 'enable',
          import_route: 'enable',
          auto_assign_sid: 'enable',
        },
      ],
    },
  ],
};

/** PE22-A 端隧道贡献 */
const pe22PeAContrib: Srv6EndpointInjectedDelta = {
  neighbors: [
    { bgpIndex: 0, remote_ip: '203::33', remote_as: 430, ebgp_multihop: 255 },
    { bgpIndex: 1, remote_ip: '101.1.1.22', remote_as: 122 },
  ],
  activateAddressFamily: [{ bgpIndex: 0, peerIp: '203::33' }],
  neighborDisableConnectedCheck: [{ bgpIndex: 0, remote_ip: '203::33' }],
  rdRt: [{ bgpIndex: 1, route_distinguisher: '429:9999', route_target: '429:9999' }],
  ipv6Routes: [
    { destination: '240f:2033::/64', via: '203::33' },
    { destination: '::/0', vrf: 9999, via: 'nexthop-vrf 0' },
  ],
};

describe('srv6.merge', () => {
  it('M1: baseline only equals baseline', () => {
    const out = mergeBaselineWithContributions(pe22Baseline, []);
    expect(out).toEqual(pe22Baseline);
    expect(out.ipv6_route).toBeUndefined();
    expect((out.bgp as unknown[])[0]).not.toHaveProperty('neighbor');
  });

  it('M2: baseline + PE22-A contribution adds tunnel increments', () => {
    const out = mergeBaselineWithContributions(pe22Baseline, [pe22PeAContrib]);
    const pubBgp = (out.bgp as Record<string, unknown>[])[0];
    expect(pubBgp.neighbor).toEqual([{ remote_ip: '203::33', remote_as: 430, ebgp_multihop: 255 }]);
    expect(pubBgp.neighbor_disable_connected_check).toEqual(['203::33']);

    const vpnAf = (pubBgp.address_family as Record<string, unknown>[]).find(
      (af) => af.modifiler === 'vpn',
    );
    expect(vpnAf?.activate_address_family).toEqual(['203::33']);

    const innerBgp = (out.bgp as Record<string, unknown>[])[1];
    expect(innerBgp.neighbor).toEqual([{ remote_ip: '101.1.1.22', remote_as: 122 }]);
    const uniAf = (innerBgp.address_family as Record<string, unknown>[]).find(
      (af) => af.modifiler === 'unicast',
    );
    expect(uniAf?.route_distinguisher).toBe('429:9999');
    expect(uniAf?.route_target).toBe('429:9999');

    expect(out.ipv6_route).toEqual([
      { destination: '240f:2033::/64', via: '203::33' },
      { destination: '::/0', vrf: 9999, via: 'nexthop-vrf 0' },
    ]);

    // 基线静态字段保留
    expect(out.ipv4_route).toEqual(pe22Baseline.ipv4_route);
    expect(out.segment_routing_srv6).toEqual(pe22Baseline.segment_routing_srv6);
  });

  it('M3 / PE22: delete recompute (exclude tunnel) restores baseline', () => {
    const withTunnel = mergeBaselineWithContributions(pe22Baseline, [pe22PeAContrib]);
    expect(withTunnel.ipv6_route).toBeDefined();

    const afterDelete = mergeBaselineWithContributions(pe22Baseline, []);
    expect(afterDelete).toEqual(pe22Baseline);

    const pubBgp = (afterDelete.bgp as Record<string, unknown>[])[0];
    expect(pubBgp.neighbor).toBeUndefined();
    const innerBgp = (afterDelete.bgp as Record<string, unknown>[])[1];
    const uniAf = (innerBgp.address_family as Record<string, unknown>[])[0];
    expect(uniAf.route_distinguisher).toBeUndefined();
    expect(uniAf.route_target).toBeUndefined();
    expect(innerBgp.neighbor).toBeUndefined();
  });

  it('CE contribution merges inner neighbor only', () => {
    const ceBaseline = {
      bgp: [{ asn: 200, bgp_ebgp_requires_policy: 'disable', address_family: [] }],
    };
    const ceContrib: Srv6EndpointInjectedDelta = {
      neighbors: [{ bgpIndex: 0, remote_ip: '101.1.1.1', remote_as: 105 }],
    };
    const out = mergeBaselineWithContributions(ceBaseline, [ceContrib]);
    expect((out.bgp as Record<string, unknown>[])[0].neighbor).toEqual([
      { remote_ip: '101.1.1.1', remote_as: 105 },
    ]);
  });

  it('legacy PE-PE archive with NDC but no ebgp_multihop backfills 255', () => {
    const legacy: Srv6EndpointInjectedDelta = {
      neighbors: [{ bgpIndex: 0, remote_ip: '203::33', remote_as: 430 }],
      activateAddressFamily: [{ bgpIndex: 0, peerIp: '203::33' }],
      neighborDisableConnectedCheck: [{ bgpIndex: 0, remote_ip: '203::33' }],
    };
    const out = mergeBaselineWithContributions(pe22Baseline, [legacy]);
    const pub = (out.bgp as Record<string, unknown>[])[0];
    expect(pub.neighbor).toEqual([{ remote_ip: '203::33', remote_as: 430, ebgp_multihop: 255 }]);
  });

  it('upserts ebgp_multihop onto an existing baseline neighbor', () => {
    const baseline = {
      bgp: [
        {
          vrf: 0,
          asn: 429,
          neighbor: [{ remote_ip: '203::33', remote_as: 430 }],
          address_family: [],
        },
      ],
    };
    const contrib: Srv6EndpointInjectedDelta = {
      neighbors: [{ bgpIndex: 0, remote_ip: '203::33', remote_as: 430, ebgp_multihop: 255 }],
      neighborDisableConnectedCheck: [{ bgpIndex: 0, remote_ip: '203::33' }],
    };
    const out = mergeBaselineWithContributions(baseline, [contrib]);
    const pub = (out.bgp as Record<string, unknown>[])[0];
    expect(pub.neighbor).toEqual([{ remote_ip: '203::33', remote_as: 430, ebgp_multihop: 255 }]);
  });

  it('CE neighbors without NDC do not receive ebgp_multihop', () => {
    const mixed: Srv6EndpointInjectedDelta = {
      neighbors: [
        { bgpIndex: 0, remote_ip: '203::33', remote_as: 430 },
        { bgpIndex: 1, remote_ip: '101.1.1.22', remote_as: 122 },
      ],
      neighborDisableConnectedCheck: [{ bgpIndex: 0, remote_ip: '203::33' }],
    };
    const out = mergeBaselineWithContributions(pe22Baseline, [mixed]);
    const inner = (out.bgp as Record<string, unknown>[])[1];
    expect(inner.neighbor).toEqual([{ remote_ip: '101.1.1.22', remote_as: 122 }]);
  });

  describe('P5.3 Hub merge', () => {
    const pe3HubBaseline = {
      bgp: [
        { vrf: 0, asn: 430, router_id: '203.100.100.33', address_family: [] },
        {
          vrf: 7777,
          asn: 106,
          router_id: '102.1.1.33',
          address_family: [{ address_family: 'ipv4', modifiler: 'unicast' }],
        },
      ],
    };

    const pe22HubContrib: Srv6EndpointInjectedDelta = {
      neighbors: [
        { bgpIndex: 0, remote_ip: '203::22', remote_as: 430 },
        { bgpIndex: 1, remote_ip: '102.1.1.22', remote_as: 122 },
      ],
      activateAddressFamily: [{ bgpIndex: 0, peerIp: '203::22' }],
      neighborDisableConnectedCheck: [{ bgpIndex: 0, remote_ip: '203::22' }],
      rdRt: [{ bgpIndex: 1, route_distinguisher: '200:12851', route_target: '200:40988' }],
    };

    const pe2HubContribReuse: Srv6EndpointInjectedDelta = {
      neighbors: [
        { bgpIndex: 0, remote_ip: '203::44', remote_as: 440 },
        { bgpIndex: 1, remote_ip: '102.1.1.22', remote_as: 122 },
      ],
      activateAddressFamily: [{ bgpIndex: 0, peerIp: '203::44' }],
      neighborDisableConnectedCheck: [{ bgpIndex: 0, remote_ip: '203::44' }],
      rdRt: [{ bgpIndex: 1, route_distinguisher: '200:99999', route_target: '200:40944' }],
    };

    const packHub = (delta: Srv6EndpointInjectedDelta, mode: 'REUSE_VRF' | 'DEDICATED_VRF') => ({
      delta,
      isHubPeSlot: true,
      hubVrfMode: mode,
    });

    it('H4/H5 REUSE_VRF: second spoke does not overwrite RD/RT on same vrf bgpIndex', () => {
      const merged = mergeBaselineWithContributions(pe3HubBaseline, [
        packHub(pe22HubContrib, 'REUSE_VRF'),
        packHub(pe2HubContribReuse, 'REUSE_VRF'),
      ]);
      const pub = (merged.bgp as Record<string, unknown>[])[0];
      expect((pub.neighbor as unknown[]).length).toBe(2);
      const inner = (merged.bgp as Record<string, unknown>[])[1];
      const uniAf = (inner.address_family as Record<string, unknown>[]).find(
        (af) => af.modifiler === 'unicast',
      );
      expect(uniAf?.route_distinguisher).toBe('200:12851');
      expect(uniAf?.route_target).toBe('200:40988');
      expect((inner.neighbor as unknown[]).length).toBe(1);
    });

    it('H7 REUSE_VRF: delete second spoke keeps first RD/RT', () => {
      const afterDeleteT2 = mergeBaselineWithContributions(pe3HubBaseline, [
        packHub(pe22HubContrib, 'REUSE_VRF'),
      ]);
      const pub = (afterDeleteT2.bgp as Record<string, unknown>[])[0];
      expect(pub.neighbor).toEqual([{ remote_ip: '203::22', remote_as: 430, ebgp_multihop: 255 }]);
      const inner = (afterDeleteT2.bgp as Record<string, unknown>[])[1];
      const uniAf = (inner.address_family as Record<string, unknown>[])[0];
      expect(uniAf.route_distinguisher).toBe('200:12851');
      expect(uniAf.route_target).toBe('200:40988');
    });

    it('DEDICATED_VRF: each spoke owns independent bgp segment RD/RT', () => {
      const pe2Dedicated: Srv6EndpointInjectedDelta = {
        neighbors: [{ bgpIndex: 0, remote_ip: '203::44', remote_as: 440 }],
        rdRt: [{ bgpIndex: 2, route_distinguisher: '200:20002', route_target: '200:40944' }],
      };
      const baselineDedicated = {
        bgp: [
          { vrf: 0, asn: 430, address_family: [] },
          {
            vrf: 7777,
            asn: 106,
            address_family: [{ address_family: 'ipv4', modifiler: 'unicast' }],
          },
          {
            vrf: 8888,
            asn: 107,
            address_family: [{ address_family: 'ipv4', modifiler: 'unicast' }],
          },
        ],
      };
      const merged = mergeBaselineWithContributions(baselineDedicated, [
        packHub(pe22HubContrib, 'DEDICATED_VRF'),
        packHub(pe2Dedicated, 'DEDICATED_VRF'),
      ]);
      const inner1 = (merged.bgp as Record<string, unknown>[])[1];
      const inner2 = (merged.bgp as Record<string, unknown>[])[2];
      expect(
        (inner1.address_family as Record<string, unknown>[])[0].route_target,
      ).toBe('200:40988');
      expect(
        (inner2.address_family as Record<string, unknown>[])[0].route_target,
      ).toBe('200:40944');
    });
  });

  describe('P5.2b Hub inventory materialize', () => {
    const hubBaselineWithInventory = {
      bgp: [{ vrf: 0, asn: 430, address_family: [] }],
      [TOWER_HUB_INVENTORY_KEY]: {
        wan: [
          {
            id: 'w-new',
            ifName: 'GigabitEthernet 0/0/9',
            ipv6: '203::99/64',
            source: 'role_wizard',
            createdAt: '2026-01-01',
          },
        ],
        lan: [],
      },
    };

    const hubNeighborContrib: Srv6EndpointInjectedDelta = {
      neighbors: [{ bgpIndex: 0, remote_ip: '203::22', remote_as: 430 }],
    };

    it('materializes wan interface from inventory on hub merge', () => {
      const merged = mergeBaselineWithContributions(hubBaselineWithInventory, [
        {
          delta: hubNeighborContrib,
          isHubPeSlot: true,
          hubVrfMode: 'REUSE_VRF',
          hubBindings: { wanIf: 'GigabitEthernet 0/0/9', wanInventoryId: 'w-new' },
        },
      ]);
      expect(merged[TOWER_HUB_INVENTORY_KEY]).toBeUndefined();
      const ifaces = merged.interfaces_GigabitEthernet as Record<string, unknown>[];
      expect(ifaces?.some((i) => i.name === 'GigabitEthernet 0/0/9')).toBe(true);
      expect((merged.bgp as Record<string, unknown>[])[0].neighbor).toHaveLength(1);
    });

    it('NR-1: S topology merge ignores hub inventory extension', () => {
      const sBaseline = {
        ...pe22Baseline,
        [TOWER_HUB_INVENTORY_KEY]: { wan: [{ id: 'x', ifName: 'ge9', ipv6: '::1/64', source: 'role_wizard', createdAt: '' }], lan: [] },
      };
      const out = mergeBaselineWithContributions(sBaseline, [pe22PeAContrib]);
      expect(out[TOWER_HUB_INVENTORY_KEY]).toBeUndefined();
      expect((out.bgp as Record<string, unknown>[])[0].neighbor).toHaveLength(1);
      expect(out.interfaces_GigabitEthernet).toEqual(pe22Baseline.interfaces_GigabitEthernet);
    });
  });
});
