import {
  TOWER_HUB_INVENTORY_KEY,
  attachHubInventoryToConfig,
  buildHubInventoryFromPeWizardValues,
  emptyHubInventory,
  hubInventoryToPeWizardForm,
  parseHubInventoryFromConfig,
  stripTowerExtensionsFromDeviceConfig,
} from './hubPeInventory';

describe('hubPeInventory', () => {
  it('buildHubInventoryFromPeWizardValues writes role_wizard WAN/LAN', () => {
    const inv = buildHubInventoryFromPeWizardValues({
      hubWanInventory: [{ ifName: 'ge0', ipv6: '2001::1/64' }],
      lanConfigs: [
        {
          ifName: 'ge1',
          vrf: 10,
          asn: 65001,
          routerId: '10.0.0.1',
        },
      ],
    });
    expect(inv.wan).toHaveLength(1);
    expect(inv.wan[0].source).toBe('role_wizard');
    expect(inv.lan[0].privateAsn).toBe(65001);
  });

  it('buildHubInventoryFromPeWizardValues preserves tunnel_inline segment', () => {
    const existing = emptyHubInventory();
    existing.wan.push({
      id: 'w-inline',
      ifName: 'ge2',
      ipv6: '2001::2/64',
      source: 'tunnel_inline',
      createdByTunnelId: 't1',
      createdAt: '2026-01-01',
    });
    const inv = buildHubInventoryFromPeWizardValues(
      { hubWanInventory: [{ id: 'w1', ifName: 'ge0', ipv6: '2001::1/64' }] },
      existing,
    );
    expect(inv.wan).toHaveLength(2);
    expect(inv.wan.find((w) => w.id === 'w-inline')?.source).toBe('tunnel_inline');
    expect(inv.wan.find((w) => w.ifName === 'ge0')?.source).toBe('role_wizard');
  });

  it('reuses inventory id when wizard ifName matches existing', () => {
    const existing = emptyHubInventory();
    existing.wan.push({
      id: 'w-existing',
      ifName: 'ge0',
      ipv6: '2001::1/64',
      source: 'role_wizard',
      createdAt: '2026-01-01',
    });
    const inv = buildHubInventoryFromPeWizardValues(
      { hubWanInventory: [{ ifName: 'ge0', ipv6: '2001::1/64' }] },
      existing,
    );
    expect(inv.wan).toHaveLength(1);
    expect(inv.wan[0].id).toBe('w-existing');
  });

  it('parseHubInventoryFromConfig and stripTowerExtensionsFromDeviceConfig', () => {
    const inv = emptyHubInventory();
    inv.wan.push({
      id: 'w1',
      ifName: 'ge0',
      ipv6: '2001::1/64',
      source: 'role_wizard',
      createdAt: '2026-01-01',
    });
    const cfg = attachHubInventoryToConfig({ bgp: [] }, inv);
    expect(parseHubInventoryFromConfig(cfg)?.wan[0].ifName).toBe('ge0');
    const stripped = stripTowerExtensionsFromDeviceConfig(cfg);
    expect(stripped.bgp).toEqual([]);
    expect(stripped[TOWER_HUB_INVENTORY_KEY]).toBeUndefined();
  });

  it('hubInventoryToPeWizardForm restores only role_wizard rows', () => {
    const inv = emptyHubInventory();
    inv.wan.push(
      {
        id: 'w-wiz',
        ifName: 'ge0',
        ipv6: '2001::1/64',
        source: 'role_wizard',
        createdAt: '2026-01-01',
      },
      {
        id: 'w-inline',
        ifName: 'ge2',
        ipv6: '2001::2/64',
        source: 'tunnel_inline',
        createdAt: '2026-01-01',
      },
    );
    const cfg = attachHubInventoryToConfig({}, inv);
    const form = hubInventoryToPeWizardForm(cfg);
    expect(form.hubWanInventory).toHaveLength(1);
    expect(form.hubWanInventory[0].id).toBe('w-wiz');
  });
});
