/**
 * SRv6 隧道「关系档案」：与后端 srv6Tunnel.types / POST|PUT 载荷对齐。
 */
import { buildSrv6PeerRouteDestination } from './srv6Ipv6';

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

export type Srv6ActivateAfDelta = { bgpIndex: number; peerIp: string };
export type Srv6NdcDelta = { bgpIndex: number; remote_ip: string };

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

export type Srv6TunnelArchivePayload = {
  peAInnerIf?: string;
  peBInnerIf?: string;
  rdRtMeta?: Srv6RdRtMeta | null;
  injectedDelta?: Srv6InjectedDelta;
  endpointFingerprint?: Srv6EndpointFingerprint;
};

const trimPrefix = (v?: string): string | undefined => {
  if (!v) return undefined;
  const s = String(v);
  return s.includes('/') ? s.split('/')[0] : s;
};

const ipv6HostFromRaw = (raw?: string): string | undefined => {
  const s = String(raw || '').trim();
  if (!s) return undefined;
  const host = s.split('/')[0]?.trim();
  if (!host || host.startsWith('fe80:')) return undefined;
  return host;
};

const extractPortIpv6 = (cfg: any, portIndex: number): string | undefined => {
  if (!cfg || typeof cfg !== 'object') return undefined;
  const keys = Object.keys(cfg);
  for (const k of keys) {
    if (k.startsWith('interfaces_') || k.startsWith('subinterfaces_')) {
      const arr = cfg[k];
      if (Array.isArray(arr) && arr[portIndex]) {
        const ip = ipv6HostFromRaw(arr[portIndex]?.ipv6_static || arr[portIndex]?.ipv6);
        if (ip) return ip;
      }
    }
  }
  return undefined;
};

const rowHostIpPreferV4 = (it: any): string | undefined => {
  const v4 = trimPrefix(it?.ipv4_static || it?.ipv4);
  if (v4) return v4;
  return ipv6HostFromRaw(it?.ipv6_static || it?.ipv6);
};

const extractPortIp = (cfg: any, portIndex: number): string | undefined => {
  if (!cfg || typeof cfg !== 'object') return undefined;
  const keys = Object.keys(cfg);
  for (const k of keys) {
    if (k.startsWith('interfaces_') || k.startsWith('subinterfaces_')) {
      const arr = cfg[k];
      if (Array.isArray(arr) && arr[portIndex]) {
        const ip = rowHostIpPreferV4(arr[portIndex]);
        if (ip) return ip;
      }
    }
  }
  if (portIndex === 0) {
    return trimPrefix(cfg.ipv4_static || cfg.ipv4) || ipv6HostFromRaw(cfg.ipv6_static || cfg.ipv6);
  }
  return undefined;
};

const extractInterfaceIp = (cfg: any, ifName?: string): string | undefined => {
  if (!cfg || !ifName) return undefined;
  for (const k of Object.keys(cfg)) {
    if (!k.startsWith('interfaces_') && !k.startsWith('subinterfaces_')) continue;
    const arr = cfg[k];
    if (!Array.isArray(arr)) continue;
    for (const it of arr) {
      if (String(it?.name || '') === ifName) return rowHostIpPreferV4(it);
    }
  }
  return undefined;
};

const extractInterfaceVrf = (cfg: any, ifName?: string): string | number | undefined => {
  if (!cfg || !ifName) return undefined;
  for (const k of Object.keys(cfg)) {
    if (!k.startsWith('interfaces_') && !k.startsWith('subinterfaces_')) continue;
    const arr = cfg[k];
    if (!Array.isArray(arr)) continue;
    for (const it of arr) {
      if (String(it?.name || '') === ifName) {
        const vrf = it?.vrf;
        if (vrf !== undefined && vrf !== null && String(vrf) !== '') return vrf;
      }
    }
  }
  return undefined;
};

const extractBgpAsnAt = (cfg: any, idx: number): number | undefined => {
  const arr = Array.isArray(cfg?.bgp) ? cfg.bgp : [];
  let asn: any = arr[idx]?.asn;
  if (asn === undefined && arr[0]) asn = arr[0]?.asn;
  return typeof asn === 'number' ? asn : asn ? Number(asn) : undefined;
};

const extractSrv6Prefix = (cfg: any): string | undefined => {
  const top = cfg?.segment_routing_srv6?.prefix;
  if (typeof top === 'string' && top.trim()) return top.trim();
  const legacy =
    cfg?.pe?.publicConfig?.sidPrefix ?? cfg?.pe?.sidPrefix ?? cfg?.sidPrefix;
  return typeof legacy === 'string' && legacy.trim() ? legacy.trim() : undefined;
};

const isPublicBgpBlock = (b: any) =>
  b && typeof b === 'object' && (!b.vrf || b.vrf === 0 || b.vrf === '0');

const readPePublicBgpIndex = (cfg: any): number => {
  const pc = cfg?.pe?.publicConfig;
  if (pc && typeof pc.publicBgpIndex === 'number') return pc.publicBgpIndex;
  if (typeof cfg?.pe?.publicBgpIndex === 'number') return cfg.pe.publicBgpIndex;
  const bgpArr = Array.isArray(cfg?.bgp) ? cfg.bgp : [];
  const idx = bgpArr.findIndex(isPublicBgpBlock);
  return idx >= 0 ? idx : 0;
};

const findBgpIndexByVrf = (cfg: any, targetVrf: any): number | undefined => {
  if (targetVrf === undefined || targetVrf === null || String(targetVrf) === '') return undefined;
  const bgpArr = Array.isArray(cfg?.bgp) ? cfg.bgp : [];
  const idx = bgpArr.findIndex((b: any) => String(b?.vrf) === String(targetVrf));
  return idx >= 0 ? idx : undefined;
};

const extractCeWanIpv4 = (cfg: any): string | undefined => {
  const wanName =
    cfg?.ce?.publicConfig?.wanName ||
    cfg?.ce?.publicConfig?.wanDev ||
    cfg?.ce?.wanDev;
  if (wanName) {
    for (const k of Object.keys(cfg || {})) {
      if (!k.startsWith('interfaces_') && !k.startsWith('subinterfaces_')) continue;
      const arr = cfg[k];
      if (!Array.isArray(arr)) continue;
      for (const it of arr) {
        if (String(it?.name || '') === String(wanName)) {
          return trimPrefix(it?.ipv4_static || it?.ipv4);
        }
      }
    }
  }
  if (!cfg || typeof cfg !== 'object') return undefined;
  for (const k of Object.keys(cfg)) {
    if (!k.startsWith('interfaces_') && !k.startsWith('subinterfaces_')) continue;
    const arr = cfg[k];
    if (Array.isArray(arr) && arr[0]) {
      const ip = trimPrefix(arr[0]?.ipv4_static || arr[0]?.ipv4);
      if (ip) return ip;
    }
  }
  return trimPrefix(cfg?.ipv4_static || cfg?.ipv4);
};

const buildPeFingerprint = (cfg: any, innerIf?: string): Srv6PeFingerprint => ({
  publicIpv6: extractPortIpv6(cfg, 0),
  publicBgpAsn: extractBgpAsnAt(cfg, 0),
  sidPrefix: extractSrv6Prefix(cfg),
  innerIf,
  innerIp: innerIf ? extractInterfaceIp(cfg, innerIf) : extractPortIp(cfg, 1),
  innerVrf: innerIf ? extractInterfaceVrf(cfg, innerIf) : undefined,
  innerBgpAsn: extractBgpAsnAt(cfg, 1),
});

const buildCeFingerprint = (cfg: any): Srv6CeFingerprint => ({
  publicIpv4: extractCeWanIpv4(cfg),
  publicBgpAsn: extractBgpAsnAt(cfg, 0),
  innerBgpAsn: extractBgpAsnAt(cfg, 1),
});

const buildPeInjectedDelta = (
  selfKey: 'peA' | 'peB',
  peConfigs: { peA?: any; peB?: any },
  ceConfigs: { ceA?: any; ceB?: any },
  innerIf: string | undefined,
  rdRtMeta: Srv6RdRtMeta | null,
): Srv6EndpointInjectedDelta | undefined => {
  const selfCfg = peConfigs[selfKey];
  if (!selfCfg) return undefined;
  const peerKey = selfKey === 'peA' ? 'peB' : 'peA';
  const ceKey = selfKey === 'peA' ? 'ceA' : 'ceB';
  const peerCfg = peConfigs[peerKey];
  const ceCfg = ceConfigs[ceKey];
  const rdKey = selfKey;
  const vrf = innerIf ? extractInterfaceVrf(selfCfg, innerIf) : undefined;

  const delta: Srv6EndpointInjectedDelta = {};
  const pubIdx = readPePublicBgpIndex(selfCfg);

  if (peerCfg) {
    const peerPublicIp = extractPortIpv6(peerCfg, 0);
    const peerAsn = extractBgpAsnAt(peerCfg, 0);
    if (peerPublicIp) {
      delta.neighbors = [
        ...(delta.neighbors || []),
        { bgpIndex: pubIdx, remote_ip: peerPublicIp, remote_as: peerAsn ?? 0 },
      ];
      delta.activateAddressFamily = [
        ...(delta.activateAddressFamily || []),
        { bgpIndex: pubIdx, peerIp: peerPublicIp },
      ];
      delta.neighborDisableConnectedCheck = [
        ...(delta.neighborDisableConnectedCheck || []),
        { bgpIndex: pubIdx, remote_ip: peerPublicIp },
      ];
    }
  }

  if (ceCfg && vrf !== undefined) {
    const cePublicIp = extractPortIp(ceCfg, 0);
    const ceAsnInner = extractBgpAsnAt(ceCfg, 1);
    const bgpIdx = findBgpIndexByVrf(selfCfg, vrf) ?? 1;
    if (cePublicIp) {
      delta.neighbors = [
        ...(delta.neighbors || []),
        { bgpIndex: bgpIdx, remote_ip: cePublicIp, remote_as: ceAsnInner ?? 0 },
      ];
    }
  }

  if (rdRtMeta?.rtCommon && rdRtMeta.rdMap?.[rdKey] && vrf !== undefined) {
    const bgpIdx = findBgpIndexByVrf(selfCfg, vrf) ?? 1;
    delta.rdRt = [
      {
        bgpIndex: bgpIdx,
        route_distinguisher: rdRtMeta.rdMap[rdKey],
        route_target: rdRtMeta.rtCommon,
      },
    ];
  }

  if (peerCfg && vrf !== undefined) {
    const peerPrefix = extractSrv6Prefix(peerCfg);
    const dest = buildSrv6PeerRouteDestination(peerPrefix);
    const via = extractPortIpv6(peerCfg, 0);
    if (dest && via) {
      delta.ipv6Routes = [
        ...(delta.ipv6Routes || []),
        { destination: dest, via },
        { destination: '::/0', vrf, via: 'nexthop-vrf 0' },
      ];
    }
  }

  return delta;
};

const buildCeInjectedDelta = (
  ceCfg: any,
  peCfg: any,
  peInnerIf?: string,
): Srv6EndpointInjectedDelta | undefined => {
  if (!ceCfg || !peCfg) return undefined;
  const peInnerIp = peInnerIf ? extractInterfaceIp(peCfg, peInnerIf) : extractPortIp(peCfg, 1);
  const peAsnInner = extractBgpAsnAt(peCfg, 1);
  if (!peInnerIp) return undefined;
  return {
    neighbors: [{ bgpIndex: 0, remote_ip: peInnerIp, remote_as: peAsnInner ?? 0 }],
  };
};

export type BuildTunnelArchiveInput = {
  peAInnerIf?: string;
  peBInnerIf?: string;
  peConfigs: { peA?: any; peB?: any };
  ceConfigs: { ceA?: any; ceB?: any };
  /** 注入后即将写入平台库的 PE 配置（用于指纹） */
  peStorageCfgs?: { peA?: any; peB?: any };
  cePreviewCfgs?: { ceA?: any; ceB?: any };
  rdRtMeta: Srv6RdRtMeta | null;
};

export const buildTunnelArchive = (input: BuildTunnelArchiveInput): Srv6TunnelArchivePayload => {
  const { peAInnerIf, peBInnerIf, peConfigs, ceConfigs, peStorageCfgs, cePreviewCfgs, rdRtMeta } =
    input;

  const injectedDelta: Srv6InjectedDelta = {};
  const peADelta = buildPeInjectedDelta('peA', peConfigs, ceConfigs, peAInnerIf, rdRtMeta);
  const peBDelta = buildPeInjectedDelta('peB', peConfigs, ceConfigs, peBInnerIf, rdRtMeta);
  if (peADelta) injectedDelta.peA = peADelta;
  if (peBDelta) injectedDelta.peB = peBDelta;

  const ceADelta = buildCeInjectedDelta(
    cePreviewCfgs?.ceA ?? ceConfigs.ceA,
    peStorageCfgs?.peA ?? peConfigs.peA,
    peAInnerIf,
  );
  const ceBDelta = buildCeInjectedDelta(
    cePreviewCfgs?.ceB ?? ceConfigs.ceB,
    peStorageCfgs?.peB ?? peConfigs.peB,
    peBInnerIf,
  );
  if (ceADelta) injectedDelta.ceA = ceADelta;
  if (ceBDelta) injectedDelta.ceB = ceBDelta;

  const endpointFingerprint: Srv6EndpointFingerprint = {};
  const peAfp = peStorageCfgs?.peA ?? peConfigs.peA;
  const peBfp = peStorageCfgs?.peB ?? peConfigs.peB;
  const ceAfp = cePreviewCfgs?.ceA ?? ceConfigs.ceA;
  const ceBfp = cePreviewCfgs?.ceB ?? ceConfigs.ceB;
  if (peAfp) endpointFingerprint.peA = buildPeFingerprint(peAfp, peAInnerIf);
  if (peBfp) endpointFingerprint.peB = buildPeFingerprint(peBfp, peBInnerIf);
  if (ceAfp) endpointFingerprint.ceA = buildCeFingerprint(ceAfp);
  if (ceBfp) endpointFingerprint.ceB = buildCeFingerprint(ceBfp);

  return {
    peAInnerIf,
    peBInnerIf,
    rdRtMeta,
    injectedDelta,
    endpointFingerprint,
  };
};
