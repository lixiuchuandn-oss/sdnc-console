import { buildWanStaticRoutesFromRows } from './peWizardWanRoutes';
import { dedupeIpv6Routes } from './peWizardReferencedPatch';

describe('IPv6 静态路由去重', () => {
  it('Hub 多 WAN 行填同一条 IPv6 路由只生成一条', () => {
    const { ipv6_route } = buildWanStaticRoutesFromRows([
      { ifName: 'GigabitEthernet 0/7/0', ipv6Dest: '2100::/64', ipv6Via: '2200::1' } as any,
      { ifName: 'GigabitEthernet 0/a/0', ipv6Dest: '2100::/64', ipv6Via: '2200::1' } as any,
    ]);
    expect(ipv6_route).toEqual([{ destination: '2100::/64', via: '2200::1' }]);
  });

  it('同目的不同网关保留两条', () => {
    const { ipv6_route } = buildWanStaticRoutesFromRows([
      { ifName: 'ge0', ipv6Dest: '2100::/64', ipv6Via: '2200::1' } as any,
      { ifName: 'ge1', ipv6Dest: '2100::/64', ipv6Via: '2600::1' } as any,
    ]);
    expect(ipv6_route).toHaveLength(2);
  });

  it('清理现网已有的重复条目，保留不同 vrf 的路由', () => {
    const out = dedupeIpv6Routes([
      { destination: '2100::/64', via: '2200::1' },
      { destination: '2100::/64', via: '2200::1' },
      { destination: '::/0', vrf: 10001, via: 'nexthop-vrf 0' },
      { destination: '::/0', via: 'nexthop-vrf 0' },
    ]);
    expect(out).toEqual([
      { destination: '2100::/64', via: '2200::1' },
      { destination: '::/0', vrf: 10001, via: 'nexthop-vrf 0' },
      { destination: '::/0', via: 'nexthop-vrf 0' },
    ]);
  });
});
