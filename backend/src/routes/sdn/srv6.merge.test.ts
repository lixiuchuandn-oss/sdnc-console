import { mergeBaselineWithContributions } from './srv6.merge';
import type { Srv6EndpointInjectedDelta } from '../../entities/vRouter/srv6Tunnel.types';

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
    { bgpIndex: 0, remote_ip: '203::33', remote_as: 430 },
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
    expect(pubBgp.neighbor).toEqual([{ remote_ip: '203::33', remote_as: 430 }]);
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
});
