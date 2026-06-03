import { buildSrv6PeerRouteDestination, maskToIpv6Network } from './srv6Ipv6';

describe('srv6Ipv6', () => {
  it('masks SID host to /64 network', () => {
    expect(maskToIpv6Network('240f:2033::1235', 64)).toBe('240f:2033::');
    expect(buildSrv6PeerRouteDestination('240f:2033::1235')).toBe('240f:2033::/64');
  });

  it('does not keep host bits (97f843f regression)', () => {
    expect(buildSrv6PeerRouteDestination('240f:2033::1235')).not.toBe('240f:2033::1235/64');
  });

  it('handles expanded form without ::', () => {
    expect(buildSrv6PeerRouteDestination('240f:2033:0:0:0:0:0:1235')).toBe('240f:2033::/64');
  });
});
