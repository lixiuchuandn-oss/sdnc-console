import {
  buildHubPortRegistryFromTunnels,
  findHubBlockingConflictAmong,
  getHubPeUuid,
  isHubTunnel,
} from './srv6.hub';

describe('srv6.hub', () => {
  const hubBinding = (overrides?: Partial<NonNullable<Parameters<typeof findHubBlockingConflictAmong>[0]['hubBindings']>>) => ({
    hubPeUuid: 'hub-1',
    spokePeUuid: 'spoke-1',
    hubPeSlot: 'peA' as const,
    wanIf: 'GigabitEthernet0/0/0',
    peerPublicNeighbor: '2001:db8::33',
    ...overrides,
  });

  describe('isHubTunnel / getHubPeUuid', () => {
    it('identifies H topology and resolves hub PE uuid', () => {
      expect(isHubTunnel({ tunnelTopology: 'H' })).toBe(true);
      expect(isHubTunnel({ tunnelTopology: 'S' })).toBe(false);
      expect(
        getHubPeUuid({ hubPeSlot: 'peB', peA: 'a', peB: 'hub-1' }),
      ).toBe('hub-1');
    });
  });

  describe('findHubBlockingConflictAmong (C-H1)', () => {
    it('returns C-H1 when same hubPeUuid and peerPublicNeighbor collide', () => {
      const tunnel = {
        id: 't-new',
        tunnelTopology: 'H' as const,
        hubBindings: hubBinding({ peerPublicNeighbor: '2001:db8::33' }),
      };
      const others = [
        {
          id: 't-existing',
          name: 'Existing Hub Spoke',
          tunnelTopology: 'H' as const,
          hubBindings: hubBinding({ peerPublicNeighbor: '2001:DB8::33' }),
        },
      ];
      const conflict = findHubBlockingConflictAmong(tunnel, others);
      expect(conflict?.code).toBe('C-H1');
      expect(conflict?.tunnelId).toBe('t-existing');
      expect(conflict?.message).toContain('2001:db8::33');
    });

    it('allows same neighbor on different hub PE devices', () => {
      const tunnel = {
        id: 't-new',
        tunnelTopology: 'H' as const,
        hubBindings: hubBinding({ hubPeUuid: 'hub-2' }),
      };
      const others = [
        {
          id: 't-existing',
          name: 'Other Hub',
          tunnelTopology: 'H' as const,
          hubBindings: hubBinding({ hubPeUuid: 'hub-1' }),
        },
      ];
      expect(findHubBlockingConflictAmong(tunnel, others)).toBeNull();
    });

    it('ignores S topology and excludes self by tunnel id', () => {
      const tunnel = {
        id: 't1',
        tunnelTopology: 'S' as const,
        hubBindings: hubBinding(),
      };
      const others = [
        {
          id: 't1',
          name: 'Self',
          tunnelTopology: 'H' as const,
          hubBindings: hubBinding(),
        },
      ];
      expect(findHubBlockingConflictAmong(tunnel, others, 't1')).toBeNull();
    });
  });

  describe('buildHubPortRegistryFromTunnels', () => {
    it('aggregates port entries for matching hub PE uuid', () => {
      const tunnels = [
        {
          id: 't1',
          name: 'Hub-Spoke-A',
          tunnelTopology: 'H' as const,
          hubVrfMode: 'REUSE_VRF' as const,
          hubBindings: hubBinding({ hubPeUuid: 'hub-1', wanIf: 'GE0/0/0' }),
        },
        {
          id: 't2',
          name: 'Hub-Spoke-B',
          tunnelTopology: 'H' as const,
          hubVrfMode: 'REUSE_VRF' as const,
          hubBindings: hubBinding({
            hubPeUuid: 'hub-1',
            spokePeUuid: 'spoke-2',
            peerPublicNeighbor: '2001:db8::44',
            wanIf: 'GE0/0/1',
            lanIf: 'GE0/0/2',
          }),
        },
        {
          id: 't3',
          name: 'Other Hub',
          tunnelTopology: 'H' as const,
          hubBindings: hubBinding({ hubPeUuid: 'hub-other' }),
        },
        {
          id: 't4',
          name: 'Spoke Direct',
          tunnelTopology: 'S' as const,
          hubBindings: null,
        },
      ];
      const registry = buildHubPortRegistryFromTunnels('hub-1', tunnels);
      expect(registry).toHaveLength(2);
      expect(registry[0]).toMatchObject({
        tunnelId: 't1',
        hubPeSlot: 'peA',
        wanIf: 'GE0/0/0',
        peerPublicNeighbor: '2001:db8::33',
        spokePeUuid: 'spoke-1',
        hubVrfMode: 'REUSE_VRF',
      });
      expect(registry[1].lanIf).toBe('GE0/0/2');
    });

    it('falls back lanIf from hub slot inner interface when hubBindings.lanIf missing', () => {
      const tunnels = [
        {
          id: 't1',
          name: 'Hub-Spoke-A',
          tunnelTopology: 'H' as const,
          hubVrfMode: 'REUSE_VRF' as const,
          peBInnerIf: 'GigabitEthernet 2/3/0',
          hubBindings: hubBinding({ hubPeUuid: 'hub-1', hubPeSlot: 'peB' as const }),
        },
      ];
      const registry = buildHubPortRegistryFromTunnels('hub-1', tunnels);
      expect(registry).toHaveLength(1);
      expect(registry[0].lanIf).toBe('GigabitEthernet 2/3/0');
    });
  });
});
