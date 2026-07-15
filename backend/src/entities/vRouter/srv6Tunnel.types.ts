/** SRv6 隧道关系档案 JSON 列类型（实体与路由共用） */

export type Srv6RdRtMeta = {
  rtCommon: string;
  rdMap: Record<string, string>;
};

export type Srv6BgpNeighborDelta = {
  bgpIndex: number;
  remote_ip: string;
  remote_as?: number;
};

export type Srv6Ipv6RouteDelta = {
  destination: string;
  via: string;
  vrf?: string | number | null;
};

export type Srv6RdRtDelta = {
  bgpIndex: number;
  route_distinguisher: string;
  route_target: string;
};

export type Srv6ActivateAfDelta = {
  bgpIndex: number;
  peerIp: string;
};

export type Srv6NdcDelta = {
  bgpIndex: number;
  remote_ip: string;
};

export type Srv6EndpointInjectedDelta = {
  neighbors?: Srv6BgpNeighborDelta[];
  ipv6Routes?: Srv6Ipv6RouteDelta[];
  rdRt?: Srv6RdRtDelta[];
  activateAddressFamily?: Srv6ActivateAfDelta[];
  neighborDisableConnectedCheck?: Srv6NdcDelta[];
};

export type Srv6InjectedDelta = {
  peA?: Srv6EndpointInjectedDelta;
  peB?: Srv6EndpointInjectedDelta;
  ceA?: Srv6EndpointInjectedDelta;
  ceB?: Srv6EndpointInjectedDelta;
};

export type Srv6PeFingerprint = {
  publicIpv6?: string;
  publicBgpAsn?: number;
  sidPrefix?: string;
  innerIf?: string;
  innerIp?: string;
  innerVrf?: string | number;
  innerBgpAsn?: number;
  /** Hub PE：本隧道绑定的 WAN 口名 */
  wanIf?: string;
  /** Hub PE：PE–PE 公网 neighbor 判重键 */
  peerPublicNeighbor?: string;
};

export type Srv6CeFingerprint = {
  publicIpv4?: string;
  /** CE LAN 侧 IPv4（客户侧口；健康巡检 CE↔CE Ping 目标） */
  lanIpv4?: string;
  lanIf?: string;
  publicBgpAsn?: number;
  innerBgpAsn?: number;
  /** 高可用模式：CE 侧绑定的 IBR HA 组（平台档案，不参与设备 merge） */
  haGroupId?: string;
  haGroupName?: string;
  backupVrUuid?: string;
};

export type Srv6EndpointFingerprint = {
  peA?: Srv6PeFingerprint;
  peB?: Srv6PeFingerprint;
  ceA?: Srv6CeFingerprint;
  ceB?: Srv6CeFingerprint;
};

export type Srv6EndpointSlot = 'peA' | 'peB' | 'ceA' | 'ceB';

export type Srv6TunnelTopology = 'S' | 'H';

export type Srv6PeNeighborMode = 'static' | 'rr_domain';

export type Srv6HubVrfMode = 'REUSE_VRF' | 'DEDICATED_VRF';

export type Srv6HubSlotBinding = {
  hubPeUuid: string;
  spokePeUuid: string;
  hubPeSlot: 'peA' | 'peB';
  wanIf: string;
  lanIf?: string;
  peerPublicNeighbor: string;
  /** §14.17 · Hub WAN inventory 引用 */
  wanInventoryId?: string;
  /** §14.17 · Hub LAN inventory 引用（路线 B） */
  lanInventoryId?: string;
};

export type Srv6TunnelArchiveFields = {
  peAInnerIf?: string | null;
  peBInnerIf?: string | null;
  rdRtMeta?: Srv6RdRtMeta | null;
  injectedDelta?: Srv6InjectedDelta | null;
  endpointFingerprint?: Srv6EndpointFingerprint | null;
  tunnelTopology?: Srv6TunnelTopology | null;
  hubPeSlot?: 'peA' | 'peB' | null;
  hubBindings?: Srv6HubSlotBinding | null;
  hubVrfMode?: Srv6HubVrfMode | null;
  peANeighborMode?: Srv6PeNeighborMode | null;
  peBNeighborMode?: Srv6PeNeighborMode | null;
  peARrDomainId?: string | null;
  peBRrDomainId?: string | null;
};
