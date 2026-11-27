import { applyPeWizardReferencedChanges } from './peWizardReferencedPatch';

// 临时诊断：用测试机 Hub VR2 原样配置 + 等价表单值，看哪些标签被误判为变更
const vr2: Record<string, unknown> = {
  role: 'HUB_PE',
  interfaces_GigabitEthernet: [
    { ipv6_static: '2200::100/64', name: 'GigabitEthernet 0/7/0', ipv4_static: '20.1.1.100/24', status: 'up' },
    { name: 'GigabitEthernet 0/8/0', vrf: 10001, ipv4_static: '23.1.1.2/24', status: 'up' },
    { ipv6_static: '2600::100/64', name: 'GigabitEthernet 0/a/0', ipv4_static: '60.1.1.100/24', status: 'up' },
    { name: 'GigabitEthernet 0/b/0', vrf: 10002, ipv4_static: '26.1.1.2/24', status: 'up' },
  ],
  vrf: [10001, 10002],
  ipv6_route: [
    { destination: '2100::/64', via: '2200::1' },
    { destination: '::/0', vrf: 10001, via: 'nexthop-vrf 0' },
  ],
  ipv4_route: [
    { dev: 'GigabitEthernet 0/7/0', destination: '10.1.1.100/32', priority: 100 },
    { dev: 'GigabitEthernet 0/a/0', destination: '50.1.1.100/32', priority: 100 },
  ],
  pe: {
    lanConfig: [
      { ipv4: '23.1.1.2/24', lanBgp: { routeDistinguisher: '200:112', routerId: '23.1.1.2', asn: 65002, routeTarget: '200:57966' }, vrf: 10001, lanName: 'GigabitEthernet 0/8/0' },
      { ipv4: '26.1.1.2/24', lanBgp: { routeDistinguisher: '200:116', routerId: '26.1.1.2', asn: 65002, routeTarget: '200:57999' }, vrf: 10002, lanName: 'GigabitEthernet 0/b/0' },
    ],
    publicConfig: {
      wanName: 'GigabitEthernet 0/7/0', ipv6Via: '2200::1', sidPrefix: '2200::100', ipv6Dest: '2100::/64',
      publicBgpIndex: 0, wanRouteDest: '10.1.1.100/32', locatorName: 'pe2-hub', wanIpv4: '20.1.1.100/24',
      wanRoutePriority: 100, wanIpv6: '2200::100/64', publicBgp: { routerId: '20.1.1.100', asn: 65002 }, wanNdProxyIfNames: [],
    },
  },
};

const values: any = {
  hubWanInventory: [
    { ifName: 'GigabitEthernet 0/7/0', ipv4: '20.1.1.100/24', ipv6: '2200::100/64', ipv4RouteDest: '10.1.1.100/32', ipv4RoutePriority: 100, ipv6Dest: '2100::/64', ipv6Via: '2200::1', ndProxy: false },
    { ifName: 'GigabitEthernet 0/a/0', ipv4: '60.1.1.100/24', ipv6: '2600::100/64', ipv4RouteDest: '50.1.1.100/32', ipv4RoutePriority: 100, ipv6Dest: '2100::/64', ipv6Via: '2200::1', ndProxy: false },
  ],
  lanConfigs: [
    { vrf: 10001, ifName: 'GigabitEthernet 0/8/0', ipv4: '23.1.1.2/24', asn: 65002, routerId: '23.1.1.2', routeDistinguisher: '200:112', routeTarget: '200:57966' },
    { vrf: 10002, ifName: 'GigabitEthernet 0/b/0', ipv4: '26.1.1.2/24', asn: 65002, routerId: '26.1.1.2', routeDistinguisher: '200:116', routeTarget: '200:57999' },
  ],
};

describe('Hub 角色向导：无改动下发', () => {
  it('现网无 inventory（回退只含主 WAN）时，第二个已存在的 WAN 口不算新增 → 无变更', () => {
    const r = applyPeWizardReferencedChanges(vr2, values, { isHubPe: true });
    expect(r.blockedReasons || []).toEqual([]);
    expect(r.changedLabels).toEqual([]);
  });

  it('真正新增现网不存在的 WAN 口仍报“新增 WAN 口”', () => {
    const v = {
      ...values,
      hubWanInventory: [
        ...values.hubWanInventory,
        { ifName: 'GigabitEthernet 0/c/0', ipv4: '70.1.1.100/24', ipv6: '2700::100/64' },
      ],
    };
    const r = applyPeWizardReferencedChanges(vr2, v, { isHubPe: true });
    expect(r.changedLabels.some((l) => l.includes('新增 WAN 口') && l.includes('0/c/0'))).toBe(true);
    expect(r.changedLabels.some((l) => l.includes('0/a/0'))).toBe(false);
  });
});
