import {
  classifyHubLanOption,
  deriveHubVrfMode,
  detectHubLanSelectionDesync,
  findFirstReuseVrfTunnelRef,
  hubCeDiffersFromAnchor,
  hubInventoryBlockMessage,
  hubLanSelectionPatch,
  hubLanSelectionClear,
  isFirstHubTunnel,
  matchesHubReuseAnchorLan,
  pickHubReuseAnchorFromTunnel,
  pickHubReuseAnchorPreviewFromStatus,
  resolveHubCustomerSideIntent,
  resolveSelectedHubLanState,
  shouldInheritReuseAnchor,
  validateHubTunnelInventory,
  type HubLanOptionRow,
} from './srv6TunnelWizardHub';

describe('srv6TunnelWizardHub P3/P5', () => {
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

  it('resolveHubCustomerSideIntent explicit_dedicated for idle LAN on different physical port', () => {
    expect(
      resolveHubCustomerSideIntent({
        isFirstHubTunnel: false,
        hasReuseAnchor: true,
        hubLanInventoryId: 'lan-8888',
        hubLanIf: 'GigabitEthernet 2/4/0',
        selectedLanState: 'idle',
        anchorLanInventoryId: 'lan-9999',
        anchorLanIf: 'GigabitEthernet 2/3/0',
        hubCeUuid: 'ce-new',
        anchorCeUuid: 'ce-anchor',
        customerSideTouched: true,
      }),
    ).toBe('explicit_dedicated');
    expect(
      deriveHubVrfMode({
        isFirstHubTunnel: false,
        hasReuseAnchorOnHub: true,
        selectedLanState: 'idle',
        customerSideIntent: 'explicit_dedicated',
      }),
    ).toBe('DEDICATED_VRF');
  });

  it('resolveHubCustomerSideIntent inherit_reuse when customer side not configured yet', () => {
    expect(
      resolveHubCustomerSideIntent({
        isFirstHubTunnel: false,
        hasReuseAnchor: true,
        anchorLanIf: 'GigabitEthernet 2/3/0',
        selectedLanState: 'idle',
      }),
    ).toBe('inherit_reuse');
  });

  it('classifyHubLanOption distinguishes dedicated vs reuse', () => {
    const registry = [
      { lanIf: 'ge1', hubVrfMode: 'DEDICATED_VRF', tunnelName: 'T-ded' },
      { lanIf: 'ge2', hubVrfMode: 'REUSE_VRF', tunnelName: 'T-reuse' },
    ];
    expect(classifyHubLanOption('ge1', registry).state).toBe('dedicated_occupied');
    expect(classifyHubLanOption('ge2', registry).state).toBe('reuse_reusable');
    expect(classifyHubLanOption('ge3', registry).state).toBe('idle');
  });

  it('classifyHubLanOption same ifName different VRF inventory id', () => {
    const registry = [
      {
        lanIf: 'GigabitEthernet 2/3/0',
        lanInventoryId: 'lan-9999',
        hubVrfMode: 'REUSE_VRF',
        tunnelName: 'T-reuse',
      },
    ];
    expect(
      classifyHubLanOption(
        { id: 'lan-9999', ifName: 'GigabitEthernet 2/3/0', vrf: 9999 },
        registry,
      ).state,
    ).toBe('reuse_reusable');
    expect(
      classifyHubLanOption(
        { id: 'lan-8888', ifName: 'GigabitEthernet 2/3/0', vrf: 8888 },
        registry,
      ).state,
    ).toBe('idle');
  });

  it('matchesHubReuseAnchorLan rejects same ifName different inventory id', () => {
    expect(
      matchesHubReuseAnchorLan({
        hubLanInventoryId: 'lan-8888',
        hubLanIf: 'GigabitEthernet 2/3/0',
        anchorLanInventoryId: 'lan-9999',
        anchorLanIf: 'GigabitEthernet 2/3/0',
      }),
    ).toBe(false);
  });

  it('deriveHubVrfMode DEDICATED for subsequent idle VRF 8888 on shared physical if', () => {
    expect(
      deriveHubVrfMode({
        isFirstHubTunnel: false,
        hasReuseAnchorOnHub: true,
        selectedLanState: 'idle',
        inheritReuseAnchor: false,
        matchesReuseAnchorLan: false,
        hubCeDiffersFromAnchor: true,
      }),
    ).toBe('DEDICATED_VRF');
  });

  it('deriveHubVrfMode from lan option state', () => {
    expect(
      deriveHubVrfMode({
        isFirstHubTunnel: true,
        hasReuseAnchorOnHub: false,
        selectedLanState: 'idle',
      }),
    ).toBe('REUSE_VRF');

    expect(
      deriveHubVrfMode({
        isFirstHubTunnel: false,
        hasReuseAnchorOnHub: false,
        selectedLanState: 'idle',
      }),
    ).toBe('DEDICATED_VRF');

    expect(
      deriveHubVrfMode({
        isFirstHubTunnel: false,
        hasReuseAnchorOnHub: true,
        selectedLanState: 'idle',
      }),
    ).toBe('DEDICATED_VRF');

    expect(
      deriveHubVrfMode({
        isFirstHubTunnel: false,
        hasReuseAnchorOnHub: true,
        selectedLanState: 'reuse_reusable',
        matchesReuseAnchorLan: true,
      }),
    ).toBe('REUSE_VRF');

    expect(
      deriveHubVrfMode({
        isFirstHubTunnel: false,
        hasReuseAnchorOnHub: true,
        selectedLanState: 'reuse_reusable',
        matchesReuseAnchorLan: false,
      }),
    ).toBe('DEDICATED_VRF');

    expect(
      deriveHubVrfMode({
        isFirstHubTunnel: false,
        hasReuseAnchorOnHub: true,
        selectedLanState: 'idle',
        inheritReuseAnchor: true,
      }),
    ).toBe('REUSE_VRF');
  });

  it('shouldInheritReuseAnchor true when subsequent tunnel has no lan selection yet', () => {
    expect(
      shouldInheritReuseAnchor({
        isFirstHubTunnel: false,
        hasReuseAnchor: true,
        anchorLanIf: 'GigabitEthernet 2/3/0',
        selectedLanState: 'idle',
      }),
    ).toBe(true);
  });

  it('pickHubReuseAnchorPreviewFromStatus reads hubBindings and hub CE without fetch', () => {
    const preview = pickHubReuseAnchorPreviewFromStatus('peB', [
      {
        tunnelId: 't-reuse',
        hubVrfMode: 'REUSE_VRF',
        peBInnerIf: 'ge1',
        ceB: 'ce-anchor',
        hubBindings: { lanIf: 'ge1', lanInventoryId: 'lan-1' },
      },
    ]);
    expect(preview).toEqual({
      hubLanIf: 'ge1',
      hubLanInventoryId: 'lan-1',
      hubPeInnerIf: 'ge1',
      hubCeUuid: 'ce-anchor',
      sourceTunnelId: 't-reuse',
    });
  });

  it('matchesHubReuseAnchorLan rejects id match when ifName differs', () => {
    expect(
      matchesHubReuseAnchorLan({
        hubLanInventoryId: 'lan-9999',
        hubLanIf: 'GigabitEthernet 2/4/0',
        anchorLanInventoryId: 'lan-9999',
        anchorLanIf: 'GigabitEthernet 2/3/0',
      }),
    ).toBe(false);
  });

  it('resolveHubCustomerSideIntent explicit_dedicated when CE touched before anchor CE loaded', () => {
    expect(
      resolveHubCustomerSideIntent({
        isFirstHubTunnel: false,
        hasReuseAnchor: true,
        hubLanInventoryId: 'lan-9999',
        hubLanIf: 'GigabitEthernet 2/3/0',
        anchorLanInventoryId: 'lan-9999',
        anchorLanIf: 'GigabitEthernet 2/3/0',
        hubCeUuid: 'ce-new',
        selectedLanState: 'idle',
        customerSideTouched: true,
      }),
    ).toBe('explicit_dedicated');
  });

  it('resolveHubCustomerSideIntent explicit_dedicated when hubLan desynced', () => {
    expect(
      resolveHubCustomerSideIntent({
        isFirstHubTunnel: false,
        hasReuseAnchor: true,
        hubLanInventoryId: 'lan-9999',
        hubLanIf: 'GigabitEthernet 2/4/0',
        anchorLanInventoryId: 'lan-9999',
        anchorLanIf: 'GigabitEthernet 2/3/0',
        selectedLanState: 'idle',
        hubLanDesynced: true,
      }),
    ).toBe('explicit_dedicated');
  });

  it('deriveHubVrfMode REUSE when idle lan matches anchor on hub with reuse anchor', () => {
    expect(
      deriveHubVrfMode({
        isFirstHubTunnel: false,
        hasReuseAnchorOnHub: true,
        selectedLanState: 'idle',
        inheritReuseAnchor: false,
        matchesReuseAnchorLan: true,
      }),
    ).toBe('REUSE_VRF');
  });

  it('shouldInheritReuseAnchor when subsequent default', () => {
    expect(
      shouldInheritReuseAnchor({
        isFirstHubTunnel: false,
        hasReuseAnchor: true,
        hubLanInventoryId: 'lan-1',
        anchorLanInventoryId: 'lan-1',
        anchorLanIf: 'ge1',
        hubLanIf: 'ge1',
      }),
    ).toBe(true);

    expect(
      shouldInheritReuseAnchor({
        isFirstHubTunnel: false,
        hasReuseAnchor: true,
        hubLanInventoryId: 'lan-2',
        anchorLanInventoryId: 'lan-1',
        selectedLanState: 'idle',
      }),
    ).toBe(false);

    expect(
      shouldInheritReuseAnchor({
        isFirstHubTunnel: false,
        hasReuseAnchor: true,
        hubLanInventoryId: 'lan-1',
        anchorLanInventoryId: 'lan-1',
        anchorLanIf: 'ge1',
        hubLanIf: 'ge2',
        selectedLanState: 'idle',
      }),
    ).toBe(false);

    expect(
      shouldInheritReuseAnchor({
        isFirstHubTunnel: false,
        hasReuseAnchor: true,
        hubLanInventoryId: 'lan-1',
        anchorLanInventoryId: 'lan-1',
        hubCeUuid: 'ce-new',
        anchorCeUuid: 'ce-anchor',
        selectedLanState: 'reuse_reusable',
      }),
    ).toBe(false);
  });

  it('resolveSelectedHubLanState prefers ifName when inventory id desynced', () => {
    const lanOptions: HubLanOptionRow[] = [
      { value: 'lan-9999', ifName: 'ge9999', lanState: 'reuse_reusable' },
      { value: 'lan-8888', ifName: 'ge8888', lanState: 'idle' },
    ];
    expect(
      detectHubLanSelectionDesync({
        hubLanInventoryId: 'lan-9999',
        hubLanIf: 'ge8888',
        lanOptions,
      }),
    ).toBe(true);
    const resolved = resolveSelectedHubLanState({
      hubLanInventoryId: 'lan-9999',
      hubLanIf: 'ge8888',
      lanOptions,
      portRegistry: [{ lanIf: 'ge9999', hubVrfMode: 'REUSE_VRF', tunnelName: 'T1' }],
    });
    expect(resolved.desynced).toBe(true);
    expect(resolved.state).toBe('idle');
    expect(
      deriveHubVrfMode({
        isFirstHubTunnel: false,
        hasReuseAnchorOnHub: true,
        selectedLanState: resolved.state,
        inheritReuseAnchor: false,
        hubLanDesynced: true,
      }),
    ).toBe('DEDICATED_VRF');
  });

  it('deriveHubVrfMode: subsequent idle LAN is DEDICATED even without hubVrfMode on first tunnel', () => {
    expect(
      deriveHubVrfMode({
        isFirstHubTunnel: false,
        hasReuseAnchorOnHub: false,
        selectedLanState: 'idle',
        inheritReuseAnchor: false,
      }),
    ).toBe('DEDICATED_VRF');
  });

  it('shouldInheritReuseAnchor false for subsequent idle LAN', () => {
    expect(
      shouldInheritReuseAnchor({
        isFirstHubTunnel: false,
        hasReuseAnchor: true,
        hubLanIf: 'ge8888',
        anchorLanIf: 'ge9999',
        selectedLanState: 'idle',
      }),
    ).toBe(false);
  });

  it('shouldInheritReuseAnchor true when idle but explicit anchor LAN and CE', () => {
    expect(
      shouldInheritReuseAnchor({
        isFirstHubTunnel: false,
        hasReuseAnchor: true,
        hubLanInventoryId: 'lan-9999',
        anchorLanInventoryId: 'lan-9999',
        hubLanIf: 'GigabitEthernet 2/3/0',
        anchorLanIf: 'GigabitEthernet 2/3/0',
        hubCeUuid: 'ce-anchor',
        anchorCeUuid: 'ce-anchor',
        selectedLanState: 'idle',
      }),
    ).toBe(true);
    expect(
      deriveHubVrfMode({
        isFirstHubTunnel: false,
        hasReuseAnchorOnHub: true,
        selectedLanState: 'idle',
        inheritReuseAnchor: true,
      }),
    ).toBe('REUSE_VRF');
  });

  it('deriveHubVrfMode treats CE change as dedicated when not on reuse LAN', () => {
    expect(
      deriveHubVrfMode({
        isFirstHubTunnel: false,
        hasReuseAnchorOnHub: true,
        selectedLanState: 'idle',
        inheritReuseAnchor: false,
        hubCeDiffersFromAnchor: true,
      }),
    ).toBe('DEDICATED_VRF');
  });

  it('validateHubTunnelInventory blocks missing WAN inventory', () => {
    expect(
      validateHubTunnelInventory({
        hubVrfMode: 'REUSE_VRF',
        isFirstHubTunnel: true,
        hasWanInventoryOptions: false,
        hasLanInventoryOptions: true,
      }),
    ).toEqual({ ok: false, message: hubInventoryBlockMessage('wan') });
  });

  it('validateHubTunnelInventory requires LAN on first hub tunnel', () => {
    expect(
      validateHubTunnelInventory({
        hubVrfMode: 'REUSE_VRF',
        hubWanInventoryId: 'w1',
        isFirstHubTunnel: true,
        hasWanInventoryOptions: true,
        hasLanInventoryOptions: false,
      }),
    ).toEqual({ ok: false, message: hubInventoryBlockMessage('lan') });

    expect(
      validateHubTunnelInventory({
        hubVrfMode: 'REUSE_VRF',
        hubWanInventoryId: 'w1',
        isFirstHubTunnel: true,
        hasWanInventoryOptions: true,
        hasLanInventoryOptions: true,
      }),
    ).toEqual({ ok: false, message: '首条 Hub 隧道须选择 Hub 内网口' });
  });

  it('validateHubTunnelInventory subsequent REUSE inherit needs anchor', () => {
    expect(
      validateHubTunnelInventory({
        hubVrfMode: 'REUSE_VRF',
        hubWanInventoryId: 'w1',
        isFirstHubTunnel: false,
        hasWanInventoryOptions: true,
        hasLanInventoryOptions: true,
        inheritReuseAnchor: true,
        reuseAnchor: null,
      }).ok,
    ).toBe(false);
  });

  it('validateHubTunnelInventory allows new REUSE anchor on idle LAN without prior anchor', () => {
    expect(
      validateHubTunnelInventory({
        hubVrfMode: 'REUSE_VRF',
        hubWanInventoryId: 'w1',
        hubLanInventoryId: 'l-new',
        isFirstHubTunnel: false,
        hasWanInventoryOptions: true,
        hasLanInventoryOptions: true,
        selectedLanState: 'idle',
      }).ok,
    ).toBe(true);
  });

  it('hubLanSelectionPatch syncs hub pe inner if', () => {
    expect(hubLanSelectionPatch('peB', 'GigabitEthernet 1/0/1')).toEqual({
      hubLanIf: 'GigabitEthernet 1/0/1',
      peBInnerIf: 'GigabitEthernet 1/0/1',
    });
    expect(hubLanSelectionPatch('peB', 'GigabitEthernet 1/0/1', 'lan-8888')).toEqual({
      hubLanIf: 'GigabitEthernet 1/0/1',
      peBInnerIf: 'GigabitEthernet 1/0/1',
      hubLanInventoryId: 'lan-8888',
    });
  });

  it('hubLanSelectionClear clears hub lan and pe inner if', () => {
    expect(hubLanSelectionClear('peA')).toEqual({
      hubLanIf: undefined,
      hubLanInventoryId: undefined,
      peAInnerIf: undefined,
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
        hubVrfMode: 'DEDICATED_VRF',
        hubWanInventoryId: 'w1',
        isFirstHubTunnel: false,
        hasWanInventoryOptions: true,
        hasLanInventoryOptions: false,
      }),
    ).toEqual({ ok: false, message: hubInventoryBlockMessage('lan') });

    expect(
      validateHubTunnelInventory({
        hubVrfMode: 'DEDICATED_VRF',
        hubWanInventoryId: 'w1',
        isFirstHubTunnel: false,
        hasWanInventoryOptions: true,
        hasLanInventoryOptions: true,
      }),
    ).toEqual({ ok: false, message: '请选择 Hub 内网口（独立专网须使用空闲 LAN）' });

    expect(
      validateHubTunnelInventory({
        hubVrfMode: 'DEDICATED_VRF',
        hubWanInventoryId: 'w1',
        hubLanInventoryId: 'l1',
        isFirstHubTunnel: false,
        hasWanInventoryOptions: true,
        hasLanInventoryOptions: true,
        selectedLanState: 'dedicated_occupied',
      }).ok,
    ).toBe(false);

    expect(
      validateHubTunnelInventory({
        hubVrfMode: 'DEDICATED_VRF',
        hubWanInventoryId: 'w1',
        hubLanInventoryId: 'l1',
        isFirstHubTunnel: false,
        hasWanInventoryOptions: true,
        hasLanInventoryOptions: true,
        selectedLanState: 'idle',
      }).ok,
    ).toBe(true);
  });
});
