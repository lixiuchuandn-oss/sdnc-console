import type { SRv6Tunnel } from '../../entities/vRouter/SRv6Tunnel';
import {
  detachHaGroupFromSrv6Fingerprint,
  detachSrv6TunnelsFromHaGroup,
} from './haGroupTunnelMetadata';

describe('haGroupTunnelMetadata', () => {
  it('removes only the matching CE HA annotation fields and preserves other fingerprint data', () => {
    const fingerprint = {
      peA: { publicIpv6: '2001:db8::1' },
      ceA: {
        publicIpv4: '192.0.2.10',
        haGroupId: 'ha-1',
        haGroupName: 'primary-pair',
        backupVrUuid: 'ce-2',
      },
      ceB: {
        publicIpv4: '192.0.2.20',
        haGroupId: 'ha-2',
        haGroupName: 'other-pair',
        backupVrUuid: 'ce-4',
      },
    };

    const detached = detachHaGroupFromSrv6Fingerprint(fingerprint, 'ha-1');

    expect(detached).toEqual({
      peA: { publicIpv6: '2001:db8::1' },
      ceA: { publicIpv4: '192.0.2.10' },
      ceB: fingerprint.ceB,
    });
    expect(fingerprint.ceA.haGroupId).toBe('ha-1');
  });

  it('leaves fingerprints unchanged when they do not reference the deleted group', () => {
    const fingerprint = { ceA: { haGroupId: 'ha-2', publicIpv4: '192.0.2.10' } };

    expect(detachHaGroupFromSrv6Fingerprint(fingerprint, 'ha-1')).toBe(fingerprint);
    expect(detachHaGroupFromSrv6Fingerprint(null, 'ha-1')).toBeNull();
  });

  it('saves only tunnels whose endpoint fingerprint references the deleted group', async () => {
    const matching = {
      id: 'tunnel-1',
      endpointFingerprint: { ceA: { haGroupId: 'ha-1', publicIpv4: '192.0.2.10' } },
    } as SRv6Tunnel;
    const unrelated = {
      id: 'tunnel-2',
      endpointFingerprint: { ceA: { haGroupId: 'ha-2', publicIpv4: '192.0.2.20' } },
    } as SRv6Tunnel;
    const repository = {
      find: jest.fn().mockResolvedValue([matching, unrelated]),
      save: jest.fn().mockImplementation(async (rows: SRv6Tunnel[]) => rows),
    };

    const detached = await detachSrv6TunnelsFromHaGroup(repository, 'ha-1');

    expect(detached).toBe(1);
    expect(repository.find).toHaveBeenCalledWith({ select: ['id', 'endpointFingerprint'] });
    expect(repository.save).toHaveBeenCalledWith([matching]);
    expect(matching.endpointFingerprint?.ceA).toEqual({ publicIpv4: '192.0.2.10' });
    expect(unrelated.endpointFingerprint?.ceA?.haGroupId).toBe('ha-2');
  });
});
