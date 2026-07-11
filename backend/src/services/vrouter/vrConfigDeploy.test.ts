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
});
