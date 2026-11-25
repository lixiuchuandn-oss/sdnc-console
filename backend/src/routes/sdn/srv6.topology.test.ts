import { hubsOfSpoke, resolveHubPe, type Srv6TopologyTunnelRow } from './srv6.topology';

const row = (
  id: string,
  peA: string,
  peB: string,
  topo: 'S' | 'H' | null = 'H',
  hubPeSlot: 'peA' | 'peB' | null = 'peA',
): Srv6TopologyTunnelRow => ({
  id,
  name: id,
  peA,
  peB,
  ceA: `C${peA}`,
  ceB: `C${peB}`,
  tunnelTopology: topo,
  hubPeSlot,
  peAInnerIf: null,
  peBInnerIf: null,
});

describe('srv6.topology', () => {
  it('resolveHubPe: H uses hubPeSlot; S falls back to ≥2 refs; p2p → null', () => {
    const all = [row('1', 'H1', 'S1'), row('2', 'X', 'Y', 'S', null)];
    expect(resolveHubPe(all[0], all)).toBe('H1');
    expect(resolveHubPe(all[1], all)).toBeNull();
    const shared = [row('a', 'P', 'Q', 'S', null), row('b', 'P', 'R', 'S', null)];
    expect(resolveHubPe(shared[0], shared)).toBe('P');
  });

  it('hubsOfSpoke finds dual-homed hubs', () => {
    const all = [row('1', 'H1', 'S1'), row('2', 'H2', 'S1'), row('3', 'H1', 'S2')];
    expect(hubsOfSpoke('S1', all).sort()).toEqual(['H1', 'H2']);
    expect(hubsOfSpoke('S2', all)).toEqual(['H1']);
  });
});
