import {
  assertUniqueHubInventoryIfNames,
  buildWanStaticRoutesFromRows,
  enrichHubWanRowsFromDeviceRoutes,
  sanitizeIpv6RoutesForDevice,
  type WanRouteFormRow,
} from './peWizardWanRoutes';

describe('peWizardWanRoutes P2', () => {
  it('buildWanStaticRoutesFromRows emits per-WAN ipv4 and ipv6 routes', () => {
    const { ipv4_route, ipv6_route } = buildWanStaticRoutesFromRows([
      {
        ifName: 'GigabitEthernet 2/2/0',
        ipv4RouteDest: '0.0.0.0/0',
        ipv4RoutePriority: 100,
        ipv6Dest: '::/0',
        ipv6Via: '203::33',
      },
      {
        ifName: 'GigabitEthernet 2/3/0',
        ipv6Dest: '240f::/64',
        ipv6Via: '203::44',
      },
    ]);
    expect(ipv4_route).toHaveLength(1);
    expect(ipv4_route[0].dev).toBe('GigabitEthernet 2/2/0');
    expect(ipv6_route).toHaveLength(2);
    expect(ipv6_route[0]).toEqual({ destination: '::/0', via: '203::33' });
    expect(ipv6_route[1]).toEqual({ destination: '240f::/64', via: '203::44' });
    expect((ipv6_route[0] as Record<string, unknown>).dev).toBeUndefined();
  });

  it('sanitizeIpv6RoutesForDevice strips dev from ipv6_route', () => {
    const out = sanitizeIpv6RoutesForDevice({
      ipv6_route: [{ destination: '::/0', via: '203::33', dev: 'ge0' }],
    });
    expect(out.ipv6_route[0]).toEqual({ destination: '::/0', via: '203::33' });
  });

  it('enrichHubWanRowsFromDeviceRoutes maps routes by interface dev', () => {
    const rows = enrichHubWanRowsFromDeviceRoutes<WanRouteFormRow>(
      [{ ifName: 'ge0' }, { ifName: 'ge1' }],
      {
        ipv4_route: [{ destination: '0.0.0.0/0', dev: 'ge0', priority: 90 }],
        ipv6_route: [
          { destination: '::/0', via: '203::33' },
          { destination: '::/0', via: '203::44' },
        ],
      },
    );
    expect(rows[0].ipv4RouteDest).toBe('0.0.0.0/0');
    expect(rows[0].ipv6Via).toBe('203::33');
    expect(rows[1].ipv6Via).toBe('203::44');
  });

  it('enrichHubWanRowsFromDeviceRoutes preserves inventory ipv6Via when set', () => {
    const rows = enrichHubWanRowsFromDeviceRoutes(
      [
        { ifName: 'ge0', ipv6Dest: '::/0', ipv6Via: '203::aa' },
        { ifName: 'ge1', ipv6Dest: '::/0', ipv6Via: '203::bb' },
      ],
      {
        ipv6_route: [
          { destination: '::/0', via: '203::33' },
          { destination: '::/0', via: '203::44' },
        ],
      },
    );
    expect(rows[0].ipv6Via).toBe('203::aa');
    expect(rows[1].ipv6Via).toBe('203::bb');
  });

  it('assertUniqueHubInventoryIfNames rejects duplicate wan or lan ifName', () => {
    expect(
      assertUniqueHubInventoryIfNames(
        [{ ifName: 'ge0' }, { ifName: 'ge0' }],
        [{ ifName: 'ge1' }],
      ),
    ).toContain('WAN');
    expect(
      assertUniqueHubInventoryIfNames(
        [{ ifName: 'ge0' }],
        [{ ifName: 'ge2' }, { ifName: 'ge2' }],
      ),
    ).toContain('LAN');
    expect(assertUniqueHubInventoryIfNames([{ ifName: 'ge0' }], [{ ifName: 'ge1' }])).toBeNull();
  });
});
