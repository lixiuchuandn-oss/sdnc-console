import type { HsmLldpPhysicalLink } from '../buildHsmLldpPhysicalLinks';
import { filterLldpLinksForPhysicalNetwork } from './filterLldpLinksForPhysicalNetwork';

describe('filterLldpLinksForPhysicalNetwork', () => {
  const links: HsmLldpPhysicalLink[] = [
    {
      id: '1',
      switchHost: '10.0.0.1',
      switchTitle: 'sw1',
      port: 'GE0/0/1',
      nodeName: 'node-a',
      localIf: 'eth0',
    },
    {
      id: '2',
      switchHost: '10.0.0.1',
      switchTitle: 'sw1',
      port: 'GE0/0/2',
      nodeName: 'node-b',
      localIf: 'eth1',
    },
  ];

  const topology = {
    defaultIf: 'eth0',
    customList: [{ interface: 'eth1', nodes: ['node-b'] }],
    nodesOnDefault: ['node-a'],
  };

  it('returns empty when topology missing', () => {
    expect(filterLldpLinksForPhysicalNetwork(links, null, null)).toEqual([]);
  });

  it('keeps links whose localIf matches node logical interface', () => {
    const filtered = filterLldpLinksForPhysicalNetwork(links, topology, null);
    expect(filtered.map((l) => l.id)).toEqual(['1', '2']);
  });

  it('filters by bond member list when bondFromAnnotation is set', () => {
    const originNics = {
      bondFromAnnotation: true,
      byNode: {
        'node-a': ['eth0', 'eth2'],
        'node-b': ['eth2'],
      },
    };
    const filtered = filterLldpLinksForPhysicalNetwork(links, topology, originNics);
    expect(filtered.map((l) => l.nodeName)).toEqual(['node-a']);
  });
});
