import {
  applyPeWizardReferencedChanges,
  lockedLanFieldChanges,
  lockedLanVrfsFromConfig,
  lockedWanFieldChanges,
  lockedWanIfNamesFromConfig,
} from './peWizardReferencedPatch';
import { TOWER_HUB_INVENTORY_KEY } from './hubPeInventory';

const lanBgp = (vrf: number, rd: string, rt: string, extra: Record<string, unknown> = {}) => ({
  asn: 65002,
  vrf,
  router_id: '23.1.1.2',
  address_family: [
    { address_family: 'ipv4', modifiler: 'unicast', route_distinguisher: rd, route_target: rt },
  ],
  ...extra,
});

const baseCfg = () => ({
  interfaces_GigabitEthernet: [
    { name: 'GigabitEthernet 0/7/0', ipv6_static: '2100::100/64', tunnel_extra: 'keep' },
    { name: 'GigabitEthernet 0/8/0', ipv4_static: '23.1.1.2/24', vrf: 10001 },
  ],
  vrf: [10001],
  bgp: [
    { asn: 65002, router_id: '20.1.1.100', address_family: [] },
    lanBgp(10001, '200:112', '200:57966', { neighbor: [{ ip: '2200::1' }] }),
  ],
  pe: {
    publicConfig: { wanName: 'GigabitEthernet 0/7/0' },
    lanConfig: [
      {
        vrf: 10001,
        ifName: 'GigabitEthernet 0/8/0',
        lanBgp: { asn: 65002, routerId: '23.1.1.2', routeDistinguisher: '200:112', routeTarget: '200:57966' },
      },
    ],
  },
});

const values = { sidPrefix: '2200::100', wanDev: 'GigabitEthernet 0/7/0', wanIpv6: '2100::100/64' };

describe('mergeInterfacesAndLanBgp via applyPeWizardReferencedChanges', () => {
  it('adds new interfaces / VRF / LAN BGP and reports them', () => {
    const full = {
      interfaces_GigabitEthernet: [
        { name: 'GigabitEthernet 0/7/0', ipv6_static: '2100::100/64', status: 'up' },
        { name: 'GigabitEthernet 0/a/0', ipv4_static: '60.1.1.100/24', status: 'up' },
        { name: 'GigabitEthernet 0/8/0', ipv4_static: '23.1.1.2/24', vrf: 10001 },
        { name: 'GigabitEthernet 0/b/0', ipv4_static: '26.1.1.2/24', vrf: 10002, status: 'up' },
      ],
      vrf: [10001, 10002],
      bgp: [lanBgp(10001, '200:112', '200:57966'), lanBgp(10002, '200:116', '200:57999')],
    };
    const { cfg, changedLabels, blockedReasons } = applyPeWizardReferencedChanges(baseCfg(), values, {
      isHubPe: false,
      fullCfg: full,
    });
    expect(blockedReasons).toBeUndefined();
    expect(changedLabels.some((l) => l.includes('新增接口') && l.includes('GigabitEthernet 0/a/0'))).toBe(true);
    expect(changedLabels.some((l) => l.includes('GigabitEthernet 0/b/0'))).toBe(true);
    expect(changedLabels).toContain('新增 VRF 10002');
    expect(changedLabels.some((l) => l.includes('新增 LAN BGP') && l.includes('10002'))).toBe(true);
    const ifs = cfg.interfaces_GigabitEthernet as Record<string, unknown>[];
    expect(ifs).toHaveLength(4);
    // 隧道注入字段保留
    expect(ifs.find((i) => i.name === 'GigabitEthernet 0/7/0')?.tunnel_extra).toBe('keep');
    expect(cfg.vrf).toEqual([10001, 10002]);
    const bgp = cfg.bgp as Record<string, any>[];
    // 已有 VRF 段 neighbor 未被覆盖
    expect(bgp.find((b) => b.vrf === 10001)?.neighbor).toEqual([{ ip: '2200::1' }]);
    expect(bgp.some((b) => b.vrf === 10002)).toBe(true);
  });

  it('blocks RD/RT change on existing VRF and leaves cfg untouched', () => {
    const base = baseCfg();
    const full = {
      interfaces_GigabitEthernet: [{ name: 'GigabitEthernet 0/a/0', ipv4_static: '60.1.1.100/24' }],
      bgp: [lanBgp(10001, '200:113', '200:57966')],
    };
    const { cfg, changedLabels, blockedReasons } = applyPeWizardReferencedChanges(base, values, {
      isHubPe: false,
      fullCfg: full,
    });
    expect(changedLabels).toEqual([]);
    expect(blockedReasons).toEqual(['VRF 10001：RD 200:112→200:113']);
    expect(cfg).toEqual(base);
  });

  it('copies pe.lanConfig from fullCfg so re-entry can restore extra LAN', () => {
    const full = {
      pe: {
        publicConfig: { wanName: 'GigabitEthernet 0/7/0' },
        lanConfig: [
          { vrf: 10001, lanName: 'GigabitEthernet 0/8/0' },
          { vrf: 10002, lanName: 'GigabitEthernet 0/b/0', ipv4: '26.1.1.2/24' },
        ],
      },
    };
    const { cfg } = applyPeWizardReferencedChanges(baseCfg(), values, {
      isHubPe: true,
      fullCfg: full,
    });
    expect((cfg.pe as { lanConfig: unknown[] }).lanConfig).toHaveLength(2);
  });

  it('does not treat pe-only Hub snapshot as brand-new inventory', () => {
    const hub = {
      ...baseCfg(),
      pe: {
        publicConfig: {
          wanName: 'GigabitEthernet 0/7/0',
          wanIpv6: '2100::100/64',
        },
        lanConfig: [
          {
            vrf: 10001,
            lanName: 'GigabitEthernet 0/8/0',
            ipv4: '23.1.1.2/24',
            lanBgp: { asn: 65002, routerId: '23.1.1.2' },
          },
        ],
      },
    };
    const { changedLabels } = applyPeWizardReferencedChanges(
      hub,
      {
        sidPrefix: '2200::100',
        hubWanInventory: [{ ifName: 'GigabitEthernet 0/7/0', ipv6: '2100::100/64' }],
        lanConfigs: [
          { ifName: 'GigabitEthernet 0/8/0', vrf: 10001, asn: 65002, routerId: '23.1.1.2' },
        ],
      },
      { isHubPe: true },
    );
    expect(changedLabels.some((l) => l.includes('新增 WAN') || l.includes('新增 LAN'))).toBe(false);
  });

  it('reports Hub inventory new WAN/LAN instead of being masked by route labels', () => {
    const hub = {
      ...baseCfg(),
      [TOWER_HUB_INVENTORY_KEY]: {
        wan: [{ id: 'w1', ifName: 'GigabitEthernet 0/7/0', ipv6: '2100::100/64', source: 'role_wizard', createdAt: 'x' }],
        lan: [],
      },
    };
    const { changedLabels } = applyPeWizardReferencedChanges(
      hub,
      {
        sidPrefix: '2200::100',
        hubWanInventory: [
          { ifName: 'GigabitEthernet 0/7/0', ipv6: '2100::100/64' },
          { ifName: 'GigabitEthernet 0/a/0', ipv6: '2600::100/64', ipv6Dest: '2500::/64', ipv6Via: '2600::1' },
        ],
        lanConfigs: [{ ifName: 'GigabitEthernet 0/b/0', vrf: 10002, asn: 65002, routerId: '26.1.1.2' }],
      },
      { isHubPe: true },
    );
    expect(changedLabels).toContain('IPv6 静态路由');
    expect(changedLabels).toContain('新增 WAN 口 GigabitEthernet 0/a/0');
    expect(changedLabels).toContain('新增 LAN 口 GigabitEthernet 0/b/0(VRF 10002)');
  });
});

describe('locked LAN fields (edit-stage)', () => {
  it('lists saved VRFs as locked', () => {
    expect([...lockedLanVrfsFromConfig(baseCfg())]).toEqual(['10001']);
  });

  it('detects locked field changes, ignores new VRF rows', () => {
    const rows = [
      { vrf: 10001, asn: 65002, routerId: '23.1.1.2', routeDistinguisher: '200:112', routeTarget: '200:1' },
      { vrf: 10002, asn: 1, routerId: '1.1.1.1', routeDistinguisher: '1:1', routeTarget: '1:1' },
    ];
    expect(lockedLanFieldChanges(baseCfg(), rows)).toEqual(['VRF 10001：RT 200:57966→200:1']);
  });

  it('no change → empty', () => {
    const rows = [
      { vrf: 10001, asn: 65002, routerId: '23.1.1.2', routeDistinguisher: '200:112', routeTarget: '200:57966' },
    ];
    expect(lockedLanFieldChanges(baseCfg(), rows)).toEqual([]);
  });

  it('detects missing locked LAN VRF as delete attempt', () => {
    expect(lockedLanFieldChanges(baseCfg(), [{ vrf: 10002, asn: 1, routerId: '1.1.1.1' }])).toEqual([
      'VRF 10001：不可删除（已被隧道引用）',
    ]);
  });

  it('lists saved WAN ifNames as locked and detects delete', () => {
    expect([...lockedWanIfNamesFromConfig(baseCfg())].sort()).toEqual(['GigabitEthernet 0/7/0']);
    expect(
      lockedWanFieldChanges(baseCfg(), [{ ifName: 'GigabitEthernet 0/a/0', ipv6: '2600::1/64' }]),
    ).toEqual(['WAN GigabitEthernet 0/7/0：不可删除（已被隧道引用）']);
  });
});
