import {
  findFirstReuseVrfTunnelRef,
  hubInventoryBlockMessage,
  hubLanSelectionPatch,
  isFirstHubTunnel,
  pickHubReuseAnchorFromTunnel,
  validateHubTunnelInventory,
} from './srv6TunnelWizardHub';

describe('srv6TunnelWizardHub P3', () => {
  it('isFirstHubTunnel when no alive tunnels on hub', () => {
    expect(isFirstHubTunnel(0)).toBe(true);
    expect(isFirstHubTunnel(1)).toBe(false);
  });

  it('hubInventoryBlockMessage uses role wizard guidance', () => {
    expect(hubInventoryBlockMessage('wan')).toContain('HUB_PE 角色配置向导');
    expect(hubInventoryBlockMessage('lan')).toContain('LAN');
  });

  it('pickHubReuseAnchorFromTunnel reads hubBindings and hub CE', () => {
    const anchor = pickHubReuseAnchorFromTunnel('peA', {
      id: 't1',
      name: 'Hub-T1',
      ceA: 'ce-hub',
      ceB: 'ce-spoke',
      peAInnerIf: 'ge1',
      hubBindings: { lanIf: 'ge1', lanInventoryId: 'lan-1' },
    });
    expect(anchor).toEqual({
      hubLanIf: 'ge1',
      hubLanInventoryId: 'lan-1',
      hubPeInnerIf: 'ge1',
      hubCeUuid: 'ce-hub',
      sourceTunnelId: 't1',
      sourceTunnelName: 'Hub-T1',
    });
  });

  it('validateHubTunnelInventory blocks missing WAN inventory', () => {
    expect(
      validateHubTunnelInventory({
        isFirstHubTunnel: true,
        hasWanInventoryOptions: false,
        hasLanInventoryOptions: true,
      }),
    ).toEqual({ ok: false, message: hubInventoryBlockMessage('wan') });
  });

  it('validateHubTunnelInventory requires LAN on first REUSE', () => {
    expect(
      validateHubTunnelInventory({
        hubCustomerSide: 'reuse',
        hubWanInventoryId: 'w1',
        isFirstHubTunnel: true,
        hasWanInventoryOptions: true,
        hasLanInventoryOptions: false,
      }),
    ).toEqual({ ok: false, message: hubInventoryBlockMessage('lan') });

    expect(
      validateHubTunnelInventory({
        hubCustomerSide: 'reuse',
        hubWanInventoryId: 'w1',
        isFirstHubTunnel: true,
        hasWanInventoryOptions: true,
        hasLanInventoryOptions: true,
      }),
    ).toEqual({ ok: false, message: '首条共用客户侧隧道须选择 Hub 客户侧 LAN' });
  });

  it('validateHubTunnelInventory subsequent REUSE needs anchor', () => {
    expect(
      validateHubTunnelInventory({
        hubCustomerSide: 'reuse',
        hubWanInventoryId: 'w1',
        isFirstHubTunnel: false,
        hasWanInventoryOptions: true,
        hasLanInventoryOptions: true,
        reuseAnchor: null,
      }).ok,
    ).toBe(false);
  });

  it('hubLanSelectionPatch syncs hub pe inner if', () => {
    expect(hubLanSelectionPatch('peB', 'GigabitEthernet 1/0/1')).toEqual({
      hubLanIf: 'GigabitEthernet 1/0/1',
      peBInnerIf: 'GigabitEthernet 1/0/1',
    });
  });

  it('findFirstReuseVrfTunnelRef skips DEDICATED and dedupes tunnelId', () => {
    const ref = findFirstReuseVrfTunnelRef([
      { tunnelId: 't-ded', hubVrfMode: 'DEDICATED_VRF' },
      { tunnelId: 't-reuse', hubVrfMode: 'REUSE_VRF' },
      { tunnelId: 't-reuse', hubVrfMode: 'REUSE_VRF' },
    ]);
    expect(ref?.tunnelId).toBe('t-reuse');
    expect(findFirstReuseVrfTunnelRef([{ tunnelId: 't1', hubVrfMode: 'DEDICATED_VRF' }])).toBeNull();
  });

  it('validateHubTunnelInventory dedicated requires LAN inventory and selection', () => {
    expect(
      validateHubTunnelInventory({
        hubCustomerSide: 'dedicated',
        hubWanInventoryId: 'w1',
        isFirstHubTunnel: false,
        hasWanInventoryOptions: true,
        hasLanInventoryOptions: false,
      }),
    ).toEqual({ ok: false, message: hubInventoryBlockMessage('lan') });

    expect(
      validateHubTunnelInventory({
        hubCustomerSide: 'dedicated',
        hubWanInventoryId: 'w1',
        isFirstHubTunnel: false,
        hasWanInventoryOptions: true,
        hasLanInventoryOptions: true,
      }),
    ).toEqual({ ok: false, message: '独立客户侧须选择 Hub 内网口' });

    expect(
      validateHubTunnelInventory({
        hubCustomerSide: 'dedicated',
        hubWanInventoryId: 'w1',
        hubLanInventoryId: 'l1',
        isFirstHubTunnel: false,
        hasWanInventoryOptions: true,
        hasLanInventoryOptions: true,
      }).ok,
    ).toBe(true);
  });
});
