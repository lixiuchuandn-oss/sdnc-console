import { ejectInjectedDeltaFromConfig } from './srv6.eject';

describe('srv6.eject', () => {
  it('removes matching neighbor and ipv6_route', () => {
    const cfg = {
      bgp: [
        {
          vrf: 0,
          neighbor: [
            { remote_ip: '2001:db8::2', remote_as: 65002 },
            { remote_ip: '10.0.0.9', remote_as: 65009 },
          ],
        },
        {
          vrf: 10,
          neighbor: [{ remote_ip: '203.0.113.5', remote_as: 65020 }],
        },
      ],
      ipv6_route: [
        { destination: '240f:2033::/64', via: '2001:db8::2' },
        { destination: '::/0', vrf: 10, via: 'nexthop-vrf 0' },
      ],
    };
    const { config } = ejectInjectedDeltaFromConfig(cfg, {
      neighbors: [
        { bgpIndex: 0, remote_ip: '2001:db8::2' },
        { bgpIndex: 1, remote_ip: '203.0.113.5' },
      ],
      ipv6Routes: [
        { destination: '240f:2033::/64', via: '2001:db8::2' },
        { destination: '::/0', vrf: 10, via: 'nexthop-vrf 0' },
      ],
    });
    expect((config.bgp as any[])[0].neighbor).toHaveLength(1);
    expect((config.bgp as any[])[1].neighbor).toHaveLength(0);
    expect(config.ipv6_route).toBeUndefined();
  });
});
