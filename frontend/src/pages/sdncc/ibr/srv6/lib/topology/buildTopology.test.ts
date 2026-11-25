import { abbrIfName, buildHubTopology, buildP2pTopology, summarizeTopology } from './buildTopology';
import { layoutTopology, pickLayout } from './layout';
import { offsetQuadPath, parallelOffset } from './TunnelEdge';

const hubStatus = (tunnels: any[]): any => ({
  vrUuid: 'HUB',
  tunnelCount: tunnels.length,
  isHub: true,
  tunnels,
  portRegistry: [],
  hubInventory: {},
  hubInventoryUi: {},
});

const ht = (id: string, spoke: string, wan: string, ceHub = 'CEH', ceSpoke = `CE-${spoke}`) => ({
  tunnelId: id,
  tunnelName: `t-${id}`,
  slot: 'peA',
  tunnelTopology: 'H',
  hubPeSlot: 'peA',
  ceA: ceHub,
  ceB: ceSpoke,
  hubBindings: { hubPeUuid: 'HUB', spokePeUuid: spoke, hubPeSlot: 'peA', wanIf: wan, peerPublicNeighbor: '' },
});

describe('buildTopology', () => {
  it('p2p renders four ends', () => {
    const topo = buildP2pTopology(
      { id: 't1', name: 't1', peA: 'A', peB: 'B', ceA: 'CA', ceB: 'CB', tunnelTopology: 'S' },
      't1',
    );
    expect(topo.mode).toBe('p2p');
    expect(summarizeTopology(topo)).toMatchObject({ pe: 2, ce: 2, tunnels: 1 });
    expect(topo.attaches).toHaveLength(2);
  });

  it('dedupes spoke PE and reused hub CE; groups parallel tunnels', () => {
    const topo = buildHubTopology(
      hubStatus([
        ht('1', 'S1', 'GigabitEthernet0/7/0'),
        ht('2', 'S1', 'GigabitEthernet0/7/1'),
        ht('3', 'S2', 'GigabitEthernet0/7/0'),
      ]),
      [],
      '2',
    );
    const sum = summarizeTopology(topo);
    expect(sum).toMatchObject({ hub: 1, spoke: 2, tunnels: 3 });
    // CEH 复用 + CE-S1 + CE-S2
    expect(sum.ce).toBe(3);
    const s1 = topo.tunnels.filter((t) => t.target === 'pe:S1');
    expect(s1.map((t) => t.groupSize)).toEqual([2, 2]);
    expect(s1.map((t) => t.groupIndex)).toEqual([0, 1]);
    expect(topo.nodes.find((n) => n.id === 'pe:S1')?.focus).toBe(true);
  });

  it('layout picks by spoke count and positions all nodes', () => {
    const many = buildHubTopology(
      hubStatus(Array.from({ length: 6 }, (_, i) => ht(String(i), `S${i}`, 'GE0/0/0'))),
      [],
      '0',
    );
    expect(pickLayout(many)).toBe('radial');
    const pos = layoutTopology(many);
    many.nodes.forEach((n) => expect(pos[n.id]).toBeDefined());
  });

  it('multi-hub merges shared spoke and picks multihub layout', () => {
    const h1 = hubStatus([ht('1', 'S1', 'GE0/0/0'), ht('2', 'S2', 'GE0/0/0')]);
    const h2 = { ...hubStatus([{ ...ht('3', 'S1', 'GE0/0/1', 'CEH2'), hubBindings: { ...ht('3', 'S1', 'GE0/0/1').hubBindings, hubPeUuid: 'HUB2' } }]), vrUuid: 'HUB2' };
    const topo = buildHubTopology([h1, h2], [], '1');
    const sum = summarizeTopology(topo);
    expect(sum).toMatchObject({ hub: 2, spoke: 2, tunnels: 3 });
    expect(pickLayout(topo)).toBe('multihub');
    const pos = layoutTopology(topo);
    topo.nodes.forEach((n) => expect(pos[n.id]).toBeDefined());
  });

  it('abbrIfName', () => {
    expect(abbrIfName('GigabitEthernet0/7/0')).toBe('GE0/7/0');
    expect(abbrIfName('XGigabitEthernet1/0/1')).toBe('XGE1/0/1');
    expect(abbrIfName('')).toBe('');
  });

  it('parallel offset is symmetric', () => {
    expect(parallelOffset(0, 1)).toBe(0);
    expect(parallelOffset(0, 2)).toBe(-parallelOffset(1, 2));
    const { labelY } = offsetQuadPath(0, 0, 100, 0, 10);
    expect(labelY).toBe(10);
  });
});
