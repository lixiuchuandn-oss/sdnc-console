import { mergeBaselineWithContributions } from './srv6.merge';
import { effectiveConfigMatches } from './srv6.sync';
import type { Srv6EndpointInjectedDelta } from '../../entities/vRouter/srv6Tunnel.types';

const pe22Baseline = {
  bgp: [
    { vrf: 0, asn: 429, segment_routing_srv6: 'enable', address_family: [] },
    {
      vrf: 9999,
      asn: 105,
      address_family: [{ address_family: 'ipv4', modifiler: 'unicast', export_route: 'enable' }],
    },
  ],
};

const pe22Contrib: Srv6EndpointInjectedDelta = {
  neighbors: [{ bgpIndex: 0, remote_ip: '203::33', remote_as: 430 }],
  activateAddressFamily: [{ bgpIndex: 0, peerIp: '203::33' }],
  ipv6Routes: [{ destination: '240f:2033::/64', via: '203::33' }],
};

describe('srv6.sync', () => {
  it('effectiveConfigMatches: baseline only', () => {
    const actual = mergeBaselineWithContributions(pe22Baseline, []);
    expect(effectiveConfigMatches(actual, pe22Baseline, [])).toBe(true);
    expect(effectiveConfigMatches(actual, pe22Baseline, [pe22Contrib])).toBe(false);
  });

  it('effectiveConfigMatches: baseline + single tunnel contrib', () => {
    const actual = mergeBaselineWithContributions(pe22Baseline, [pe22Contrib]);
    expect(effectiveConfigMatches(actual, pe22Baseline, [pe22Contrib])).toBe(true);
    expect(effectiveConfigMatches(actual, pe22Baseline, [])).toBe(false);
  });

  it('P2 invariant: sync result equals merge(baseline, [contrib])', () => {
    const synced = mergeBaselineWithContributions(pe22Baseline, [pe22Contrib]);
    const manual = mergeBaselineWithContributions(pe22Baseline, [pe22Contrib]);
    expect(JSON.stringify(synced)).toBe(JSON.stringify(manual));
  });
});
