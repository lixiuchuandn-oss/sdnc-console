import { validateTunnelArchiveRequired } from './srv6.archive';

const minimalArchive = () => ({
  peAInnerIf: 'GE0/0/1',
  peBInnerIf: 'GE0/0/1',
  rdRtMeta: { rtCommon: '65001:100', rdMap: { peA: '65001:1', peB: '65001:2' } },
  injectedDelta: {
    peA: { neighbors: [{ bgpIndex: 0, remote_ip: '2001::1', remote_as: 1 }] },
    peB: { neighbors: [{ bgpIndex: 0, remote_ip: '2001::2', remote_as: 2 }] },
    ceA: { neighbors: [{ bgpIndex: 0, remote_ip: '10.0.0.1', remote_as: 3 }] },
    ceB: { neighbors: [{ bgpIndex: 0, remote_ip: '10.0.0.2', remote_as: 4 }] },
  },
  endpointFingerprint: {
    peA: { publicIpv6: '2001::a' },
    peB: { publicIpv6: '2001::b' },
    ceA: { publicIpv4: '1.1.1.1' },
    ceB: { publicIpv4: '2.2.2.2' },
  },
});

describe('srv6.archive validateTunnelArchiveRequired', () => {
  it('passes complete S topology archive', () => {
    expect(validateTunnelArchiveRequired({ ...minimalArchive(), tunnelTopology: 'S' }).ok).toBe(true);
  });

  it('requires hub fields for H topology', () => {
    const base = minimalArchive();
    const r = validateTunnelArchiveRequired({
      ...base,
      tunnelTopology: 'H',
      peA: 'hub-uuid',
      peB: 'spoke-uuid',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('hubPeSlot');
  });

  it('passes consistent H topology hub bindings', () => {
    const r = validateTunnelArchiveRequired({
      ...minimalArchive(),
      tunnelTopology: 'H',
      peA: 'hub-uuid',
      peB: 'spoke-uuid',
      hubPeSlot: 'peA',
      hubVrfMode: 'REUSE_VRF',
      hubBindings: {
        hubPeUuid: 'hub-uuid',
        spokePeUuid: 'spoke-uuid',
        hubPeSlot: 'peA',
        wanIf: 'GE0/0/0',
        peerPublicNeighbor: '2001:db8::33',
      },
    });
    expect(r.ok).toBe(true);
  });

  it('rejects hub fields on S topology', () => {
    const r = validateTunnelArchiveRequired({
      ...minimalArchive(),
      tunnelTopology: 'S',
      hubPeSlot: 'peA',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('不应包含 hubBindings');
  });

  it('rejects mismatched hubPeUuid in bindings', () => {
    const r = validateTunnelArchiveRequired({
      ...minimalArchive(),
      tunnelTopology: 'H',
      peA: 'hub-uuid',
      peB: 'spoke-uuid',
      hubPeSlot: 'peA',
      hubVrfMode: 'REUSE_VRF',
      hubBindings: {
        hubPeUuid: 'wrong-hub',
        spokePeUuid: 'spoke-uuid',
        hubPeSlot: 'peA',
        wanIf: 'GE0/0/0',
        peerPublicNeighbor: '2001:db8::33',
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('hubPeUuid');
  });
});
