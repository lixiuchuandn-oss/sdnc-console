import {
  detectDeployDrift,
  getBlockingDriftConflicts,
  mergeDeviceWithPlatformSlice,
  normalizeIpsecSliceForDevice,
  stripMeta,
} from './vrConfigDeploy';

describe('vrConfigDeploy', () => {
  it('stripMeta removes CSM and tower extension fields', () => {
    const input = {
      bgp: [],
      code: 200,
      updateDate: 'x',
      _towerHubInventory: { wan: [] },
    };
    expect(stripMeta(input)).toEqual({ bgp: [] });
  });

  it('merge acl slice preserves device nat/ipsec', () => {
    const device = {
      nat: [{ name: 'n1' }],
      ipsec: [{ ID: 't1' }],
      acl: [{ acl_id: 1, rule: [] }],
      bgp: [{ asn: 100 }],
    };
    const platform = {
      acl: [{ acl_id: 2, rule: [{ rule_id: 1 }] }],
      nat: [],
    };
    const merged = mergeDeviceWithPlatformSlice(device, platform, 'acl');
    expect(merged.acl).toEqual(platform.acl);
    expect(merged.nat).toEqual(device.nat);
    expect(merged.ipsec).toEqual(device.ipsec);
    expect(merged.bgp).toEqual(device.bgp);
  });

  it('merge srv6 overlays platform keys but keeps device acl/nat/ipsec', () => {
    const device = {
      acl: [{ acl_id: 1 }],
      nat: [{ name: 'n1' }],
      ipsec: [{ ID: 'vpn' }],
      bgp: [{ asn: 1 }],
    };
    const platform = {
      bgp: [{ asn: 429 }],
      ipv4_route: [{ destination: '10.0.0.0/24' }],
      acl: [],
      nat: [],
      ipsec: [],
      _towerHubInventory: { wan: [] },
    };
    const merged = mergeDeviceWithPlatformSlice(device, platform, 'srv6');
    expect(merged.bgp).toEqual(platform.bgp);
    expect(merged.ipv4_route).toEqual(platform.ipv4_route);
    expect(merged.acl).toEqual(device.acl);
    expect(merged.nat).toEqual(device.nat);
    expect(merged.ipsec).toEqual(device.ipsec);
    expect(merged).not.toHaveProperty('_towerHubInventory');
  });

  it('merge srv6 keeps device interface vrrp when platform interfaces omit it', () => {
    const deviceVrrp = [{ vrid: 1, priority: 200, virtual_ipaddress: ['11.1.1.100/24'] }];
    const device = {
      vrrp: [{ group_id: 1, vrrp_instance: [1], track_interval: 3, track_gateway: [] }],
      interfaces_GigabitEthernet: [
        {
          name: 'GigabitEthernet 0/7/0',
          ipv4_static: '11.1.1.11/24',
          vrrp: deviceVrrp,
        },
        { name: 'GigabitEthernet 0/8/0', ipv4_static: '12.1.1.1/24' },
      ],
      bgp: [{ asn: 65000, neighbor: [{ remote_ip: '11.1.1.1', remote_as: 65001 }] }],
    };
    const platform = {
      interfaces_GigabitEthernet: [
        { name: 'GigabitEthernet 0/7/0', ipv4_static: '11.1.1.11/24' },
        { name: 'GigabitEthernet 0/8/0', ipv4_static: '12.1.1.1/24' },
      ],
      bgp: [{ asn: 65000, neighbor: [] }],
    };
    const merged = mergeDeviceWithPlatformSlice(device, platform, 'srv6');
    expect(merged.vrrp).toEqual(device.vrrp);
    expect(merged.bgp).toEqual(platform.bgp);
    const wan = (merged.interfaces_GigabitEthernet as Array<Record<string, unknown>>)[0];
    expect(wan.vrrp).toEqual(deviceVrrp);
  });

  it('merge srv6 preserves iface vrrp across whitespace name variants and interface key', () => {
    const deviceVrrp = [{ vrid: 1, priority: 200, virtual_ipaddress: ['11.1.1.100/24'] }];
    const device = {
      vrrp: [{ group_id: 1, vrrp_instance: [1] }],
      interface: [
        {
          name: 'GigabitEthernet 0/7/0',
          ipv4_static: '11.1.1.11/24',
          vrrp: deviceVrrp,
        },
      ],
    };
    const platform = {
      interface: [{ name: 'GigabitEthernet0/7/0', ipv4_static: '11.1.1.11/24' }],
      bgp: [{ asn: 65000 }],
    };
    const merged = mergeDeviceWithPlatformSlice(device, platform, 'srv6');
    const wan = (merged.interface as Array<Record<string, unknown>>)[0];
    expect(wan.vrrp).toEqual(deviceVrrp);
    expect(merged.vrrp).toEqual(device.vrrp);
  });

  it('normalizeIpsecSliceForDevice converts booleans and drops dpd', () => {
    const out = normalizeIpsecSliceForDevice([
      {
        ID: 'a',
        dpd: true,
        'nat-traversal': true,
        'sa-initiate': false,
      },
    ]) as Record<string, unknown>[];
    expect(out[0].dpd).toBeUndefined();
    expect(out[0]['nat-traversal']).toBe('true');
    expect(out[0]['sa-initiate']).toBe('false');
  });

  it('merge nat slice overlays nat_address_group from platform', () => {
    const device = {
      nat: [{ name: 'device-only' }],
      nat_address_group: [{ group_id: 9, static_mapping: [] }],
      acl: [{ acl_id: 1 }],
      bgp: [{ asn: 1 }],
    };
    const platform = {
      nat_address_group: [
        { group_id: 1, range: ['10.0.0.0/24'], static_mapping: [{ inside: '10.0.0.1' }] },
      ],
    };
    const merged = mergeDeviceWithPlatformSlice(device, platform, 'nat');
    expect(merged.nat_address_group).toEqual(platform.nat_address_group);
    expect(merged.nat).toEqual(device.nat);
    expect(merged.acl).toEqual(device.acl);
    expect(merged.bgp).toEqual(device.bgp);
  });

  it('detectDeployDrift flags device acl history when platform acl differs', () => {
    const device = { acl: [{ acl_id: 1, rule: [] }], bgp: [{ asn: 1 }] };
    const platform = { acl: [{ acl_id: 2, rule: [] }] };
    const conflicts = detectDeployDrift(device, platform, 'acl');
    expect(getBlockingDriftConflicts(conflicts)).toHaveLength(1);
    expect(conflicts[0].kind).toBe('DOMAIN_OVERWRITE');
    expect(conflicts[0].key).toBe('acl');
  });

  it('detectDeployDrift reports platform stale for srv6 without blocking other domains', () => {
    const device = {
      acl: [{ acl_id: 99 }],
      bgp: [{ asn: 1 }],
    };
    const platform = {
      bgp: [{ asn: 429 }],
      acl: [],
    };
    const conflicts = detectDeployDrift(device, platform, 'srv6');
    const blockers = getBlockingDriftConflicts(conflicts);
    expect(blockers.some((c) => c.key === 'bgp')).toBe(true);
    expect(conflicts.some((c) => c.kind === 'PLATFORM_STALE' && c.key === 'acl')).toBe(true);
    expect(blockers.some((c) => c.key === 'acl')).toBe(false);
  });

  it('detectDeployDrift skips srv6 when platform only injects extra neighbors/routes', () => {
    const device = {
      bgp: [{ asn: 65001, router_id: '10.1.1.100', address_family: [] }],
      ipv6_route: [{ destination: '2200::/64', via: '2100::1' }],
    };
    const platform = {
      bgp: [
        {
          asn: 65001,
          router_id: '10.1.1.100',
          address_family: [{ address_family: 'ipv4', modifiler: 'vpn' }],
          neighbor: [{ remote_ip: '2200::100', remote_as: 65002 }],
        },
      ],
      ipv6_route: [
        { destination: '2200::/64', via: '2100::1' },
        { destination: '::/0', vrf: 10001, via: 'nexthop-vrf 0' },
      ],
    };
    const conflicts = detectDeployDrift(device, platform, 'srv6');
    expect(getBlockingDriftConflicts(conflicts)).toHaveLength(0);
  });

  it('detectDeployDrift still blocks srv6 when device has extra neighbor', () => {
    const device = {
      bgp: [
        {
          asn: 65001,
          neighbor: [{ remote_ip: '2001:db8::9', remote_as: 99 }],
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
    const conflicts = detectDeployDrift(device, platform, 'srv6');
    const bgp = getBlockingDriftConflicts(conflicts).find((c) => c.key === 'bgp');
    expect(bgp).toBeTruthy();
    expect(bgp?.message).toMatch(/2001:db8::9|设备多出|将覆盖/);
  });
});
