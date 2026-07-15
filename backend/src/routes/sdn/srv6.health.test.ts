import {
  collectExpectedNeighbors,
  collectExpectedSidRoutes,
  findLiveNeighbor,
  isBgpSessionUp,
  isSidRouteExpectation,
  normalizeNeighborIp,
  resolvePublicBgpIndex,
  sidRoutePresentInLive,
} from './srv6.health';

describe('srv6.health helpers', () => {
  test('normalizeNeighborIp lowercases and strips brackets', () => {
    expect(normalizeNeighborIp(' 2001:DB8::1 ')).toBe('2001:db8::1');
    expect(normalizeNeighborIp('[2001:db8::1]')).toBe('2001:db8::1');
  });

  test('isBgpSessionUp accepts Established and numeric pfx column', () => {
    expect(isBgpSessionUp('Established')).toBe(true);
    expect(isBgpSessionUp('12')).toBe(true);
    expect(isBgpSessionUp('Active')).toBe(false);
    expect(isBgpSessionUp('2 4 N/A')).toBe(false);
  });

  test('resolvePublicBgpIndex prefers publicConfig / VRF0 block', () => {
    expect(
      resolvePublicBgpIndex({
        pe: { publicConfig: { publicBgpIndex: 2 } },
        bgp: [{ vrf: 1 }, { vrf: 2 }, { vrf: 0 }],
      }),
    ).toBe(2);
    expect(
      resolvePublicBgpIndex({
        bgp: [{ vrf: 7 }, { asn: 100 }],
      }),
    ).toBe(1);
  });

  test('collectExpectedNeighbors splits PE public vs private and CE private', () => {
    const { public: pub, private: priv } = collectExpectedNeighbors({
      tunnel: {
        peA: 'pe-a',
        peB: 'pe-b',
        ceA: 'ce-a',
        ceB: 'ce-b',
        injectedDelta: {
          peA: {
            neighbors: [
              { bgpIndex: 0, remote_ip: '2001:db8::b' },
              { bgpIndex: 1, remote_ip: '101.1.1.1' },
            ],
          },
          peB: {
            neighbors: [{ bgpIndex: 0, remote_ip: '2001:db8::a' }],
          },
          ceA: {
            neighbors: [{ bgpIndex: 0, remote_ip: '10.0.0.1' }],
          },
          ceB: {
            neighbors: [{ bgpIndex: 0, remote_ip: '10.0.0.2' }],
          },
        },
      },
      publicBgpIndexBySlot: { peA: 0, peB: 0 },
    });
    expect(pub.map((x) => x.remoteIp).sort()).toEqual(['2001:db8::a', '2001:db8::b']);
    expect(priv.map((x) => `${x.slot}:${x.remoteIp}`).sort()).toEqual([
      'ceA:10.0.0.1',
      'ceB:10.0.0.2',
      'peA:101.1.1.1',
    ]);
  });

  test('findLiveNeighbor matches by normalized IP', () => {
    const row = findLiveNeighbor(
      [
        { neighbor: '2001:DB8::1', as: '100', state: 'Established' },
        { neighbor: '10.0.0.1', as: '200', state: 'Active' },
      ],
      '2001:db8::1',
    );
    expect(row?.state).toBe('Established');
  });

  test('isSidRouteExpectation skips VRF default ::/0', () => {
    expect(isSidRouteExpectation({ destination: '240f:2033::/64', via: '203::33' })).toBe(true);
    expect(isSidRouteExpectation({ destination: '::/0', via: 'nexthop-vrf 0' })).toBe(false);
  });

  test('collectExpectedSidRoutes only takes PE SID routes', () => {
    const routes = collectExpectedSidRoutes({
      tunnel: {
        peA: 'pe-a',
        peB: 'pe-b',
        injectedDelta: {
          peA: {
            ipv6Routes: [
              { destination: '240f:20b::/64', via: '2001:db8::b' },
              { destination: '::/0', vrf: 7, via: 'nexthop-vrf 0' },
            ],
          },
          peB: {
            ipv6Routes: [{ destination: '240f:20a::/64', via: '2001:db8::a' }],
          },
        },
      },
    });
    expect(routes.map((r) => r.destination).sort()).toEqual(['240f:20a::/64', '240f:20b::/64']);
  });

  test('sidRoutePresentInLive matches prefix or raw blob', () => {
    expect(
      sidRoutePresentInLive(
        [{ raw: 'S  240f:2033::/64 via 203::33', protocol: 'S', prefix: '240f:2033::/64', next_hop: '203::33', interface: '' }],
        '',
        '240f:2033::/64',
        '203::33',
      ),
    ).toBe(true);
    expect(
      sidRoutePresentInLive([], 'S  240f:2044::/64 [1/0] via 203::44, eth0', '240f:2044::/64', '203::44'),
    ).toBe(true);
    expect(sidRoutePresentInLive([], '', '240f:2099::/64', '203::99')).toBe(false);
  });
});
