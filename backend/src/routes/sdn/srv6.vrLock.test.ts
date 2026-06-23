import { SRv6Tunnel } from '../../entities/vRouter/SRv6Tunnel';
import { VRConfig } from '../../entities/vRouter/VRConfig';
import { computePeFingerprint } from './srv6.archive';
import {
  assertSrv6VrConfigUpsertAllowed,
  assertSrv6VrSetRoleAllowed,
} from './srv6.vrLock';

jest.mock('../../config/database', () => ({
  AppDataSource: {
    getRepository: jest.fn(),
  },
}));

jest.mock('./srv6.references', () => ({
  findSrv6TunnelsReferencingVr: jest.fn(),
}));

const { AppDataSource } = jest.requireMock('../../config/database') as {
  AppDataSource: { getRepository: jest.Mock };
};

const { findSrv6TunnelsReferencingVr } = jest.requireMock('./srv6.references') as {
  findSrv6TunnelsReferencingVr: jest.Mock;
};

const hubMultiWanCfg = (ge1Ipv6 = '2001::hub1/64') =>
  JSON.stringify({
    role: 'HUB_PE',
    segment_routing_srv6: { prefix: '2001:db8::/64' },
    interfaces_GigabitEthernet: [
      { name: 'ge0', ipv6_static: '2001::hub0/64' },
      { name: 'ge1', ipv6_static: ge1Ipv6 },
    ],
    bgp: [{ asn: 65000 }, { asn: 65001 }],
  });

const spokeCfg = (publicIpv6 = '2001::spoke/64') =>
  JSON.stringify({
    role: 'SPOKE_PE',
    segment_routing_srv6: { prefix: '2001:db8:1::/64' },
    interfaces_GigabitEthernet: [{ name: 'wan0', ipv6_static: publicIpv6 }],
    bgp: [{ asn: 65100 }],
  });

describe('srv6.vrLock', () => {
  const mockTunnelFindOne = (tunnel: Partial<SRv6Tunnel>) => {
    AppDataSource.getRepository.mockImplementation((entity: unknown) => {
      if (entity === SRv6Tunnel) {
        return { findOne: jest.fn().mockResolvedValue(tunnel) };
      }
      if (entity === VRConfig) {
        return { findOne: jest.fn().mockResolvedValue({ uuid: 'hub-1', role: 'HUB_PE' }) };
      }
      return { findOne: jest.fn().mockResolvedValue(null) };
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('assertSrv6VrConfigUpsertAllowed · Hub 多 WAN (A12)', () => {
    const hubTunnel = {
      id: 't-hub',
      name: 'Hub-T1',
      tunnelTopology: 'H',
      hubPeSlot: 'peB',
      peA: 'spoke-1',
      peB: 'hub-1',
      hubBindings: {
        hubPeUuid: 'hub-1',
        spokePeUuid: 'spoke-1',
        hubPeSlot: 'peB',
        wanIf: 'ge0',
        peerPublicNeighbor: '203::spoke/64',
      },
      endpointFingerprint: {
        peB: computePeFingerprint(
          JSON.parse(hubMultiWanCfg()) as Record<string, unknown>,
          undefined,
          { wanIf: 'ge0', peerPublicNeighbor: '203::spoke/64' },
        ),
      },
    } as unknown as SRv6Tunnel;

    it('allows changing an unbound WAN interface on referenced Hub PE', async () => {
      findSrv6TunnelsReferencingVr.mockResolvedValue([
        { tunnelId: 't-hub', tunnelName: 'Hub-T1', slot: 'peB' },
      ]);
      mockTunnelFindOne(hubTunnel);

      await expect(
        assertSrv6VrConfigUpsertAllowed('hub-1', hubMultiWanCfg('2001::hub1-changed/64')),
      ).resolves.toBeUndefined();
    });

    it('rejects changing bound Hub WAN IPv6 on ge0 (409)', async () => {
      findSrv6TunnelsReferencingVr.mockResolvedValue([
        { tunnelId: 't-hub', tunnelName: 'Hub-T1', slot: 'peB' },
      ]);
      mockTunnelFindOne(hubTunnel);

      const cfg = JSON.parse(hubMultiWanCfg()) as Record<string, unknown>;
      const ifaces = cfg.interfaces_GigabitEthernet as Record<string, unknown>[];
      ifaces[0] = { ...ifaces[0], ipv6_static: '2001::bound-changed/64' };

      await expect(
        assertSrv6VrConfigUpsertAllowed('hub-1', JSON.stringify(cfg)),
      ).rejects.toMatchObject({ statusCode: 409 });
    });

    it('rejects changing Hub SID prefix when referenced (409)', async () => {
      findSrv6TunnelsReferencingVr.mockResolvedValue([
        { tunnelId: 't-hub', tunnelName: 'Hub-T1', slot: 'peB' },
      ]);
      mockTunnelFindOne(hubTunnel);

      const cfg = JSON.parse(hubMultiWanCfg()) as Record<string, unknown>;
      cfg.segment_routing_srv6 = { prefix: '2001:db8:ff::/64' };

      await expect(
        assertSrv6VrConfigUpsertAllowed('hub-1', JSON.stringify(cfg)),
      ).rejects.toMatchObject({ statusCode: 409 });
    });
  });

  describe('assertSrv6VrConfigUpsertAllowed · Spoke (R6)', () => {
    const spokeTunnel = {
      id: 't-spoke',
      name: 'Spoke-T1',
      tunnelTopology: 'S',
      endpointFingerprint: {
        peA: computePeFingerprint(
          JSON.parse(spokeCfg()) as Record<string, unknown>,
        ),
      },
    } as unknown as SRv6Tunnel;

    it('rejects changing Spoke public IPv6 when referenced (409)', async () => {
      findSrv6TunnelsReferencingVr.mockResolvedValue([
        { tunnelId: 't-spoke', tunnelName: 'Spoke-T1', slot: 'peA' },
      ]);
      mockTunnelFindOne(spokeTunnel);

      await expect(
        assertSrv6VrConfigUpsertAllowed('spoke-1', spokeCfg('2001::spoke-changed/64')),
      ).rejects.toMatchObject({ statusCode: 409 });
    });
  });

  describe('assertSrv6VrSetRoleAllowed (A11)', () => {
    it('allows set-role when role unchanged', async () => {
      findSrv6TunnelsReferencingVr.mockResolvedValue([
        { tunnelId: 't1', tunnelName: 'T1', slot: 'peB' },
      ]);
      AppDataSource.getRepository.mockReturnValue({
        findOne: jest.fn().mockResolvedValue({ uuid: 'hub-1', role: 'HUB_PE' }),
      });

      await expect(assertSrv6VrSetRoleAllowed('hub-1', 'HUB_PE')).resolves.toBeUndefined();
    });

    it('rejects set-role change when VR is referenced (409)', async () => {
      findSrv6TunnelsReferencingVr.mockResolvedValue([
        { tunnelId: 't1', tunnelName: 'T1', slot: 'peB' },
      ]);
      AppDataSource.getRepository.mockReturnValue({
        findOne: jest.fn().mockResolvedValue({ uuid: 'hub-1', role: 'HUB_PE' }),
      });

      await expect(assertSrv6VrSetRoleAllowed('hub-1', 'SPOKE_PE')).rejects.toMatchObject({
        statusCode: 409,
      });
    });
  });
});
