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
});
