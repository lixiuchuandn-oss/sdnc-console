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
    expect(archive.injectedDelta?.peA?.activateAddressFamily?.[0]?.bgpIndex).toBe(1);
    expect(archive.injectedDelta?.peA?.neighborDisableConnectedCheck?.[0]?.bgpIndex).toBe(1);
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
  });
});
