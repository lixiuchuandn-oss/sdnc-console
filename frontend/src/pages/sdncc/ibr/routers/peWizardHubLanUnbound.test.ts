import {
  applyPeWizardReferencedChanges,
  lockedLanFieldChanges,
  lockedLanVrfsForBound,
} from './peWizardReferencedPatch';

const lanBgp = (vrf: number, rid: string, rd: string, rt: string) => ({
  asn: 65002,
  vrf,
  router_id: rid,
  bgp_ebgp_requires_policy: 'disable',
  address_family: [
    { address_family: 'ipv4', modifiler: 'unicast', route_distinguisher: rd, route_target: rt },
  ],
});

const hubCfg = (): Record<string, unknown> => ({
  role: 'HUB_PE',
  interfaces_GigabitEthernet: [
    { name: 'GigabitEthernet 0/7/0', ipv4_static: '20.1.1.100/24', ipv6_static: '2200::100/64' },
    { name: 'GigabitEthernet 0/8/0', vrf: 10001, ipv4_static: '23.1.1.2/24' },
    { name: 'GigabitEthernet 0/b/0', vrf: 10002, ipv4_static: '26.1.1.2/24' },
  ],
  vrf: [10001, 10002],
  bgp: [
    { asn: 65002, router_id: '20.1.1.100' },
    lanBgp(10001, '23.1.1.2', '200:112', '200:57966'),
    lanBgp(10002, '26.1.1.2', '200:116', '200:57999'),
  ],
  pe: {
    lanConfig: [
      { vrf: 10001, lanName: 'GigabitEthernet 0/8/0', ipv4: '23.1.1.2/24', lanBgp: { asn: 65002, routerId: '23.1.1.2', routeDistinguisher: '200:112', routeTarget: '200:57966' } },
      { vrf: 10002, lanName: 'GigabitEthernet 0/b/0', ipv4: '26.1.1.2/24', lanBgp: { asn: 65002, routerId: '26.1.1.2', routeDistinguisher: '200:116', routeTarget: '200:57999' } },
    ],
    publicConfig: { wanName: 'GigabitEthernet 0/7/0', wanIpv4: '20.1.1.100/24', wanIpv6: '2200::100/64' },
  },
});

const lanRows = (rt2: string) => [
  { vrf: 10001, ifName: 'GigabitEthernet 0/8/0', ipv4: '23.1.1.2/24', asn: 65002, routerId: '23.1.1.2', routeDistinguisher: '200:112', routeTarget: '200:57966' },
  { vrf: 10002, ifName: 'GigabitEthernet 0/b/0', ipv4: '26.1.1.2/24', asn: 65002, routerId: '26.1.1.2', routeDistinguisher: '200:116', routeTarget: rt2 },
];

const bound = new Set(['GigabitEthernet 0/8/0']);

describe('Hub：隧道删除后 LAN #2 解锁', () => {
  it('只锁仍被隧道绑定的 LAN 口所在 VRF', () => {
    expect([...lockedLanVrfsForBound(hubCfg(), bound)]).toEqual(['10001']);
  });

  it('绑定未知（null）时失败关闭：锁全部已保存 VRF', () => {
    expect([...lockedLanVrfsForBound(hubCfg(), null)].sort()).toEqual(['10001', '10002']);
  });

  it('改未绑定 VRF 10002 的 RT 不报锁定冲突', () => {
    const locked = lockedLanVrfsForBound(hubCfg(), bound);
    expect(
      lockedLanFieldChanges(hubCfg(), lanRows('200:60000') as any, { boundLanIfNames: bound, lockedVrfs: locked }),
    ).toEqual([]);
  });

  it('改仍被绑定的 VRF 10001 的 RT 仍拦截', () => {
    const locked = lockedLanVrfsForBound(hubCfg(), bound);
    const rows = lanRows('200:57999');
    rows[0].routeTarget = '200:1';
    const out = lockedLanFieldChanges(hubCfg(), rows as any, { boundLanIfNames: bound, lockedVrfs: locked });
    expect(out.some((l) => l.includes('VRF 10001') && l.includes('RT'))).toBe(true);
  });

  it('合并时把 VRF 10002 新 RT 写入 bgp，且有变更标签', () => {
    const full = {
      bgp: [
        { asn: 65002, router_id: '20.1.1.100' },
        lanBgp(10001, '23.1.1.2', '200:112', '200:57966'),
        lanBgp(10002, '26.1.1.2', '200:116', '200:60000'),
      ],
    };
    const r = applyPeWizardReferencedChanges(
      hubCfg(),
      { lanConfigs: lanRows('200:60000'), hubWanInventory: [] } as any,
      { isHubPe: true, fullCfg: full, boundLanIfNames: bound },
    );
    expect(r.blockedReasons || []).toEqual([]);
    const b2 = (r.cfg.bgp as any[]).find((b) => Number(b.vrf) === 10002);
    expect(b2.address_family[0].route_target).toBe('200:60000');
    expect(r.changedLabels.some((l) => l.includes('LAN BGP') && l.includes('10002'))).toBe(true);
  });
});
