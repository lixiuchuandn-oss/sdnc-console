import type { SRv6Tunnel } from '../../entities/vRouter/SRv6Tunnel';
import type { Srv6EndpointFingerprint } from '../../entities/vRouter/srv6Tunnel.types';
import {
  annotateSrv6FingerprintByCeUuid,
  attachSrv6TunnelsToHaGroup,
  buildCeHaAnnotationIndex,
  detachHaGroupFromSrv6Fingerprint,
  detachSrv6TunnelsFromHaGroup,
  presentSrv6TunnelsWithLiveHa,
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

  it('annotates matching CE slots with group id/name and the other member as backupVrUuid', () => {
    const fingerprint = {
      peA: { publicIpv6: '2001:db8::1' },
      ceA: { publicIpv4: '192.0.2.10' },
      ceB: { publicIpv4: '192.0.2.20' },
    };
    const index = buildCeHaAnnotationIndex([
      {
        id: 'ha-1',
        name: '眉山能力池HA组',
        members: [
          { role: 'primary', vrUuid: 'ce-1' },
          { role: 'backup', vrUuid: 'ce-2' },
        ],
      },
    ]);

    const annotated = annotateSrv6FingerprintByCeUuid(
      fingerprint,
      { ceA: 'ce-1', ceB: 'ce-3' },
      index,
    );

    expect(annotated).toEqual({
      peA: { publicIpv6: '2001:db8::1' },
      ceA: {
        publicIpv4: '192.0.2.10',
        haGroupId: 'ha-1',
        haGroupName: '眉山能力池HA组',
        backupVrUuid: 'ce-2',
      },
      ceB: { publicIpv4: '192.0.2.20' },
    });
    expect(fingerprint.ceA).toEqual({ publicIpv4: '192.0.2.10' });
  });

  it('creates a CE fingerprint when the tunnel archive had none', () => {
    const index = buildCeHaAnnotationIndex([
      {
        id: 'ha-1',
        name: 'ha-1',
        members: [
          { role: 'primary', vrUuid: 'ce-1' },
          { role: 'backup', vrUuid: 'ce-2' },
        ],
      },
    ]);

    expect(annotateSrv6FingerprintByCeUuid(null, { ceA: 'ce-2', ceB: 'ce-4' }, index)).toEqual({
      ceA: { haGroupId: 'ha-1', haGroupName: 'ha-1', backupVrUuid: 'ce-1' },
    });
  });

  it('is a no-op when the live annotation is already present', () => {
    const fingerprint = {
      ceA: {
        publicIpv4: '192.0.2.10',
        haGroupId: 'ha-1',
        haGroupName: 'ha-1',
        backupVrUuid: 'ce-2',
      },
    };
    const index = buildCeHaAnnotationIndex([
      {
        id: 'ha-1',
        name: 'ha-1',
        members: [
          { role: 'primary', vrUuid: 'ce-1' },
          { role: 'backup', vrUuid: 'ce-2' },
        ],
      },
    ]);

    expect(annotateSrv6FingerprintByCeUuid(fingerprint, { ceA: 'ce-1', ceB: 'ce-3' }, index)).toBe(
      fingerprint,
    );
  });

  it('saves only tunnels whose CE uuid belongs to the new HA group', async () => {
    const matching = {
      id: 'tunnel-1',
      ceA: 'ce-1',
      ceB: 'ce-3',
      endpointFingerprint: { ceA: { publicIpv4: '192.0.2.10' } },
    } as SRv6Tunnel;
    const unrelated = {
      id: 'tunnel-2',
      ceA: 'ce-x',
      ceB: 'ce-y',
      endpointFingerprint: { ceA: { publicIpv4: '192.0.2.20' } },
    } as SRv6Tunnel;
    const repository = {
      find: jest.fn().mockResolvedValue([matching, unrelated]),
      save: jest.fn().mockImplementation(async (rows: SRv6Tunnel[]) => rows),
    };

    const attached = await attachSrv6TunnelsToHaGroup(repository, {
      groupId: 'ha-1',
      groupName: '眉山能力池HA组',
      primaryUuid: 'ce-1',
      backupUuid: 'ce-2',
    });

    expect(attached).toBe(1);
    expect(repository.find).toHaveBeenCalledWith({
      select: ['id', 'ceA', 'ceB', 'endpointFingerprint'],
    });
    expect(repository.save).toHaveBeenCalledWith([matching]);
    expect(matching.endpointFingerprint?.ceA).toEqual({
      publicIpv4: '192.0.2.10',
      haGroupId: 'ha-1',
      haGroupName: '眉山能力池HA组',
      backupVrUuid: 'ce-2',
    });
    expect(unrelated.endpointFingerprint?.ceA).toEqual({ publicIpv4: '192.0.2.20' });
  });

  it('presents live HA names on list payloads without mutating the entity', () => {
    const tunnel: {
      id: string;
      ceA: string;
      ceB: string;
      endpointFingerprint: Srv6EndpointFingerprint;
    } = {
      id: 'tunnel-1',
      ceA: 'ce-1',
      ceB: 'ce-3',
      endpointFingerprint: { ceA: { publicIpv4: '192.0.2.10' } },
    };
    const index = buildCeHaAnnotationIndex([
      {
        id: 'ha-1',
        name: '眉山能力池HA组',
        members: [
          { role: 'primary', vrUuid: 'ce-1' },
          { role: 'backup', vrUuid: 'ce-2' },
        ],
      },
    ]);

    const presented = presentSrv6TunnelsWithLiveHa([tunnel], index);

    expect(presented[0].endpointFingerprint?.ceA?.haGroupName).toBe('眉山能力池HA组');
    expect(tunnel.endpointFingerprint.ceA).toEqual({ publicIpv4: '192.0.2.10' });
  });
});
