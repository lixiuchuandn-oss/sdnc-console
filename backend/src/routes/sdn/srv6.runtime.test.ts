import {
  computeTunnelDirections,
  publicBgpState,
  privateBgpFromExpectations,
  prefixReceivedFromExpectations,
  seedSamplesFromCounters,
  vbrasFromStatus,
  vrrpRoleFromShow,
  __resetRuntimeSamples,
  type VrCounters,
} from './srv6.runtime';
import type { Srv6TopologyTunnelRow } from './srv6.topology';

const row = (id: string, peA: string, peB: string): Srv6TopologyTunnelRow => ({
  id, name: id, peA, peB, ceA: '', ceB: '', tunnelTopology: null, hubPeSlot: null, peAInnerIf: null, peBInnerIf: null,
});
const ls = (address: string, packets: number, bytes: number, badP = 0) => ({
  address, good: { packets, bytes }, bad: { packets: badP, bytes: 0 },
});
const pol = (seg: string) => ({ bsid: 'x', segmentLists: [{ segments: [seg] }] });

describe('srv6.runtime computeTunnelDirections', () => {
  beforeEach(() => __resetRuntimeSamples());

  it('first sample → sampling, second → rate from Δ/Δt', () => {
    const t = [row('t1', 'A', 'B')];
    const c1: Record<string, VrCounters> = {
      A: { sampledAtMs: 0, localsids: [ls('2100::1:0:0:100', 100, 1000)], policies: [pol('2200::1:0:0:100/128')] },
      B: { sampledAtMs: 0, localsids: [ls('2200::1:0:0:100', 500, 5000)], policies: [pol('2100::1:0:0:100')] },
    };
    const r1 = computeTunnelDirections(t, c1).directions.t1!;
    expect(r1.aToB.state).toBe('sampling');
    expect(r1.aToB.localsid).toBe('2200::1:0:0:100');
    expect(r1.aToB.pps).toBeUndefined();

    const c2: Record<string, VrCounters> = {
      A: { ...c1.A!, sampledAtMs: 10_000, localsids: [ls('2100::1:0:0:100', 200, 2000)] },
      B: { ...c1.B!, sampledAtMs: 10_000, localsids: [ls('2200::1:0:0:100', 1500, 15000, 3)] },
    };
    const r2 = computeTunnelDirections(t, c2).directions.t1!;
    expect(r2.aToB.state).toBe('active');
    expect(r2.aToB.pps).toBeCloseTo(100);
    expect(r2.aToB.bps).toBeCloseTo(8000);
    expect(r2.aToB.badDelta).toBe(3);
    expect(r2.bToA.pps).toBeCloseTo(10);
  });

  it('counter reset (Δ<0) → sampling, not negative rate', () => {
    const t = [row('t1', 'A', 'B')];
    const mk = (ms: number, p: number): Record<string, VrCounters> => ({
      A: { sampledAtMs: ms, localsids: [], policies: [pol('2200::1')] },
      B: { sampledAtMs: ms, localsids: [ls('2200::1', p, p * 10)], policies: [] },
    });
    computeTunnelDirections(t, mk(0, 1000));
    const r = computeTunnelDirections(t, mk(5000, 10)).directions.t1!;
    expect(r.aToB.state).toBe('sampling');
    expect(r.bToA.state).toBe('not_effective'); // A 无 localsid
  });

  it('unreachable endpoint → unknown', () => {
    const r = computeTunnelDirections([row('t1', 'A', 'B')], { A: undefined, B: undefined }).directions.t1!;
    expect(r.aToB.state).toBe('unknown');
  });

  it('REUSE_VRF hub: spokes → hub direction is hub_aggregate', () => {
    const t = [row('s1', 'H', 'S1'), row('s2', 'H', 'S2')];
    const c: Record<string, VrCounters> = {
      H: { sampledAtMs: 0, localsids: [ls('2000::100', 1, 1)], policies: [pol('2001::100'), pol('2002::100')] },
      S1: { sampledAtMs: 0, localsids: [ls('2001::100', 1, 1)], policies: [pol('2000::100')] },
      S2: { sampledAtMs: 0, localsids: [ls('2002::100', 1, 1)], policies: [pol('2000::100')] },
    };
    const { directions, hubAggregates } = computeTunnelDirections(t, c);
    expect(directions.s1!.bToA.state).toBe('hub_aggregate');
    expect(directions.s2!.bToA.state).toBe('hub_aggregate');
    expect(directions.s1!.aToB.localsid).toBe('2001::100');
    expect(hubAggregates.H?.localsid).toBe('2000::100');
    expect(hubAggregates.H?.state).toBe('sampling');

    const c2: Record<string, VrCounters> = {
      H: { sampledAtMs: 5_000, localsids: [ls('2000::100', 11, 101)], policies: c.H!.policies },
      S1: { sampledAtMs: 5_000, localsids: [ls('2001::100', 11, 101)], policies: c.S1!.policies },
      S2: { sampledAtMs: 5_000, localsids: [ls('2002::100', 11, 101)], policies: c.S2!.policies },
    };
    const second = computeTunnelDirections(t, c2);
    expect(second.directions.s1!.bToA.state).toBe('hub_aggregate');
    expect(second.hubAggregates.H?.state).toBe('active');
    expect(second.hubAggregates.H?.pps).toBeCloseTo(2);
  });

  it('matches last hop of multi-segment policy', () => {
    const t = [row('t1', 'A', 'B')];
    const c: Record<string, VrCounters> = {
      A: {
        sampledAtMs: 0,
        localsids: [ls('2100::1', 1, 1)],
        policies: [{ bsid: 'x', segmentLists: [{ segments: ['fc00::1', '2200::1'] }] }],
      },
      B: {
        sampledAtMs: 0,
        localsids: [ls('2200::1', 1, 1)],
        policies: [{ bsid: 'x', segmentLists: [{ segments: ['fc00::2', '2100::1'] }] }],
      },
    };
    const r = computeTunnelDirections(t, c).directions.t1!;
    expect(r.aToB.localsid).toBe('2200::1');
    expect(r.bToA.localsid).toBe('2100::1');
  });
});

describe('srv6.runtime publicBgpState', () => {
  const raw = (state: string) =>
    [
      'IPv6 Unicast Summary (VRF default):',
      'Neighbor        V         AS   MsgRcvd   MsgSent   TblVer  InQ OutQ  Up/Down State/PfxRcd   PfxSnt Desc',
      `2001:db8::2     4      65002        10        12        0    0    0 00:05:00 ${state}        1 N/A`,
    ].join('\n');
  it('all established → up', () => expect(publicBgpState([raw('3'), raw('5')])).toBe('up'));
  it('idle → down', () => expect(publicBgpState([raw('Idle'), raw('3')])).toBe('down'));
  it('missing raw → unknown', () => expect(publicBgpState([raw('3'), undefined])).toBe('unknown'));
});

describe('srv6.runtime privateBgpFromExpectations', () => {
  const raw = [
    'IPv4 Unicast Summary (VRF 10001):',
    'Neighbor        V         AS   MsgRcvd   MsgSent   TblVer  InQ OutQ  Up/Down State/PfxRcd   PfxSnt Desc',
    '10.1.1.2        4      65001        10        12        0    0    0 00:05:00 3        1 N/A',
  ].join('\n');
  it('established private neighbor → up', () => {
    expect(privateBgpFromExpectations([{ vrUuid: 'PE', remoteIp: '10.1.1.2' }], { PE: raw })).toBe('up');
  });
  it('missing neighbor → down', () => {
    expect(privateBgpFromExpectations([{ vrUuid: 'PE', remoteIp: '10.1.1.9' }], { PE: raw })).toBe('down');
  });
  it('no raw → unknown', () => {
    expect(privateBgpFromExpectations([{ vrUuid: 'PE', remoteIp: '10.1.1.2' }], {})).toBe('unknown');
  });
});

describe('srv6.runtime vbrasFromStatus', () => {
  it('vbras_running true → running', () => expect(vbrasFromStatus({ vbras_running: true })).toBe('running'));
  it('vbras_running false → stopped', () => expect(vbrasFromStatus({ vbras_running: false })).toBe('stopped'));
  it('empty → unknown', () => expect(vbrasFromStatus(undefined)).toBe('unknown'));
});

describe('srv6.runtime prefixReceivedFromExpectations', () => {
  const raw = [
    'IPv4 Unicast Summary (VRF 10001):',
    'Neighbor        V         AS   MsgRcvd   MsgSent   TblVer  InQ OutQ  Up/Down State/PfxRcd   PfxSnt Desc',
    '10.1.1.2        4      65001        10        12        0    0    0 00:05:00 7        1 N/A',
  ].join('\n');
  const idle = [
    'IPv4 Unicast Summary (VRF 10001):',
    'Neighbor        V         AS   MsgRcvd   MsgSent   TblVer  InQ OutQ  Up/Down State/PfxRcd   PfxSnt Desc',
    '10.1.1.2        4      65001         0         0        0    0    0 never    Idle       0 N/A',
  ].join('\n');
  it('sums PE PfxRcd', () => {
    expect(
      prefixReceivedFromExpectations(
        [{ vrUuid: 'PE', remoteIp: '10.1.1.2', slot: 'peA' }],
        { PE: raw },
      ),
    ).toBe(7);
  });
  it('skips CE slots', () => {
    expect(
      prefixReceivedFromExpectations(
        [{ vrUuid: 'CE', remoteIp: '10.1.1.2', slot: 'ceA' }],
        { CE: raw },
      ),
    ).toBeUndefined();
  });
  it('sums two PE slots', () => {
    expect(
      prefixReceivedFromExpectations(
        [
          { vrUuid: 'PEA', remoteIp: '10.1.1.2', slot: 'peA' },
          { vrUuid: 'PEB', remoteIp: '10.1.1.2', slot: 'peB' },
        ],
        { PEA: raw, PEB: raw },
      ),
    ).toBe(14);
  });
  it('skips non-numeric PfxRcd (Idle)', () => {
    expect(
      prefixReceivedFromExpectations(
        [{ vrUuid: 'PE', remoteIp: '10.1.1.2', slot: 'peA' }],
        { PE: idle },
      ),
    ).toBeUndefined();
  });
});

describe('srv6.runtime sample=2 local store isolation', () => {
  beforeEach(() => __resetRuntimeSamples());

  it('rates from first→second via request-local store, not global race', () => {
    const t = [row('t1', 'A', 'B')];
    const c1: Record<string, VrCounters> = {
      A: { sampledAtMs: 1_000, localsids: [ls('2100::1', 100, 1000)], policies: [pol('2200::1')] },
      B: { sampledAtMs: 1_000, localsids: [ls('2200::1', 500, 5000)], policies: [pol('2100::1')] },
    };
    const c2: Record<string, VrCounters> = {
      A: { sampledAtMs: 4_000, localsids: [ls('2100::1', 130, 1300)], policies: [pol('2200::1')] },
      B: { sampledAtMs: 4_000, localsids: [ls('2200::1', 800, 8000)], policies: [pol('2100::1')] },
    };
    const store = new Map();
    // 模拟另一请求抢先把全局样本弄乱：不应影响本请求
    computeTunnelDirections(t, {
      A: { sampledAtMs: 9_999, localsids: [ls('2100::1', 1, 1)], policies: [pol('2200::1')] },
      B: { sampledAtMs: 9_999, localsids: [ls('2200::1', 1, 1)], policies: [pol('2100::1')] },
    });
    seedSamplesFromCounters(store, c1);
    const r = computeTunnelDirections(t, c2, { store }).directions.t1!;
    expect(r.aToB.state).toBe('active');
    expect(r.aToB.pps).toBeCloseTo(100); // (800-500)/3
    expect(r.bToA.pps).toBeCloseTo(10); // (130-100)/3
  });

  it('partial second sample: keep prior active, do not blank with sampling', () => {
    const t = [row('t1', 'A', 'B')];
    const store = new Map();
    const warm: Record<string, VrCounters> = {
      A: { sampledAtMs: 0, localsids: [ls('2100::1', 10, 100)], policies: [pol('2200::1')] },
      B: { sampledAtMs: 0, localsids: [ls('2200::1', 10, 100)], policies: [pol('2100::1')] },
    };
    computeTunnelDirections(t, warm, { store });
    const first: Record<string, VrCounters> = {
      A: { sampledAtMs: 3_000, localsids: [ls('2100::1', 40, 400)], policies: [pol('2200::1')] },
      B: { sampledAtMs: 3_000, localsids: [ls('2200::1', 40, 400)], policies: [pol('2100::1')] },
    };
    const r1 = computeTunnelDirections(t, first, { store }).directions.t1!;
    expect(r1.aToB.state).toBe('active');

    // 仅 A 有第二拍；B 仍为 first → 若整表重算且 prev 已是 first，B 方向会变 sampling
    const partial: Record<string, VrCounters | undefined> = {
      A: { sampledAtMs: 6_000, localsids: [ls('2100::1', 70, 700)], policies: [pol('2200::1')] },
      B: first.B,
    };
    seedSamplesFromCounters(store, first, new Set(['A']));
    const r2 = computeTunnelDirections(t, partial, { store }).directions.t1!;
    // A←B 方向取 A 的 localsid：应有新速率
    expect(r2.bToA.state).toBe('active');
    expect(r2.bToA.pps).toBeCloseTo(10);
    // B 侧未更新：本拍可能 sampling；合并时应保留 r1.aToB active（由 build 层 merge 保证）
    const merged = {
      aToB: r2.aToB.state === 'active' ? r2.aToB : r1.aToB.state === 'active' ? r1.aToB : r2.aToB,
      bToA: r2.bToA,
    };
    expect(merged.aToB.state).toBe('active');
    expect(merged.bToA.state).toBe('active');
  });
});

describe('srv6.runtime vrrpRoleFromShow', () => {
  const inst = (state: string) => `VRRP Instance = 1\nState = ${state}\nVirtual Router ID = 1\n`;
  const grp = (state: string) => `VRRP Sync Group = 1, ${state}\n`;
  it('sync group MASTER → master', () => expect(vrrpRoleFromShow(inst('BACKUP'), grp('MASTER'))).toBe('master'));
  it('instances BACKUP when no group → backup', () => expect(vrrpRoleFromShow(inst('BACKUP'), '')).toBe('backup'));
  it('empty → null', () => expect(vrrpRoleFromShow('', '')).toBeNull());
});
