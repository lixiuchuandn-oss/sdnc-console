import { computeTunnelDirections, publicBgpState, __resetRuntimeSamples, type VrCounters } from './srv6.runtime';
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
