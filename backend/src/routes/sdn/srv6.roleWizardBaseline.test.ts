import { TOWER_HUB_INVENTORY_KEY } from './srv6.hubInventory';
import {
  RoleWizardBaselineMergeError,
  mergeRoleWizardIntentIntoBaseline,
} from './srv6.roleWizardBaseline';

const lanBgp = (vrf: number, rd: string, rt: string, extra: Record<string, unknown> = {}) => ({
  asn: 65002,
  vrf,
  router_id: '23.1.1.2',
  address_family: [
    { address_family: 'ipv4', modifiler: 'unicast', route_distinguisher: rd, route_target: rt },
  ],
  ...extra,
});

describe('mergeRoleWizardIntentIntoBaseline', () => {
  const baseline = () => ({
    role: 'HUB_PE',
    interfaces_GigabitEthernet: [
      { name: 'GigabitEthernet 0/7/0', ipv6_static: '2100::100/64' },
      { name: 'GigabitEthernet 0/8/0', ipv4_static: '23.1.1.2/24', vrf: 10001 },
    ],
    vrf: [10001],
    bgp: [
      { asn: 65002, router_id: '20.1.1.100', address_family: [] },
      lanBgp(10001, '200:112', '200:57966'),
    ],
    ipv6_route: [{ destination: '2200::/64', via: '2100::1' }],
    pe: {
      publicConfig: { wanName: 'GigabitEthernet 0/7/0', ipv6Dest: '2200::/64' },
      lanConfig: [{ vrf: 10001, lanName: 'GigabitEthernet 0/8/0' }],
    },
  });

  it('adds new WAN/LAN iface, VRF, LAN BGP, pe.lanConfig and inventory without copying tunnel extras', () => {
    const incoming = {
      role: 'HUB_PE',
      interfaces_GigabitEthernet: [
        { name: 'GigabitEthernet 0/7/0', ipv6_static: '2100::100/64', tunnel_extra: 'keep-out' },
        { name: 'GigabitEthernet 0/a/0', ipv4_static: '60.1.1.100/24', ipv6_static: '2600::100/64', status: 'up' },
        { name: 'GigabitEthernet 0/8/0', ipv4_static: '23.1.1.2/24', vrf: 10001 },
        { name: 'GigabitEthernet 0/b/0', ipv4_static: '26.1.1.2/24', vrf: 10002, status: 'up' },
      ],
      vrf: [10001, 10002],
      bgp: [
        { asn: 65002, router_id: '20.1.1.100', neighbor: [{ remote_ip: '2200::1' }] },
        lanBgp(10001, '200:112', '200:57966', { neighbor: [{ remote_ip: 'keep-out' }] }),
        lanBgp(10002, '200:116', '200:57999'),
      ],
      ipv4_route: [
        { destination: '20.1.1.100/32', dev: 'GigabitEthernet 0/7/0', priority: 100 },
        { destination: '50.1.1.100/32', dev: 'GigabitEthernet 0/a/0', priority: 100 },
      ],
      ipv6_route: [
        { destination: '2200::/64', via: '2100::1' },
        { destination: '2500::/64', via: '2600::1' },
        { destination: '240f:2033::/64', via: '2100::200' },
        { destination: '::/0', vrf: 10, via: 'nexthop-vrf 0' },
      ],
      pe: {
        publicConfig: {
          wanName: 'GigabitEthernet 0/7/0',
          ipv6Dest: '2200::/64',
        },
        lanConfig: [
          { vrf: 10001, lanName: 'GigabitEthernet 0/8/0' },
          { vrf: 10002, lanName: 'GigabitEthernet 0/b/0', ipv4: '26.1.1.2/24' },
        ],
      },
      [TOWER_HUB_INVENTORY_KEY]: {
        wan: [
          { id: 'w1', ifName: 'GigabitEthernet 0/7/0', ipv6: '2100::100/64', ipv6Dest: '2200::/64', source: 'role_wizard', createdAt: 'x' },
          { id: 'w2', ifName: 'GigabitEthernet 0/a/0', ipv6: '2600::100/64', ipv6Dest: '2500::/64', source: 'role_wizard', createdAt: 'x' },
        ],
        lan: [
          { id: 'l1', ifName: 'GigabitEthernet 0/8/0', vrf: 10001, privateAsn: 65002, routerId: '23.1.1.2', source: 'role_wizard', createdAt: 'x' },
          { id: 'l2', ifName: 'GigabitEthernet 0/b/0', vrf: 10002, privateAsn: 65002, routerId: '26.1.1.2', source: 'role_wizard', createdAt: 'x' },
        ],
      },
    };

    const out = mergeRoleWizardIntentIntoBaseline(baseline(), incoming);
    const ifs = out.interfaces_GigabitEthernet as Record<string, unknown>[];
    expect(ifs.find((i) => i.name === 'GigabitEthernet 0/7/0')?.tunnel_extra).toBeUndefined();
    expect(ifs.some((i) => i.name === 'GigabitEthernet 0/a/0')).toBe(true);
    expect(ifs.some((i) => i.name === 'GigabitEthernet 0/b/0')).toBe(true);
    expect(out.vrf).toEqual([10001, 10002]);

    const bgp = out.bgp as Record<string, any>[];
    expect(bgp.find((b) => b.vrf === 10001)?.neighbor).toBeUndefined();
    expect(bgp.some((b) => b.vrf === 10002)).toBe(true);
    expect(bgp.find((b) => !b.vrf)?.neighbor).toBeUndefined();

    const pe = out.pe as Record<string, any>;
    expect(pe.lanConfig).toHaveLength(2);
    expect(pe.lanConfig[1].vrf).toBe(10002);

    const inv = out[TOWER_HUB_INVENTORY_KEY] as { lan: unknown[]; wan: unknown[] };
    expect(inv.wan).toHaveLength(2);
    expect(inv.lan).toHaveLength(2);

    const v6 = out.ipv6_route as Record<string, unknown>[];
    expect(v6).toEqual(
      expect.arrayContaining([
        { destination: '2200::/64', via: '2100::1' },
        { destination: '2500::/64', via: '2600::1' },
      ]),
    );
    expect(v6.some((r) => r.destination === '240f:2033::/64')).toBe(false);
    expect(v6.some((r) => r.vrf === 10)).toBe(false);

    const v4 = out.ipv4_route as Record<string, unknown>[];
    expect(v4.some((r) => r.dev === 'GigabitEthernet 0/a/0')).toBe(true);
  });

  it('does not drop baseline BGP when incoming omits the existing VRF segment', () => {
    const incoming = {
      pe: { lanConfig: [{ vrf: 10001, lanName: 'GigabitEthernet 0/8/0' }] },
      bgp: [{ asn: 65002, router_id: '20.1.1.100' }],
    };
    const out = mergeRoleWizardIntentIntoBaseline(baseline(), incoming);
    const bgp = out.bgp as Record<string, any>[];
    expect(bgp.some((b) => b.vrf === 10001)).toBe(true);
  });

  it('rejects dropping a baseline LAN VRF from pe.lanConfig', () => {
    const incoming = {
      pe: {
        lanConfig: [{ vrf: 10002, lanName: 'GigabitEthernet 0/b/0' }],
      },
    };
    expect(() => mergeRoleWizardIntentIntoBaseline(baseline(), incoming)).toThrow(
      RoleWizardBaselineMergeError,
    );
    try {
      mergeRoleWizardIntentIntoBaseline(baseline(), incoming);
    } catch (e: any) {
      expect(e.statusCode).toBe(409);
      expect(String(e.message)).toContain('10001');
    }
  });

  it('rejects dropping a baseline WAN ifName from inventory', () => {
    const base = baseline() as Record<string, unknown>;
    base[TOWER_HUB_INVENTORY_KEY] = {
      wan: [
        {
          id: 'w1',
          ifName: 'GigabitEthernet 0/7/0',
          ipv6: '2100::100/64',
          source: 'role_wizard',
          createdAt: 'x',
        },
      ],
      lan: [
        {
          id: 'l1',
          ifName: 'GigabitEthernet 0/8/0',
          vrf: 10001,
          privateAsn: 65002,
          routerId: '23.1.1.2',
          source: 'role_wizard',
          createdAt: 'x',
        },
      ],
    };
    const incoming = {
      pe: { lanConfig: [{ vrf: 10001, lanName: 'GigabitEthernet 0/8/0' }] },
      [TOWER_HUB_INVENTORY_KEY]: {
        wan: [
          {
            id: 'w2',
            ifName: 'GigabitEthernet 0/a/0',
            ipv6: '2600::100/64',
            source: 'role_wizard',
            createdAt: 'x',
          },
        ],
        lan: [
          {
            id: 'l1',
            ifName: 'GigabitEthernet 0/8/0',
            vrf: 10001,
            privateAsn: 65002,
            routerId: '23.1.1.2',
            source: 'role_wizard',
            createdAt: 'x',
          },
        ],
      },
    };
    expect(() => mergeRoleWizardIntentIntoBaseline(base, incoming)).toThrow(/WAN/);
  });

  it('unions pe.lanConfig by VRF when additive LAN is present', () => {
    const incoming = {
      pe: {
        lanConfig: [
          { vrf: 10001, lanName: 'GigabitEthernet 0/8/0' },
          { vrf: 10002, lanName: 'GigabitEthernet 0/b/0', ipv4: '26.1.1.2/24' },
        ],
      },
    };
    const out = mergeRoleWizardIntentIntoBaseline(baseline(), incoming);
    const pe = out.pe as { lanConfig: Array<{ vrf: number }> };
    expect(pe.lanConfig.map((r) => r.vrf).sort()).toEqual([10001, 10002]);
  });
});
