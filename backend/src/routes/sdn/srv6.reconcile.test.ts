import { jsonEqual } from './srv6.reconcile';
import { mergeBaselineWithContributions } from './srv6.merge';

describe('srv6.reconcile', () => {
  it('jsonEqual compares serialized JSON', () => {
    expect(jsonEqual({ a: 1, b: [2] }, { a: 1, b: [2] })).toBe(true);
    expect(jsonEqual({ a: 1 }, { a: 2 })).toBe(false);
  });

  it('zero-tunnel effective should equal baseline after merge', () => {
    const baseline = { bgp: [{ asn: 100 }], pe: { role: 'PE' } };
    const effective = mergeBaselineWithContributions(baseline, []);
    expect(jsonEqual(effective, baseline)).toBe(true);
  });

  it('invariant: stored config should match merge when contribs known', () => {
    const baseline = { bgp: [{ asn: 429, address_family: [] }] };
    const contrib = {
      neighbors: [{ bgpIndex: 0, remote_ip: '203::33', remote_as: 430 }],
    };
    const expected = mergeBaselineWithContributions(baseline, [contrib]);
    const drifted = { ...expected, extra: true };
    expect(jsonEqual(drifted, expected)).toBe(false);
  });

  it('Hub REUSE merge invariant matches recompute shape', () => {
    const baseline = {
      bgp: [
        { vrf: 0, asn: 430, address_family: [] },
        { vrf: 7777, asn: 106, address_family: [{ address_family: 'ipv4', modifiler: 'unicast' }] },
      ],
    };
    const c1 = {
      delta: {
        neighbors: [{ bgpIndex: 0, remote_ip: '203::22', remote_as: 430 }],
        rdRt: [{ bgpIndex: 1, route_distinguisher: '200:1', route_target: '200:100' }],
      },
      isHubPeSlot: true,
      hubVrfMode: 'REUSE_VRF' as const,
    };
    const c2 = {
      delta: {
        neighbors: [{ bgpIndex: 0, remote_ip: '203::44', remote_as: 440 }],
        rdRt: [{ bgpIndex: 1, route_distinguisher: '200:9', route_target: '200:200' }],
      },
      isHubPeSlot: true,
      hubVrfMode: 'REUSE_VRF' as const,
    };
    const expected = mergeBaselineWithContributions(baseline, [c1, c2]);
    expect(jsonEqual(expected, mergeBaselineWithContributions(baseline, [c1, c2]))).toBe(true);
    const af = ((expected.bgp as Record<string, unknown>[])[1].address_family as Record<
      string,
      unknown
    >[])[0];
    expect(af.route_target).toBe('200:100');
  });
});
