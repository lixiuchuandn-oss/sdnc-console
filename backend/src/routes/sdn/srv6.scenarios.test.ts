/**
 * P1–P4 端到端场景矩阵（纯函数层，不依赖 DB）
 * 覆盖：单隧道生命周期、Hub 多隧道、冲突规则、恒等式、删除语义
 */
import { detectContributionConflicts } from './srv6.conflict';
import { mergeBaselineWithContributions, routeKey } from './srv6.merge';
import { effectiveConfigMatches } from './srv6.sync';
import type { Srv6EndpointInjectedDelta } from '../../entities/vRouter/srv6Tunnel.types';
import type { Srv6AliveContribution } from './srv6.recompute';

const hubBaseline = {
  interfaces_GigabitEthernet: [{ name: 'GigabitEthernet 0/0/0', ipv6_static: '203::1/64' }],
  ipv4_route: [{ destination: '10.0.0.0/24', via: '10.0.0.1' }],
  bgp: [
    { vrf: 0, asn: 429, address_family: [] },
    { vrf: 9999, asn: 105, address_family: [{ address_family: 'ipv4', modifiler: 'unicast' }] },
    { vrf: 8888, asn: 106, address_family: [{ address_family: 'ipv4', modifiler: 'unicast' }] },
  ],
};

const spokeContrib = (
  name: string,
  peerIp: string,
  ceIp: string,
  vrfBgpIndex: number,
  rd: string,
): Srv6EndpointInjectedDelta => ({
  neighbors: [
    { bgpIndex: 0, remote_ip: peerIp, remote_as: 430 },
    { bgpIndex: vrfBgpIndex, remote_ip: ceIp, remote_as: 122 },
  ],
  activateAddressFamily: [{ bgpIndex: 0, peerIp }],
  neighborDisableConnectedCheck: [{ bgpIndex: 0, remote_ip: peerIp }],
  rdRt: [{ bgpIndex: vrfBgpIndex, route_distinguisher: rd, route_target: rd }],
  ipv6Routes: [
    { destination: `240f:${peerIp.replace(/:/g, '')}::/64`, via: peerIp },
    { destination: '::/0', vrf: vrfBgpIndex === 1 ? 9999 : 8888, via: 'nexthop-vrf 0' },
  ],
});

const aliveRef = (
  name: string,
  contrib: Srv6EndpointInjectedDelta,
): Srv6AliveContribution => ({
  tunnelId: `id-${name}`,
  tunnelName: name,
  slot: 'peA',
  contribution: contrib,
  createdAt: new Date(),
});

import { TOWER_HUB_INVENTORY_KEY } from './srv6.hubInventory';

describe('srv6.scenarios (P1–P4 matrix)', () => {
  describe('P1 单隧道生命周期', () => {
    const baseline = hubBaseline;
    const t1 = spokeContrib('T1', '203::33', '101.1.1.22', 1, '429:9999');

    it('S1.1 创建：baseline + T1 = effective', () => {
      const effective = mergeBaselineWithContributions(baseline, [t1]);
      expect(effectiveConfigMatches(effective, baseline, [t1])).toBe(true);
      expect(effective.ipv4_route).toEqual(baseline.ipv4_route);
    });

    it('S1.2 删除 T1：exclude 后 effective = baseline', () => {
      const afterDelete = mergeBaselineWithContributions(baseline, []);
      expect(afterDelete).toEqual(baseline);
      expect((afterDelete.bgp as unknown[])[0]).not.toHaveProperty('neighbor');
    });

    it('S1.3 基线 ipv4_route / interfaces 不被 merge 污染', () => {
      const effective = mergeBaselineWithContributions(baseline, [t1]);
      expect(effective.interfaces_GigabitEthernet).toEqual(baseline.interfaces_GigabitEthernet);
    });
  });

  describe('P2 恒等式', () => {
    it('S2.1 config ≡ merge(baseline, Σcontrib)', () => {
      const c1 = spokeContrib('T1', '203::33', '10.1.1.1', 1, '429:1');
      const c2 = spokeContrib('T2', '203::44', '10.2.2.2', 2, '429:2');
      const effective = mergeBaselineWithContributions(hubBaseline, [c1, c2]);
      expect(effectiveConfigMatches(effective, hubBaseline, [c1, c2])).toBe(true);
    });

    it('S2.2 手工篡改 effective 可被恒等检测发现', () => {
      const c1 = spokeContrib('T1', '203::33', '10.1.1.1', 1, '429:1');
      const effective = mergeBaselineWithContributions(hubBaseline, [c1]);
      const tampered = { ...effective, tampered: true };
      expect(effectiveConfigMatches(tampered, hubBaseline, [c1])).toBe(false);
    });
  });

  describe('P3 Hub 多隧道', () => {
    const t1 = spokeContrib('T1', '203::33', '101.1.1.22', 1, '429:9999');
    const t2Ok = spokeContrib('T2', '203::44', '101.1.1.44', 2, '429:8888');
    const t2DupNeighbor = spokeContrib('T2-dup', '203::33', '101.1.1.44', 2, '429:8888');

    it('S3.1 Hub：T1+T2 不同 spoke 共存 (M4)', () => {
      const merged = mergeBaselineWithContributions(hubBaseline, [t1, t2Ok]);
      const pub = (merged.bgp as Record<string, unknown>[])[0];
      expect((pub.neighbor as unknown[]).length).toBe(2);
      expect(merged.ipv6_route).toHaveLength(4);
    });

    it('S3.2 删 T1 留 T2：effective = baseline + T2', () => {
      const afterT1Delete = mergeBaselineWithContributions(hubBaseline, [t2Ok]);
      expect(effectiveConfigMatches(afterT1Delete, hubBaseline, [t2Ok])).toBe(true);
      const pub = (afterT1Delete.bgp as Record<string, unknown>[])[0];
      expect(pub.neighbor).toEqual([{ remote_ip: '203::44', remote_as: 430 }]);
    });

    it('S3.3 C-N1：重复 neighbor 拒绝', () => {
      const conflicts = detectContributionConflicts(t2DupNeighbor, [aliveRef('T1', t1)], hubBaseline);
      expect(conflicts.some((c) => c.code === 'C-N1')).toBe(true);
    });

    it('S3.4 C-N2：neighbor 已在基线', () => {
      const baselineWithNeighbor = mergeBaselineWithContributions(hubBaseline, [
        { neighbors: [{ bgpIndex: 0, remote_ip: '203::99', remote_as: 99 }] },
      ]);
      const conflicts = detectContributionConflicts(
        { neighbors: [{ bgpIndex: 0, remote_ip: '203::99', remote_as: 100 }] },
        [],
        baselineWithNeighbor,
      );
      expect(conflicts.some((c) => c.code === 'C-N2')).toBe(true);
    });

    it('S3.5 C-R1：同 bgpIndex RD 段冲突', () => {
      const conflicts = detectContributionConflicts(
        { rdRt: [{ bgpIndex: 1, route_distinguisher: '429:2', route_target: '429:2' }] },
        [aliveRef('T1', { rdRt: [{ bgpIndex: 1, route_distinguisher: '429:1', route_target: '429:1' }] })],
        hubBaseline,
      );
      expect(conflicts.some((c) => c.code === 'C-R1')).toBe(true);
    });

    it('S3.6 C-V1：ipv6_route 重复', () => {
      const route = { destination: '240f:2033::/64', via: '203::33' };
      const conflicts = detectContributionConflicts(
        { ipv6Routes: [route] },
        [aliveRef('T1', { ipv6Routes: [route] })],
        hubBaseline,
      );
      expect(conflicts.some((c) => c.code === 'C-V1')).toBe(true);
      expect(routeKey(route)).toBe('240f:2033::/64|203::33|');
    });

    it('S3.7 C-A1：vpn activate 重复', () => {
      const conflicts = detectContributionConflicts(
        { activateAddressFamily: [{ bgpIndex: 0, peerIp: '203::33' }] },
        [aliveRef('T1', { activateAddressFamily: [{ bgpIndex: 0, peerIp: '203::33' }] })],
        hubBaseline,
      );
      expect(conflicts.some((c) => c.code === 'C-A1')).toBe(true);
    });

    it('S3.8 C-D1：ndc 重复', () => {
      const conflicts = detectContributionConflicts(
        { neighborDisableConnectedCheck: [{ bgpIndex: 0, remote_ip: '203::33' }] },
        [aliveRef('T1', { neighborDisableConnectedCheck: [{ bgpIndex: 0, remote_ip: '203::33' }] })],
        hubBaseline,
      );
      expect(conflicts.some((c) => c.code === 'C-D1')).toBe(true);
    });
  });

  describe('P4 运维语义', () => {
    it('S4.1 零隧道：effective 应等于 baseline（对账 ORPHAN 前提）', () => {
      const baseline = hubBaseline;
      const drifted = mergeBaselineWithContributions(baseline, [
        spokeContrib('ghost', '203::55', '10.5.5.5', 1, '429:5'),
      ]);
      expect(JSON.stringify(drifted)).not.toBe(JSON.stringify(baseline));
      expect(JSON.stringify(mergeBaselineWithContributions(baseline, []))).toBe(JSON.stringify(baseline));
    });

    it('S4.2 漂移修复目标态 = merge(baseline, aliveContribs)', () => {
      const c1 = spokeContrib('T1', '203::33', '10.1.1.1', 1, '429:1');
      const expected = mergeBaselineWithContributions(hubBaseline, [c1]);
      const corrupted = { ...expected, extraField: 'bad' };
      expect(effectiveConfigMatches(corrupted, hubBaseline, [c1])).toBe(false);
      expect(effectiveConfigMatches(expected, hubBaseline, [c1])).toBe(true);
    });
  });

  describe('边界与幂等', () => {
    it('S5.1 重复 merge 同 neighbor 不重复追加', () => {
      const c = spokeContrib('T1', '203::33', '10.1.1.1', 1, '429:1');
      const once = mergeBaselineWithContributions(hubBaseline, [c, c]);
      const pub = (once.bgp as Record<string, unknown>[])[0];
      expect((pub.neighbor as unknown[]).length).toBe(1);
    });

    it('S5.2 空贡献列表不改变 baseline', () => {
      expect(mergeBaselineWithContributions(hubBaseline, [])).toEqual(hubBaseline);
    });

    it('S5.3 CE 端仅 neighbor 增量', () => {
      const ceBase = { bgp: [{ asn: 200, address_family: [] }] };
      const ceC: Srv6EndpointInjectedDelta = {
        neighbors: [{ bgpIndex: 0, remote_ip: '101.1.1.1', remote_as: 105 }],
      };
      const out = mergeBaselineWithContributions(ceBase, [ceC]);
      expect(out.bgp).toHaveLength(1);
      expect((out.bgp as Record<string, unknown>[])[0].neighbor).toHaveLength(1);
    });
  });

  describe('P5 Hub merge (PE3 · H4–H7)', () => {
    const pe3Baseline = {
      bgp: [
        { vrf: 0, asn: 430, address_family: [] },
        { vrf: 7777, asn: 106, address_family: [{ address_family: 'ipv4', modifiler: 'unicast' }] },
      ],
    };

    const tPe22: Srv6EndpointInjectedDelta = {
      neighbors: [
        { bgpIndex: 0, remote_ip: '203::22', remote_as: 430 },
        { bgpIndex: 1, remote_ip: '102.1.1.22', remote_as: 122 },
      ],
      activateAddressFamily: [{ bgpIndex: 0, peerIp: '203::22' }],
      neighborDisableConnectedCheck: [{ bgpIndex: 0, remote_ip: '203::22' }],
      rdRt: [{ bgpIndex: 1, route_distinguisher: '200:12851', route_target: '200:40988' }],
    };

    const tPe2: Srv6EndpointInjectedDelta = {
      neighbors: [
        { bgpIndex: 0, remote_ip: '203::44', remote_as: 440 },
      ],
      activateAddressFamily: [{ bgpIndex: 0, peerIp: '203::44' }],
      neighborDisableConnectedCheck: [{ bgpIndex: 0, remote_ip: '203::44' }],
      rdRt: [{ bgpIndex: 1, route_distinguisher: '200:bad', route_target: '200:40944' }],
    };

    const hubPack = (delta: Srv6EndpointInjectedDelta) => ({
      delta,
      isHubPeSlot: true,
      hubVrfMode: 'REUSE_VRF' as const,
    });

    it('H1/H4/H5: dual Spoke on Hub REUSE share one RD/RT', () => {
      const effective = mergeBaselineWithContributions(pe3Baseline, [
        hubPack(tPe22),
        hubPack(tPe2),
      ]);
      const pub = (effective.bgp as Record<string, unknown>[])[0];
      expect((pub.neighbor as unknown[]).map((n: any) => n.remote_ip).sort()).toEqual([
        '203::22',
        '203::44',
      ]);
      const inner = (effective.bgp as Record<string, unknown>[])[1];
      const af = (inner.address_family as Record<string, unknown>[])[0];
      expect(af.route_distinguisher).toBe('200:12851');
      expect(af.route_target).toBe('200:40988');
    });

    it('H7: remove one Spoke keeps shared RD/RT until last deleted', () => {
      const onlyPe2 = mergeBaselineWithContributions(pe3Baseline, [hubPack(tPe2)]);
      const inner2 = (onlyPe2.bgp as Record<string, unknown>[])[1];
      const af2 = (inner2.address_family as Record<string, unknown>[])[0];
      expect(af2.route_target).toBe('200:40944');

      const onlyPe22 = mergeBaselineWithContributions(pe3Baseline, [hubPack(tPe22)]);
      const af22 = ((onlyPe22.bgp as Record<string, unknown>[])[1].address_family as Record<
        string,
        unknown
      >[])[0];
      expect(af22.route_target).toBe('200:40988');
    });
  });

  describe('P5.2b NR regression (§14.17.9)', () => {
    const spokeSContrib = spokeContrib('S-T1', '203::55', '10.5.5.5', 1, '429:5001');

    it('NR-1: Spoke–Spoke merge unchanged when baseline carries _towerHubInventory', () => {
      const baseline = {
        ...hubBaseline,
        [TOWER_HUB_INVENTORY_KEY]: {
          wan: [{ id: 'w1', ifName: 'ge0', ipv6: '203::1/64', source: 'role_wizard', createdAt: '' }],
          lan: [],
        },
      };
      const effective = mergeBaselineWithContributions(baseline, [spokeSContrib]);
      expect(effective[TOWER_HUB_INVENTORY_KEY]).toBeUndefined();
      expect(effectiveConfigMatches(effective, hubBaseline, [spokeSContrib])).toBe(true);
      const pub = (effective.bgp as Record<string, unknown>[])[0];
      expect((pub.neighbor as unknown[]).length).toBe(1);
    });

    const hubPackReuse = (
      delta: Srv6EndpointInjectedDelta,
      bindings: { wanIf: string; wanInventoryId?: string },
    ) => ({
      delta,
      isHubPeSlot: true,
      hubVrfMode: 'REUSE_VRF' as const,
      hubBindings: bindings,
    });

    it('NR-2: Hub first route A uses inventory wan materialization + single inner bgp', () => {
      const baseline = {
        bgp: [
          { vrf: 0, asn: 430, address_family: [] },
          { vrf: 7777, asn: 106, address_family: [{ address_family: 'ipv4', modifiler: 'unicast' }] },
        ],
        [TOWER_HUB_INVENTORY_KEY]: {
          wan: [
            {
              id: 'w-hub',
              ifName: 'GigabitEthernet 0/0/0',
              ipv6: '203::hub/64',
              source: 'role_wizard',
              createdAt: '',
            },
          ],
          lan: [],
        },
      };
      const t1 = spokeContrib('H-T1', '203::33', '101.1.1.22', 1, '200:39508');
      const merged = mergeBaselineWithContributions(baseline, [
        hubPackReuse(t1, { wanIf: 'GigabitEthernet 0/0/0', wanInventoryId: 'w-hub' }),
      ]);
      expect(merged.interfaces_GigabitEthernet).toBeDefined();
      const inner = (merged.bgp as Record<string, unknown>[])[1];
      expect(inner.neighbor).toBeDefined();
      expect((merged.bgp as unknown[]).length).toBe(2);
    });

    it('NR-3: Hub second route A REUSE does not add dedicated bgp segment', () => {
      const baseline = {
        bgp: [
          { vrf: 0, asn: 430, address_family: [] },
          { vrf: 7777, asn: 106, address_family: [{ address_family: 'ipv4', modifiler: 'unicast' }] },
        ],
        [TOWER_HUB_INVENTORY_KEY]: {
          wan: [
            { id: 'w1', ifName: 'ge0', ipv6: '203::1/64', source: 'role_wizard', createdAt: '' },
            { id: 'w2', ifName: 'ge1', ipv6: '203::2/64', source: 'role_wizard', createdAt: '' },
          ],
          lan: [],
        },
      };
      const t1 = spokeContrib('H-T1', '203::33', '101.1.1.22', 1, '200:39508');
      const t2 = spokeContrib('H-T2', '203::44', '101.1.1.44', 1, '200:39508');
      const merged = mergeBaselineWithContributions(baseline, [
        hubPackReuse(t1, { wanIf: 'ge0', wanInventoryId: 'w1' }),
        hubPackReuse(t2, { wanIf: 'ge1', wanInventoryId: 'w2' }),
      ]);
      expect((merged.bgp as unknown[]).length).toBe(2);
      const pub = (merged.bgp as Record<string, unknown>[])[0];
      expect((pub.neighbor as unknown[]).length).toBe(2);
    });
  });
});
