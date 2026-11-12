import { buildTunnelArchive, inferTunnelTopologyFromRoles, resolveHubPeSlotFromRoles } from './srv6Archive';

describe('srv6Archive topology helpers', () => {
  it('infers S and H from PE roles', () => {
    expect(inferTunnelTopologyFromRoles('SPOKE_PE', 'SPOKE_PE')).toBe('S');
    expect(inferTunnelTopologyFromRoles('HUB_PE', 'SPOKE_PE')).toBe('H');
    expect(resolveHubPeSlotFromRoles('HUB_PE', 'SPOKE_PE')).toBe('peA');
    expect(resolveHubPeSlotFromRoles('SPOKE_PE', 'HUB_PE')).toBe('peB');
  });
});

describe('srv6Archive buildTunnelArchive', () => {
  const peerIp = '2408:2222::2';
  const ceWanIp = '10.20.30.40';

  /** 原始 PE：内网在 bgp[0]，公网在 bgp[1]；pe 元数据错误地标 publicBgpIndex=0 */
  const rawPeA = {
    pe: { publicConfig: { publicBgpIndex: 0 } },
    bgp: [
      { vrf: 10, asn: 65001 },
      { vrf: 0, asn: 65000, neighbor: [], address_family: [] },
    ],
    interfaces_GigabitEthernet: [
      { name: 'GigabitEthernet 0/0/0', ipv6_static: '2408:1111::1/64' },
      { name: 'GigabitEthernet 0/0/1', ipv4_static: '10.0.0.1/24', vrf: 10 },
    ],
  };

  const rawPeB = {
    bgp: [{ vrf: 0, asn: 65003 }],
    interfaces_GigabitEthernet: [{ name: 'GigabitEthernet 0/0/0', ipv6_static: `${peerIp}/64` }],
  };

  const rawCeA = {
    ce: { publicConfig: { wanName: 'GigabitEthernet 0/0/0' } },
    bgp: [{ asn: 65100 }, { asn: 65101 }],
    interfaces_GigabitEthernet: [{ name: 'GigabitEthernet 0/0/0', ipv4_static: `${ceWanIp}/24` }],
  };

  const injectedPeA = {
    ...rawPeA,
    pe: { publicConfig: { publicBgpIndex: 1 } },
    bgp: [
      rawPeA.bgp[0],
      {
        vrf: 0,
        asn: 65000,
        neighbor: [{ remote_ip: peerIp, remote_as: 65003 }],
        neighbor_disable_connected_check: [peerIp],
        address_family: [
          {
            address_family: 'ipv4',
            modifiler: 'vpn',
            activate_address_family: [peerIp],
          },
        ],
      },
    ],
  };

  it('uses injected storage cfg for public bgpIndex (not stale pe metadata)', () => {
    const archive = buildTunnelArchive({
      peAInnerIf: 'GigabitEthernet 0/0/1',
      peBInnerIf: 'GigabitEthernet 0/0/0',
      peConfigs: { peA: rawPeA, peB: rawPeB },
      ceConfigs: { ceA: rawCeA, ceB: rawCeA },
      peStorageCfgs: { peA: injectedPeA, peB: rawPeB },
      cePreviewCfgs: { ceA: rawCeA, ceB: rawCeA },
      rdRtMeta: { rtCommon: '200:100', rdMap: { peA: '200:101', peB: '200:102' } },
    });

    const peerNeighbor = archive.injectedDelta?.peA?.neighbors?.find((n) => n.remote_ip === peerIp);
    expect(peerNeighbor?.bgpIndex).toBe(1);
    expect(peerNeighbor?.ebgp_multihop).toBe(255);
    expect(archive.injectedDelta?.peA?.activateAddressFamily?.[0]?.bgpIndex).toBe(1);
    expect(archive.injectedDelta?.peA?.neighborDisableConnectedCheck?.[0]?.bgpIndex).toBe(1);
    const ceNeighbor = archive.injectedDelta?.ceA?.neighbors?.find((n) => n.remote_ip);
    expect(ceNeighbor?.ebgp_multihop).toBeUndefined();
  });

  it('without peStorageCfgs falls back to raw cfg public index (legacy)', () => {
    const archive = buildTunnelArchive({
      peAInnerIf: 'GigabitEthernet 0/0/1',
      peBInnerIf: 'GigabitEthernet 0/0/0',
      peConfigs: { peA: rawPeA, peB: rawPeB },
      ceConfigs: { ceA: rawCeA, ceB: rawCeA },
      rdRtMeta: { rtCommon: '200:100', rdMap: { peA: '200:101', peB: '200:102' } },
    });
    const peerNeighbor = archive.injectedDelta?.peA?.neighbors?.find((n) => n.remote_ip === peerIp);
    // raw cfg 上 findIndex 公网段为 1；不再误用 stale metadata 的 0
    expect(peerNeighbor?.bgpIndex).toBe(1);
  });

  it('builds Hub–Spoke archive with hubBindings and hub fingerprint', () => {
    const hubPe = {
      bgp: [{ vrf: 0, asn: 65000 }],
      interfaces_GigabitEthernet: [
        { name: 'GigabitEthernet 0/0/0', ipv6_static: '2408:hub::1/64' },
        { name: 'GigabitEthernet 0/0/1', ipv4_static: '10.0.0.1/24', vrf: 10 },
      ],
      segment_routing_srv6: { prefix: '2001:db8:hub' },
    };
    const spokePe = {
      bgp: [{ vrf: 0, asn: 65003 }],
      interfaces_GigabitEthernet: [{ name: 'GigabitEthernet 0/0/0', ipv6_static: `${peerIp}/64` }],
      segment_routing_srv6: { prefix: '2001:db8:spoke' },
    };
    const archive = buildTunnelArchive({
      peA: 'hub-uuid',
      peB: 'spoke-uuid',
      peAInnerIf: 'GigabitEthernet 0/0/1',
      peBInnerIf: 'GigabitEthernet 0/0/0',
      peConfigs: { peA: hubPe, peB: spokePe },
      ceConfigs: { ceA: rawCeA, ceB: rawCeA },
      rdRtMeta: { rtCommon: '200:100', rdMap: { peA: '200:101', peB: '200:102' } },
      tunnelTopology: 'H',
      hubPeSlot: 'peA',
      hubVrfMode: 'REUSE_VRF',
      hubWanIf: 'GigabitEthernet 0/0/0',
    });
    expect(archive.tunnelTopology).toBe('H');
    expect(archive.hubBindings?.peerPublicNeighbor).toBe(peerIp);
    expect(archive.hubBindings?.hubPeUuid).toBe('hub-uuid');
    expect(archive.endpointFingerprint?.peA?.wanIf).toBe('GigabitEthernet 0/0/0');
    expect(archive.endpointFingerprint?.peA?.peerPublicNeighbor).toBe(peerIp);
    const hubNeighbor = archive.injectedDelta?.peA?.neighbors?.find((n) => n.remote_ip === peerIp);
    expect(hubNeighbor?.bgpIndex).toBe(0);
    expect(hubNeighbor?.ebgp_multihop).toBe(255);
  });

  it('uses hub inventory wan ipv6 when hub cfg lacks wan interface', () => {
    const hubPe = {
      bgp: [{ vrf: 0, asn: 65000 }, { vrf: 10, asn: 65001 }],
      interfaces_GigabitEthernet: [
        { name: 'GigabitEthernet 0/0/1', ipv4_static: '10.0.0.1/24', vrf: 10 },
      ],
      segment_routing_srv6: { prefix: '2001:db8:hub' },
    };
    const spokePe = {
      bgp: [{ vrf: 0, asn: 65003 }],
      interfaces_GigabitEthernet: [{ name: 'GigabitEthernet 0/0/0', ipv6_static: `${peerIp}/64` }],
      segment_routing_srv6: { prefix: '2001:db8:spoke' },
    };
    const archive = buildTunnelArchive({
      peA: 'hub-uuid',
      peB: 'spoke-uuid',
      peAInnerIf: 'GigabitEthernet 0/0/1',
      peBInnerIf: 'GigabitEthernet 0/0/0',
      peConfigs: { peA: hubPe, peB: spokePe },
      ceConfigs: { ceA: rawCeA, ceB: rawCeA },
      rdRtMeta: { rtCommon: '200:100', rdMap: { peA: '200:101', peB: '200:102' } },
      tunnelTopology: 'H',
      hubPeSlot: 'peA',
      hubVrfMode: 'REUSE_VRF',
      hubWanIf: 'GigabitEthernet 0/0/9',
      hubWanInventoryId: 'w-inv',
      hubInventory: {
        wan: [
          {
            id: 'w-inv',
            ifName: 'GigabitEthernet 0/0/9',
            ipv6: '2408:hub:wan::1/64',
          },
        ],
        lan: [],
      },
    });
    const spokeNeighbor = archive.injectedDelta?.peB?.neighbors?.find((n) => n.remote_ip === '2408:hub:wan::1');
    expect(spokeNeighbor).toBeDefined();
    const hubSidRoute = archive.injectedDelta?.peA?.ipv6Routes?.find((r) => r.destination.includes('/64'));
    // Hub 无 ipv6_route 网关时 SID/64 回退对端 Spoke 公网 IPv6，不用 inventory 口地址作 via
    expect(hubSidRoute?.via).toBe(peerIp);
  });

  it('Hub SID/64 via prefers WAN ipv6_route gateway over interface address', () => {
    const hubPe = {
      bgp: [{ vrf: 0, asn: 65000 }, { vrf: 10, asn: 65001 }],
      ipv6_route: [{ destination: '290f:2033:3333::/64', via: '203::33' }],
      interfaces_GigabitEthernet: [
        { name: 'GigabitEthernet 2/2/0', ipv6_static: '203::22/64' },
        { name: 'GigabitEthernet 2/3/0', ipv4_static: '10.0.0.1/24', vrf: 10 },
      ],
      segment_routing_srv6: { prefix: '240f:2033::1235' },
    };
    const spokePe = {
      bgp: [{ vrf: 0, asn: 65003 }],
      interfaces_GigabitEthernet: [{ name: 'GigabitEthernet 0/0/0', ipv6_static: `${peerIp}/64` }],
      segment_routing_srv6: { prefix: '2001:db8:spoke' },
    };
    const archive = buildTunnelArchive({
      peA: 'hub-uuid',
      peB: 'spoke-uuid',
      peAInnerIf: 'GigabitEthernet 2/3/0',
      peBInnerIf: 'GigabitEthernet 0/0/0',
      peConfigs: { peA: hubPe, peB: spokePe },
      ceConfigs: { ceA: rawCeA, ceB: rawCeA },
      rdRtMeta: { rtCommon: '200:100', rdMap: { peA: '200:101', peB: '200:102' } },
      tunnelTopology: 'H',
      hubPeSlot: 'peA',
      hubVrfMode: 'REUSE_VRF',
      hubWanIf: 'GigabitEthernet 2/2/0',
      hubWanInventoryId: 'w-inv',
      hubInventory: {
        wan: [
          {
            id: 'w-inv',
            ifName: 'GigabitEthernet 2/2/0',
            ipv6: '203::22/64',
          },
        ],
        lan: [],
      },
    });
    const hubSidRoute = archive.injectedDelta?.peA?.ipv6Routes?.find((r) => r.destination.includes('/64'));
    expect(hubSidRoute?.via).toBe('203::33');
    expect(hubSidRoute?.via).not.toBe('203::22');
  });

  it('writes HA CE fingerprint even without CE device config', () => {
    const archive = buildTunnelArchive({
      peA: 'pe-a',
      peB: 'pe-b',
      peAInnerIf: 'GigabitEthernet 0/0/1',
      peBInnerIf: 'GigabitEthernet 0/0/0',
      peConfigs: { peA: rawPeA, peB: rawPeB },
      ceConfigs: {},
      rdRtMeta: { rtCommon: '200:100', rdMap: { peA: '200:101', peB: '200:102' } },
      ceAHaBinding: {
        haGroupId: 'ha-1',
        haGroupName: 'ha-1',
        primaryVrUuid: 'ce1',
        backupVrUuid: 'ce2',
      },
      ceBHaBinding: {
        haGroupId: 'ha-2',
        haGroupName: 'ha-2',
        primaryVrUuid: 'ce3',
        backupVrUuid: 'ce4',
      },
    });
    expect(archive.endpointFingerprint?.ceA).toMatchObject({
      haGroupId: 'ha-1',
      haGroupName: 'ha-1',
      backupVrUuid: 'ce2',
    });
    expect(archive.endpointFingerprint?.ceB).toMatchObject({
      haGroupId: 'ha-2',
      haGroupName: 'ha-2',
      backupVrUuid: 'ce4',
    });
  });
});
