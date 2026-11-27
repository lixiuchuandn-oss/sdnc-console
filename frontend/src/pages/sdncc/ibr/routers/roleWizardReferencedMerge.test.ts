import {
  applyCeWizardReferencedChanges,
  applyIpsecPresetWizardReferencedChanges,
  readCeFingerprintSnapshot,
} from './roleWizardReferencedMerge';

const ceBase = () => ({
  role: 'CE',
  interfaces_GigabitEthernet: [
    { name: 'GigabitEthernet 0/7/0', ipv4_static: '23.1.1.3/24', ipv6_static: '2100::3/64', tunnel_keep: 'yes' },
    { name: 'GigabitEthernet 0/8/0', ipv4_static: '34.1.1.3/24\n34.1.1.254/24', ipv6_static: '2408::1/64' },
  ],
  bgp: [
    {
      asn: 65001,
      router_id: '23.1.1.3',
      neighbor: [{ remote_ip: '2200::1' }],
    },
  ],
  ipv6_route: [{ destination: '240f::/64', via: '2100::1' }],
  ce: {
    publicConfig: {
      wanName: 'GigabitEthernet 0/7/0',
      wanIpv4: '23.1.1.3/24',
      wanIpv6: '2100::3/64',
      publicBgp: { asn: 65001, routerId: '23.1.1.3' },
    },
    lanConfig: [{ lanName: 'GigabitEthernet 0/8/0', lanIpv4: '34.1.1.3/24', lanIpv6: '2408::1/64' }],
  },
});

describe('applyCeWizardReferencedChanges', () => {
  it('blocks fingerprint field changes', () => {
    const { changedLabels, blockedReasons, cfg } = applyCeWizardReferencedChanges(ceBase(), {
      wanName: 'GigabitEthernet 0/7/0',
      wanIpv4: '23.1.1.3/24',
      lanName: 'GigabitEthernet 0/8/0',
      lanIpv4: '34.1.1.9/24',
      bgpAsn: 65001,
    });
    expect(changedLabels).toEqual([]);
    expect(blockedReasons?.some((s) => s.includes('LAN IPv4'))).toBe(true);
    expect(cfg).toEqual(ceBase());
  });

  it('treats VRRP-concat IPv4 as same primary address (no-op)', () => {
    const { changedLabels, blockedReasons } = applyCeWizardReferencedChanges(ceBase(), {
      wanName: 'GigabitEthernet 0/7/0',
      wanIpv4: '23.1.1.3/24',
      lanName: 'GigabitEthernet 0/8/0',
      lanIpv4: '34.1.1.3/2434.1.1.254/24',
      bgpAsn: 65001,
      wanIpv6: '2100::3/64',
      lanIpv6: '2408::1/64',
      bgpRouterId: '23.1.1.3',
    });
    expect(blockedReasons).toBeUndefined();
    expect(changedLabels).toEqual([]);
  });

  it('patches WAN IPv6 and keeps tunnel neighbor / routes', () => {
    const { cfg, changedLabels, blockedReasons } = applyCeWizardReferencedChanges(ceBase(), {
      wanName: 'GigabitEthernet 0/7/0',
      wanIpv4: '23.1.1.3/24',
      wanIpv6: '2100::9/64',
      lanName: 'GigabitEthernet 0/8/0',
      lanIpv4: '34.1.1.3/24',
      bgpAsn: 65001,
      bgpRouterId: '23.1.1.3',
    });
    expect(blockedReasons).toBeUndefined();
    expect(changedLabels).toContain('WAN 侧 IPv6');
    const ifs = cfg.interfaces_GigabitEthernet as Record<string, unknown>[];
    expect(ifs.find((i) => i.name === 'GigabitEthernet 0/7/0')?.ipv6_static).toBe('2100::9/64');
    expect(ifs.find((i) => i.name === 'GigabitEthernet 0/7/0')?.tunnel_keep).toBe('yes');
    expect((cfg.bgp as any)[0].neighbor).toEqual([{ remote_ip: '2200::1' }]);
    expect(cfg.ipv6_route).toEqual([{ destination: '240f::/64', via: '2100::1' }]);
  });

  it('reads fingerprint using primary IPv4', () => {
    expect(readCeFingerprintSnapshot(ceBase()).lanIpv4).toBe('34.1.1.3/24');
  });
});

describe('applyIpsecPresetWizardReferencedChanges', () => {
  const base = () => ({
    role: '标准',
    ipsec_preset: {
      wan_interface: 'GigabitEthernet 0/7/0',
      wan_ipv4: '1.2.3.4/24',
      wan_ipv6: '2001:db8::1/64',
      lan_interface: 'GigabitEthernet 0/8/0',
      lan_ipv4: '10.0.0.1/24',
      gateway: '1.2.3.1',
      enable_nat: false,
    },
    interfaces_GigabitEthernet: [
      { name: 'GigabitEthernet 0/7/0', ipv4_static: '1.2.3.4/24', ipv6_static: '2001:db8::1/64' },
      { name: 'GigabitEthernet 0/8/0', ipv4_static: '10.0.0.1/24' },
    ],
    ipv4_route: [
      { destination: '0.0.0.0/0', via: '1.2.3.1', priority: 100 },
      { destination: '8.8.8.8/32', via: '1.2.3.1' },
    ],
    bgp: [{ asn: 1, neighbor: [{ ip: 'keep' }] }],
  });

  it('blocks LAN IPv4 change and leaves extra routes', () => {
    const { blockedReasons, cfg } = applyIpsecPresetWizardReferencedChanges(base(), {
      wanInterface: 'GigabitEthernet 0/7/0',
      wanIpv4: '1.2.3.4/24',
      lanInterface: 'GigabitEthernet 0/8/0',
      lanIpv4: '10.0.0.9/24',
    });
    expect(blockedReasons?.some((s) => s.includes('LAN IPv4'))).toBe(true);
    expect(cfg.ipv4_route).toHaveLength(2);
    expect((cfg.bgp as any)[0].neighbor).toEqual([{ ip: 'keep' }]);
  });

  it('patches WAN IPv6 without replacing interface table', () => {
    const { cfg, changedLabels } = applyIpsecPresetWizardReferencedChanges(base(), {
      wanInterface: 'GigabitEthernet 0/7/0',
      wanIpv4: '1.2.3.4/24',
      wanIpv6: '2001:db8::9/64',
      lanInterface: 'GigabitEthernet 0/8/0',
      lanIpv4: '10.0.0.1/24',
      ipsecPublicIp: '1.2.3.1',
    });
    expect(changedLabels).toContain('WAN 侧 IPv6');
    expect(cfg.interfaces_GigabitEthernet).toHaveLength(2);
    expect((cfg.ipsec_preset as any).wan_ipv6).toBe('2001:db8::9/64');
  });
});
