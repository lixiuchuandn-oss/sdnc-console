import { alignReuseVrfTunnelArchive, findReuseVrfReferenceTunnel } from './srv6.reuseRdRt';
import { SRv6Tunnel } from '../../entities/vRouter/SRv6Tunnel';

jest.mock('../../config/database', () => ({
  AppDataSource: {
    getRepository: jest.fn(),
  },
}));

const { AppDataSource } = jest.requireMock('../../config/database') as {
  AppDataSource: { getRepository: jest.Mock };
};

describe('srv6.reuseRdRt', () => {
  const mockFind = (rows: Partial<SRv6Tunnel>[]) => {
    const sorted = [...rows].sort(
      (a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0),
    );
    AppDataSource.getRepository.mockReturnValue({
      find: jest.fn().mockResolvedValue(sorted),
    });
  };

  it('findReuseVrfReferenceTunnel returns earliest hub tunnel on same PE', async () => {
    mockFind([
      {
        id: 't2',
        name: 'T2',
        createdAt: new Date('2026-06-18'),
        tunnelTopology: 'H',
        hubVrfMode: 'REUSE_VRF',
        hubPeSlot: 'peB',
        peA: 'spoke-2',
        peB: 'hub-1',
        hubBindings: { hubPeUuid: 'hub-1', spokePeUuid: 'spoke-2', hubPeSlot: 'peB', wanIf: 'ge0', peerPublicNeighbor: '203::44' },
        rdRtMeta: { rtCommon: '200:39508', rdMap: { peA: '200:1', peB: '200:2' } },
        injectedDelta: { peA: {}, peB: {}, ceA: {}, ceB: {} },
      },
      {
        id: 't1',
        name: 'T1',
        createdAt: new Date('2026-06-01'),
        tunnelTopology: 'H',
        hubVrfMode: 'REUSE_VRF',
        hubPeSlot: 'peB',
        peA: 'spoke-1',
        peB: 'hub-1',
        hubBindings: { hubPeUuid: 'hub-1', spokePeUuid: 'spoke-1', hubPeSlot: 'peB', wanIf: 'ge0', peerPublicNeighbor: '203::22' },
        rdRtMeta: { rtCommon: '200:39508', rdMap: { peA: '200:11', peB: '200:22' } },
        injectedDelta: { peA: {}, peB: {}, ceA: {}, ceB: {} },
      },
    ] as unknown as SRv6Tunnel[]);

    const ref = await findReuseVrfReferenceTunnel('hub-1');
    expect(ref?.id).toBe('t1');
    expect(ref?.rdRtMeta?.rtCommon).toBe('200:39508');
  });

  it('alignReuseVrfTunnelArchive patches rdRtMeta and spoke pe delta', async () => {
    mockFind([
      {
        id: 't1',
        name: 'T1',
        createdAt: new Date('2026-06-01'),
        tunnelTopology: 'H',
        hubVrfMode: 'REUSE_VRF',
        hubPeSlot: 'peB',
        peA: 'spoke-1',
        peB: 'hub-1',
        hubBindings: { hubPeUuid: 'hub-1', spokePeUuid: 'spoke-1', hubPeSlot: 'peB', wanIf: 'ge0', peerPublicNeighbor: '203::22' },
        rdRtMeta: { rtCommon: '200:39508', rdMap: { peA: '200:12851', peB: '200:12851' } },
        injectedDelta: { peA: {}, peB: {}, ceA: {}, ceB: {} },
      },
    ] as unknown as SRv6Tunnel[]);

    const tunnel = {
      id: 't-new',
      tunnelTopology: 'H',
      hubVrfMode: 'REUSE_VRF',
      hubPeSlot: 'peB',
      peA: 'spoke-2',
      peB: 'hub-1',
      hubBindings: { hubPeUuid: 'hub-1', spokePeUuid: 'spoke-2', hubPeSlot: 'peB', wanIf: 'ge0', peerPublicNeighbor: '203::11' },
      rdRtMeta: { rtCommon: '200:36184', rdMap: { peA: '200:9', peB: '200:8' } },
      injectedDelta: {
        peA: { rdRt: [{ bgpIndex: 1, route_distinguisher: '200:9', route_target: '200:36184' }] },
        peB: { rdRt: [{ bgpIndex: 1, route_distinguisher: '200:8', route_target: '200:36184' }] },
        ceA: { neighbors: [{ bgpIndex: 0, remote_ip: '10.0.0.1', remote_as: 1 }] },
        ceB: { neighbors: [{ bgpIndex: 0, remote_ip: '10.0.0.2', remote_as: 1 }] },
      },
    } as unknown as SRv6Tunnel;

    const aligned = await alignReuseVrfTunnelArchive(tunnel);
    expect(aligned).toBe(true);
    expect(tunnel.rdRtMeta?.rtCommon).toBe('200:39508');
    expect(tunnel.injectedDelta?.peA?.rdRt?.[0].route_target).toBe('200:39508');
    expect(tunnel.injectedDelta?.peA?.rdRt?.[0].route_distinguisher).toBe('200:12851');
  });
});
