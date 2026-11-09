import {
  configBusinessEqual,
  configSemanticEqual,
  diffConfigSemantic,
  formatConfigSemanticDiffs,
  hasDestructiveSemanticDiff,
} from './configSemanticEqual';

describe('configSemanticEqual', () => {
  it('ignores object key order', () => {
    expect(configSemanticEqual({ b: 1, a: 2 }, { a: 2, b: 1 })).toBe(true);
  });

  it('ignores CSM meta fields', () => {
    expect(
      configSemanticEqual(
        { bgp: [{ asn: 1 }], _id: { $oid: 'aaa' }, createDate: { $date: 1 }, updateDate: { $date: 2 } },
        { bgp: [{ asn: 1 }], _id: { $oid: 'bbb' }, createDate: { $date: 9 }, report_config_status: 'applied' },
      ),
    ).toBe(true);
  });

  it('detects business field drift', () => {
    expect(configSemanticEqual({ bgp: [{ asn: 1 }] }, { bgp: [{ asn: 2 }] })).toBe(false);
  });
});

describe('configBusinessEqual', () => {
  it('treats neighbor array order as equal', () => {
    const a = {
      bgp: [
        {
          asn: 65001,
          neighbor: [
            { remote_ip: '2200::100', remote_as: 65002 },
            { remote_ip: '11.1.1.11', remote_as: 65000 },
          ],
        },
      ],
    };
    const b = {
      bgp: [
        {
          asn: 65001,
          neighbor: [
            { remote_ip: '11.1.1.11', remote_as: 65000 },
            { remote_ip: '2200::100', remote_as: 65002 },
          ],
        },
      ],
    };
    expect(configSemanticEqual(a, b)).toBe(false);
    expect(configBusinessEqual(a, b)).toBe(true);
  });
});

describe('diffConfigSemantic', () => {
  it('treats extra platform neighbor as additive', () => {
    const device = {
      bgp: [{ asn: 65001, router_id: '10.1.1.100', address_family: [] }],
      ipv6_route: [{ destination: '2200::/64', via: '2100::1' }],
    };
    const platform = {
      bgp: [
        {
          asn: 65001,
          router_id: '10.1.1.100',
          address_family: [{ address_family: 'ipv4', modifiler: 'vpn', activate_address_family: ['2200::100'] }],
          neighbor: [{ remote_ip: '2200::100', remote_as: 65002 }],
        },
      ],
      ipv6_route: [
        { destination: '2200::/64', via: '2100::1' },
        { destination: '::/0', vrf: 10001, via: 'nexthop-vrf 0' },
      ],
    };
    const diffs = diffConfigSemantic(device, platform);
    expect(hasDestructiveSemanticDiff(diffs)).toBe(false);
    expect(diffs.some((d) => d.kind === 'added')).toBe(true);
  });

  it('flags device-only neighbor as removed', () => {
    const device = {
      bgp: [
        {
          asn: 65001,
          neighbor: [{ remote_ip: '2001:db8::9', remote_as: 65099 }],
        },
      ],
    };
    const platform = {
      bgp: [
        {
          asn: 65001,
          neighbor: [{ remote_ip: '2200::100', remote_as: 65002 }],
        },
      ],
    };
    const diffs = diffConfigSemantic(device, platform);
    expect(hasDestructiveSemanticDiff(diffs)).toBe(true);
    expect(
      formatConfigSemanticDiffs(diffs, { leftLabel: '设备', rightLabel: '平台' }),
    ).toMatch(/2001:db8::9|设备多出|平台多出|remote_ip/);
  });

  it('flags asn change', () => {
    const diffs = diffConfigSemantic({ bgp: [{ asn: 1 }] }, { bgp: [{ asn: 429 }] });
    expect(hasDestructiveSemanticDiff(diffs)).toBe(true);
  });

  it('flags replacing plain route with same dest/via but new vrf as destructive', () => {
    const device = {
      ipv6_route: [{ destination: '2200::/64', via: '2100::1' }],
    };
    const platform = {
      ipv6_route: [{ destination: '2200::/64', via: '2100::1', vrf: 9999 }],
    };
    const diffs = diffConfigSemantic(device, platform);
    expect(hasDestructiveSemanticDiff(diffs)).toBe(true);
    expect(diffs.some((d) => d.kind === 'removed')).toBe(true);
    expect(diffs.some((d) => d.kind === 'added')).toBe(true);
  });

  it('allows first-tunnel inject of extra neighbor and vrf default route', () => {
    const device = {
      bgp: [{ asn: 65001, router_id: '10.1.1.100', address_family: [] }],
      ipv6_route: [{ destination: '2200::/64', via: '2100::1' }],
    };
    const platform = {
      bgp: [
        {
          asn: 65001,
          router_id: '10.1.1.100',
          address_family: [
            {
              address_family: 'ipv4',
              modifiler: 'vpn',
              activate_address_family: ['2200::100'],
            },
          ],
          neighbor: [{ remote_ip: '2200::100', remote_as: 65002 }],
          neighbor_disable_connected_check: ['2200::100'],
        },
      ],
      ipv6_route: [
        { destination: '2200::/64', via: '2100::1' },
        { destination: '::/0', vrf: 10001, via: 'nexthop-vrf 0' },
      ],
    };
    const diffs = diffConfigSemantic(device, platform);
    expect(hasDestructiveSemanticDiff(diffs)).toBe(false);
  });
});
