import {
  buildHubInventoryUi,
  emptyHubInventory,
  materializeHubInventoryForBinding,
  mergeInventoryWithBaselineCandidates,
  parseHubInventoryFromBaseline,
  patchHubBindingsInventoryIds,
  persistBaselineBindingSelectionsToInventory,
  resolveHubBindingsWithInventory,
  stripTowerExtensionsFromDeviceBaseline,
  TOWER_HUB_INVENTORY_KEY,
} from './srv6.hubInventory';
import type { Srv6HubPortRegistryEntry } from './srv6.hub';
import { VRConfig } from '../../entities/vRouter/VRConfig';

jest.mock('../../config/database', () => ({
  AppDataSource: {
    getRepository: jest.fn(),
  },
}));

const { AppDataSource } = jest.requireMock('../../config/database') as {
  AppDataSource: { getRepository: jest.Mock };
};

describe('srv6.hubInventory', () => {
  it('parseHubInventoryFromBaseline reads _towerHubInventory', () => {
    const baseline = {
      bgp: [],
      [TOWER_HUB_INVENTORY_KEY]: {
        wan: [{ id: 'w1', ifName: 'ge0', ipv6: '2001::1/64', source: 'role_wizard', createdAt: '2026-01-01' }],
        lan: [],
      },
    };
    const inv = parseHubInventoryFromBaseline(baseline);
    expect(inv.wan).toHaveLength(1);
    expect(inv.wan[0].ifName).toBe('ge0');
  });

  it('parseHubInventoryFromBaseline normalizes legacy tunnel_inline to role_wizard', () => {
    const baseline = {
      bgp: [],
      [TOWER_HUB_INVENTORY_KEY]: {
        wan: [
          {
            id: 'w-legacy',
            ifName: 'ge2',
            ipv6: '2001::2/64',
            source: 'tunnel_inline',
            createdAt: '2026-01-01',
          },
        ],
        lan: [
          {
            id: 'l-legacy',
            ifName: 'ge3',
            vrf: 20,
            privateAsn: 65002,
            routerId: '10.0.0.2',
            source: 'tunnel_inline',
            createdAt: '2026-01-01',
          },
        ],
      },
    };
    const inv = parseHubInventoryFromBaseline(baseline);
    expect(inv.wan[0].source).toBe('role_wizard');
    expect(inv.lan[0].source).toBe('role_wizard');
  });

  it('stripTowerExtensionsFromDeviceBaseline removes inventory key', () => {
    const baseline = {
      bgp: [{ index: 1 }],
      [TOWER_HUB_INVENTORY_KEY]: { wan: [], lan: [] },
    };
    const stripped = stripTowerExtensionsFromDeviceBaseline(baseline);
    expect(stripped.bgp).toEqual([{ index: 1 }]);
    expect(stripped[TOWER_HUB_INVENTORY_KEY]).toBeUndefined();
  });

  it('stripTowerExtensionsFromDeviceBaseline strips ipv6_route dev', () => {
    const stripped = stripTowerExtensionsFromDeviceBaseline({
      ipv6_route: [{ destination: '::/0', via: '203::33', dev: 'ge0' }],
    });
    expect(stripped.ipv6_route).toEqual([{ destination: '::/0', via: '203::33' }]);
  });

  it('buildHubInventoryUi marks WAN reusable when port registry references ifName', () => {
    const inventory = emptyHubInventory();
    inventory.wan.push({
      id: 'w1',
      ifName: 'ge0',
      ipv6: '2001::1/64',
      source: 'role_wizard',
      createdAt: '2026-01-01',
    });
    const registry: Srv6HubPortRegistryEntry[] = [
      {
        tunnelId: 't1',
        tunnelName: 'Hub-T1',
        spokePeUuid: 'spoke-1',
        hubPeSlot: 'peB',
        wanIf: 'ge0',
        peerPublicNeighbor: '203::1',
        hubVrfMode: 'REUSE_VRF',
      },
    ];
    const ui = buildHubInventoryUi(inventory, registry);
    expect(ui.inventoryEmpty).toBe(false);
    expect(ui.wanOptions[0].tags).toContain('wan_reusable');
    expect(ui.wanOptions[0].selectable).toBe(true);
  });

  it('buildHubInventoryUi marks reuse LAN reusable', () => {
    const inventory = emptyHubInventory();
    inventory.lan.push({
      id: 'l1',
      ifName: 'ge1',
      vrf: 9999,
      privateAsn: 65001,
      routerId: '10.0.0.1',
      source: 'role_wizard',
      createdAt: '2026-01-01',
    });
    const registry: Srv6HubPortRegistryEntry[] = [
      {
        tunnelId: 't1',
        tunnelName: 'test-20260508',
        spokePeUuid: 'spoke-1',
        hubPeSlot: 'peB',
        wanIf: 'ge0',
        lanIf: 'ge1',
        peerPublicNeighbor: '203::1',
        hubVrfMode: 'REUSE_VRF',
      },
    ];
    const ui = buildHubInventoryUi(inventory, registry);
    expect(ui.lanOptions[0].selectable).toBe(true);
    expect(ui.lanOptions[0].tags).toContain('lan_reuse_reusable');
    expect(ui.lanOptions[0].label).toContain('test-20260508');
    expect(ui.lanOptions[0].label).toContain('可复用');
  });

  it('buildHubInventoryUi keeps idle VRF on same physical if when reuse uses another inventory id', () => {
    const inventory = emptyHubInventory();
    inventory.lan.push(
      {
        id: 'lan-9999',
        ifName: 'GigabitEthernet 2/3/0',
        vrf: 9999,
        privateAsn: 65001,
        routerId: '10.0.0.1',
        source: 'role_wizard',
        createdAt: '2026-01-01',
      },
      {
        id: 'lan-8888',
        ifName: 'GigabitEthernet 2/3/0',
        vrf: 8888,
        privateAsn: 65002,
        routerId: '10.0.0.2',
        source: 'role_wizard',
        createdAt: '2026-01-01',
      },
    );
    const registry: Srv6HubPortRegistryEntry[] = [
      {
        tunnelId: 't1',
        tunnelName: 'test-reuse',
        spokePeUuid: 'spoke-1',
        hubPeSlot: 'peB',
        wanIf: 'ge0',
        lanIf: 'GigabitEthernet 2/3/0',
        lanInventoryId: 'lan-9999',
        peerPublicNeighbor: '203::1',
        hubVrfMode: 'REUSE_VRF',
      },
    ];
    const ui = buildHubInventoryUi(inventory, registry);
    expect(ui.lanOptions[0].tags).toContain('lan_reuse_reusable');
    expect(ui.lanOptions[1].tags).toContain('idle');
  });

  it('buildHubInventoryUi marks dedicated LAN occupied', () => {
    const inventory = emptyHubInventory();
    inventory.lan.push({
      id: 'l1',
      ifName: 'ge1',
      vrf: 10,
      privateAsn: 65001,
      routerId: '10.0.0.1',
      source: 'role_wizard',
      createdAt: '2026-01-01',
    });
    const registry: Srv6HubPortRegistryEntry[] = [
      {
        tunnelId: 't2',
        tunnelName: 'Hub-B',
        spokePeUuid: 'spoke-2',
        hubPeSlot: 'peB',
        wanIf: 'ge0',
        lanIf: 'ge1',
        peerPublicNeighbor: '203::2',
        hubVrfMode: 'DEDICATED_VRF',
      },
    ];
    const ui = buildHubInventoryUi(inventory, registry);
    expect(ui.lanOptions[0].selectable).toBe(false);
    expect(ui.lanOptions[0].tags).toContain('lan_dedicated_occupied');
  });

  it('materializeHubInventoryForBinding adds wan interface from inventory', () => {
    const inventory = emptyHubInventory();
    inventory.wan.push({
      id: 'w1',
      ifName: 'GigabitEthernet 0/0/2',
      ipv6: '203::99/64',
      source: 'role_wizard',
      createdAt: '2026-01-01',
    });
    const cfg: Record<string, unknown> = { bgp: [{ vrf: 0, asn: 430 }] };
    materializeHubInventoryForBinding(cfg, {
      inventory,
      binding: { wanIf: 'GigabitEthernet 0/0/2', wanInventoryId: 'w1' },
      hubVrfMode: 'REUSE_VRF',
    });
    const ifaces = cfg.interfaces_GigabitEthernet as Record<string, unknown>[];
    expect(ifaces).toHaveLength(1);
    expect(ifaces[0].ipv6_static).toBe('203::99/64');
    expect(cfg[TOWER_HUB_INVENTORY_KEY]).toBeUndefined();
  });

  it('materializeHubInventoryForBinding adds dedicated LAN bgp segment', () => {
    const inventory = emptyHubInventory();
    inventory.lan.push({
      id: 'l1',
      ifName: 'GigabitEthernet 0/0/3',
      vrf: 8888,
      privateAsn: 65088,
      routerId: '10.8.8.8',
      source: 'role_wizard',
      createdAt: '2026-01-01',
    });
    const cfg: Record<string, unknown> = { bgp: [{ vrf: 0, asn: 430 }] };
    materializeHubInventoryForBinding(cfg, {
      inventory,
      binding: { lanIf: 'GigabitEthernet 0/0/3', lanInventoryId: 'l1' },
      hubVrfMode: 'DEDICATED_VRF',
    });
    const bgp = cfg.bgp as Record<string, unknown>[];
    expect(bgp).toHaveLength(2);
    expect(bgp[1].vrf).toBe(8888);
    expect(bgp[1].asn).toBe(65088);
  });

  it('patchHubBindingsInventoryIds fills wan/lan inventory ids', () => {
    const inventory = emptyHubInventory();
    inventory.wan.push({
      id: 'w1',
      ifName: 'ge2',
      ipv6: '2001::2/64',
      source: 'role_wizard',
      createdAt: '2026-01-01',
    });
    const patched = patchHubBindingsInventoryIds(
      {
        hubPeUuid: 'hub',
        spokePeUuid: 'spoke',
        hubPeSlot: 'peB',
        wanIf: 'ge2',
        peerPublicNeighbor: '203::1',
      },
      inventory,
    );
    expect(patched.wanInventoryId).toBe('w1');
  });

  it('mergeInventoryWithBaselineCandidates adds wan from baseline interfaces', () => {
    const baseline = {
      interfaces_GigabitEthernet: [{ name: 'GigabitEthernet 0/0/0', ipv6_static: '2001::1/64' }],
      bgp: [{ vrf: 0, asn: 65000 }],
    };
    const merged = mergeInventoryWithBaselineCandidates(emptyHubInventory(), baseline);
    expect(merged.wan).toHaveLength(1);
    expect(merged.wan[0].source).toBe('device_baseline');
    expect(merged.wan[0].ifName).toBe('GigabitEthernet 0/0/0');
  });

  it('buildHubInventoryUi lists baseline wan when inventory empty', () => {
    const baseline = {
      interfaces_GigabitEthernet: [{ name: 'ge0', ipv6_static: '2001::hub/64' }],
    };
    const merged = mergeInventoryWithBaselineCandidates(emptyHubInventory(), baseline);
    const ui = buildHubInventoryUi(merged, []);
    expect(ui.inventoryEmpty).toBe(false);
    expect(ui.wanOptions).toHaveLength(1);
    expect(ui.wanOptions[0].label).toContain('Hub 已有公网口');
  });

  it('persistBaselineBindingSelectionsToInventory promotes selected baseline wan', () => {
    const baseline = {
      interfaces_GigabitEthernet: [{ name: 'ge0', ipv6_static: '2001::1/64' }],
    };
    const merged = mergeInventoryWithBaselineCandidates(emptyHubInventory(), baseline);
    const next = persistBaselineBindingSelectionsToInventory(emptyHubInventory(), baseline, {
      hubPeUuid: 'hub',
      spokePeUuid: 'spoke',
      hubPeSlot: 'peB',
      wanIf: 'ge0',
      wanInventoryId: merged.wan[0].id,
      peerPublicNeighbor: '203::1',
    });
    expect(next.wan).toHaveLength(1);
    expect(next.wan[0].source).toBe('role_wizard');
    expect(next.wan[0].ifName).toBe('ge0');
  });

  it('resolveHubBindingsWithInventory promotes baseline wan and patches inventory ids', async () => {
    const baseline = {
      bgp: [],
      interfaces_GigabitEthernet: [{ name: 'ge9', ipv6_static: '2001::9/64' }],
      [TOWER_HUB_INVENTORY_KEY]: emptyHubInventory(),
    };
    const vrRow = {
      uuid: 'hub-1',
      srv6BaselineJson: JSON.stringify(baseline),
    } as VRConfig;
    let savedBaseline = baseline;
    AppDataSource.getRepository.mockReturnValue({
      findOne: jest.fn().mockResolvedValue(vrRow),
      save: jest.fn().mockImplementation(async (row: VRConfig) => {
        if (row.srv6BaselineJson) {
          savedBaseline = JSON.parse(row.srv6BaselineJson);
        }
        return row;
      }),
    });

    const bindings = await resolveHubBindingsWithInventory(
      'hub-1',
      'tunnel-upd',
      {
        hubPeUuid: 'hub-1',
        spokePeUuid: 'spoke-1',
        hubPeSlot: 'peB',
        wanIf: 'ge9',
        peerPublicNeighbor: '203::9',
      },
      'REUSE_VRF',
    );

    expect(bindings?.wanInventoryId).toBeTruthy();
    expect(savedBaseline[TOWER_HUB_INVENTORY_KEY].wan).toHaveLength(1);
    expect(savedBaseline[TOWER_HUB_INVENTORY_KEY].wan[0].ifName).toBe('ge9');
    expect(savedBaseline[TOWER_HUB_INVENTORY_KEY].wan[0].source).toBe('role_wizard');
  });
});
