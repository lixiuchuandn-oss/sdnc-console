import { applyPeWizardReferencedChanges } from './peWizardReferencedPatch';
import { TOWER_HUB_INVENTORY_KEY } from './hubPeInventory';

describe('applyPeWizardReferencedChanges', () => {
  const baseCfg = {
    interfaces_GigabitEthernet: [
      {
        name: 'GigabitEthernet 0/7/0',
        ipv6_static: '2100::100/64',
        ipv6_nd_proxy: '2100::100',
      },
    ],
    ipv4_route: [{ destination: '20.1.1.100/32', dev: 'GigabitEthernet 0/7/0', priority: 100 }],
    ipv6_route: [
      { destination: '2200::/64', via: '2100::1' },
      { destination: '240f:2033::/64', via: '2100::200' },
      { destination: '::/0', vrf: 10, via: 'nexthop-vrf 0' },
    ],
    pe: {
      publicConfig: {
        wanName: 'GigabitEthernet 0/7/0',
        wanRouteDest: '20.1.1.100/32',
        wanRoutePriority: 100,
        ipv6Dest: '2200::/64',
        ipv6Via: '2100::1',
        wanNdProxyIfNames: ['GigabitEthernet 0/7/0'],
        sidPrefix: '2100::100/64',
      },
    },
  };

  it('skips when nothing changed (no ND-only messaging path)', () => {
    const { changedLabels } = applyPeWizardReferencedChanges(
      baseCfg,
      {
        sidPrefix: '2100::100/64',
        wanNdProxy: true,
        wanDev: 'GigabitEthernet 0/7/0',
        wanRouteDest: '20.1.1.100/32',
        wanRoutePriority: 100,
        ipv6Dest: '2200::/64',
        ipv6Via: '2100::1',
      },
      { isHubPe: false },
    );
    expect(changedLabels).toEqual([]);
  });

  it('patches only IPv4 static route and preserves tunnel ipv6 routes', () => {
    const { cfg, changedLabels } = applyPeWizardReferencedChanges(
      baseCfg,
      {
        sidPrefix: '2100::100/64',
        wanNdProxy: true,
        wanDev: 'GigabitEthernet 0/7/0',
        wanRouteDest: '0.0.0.0/0',
        wanRoutePriority: 80,
        ipv6Dest: '2200::/64',
        ipv6Via: '2100::1',
      },
      { isHubPe: false },
    );
    expect(changedLabels).toContain('IPv4 静态路由');
    expect(changedLabels).not.toContain('Locator SID ND 代答');
    expect(cfg.ipv4_route).toEqual([
      { destination: '0.0.0.0/0', dev: 'GigabitEthernet 0/7/0', priority: 80 },
    ]);
    const v6 = cfg.ipv6_route as Array<Record<string, unknown>>;
    expect(v6).toEqual(
      expect.arrayContaining([
        { destination: '240f:2033::/64', via: '2100::200' },
        { destination: '::/0', vrf: 10, via: 'nexthop-vrf 0' },
        { destination: '2200::/64', via: '2100::1' },
      ]),
    );
  });

  it('patches ND as one ordinary field among others', () => {
    const { cfg, changedLabels } = applyPeWizardReferencedChanges(
      baseCfg,
      {
        sidPrefix: '2100::100/64',
        wanNdProxy: false,
        wanDev: 'GigabitEthernet 0/7/0',
        wanRouteDest: '20.1.1.100/32',
        wanRoutePriority: 100,
        ipv6Dest: '2200::/64',
        ipv6Via: '2100::1',
      },
      { isHubPe: false },
    );
    expect(changedLabels).toEqual(['Locator SID ND 代答']);
    const ifaces = cfg.interfaces_GigabitEthernet as Array<Record<string, unknown>>;
    expect(ifaces[0].ipv6_nd_proxy).toBeUndefined();
  });

  it('updates Hub inventory ipv4 dest without wiping tunnel SID route', () => {
    const hubCfg = {
      ...baseCfg,
      [TOWER_HUB_INVENTORY_KEY]: {
        wan: [
          {
            id: 'w1',
            ifName: 'GigabitEthernet 0/7/0',
            ipv6: '2100::100/64',
            ipv4RouteDest: '20.1.1.100/32',
            ipv4RoutePriority: 100,
            ipv6Dest: '2200::/64',
            ipv6Via: '2100::1',
            source: 'role_wizard',
            createdAt: '2026-01-01',
          },
        ],
        lan: [],
      },
    };
    const { cfg, changedLabels } = applyPeWizardReferencedChanges(
      hubCfg,
      {
        sidPrefix: '2100::100/64',
        hubWanInventory: [
          {
            ifName: 'GigabitEthernet 0/7/0',
            ipv6: '2100::100/64',
            ipv4RouteDest: '0.0.0.0/0',
            ipv4RoutePriority: 100,
            ipv6Dest: '2200::/64',
            ipv6Via: '2100::1',
            ndProxy: true,
          },
        ],
      },
      { isHubPe: true },
    );
    expect(changedLabels).toContain('IPv4 静态路由');
    const inv = (cfg as Record<string, any>)[TOWER_HUB_INVENTORY_KEY];
    expect(inv.wan[0].ipv4RouteDest).toBe('0.0.0.0/0');
    const v6 = cfg.ipv6_route as Array<Record<string, unknown>>;
    expect(v6.some((r) => r.destination === '240f:2033::/64')).toBe(true);
  });
});
