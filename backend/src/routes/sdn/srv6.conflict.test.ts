import {
  checkInnerIfVrfOverlap,
  detectContributionConflicts,
  pickPrimaryConflicts,
} from './srv6.conflict';
import type { Srv6EndpointInjectedDelta } from '../../entities/vRouter/srv6Tunnel.types';
import type { Srv6AliveContribution } from './srv6.recompute';
import { mergeBaselineWithContributions } from './srv6.merge';

const ref = (name: string, contrib: Srv6EndpointInjectedDelta): Srv6AliveContribution => ({
  tunnelId: `t-${name}`,
  tunnelName: name,
  slot: 'peA',
  contribution: contrib,
  createdAt: new Date(),
});

describe('srv6.conflict', () => {
  const baseline = {
    bgp: [{ vrf: 0, asn: 429, neighbor: [{ remote_ip: '203::99', remote_as: 99 }] }],
  };

  it('X1: C-N1 duplicate neighbor on same bgpIndex', () => {
    const existing = ref('T1', {
      neighbors: [{ bgpIndex: 0, remote_ip: '203::33', remote_as: 430 }],
    });
    const newContrib: Srv6EndpointInjectedDelta = {
      neighbors: [{ bgpIndex: 0, remote_ip: '203::33', remote_as: 431 }],
    };
    const conflicts = detectContributionConflicts(newContrib, [existing], {});
    expect(conflicts.some((c) => c.code === 'C-N1')).toBe(true);
  });

  it('X2: C-R1 same bgpIndex RD/RT segment', () => {
    const existing = ref('T1', {
      rdRt: [{ bgpIndex: 1, route_distinguisher: '429:1', route_target: '429:1' }],
    });
    const newContrib: Srv6EndpointInjectedDelta = {
      rdRt: [{ bgpIndex: 1, route_distinguisher: '429:2', route_target: '429:2' }],
    };
    const conflicts = detectContributionConflicts(newContrib, [existing], {});
    expect(conflicts.some((c) => c.code === 'C-R1')).toBe(true);
  });

  it('X3: different vrf inner segments pass neighbor check', () => {
    const existing = ref('T1', {
      neighbors: [{ bgpIndex: 1, remote_ip: '10.1.1.1', remote_as: 101 }],
    });
    const newContrib: Srv6EndpointInjectedDelta = {
      neighbors: [{ bgpIndex: 2, remote_ip: '10.2.2.2', remote_as: 102 }],
      rdRt: [{ bgpIndex: 2, route_distinguisher: '429:8888', route_target: '429:8888' }],
    };
    const conflicts = detectContributionConflicts(newContrib, [existing], baseline);
    expect(conflicts.filter((c) => c.code.startsWith('C-N') || c.code.startsWith('C-R'))).toHaveLength(0);
  });

  it('C-N2: neighbor already in baseline', () => {
    const conflicts = detectContributionConflicts(
      { neighbors: [{ bgpIndex: 0, remote_ip: '203::99', remote_as: 100 }] },
      [],
      baseline,
    );
    expect(conflicts.some((c) => c.code === 'C-N2')).toBe(true);
  });

  it('C-I1: same innerIf and vrf on hub PE', () => {
    const conflicts = checkInnerIfVrfOverlap(
      { innerIf: 'GigabitEthernet 0/0/1', innerVrf: 9999 },
      { innerIf: 'GigabitEthernet 0/0/1', innerVrf: 9999 },
      { tunnelId: 't1', tunnelName: 'T1' },
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].code).toBe('C-I1');
  });

  it('M4: hub merge two spoke contributions coexist', () => {
    const hubBaseline = {
      bgp: [
        { vrf: 0, asn: 429, address_family: [] },
        { vrf: 9999, asn: 105, address_family: [{ address_family: 'ipv4', modifiler: 'unicast' }] },
        { vrf: 8888, asn: 106, address_family: [{ address_family: 'ipv4', modifiler: 'unicast' }] },
      ],
    };
    const c1: Srv6EndpointInjectedDelta = {
      neighbors: [
        { bgpIndex: 0, remote_ip: '203::33', remote_as: 430 },
        { bgpIndex: 1, remote_ip: '10.1.1.1', remote_as: 101 },
      ],
      rdRt: [{ bgpIndex: 1, route_distinguisher: '429:9999', route_target: '429:9999' }],
      ipv6Routes: [{ destination: '240f:2033::/64', via: '203::33' }],
    };
    const c2: Srv6EndpointInjectedDelta = {
      neighbors: [
        { bgpIndex: 0, remote_ip: '203::44', remote_as: 440 },
        { bgpIndex: 2, remote_ip: '10.2.2.2', remote_as: 102 },
      ],
      rdRt: [{ bgpIndex: 2, route_distinguisher: '429:8888', route_target: '429:8888' }],
      ipv6Routes: [{ destination: '240f:2044::/64', via: '203::44' }],
    };
    const merged = mergeBaselineWithContributions(hubBaseline, [c1, c2]);
    const pub = (merged.bgp as Record<string, unknown>[])[0];
    expect(pub.neighbor).toHaveLength(2);
    expect(merged.ipv6_route).toHaveLength(2);
  });

  it('Hub REUSE_VRF: private bgpIndex neighbor overlap is allowed', () => {
    const existing = ref('T1', {
      neighbors: [{ bgpIndex: 1, remote_ip: '10.1.1.1', remote_as: 101 }],
      rdRt: [{ bgpIndex: 1, route_distinguisher: '429:9999', route_target: '429:9999' }],
    });
    const newContrib: Srv6EndpointInjectedDelta = {
      neighbors: [{ bgpIndex: 1, remote_ip: '10.1.1.1', remote_as: 102 }],
      rdRt: [{ bgpIndex: 1, route_distinguisher: '429:9999', route_target: '429:9999' }],
    };
    const conflicts = detectContributionConflicts(newContrib, [existing], baseline, {
      hubPeSlot: true,
      hubVrfMode: 'REUSE_VRF',
    });
    expect(conflicts.some((c) => c.code === 'C-N1')).toBe(false);
    expect(conflicts.some((c) => c.code === 'C-R1')).toBe(false);
  });

  it('Hub PE slot: public bgpIndex 0 neighbor overlap still triggers C-N1', () => {
    const existing = ref('T1', {
      neighbors: [{ bgpIndex: 0, remote_ip: '203::33', remote_as: 430 }],
    });
    const newContrib: Srv6EndpointInjectedDelta = {
      neighbors: [{ bgpIndex: 0, remote_ip: '203::33', remote_as: 431 }],
    };
    const conflicts = detectContributionConflicts(newContrib, [existing], baseline, {
      hubPeSlot: true,
      hubVrfMode: 'REUSE_VRF',
    });
    expect(conflicts.some((c) => c.code === 'C-N1')).toBe(true);
  });

  it('Hub REUSE_VRF: skips C-I1 innerIf/vrf overlap', () => {
    const conflicts = detectContributionConflicts(
      { neighbors: [{ bgpIndex: 0, remote_ip: '203::55', remote_as: 430 }] },
      [],
      baseline,
      {
        hubPeSlot: true,
        hubVrfMode: 'REUSE_VRF',
        innerIfMeta: { innerIf: 'GigabitEthernet 0/0/1', innerVrf: 9999 },
        existingInnerIfMetas: [
          {
            tunnelId: 't1',
            tunnelName: 'T1',
            innerIf: 'GigabitEthernet 0/0/1',
            innerVrf: 9999,
          },
        ],
      },
    );
    expect(conflicts.some((c) => c.code === 'C-I1')).toBe(false);
  });

  it('pickPrimaryConflicts prioritizes C-H1 blocking', () => {
    const conflicts = [
      { code: 'C-N1' as const, message: 'neighbor dup' },
      { code: 'C-H1' as const, message: 'blocking dup', tunnelId: 't1', tunnelName: 'T1' },
    ];
    const primary = pickPrimaryConflicts(conflicts, true);
    expect(primary).toHaveLength(1);
    expect(primary[0].code).toBe('C-H1');
  });
});
