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
};

export type Srv6CeFingerprint = {
  publicIpv4?: string;
  publicBgpAsn?: number;
  innerBgpAsn?: number;
};

export type Srv6EndpointFingerprint = {
  peA?: Srv6PeFingerprint;
  peB?: Srv6PeFingerprint;
  ceA?: Srv6CeFingerprint;
  ceB?: Srv6CeFingerprint;
};

export type Srv6EndpointSlot = 'peA' | 'peB' | 'ceA' | 'ceB';

export type Srv6TunnelArchiveFields = {
  peAInnerIf?: string | null;
  peBInnerIf?: string | null;
  rdRtMeta?: Srv6RdRtMeta | null;
  injectedDelta?: Srv6InjectedDelta | null;
  endpointFingerprint?: Srv6EndpointFingerprint | null;
};
