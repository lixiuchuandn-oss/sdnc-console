import {
  extractSrv6PrefixFromConfig,
  type VrConfigRow,
} from './srv6.validation';
import type {
  Srv6CeFingerprint,
  Srv6EndpointFingerprint,
  Srv6EndpointSlot,
  Srv6HubSlotBinding,
  Srv6HubVrfMode,
  Srv6InjectedDelta,
  Srv6PeFingerprint,
  Srv6RdRtMeta,
  Srv6TunnelArchiveFields,
  Srv6TunnelTopology,
} from './srv6.archive.types';

const normalizeText = (value: unknown) => String(value ?? '').trim();

const parseJsonObject = (raw: unknown): Record<string, unknown> | null => {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== 'string') return null;
  const text = normalizeText(raw);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const trimPrefix = (raw: unknown): string | undefined => {
  const s = normalizeText(raw);
  if (!s) return undefined;
  const slash = s.indexOf('/');
  return slash >= 0 ? s.slice(0, slash) : s;
};

const ipv6HostFromRaw = (raw: unknown): string | undefined => {
  const s = normalizeText(raw);
  if (!s) return undefined;
  const host = s.split('/')[0]?.trim();
  if (!host || host.startsWith('fe80:')) return undefined;
  return host;
};

const extractPortIpv6 = (cfg: Record<string, unknown>, portIndex: number): string | undefined => {
  const keys = Object.keys(cfg);
  for (const k of keys) {
    if (k.startsWith('interfaces_') || k.startsWith('subinterfaces_')) {
      const arr = cfg[k];
      if (Array.isArray(arr) && arr[portIndex]) {
        const ip = ipv6HostFromRaw(
          (arr[portIndex] as Record<string, unknown>).ipv6_static ??
            (arr[portIndex] as Record<string, unknown>).ipv6,
        );
        if (ip) return ip;
      }
    }
  }
  const candidates: string[] = [];
  for (const k of keys) {
    if (k.startsWith('interfaces_') || k.startsWith('subinterfaces_')) {
      const arr = cfg[k];
      if (Array.isArray(arr)) {
        for (const it of arr) {
          const ip = ipv6HostFromRaw(
            (it as Record<string, unknown>).ipv6_static ??
              (it as Record<string, unknown>).ipv6,
          );
          if (ip) candidates.push(ip);
        }
      }
    }
  }
  if (portIndex === 0) return candidates[0] || ipv6HostFromRaw(cfg.ipv6_static ?? cfg.ipv6);
  if (portIndex === 1) return candidates[1] || candidates[0];
  return undefined;
};

const extractPortIpv4 = (cfg: Record<string, unknown>, portIndex: number): string | undefined => {
  const keys = Object.keys(cfg);
  for (const k of keys) {
    if (k.startsWith('interfaces_') || k.startsWith('subinterfaces_')) {
      const arr = cfg[k];
      if (Array.isArray(arr) && arr[portIndex]) {
        const ip = trimPrefix(
          (arr[portIndex] as Record<string, unknown>).ipv4_static ??
            (arr[portIndex] as Record<string, unknown>).ipv4,
        );
        if (ip) return ip;
      }
    }
  }
  const candidates: string[] = [];
  for (const k of keys) {
    if (k.startsWith('interfaces_') || k.startsWith('subinterfaces_')) {
      const arr = cfg[k];
      if (Array.isArray(arr)) {
        for (const it of arr) {
          const ip = trimPrefix(
            (it as Record<string, unknown>).ipv4_static ?? (it as Record<string, unknown>).ipv4,
          );
          if (ip) candidates.push(ip);
        }
      }
    }
  }
  if (portIndex === 0) return candidates[0] || trimPrefix(cfg.ipv4_static ?? cfg.ipv4);
  if (portIndex === 1) return candidates[1] || candidates[0];
  return undefined;
};

const extractInterfaceIpv4 = (cfg: Record<string, unknown>, ifName?: string): string | undefined => {
  if (!ifName) return undefined;
  for (const k of Object.keys(cfg)) {
    if (!k.startsWith('interfaces_') && !k.startsWith('subinterfaces_')) continue;
    const arr = cfg[k];
    if (!Array.isArray(arr)) continue;
    for (const it of arr) {
      if (!it || typeof it !== 'object') continue;
      if (String((it as Record<string, unknown>).name || '') !== ifName) continue;
      return trimPrefix(
        (it as Record<string, unknown>).ipv4_static ?? (it as Record<string, unknown>).ipv4,
      );
    }
  }
  return undefined;
};

const rowHostIpPreferV4 = (it: Record<string, unknown>): string | undefined => {
  const v4 = trimPrefix(it.ipv4_static ?? it.ipv4);
  if (v4) return v4;
  return ipv6HostFromRaw(it.ipv6_static ?? it.ipv6);
};

const extractInterfaceIp = (cfg: Record<string, unknown>, ifName?: string): string | undefined => {
  if (!ifName) return undefined;
  for (const k of Object.keys(cfg)) {
    if (!k.startsWith('interfaces_') && !k.startsWith('subinterfaces_')) continue;
    const arr = cfg[k];
    if (!Array.isArray(arr)) continue;
    for (const it of arr) {
      if (!it || typeof it !== 'object') continue;
      if (String((it as Record<string, unknown>).name || '') !== ifName) continue;
      return rowHostIpPreferV4(it as Record<string, unknown>);
    }
  }
  return undefined;
};

const extractInterfaceVrf = (
  cfg: Record<string, unknown>,
  ifName?: string,
): string | number | undefined => {
  if (!ifName) return undefined;
  for (const k of Object.keys(cfg)) {
    if (!k.startsWith('interfaces_') && !k.startsWith('subinterfaces_')) continue;
    const arr = cfg[k];
    if (!Array.isArray(arr)) continue;
    for (const it of arr) {
      if (!it || typeof it !== 'object') continue;
      if (String((it as Record<string, unknown>).name || '') !== ifName) continue;
      const vrf = (it as Record<string, unknown>).vrf;
      if (vrf !== undefined && vrf !== null && String(vrf) !== '') return vrf as string | number;
    }
  }
  return undefined;
};

const extractBgpAsnAt = (cfg: Record<string, unknown>, idx: number): number | undefined => {
  const bgpArr = Array.isArray(cfg.bgp) ? cfg.bgp : [];
  const pick = (i: number) => {
    const asn = (bgpArr[i] as Record<string, unknown> | undefined)?.asn;
    if (typeof asn === 'number' && Number.isFinite(asn)) return asn;
    if (asn !== undefined && asn !== null && String(asn).trim() !== '') {
      const n = Number(asn);
      return Number.isFinite(n) ? n : undefined;
    }
    return undefined;
  };
  const at = pick(idx);
  if (at !== undefined) return at;
  return pick(0);
};

const extractCeWanIpv4 = (cfg: Record<string, unknown>): string | undefined => {
  const ce = cfg.ce;
  const ceObj = ce && typeof ce === 'object' ? (ce as Record<string, unknown>) : undefined;
  const pc = ceObj?.publicConfig;
  const pub = pc && typeof pc === 'object' ? (pc as Record<string, unknown>) : ceObj;
  const wanName = normalizeText(pub?.wanName ?? pub?.wanDev ?? ceObj?.wanDev);
  if (wanName) {
    const byName = extractInterfaceIpv4(cfg, wanName);
    if (byName) return byName;
  }
  return extractPortIpv4(cfg, 0);
};

const extractInterfaceIpv6 = (cfg: Record<string, unknown>, ifName?: string): string | undefined => {
  if (!ifName) return undefined;
  for (const k of Object.keys(cfg)) {
    if (!k.startsWith('interfaces_') && !k.startsWith('subinterfaces_')) continue;
    const arr = cfg[k];
    if (!Array.isArray(arr)) continue;
    for (const it of arr) {
      if (!it || typeof it !== 'object') continue;
      if (String((it as Record<string, unknown>).name || '') !== ifName) continue;
      return ipv6HostFromRaw(
        (it as Record<string, unknown>).ipv6_static ?? (it as Record<string, unknown>).ipv6,
      );
    }
  }
  return undefined;
};

const parseHubSlotBinding = (raw: unknown): Srv6HubSlotBinding | null | { error: string } => {
  if (raw === null || raw === undefined) return null;
  if (!raw || typeof raw !== 'object') return { error: 'Hub 绑定格式无效' };
  const b = raw as Record<string, unknown>;
  const hubPeUuid = normalizeText(b.hubPeUuid);
  const spokePeUuid = normalizeText(b.spokePeUuid);
  const hubPeSlot = normalizeText(b.hubPeSlot) as 'peA' | 'peB';
  const wanIf = normalizeText(b.wanIf);
  const peerPublicNeighbor = normalizeText(b.peerPublicNeighbor);
  const lanIf = normalizeText(b.lanIf) || undefined;
  if (!hubPeUuid || !spokePeUuid || !wanIf || !peerPublicNeighbor) {
    return { error: 'Hub 绑定缺少 hubPeUuid、spokePeUuid、wanIf 或 peerPublicNeighbor' };
  }
  if (hubPeSlot !== 'peA' && hubPeSlot !== 'peB') {
    return { error: 'Hub 绑定 hubPeSlot 须为 peA 或 peB' };
  }
  return { hubPeUuid, spokePeUuid, hubPeSlot, wanIf, lanIf, peerPublicNeighbor };
};

export const computePeFingerprint = (
  cfg: Record<string, unknown>,
  innerIf?: string,
  hubMeta?: { wanIf?: string; peerPublicNeighbor?: string },
): Srv6PeFingerprint => ({
  publicIpv6: hubMeta?.wanIf
    ? extractInterfaceIpv6(cfg, hubMeta.wanIf) ?? extractPortIpv6(cfg, 0)
    : extractPortIpv6(cfg, 0),
  publicBgpAsn: extractBgpAsnAt(cfg, 0),
  sidPrefix: extractSrv6PrefixFromConfig(cfg),
  innerIf: innerIf || undefined,
  innerIp: innerIf ? extractInterfaceIp(cfg, innerIf) : extractPortIpv4(cfg, 1),
  innerVrf: innerIf ? extractInterfaceVrf(cfg, innerIf) : undefined,
  innerBgpAsn: extractBgpAsnAt(cfg, 1),
  wanIf: hubMeta?.wanIf,
  peerPublicNeighbor: hubMeta?.peerPublicNeighbor,
});

export const computeCeFingerprint = (cfg: Record<string, unknown>): Srv6CeFingerprint => ({
  publicIpv4: extractCeWanIpv4(cfg),
  publicBgpAsn: extractBgpAsnAt(cfg, 0),
  innerBgpAsn: extractBgpAsnAt(cfg, 1),
});

const stableJson = (obj: unknown) => JSON.stringify(obj ?? null);

export const diffFingerprintFields = (
  expected: Record<string, unknown> | undefined,
  actual: Record<string, unknown> | undefined,
): string[] => {
  if (!expected) return [];
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual || {})]);
  const diffs: string[] = [];
  keys.forEach((k) => {
    const ev = (expected as Record<string, unknown>)[k];
    const av = (actual || {})[k];
    if (stableJson(ev) !== stableJson(av)) {
      diffs.push(k);
    }
  });
  return diffs;
};

export const parseSrv6ArchiveFromBody = (
  body: unknown,
): { ok: true; archive: Srv6TunnelArchiveFields } | { ok: false; message: string } => {
  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const archive: Srv6TunnelArchiveFields = {};

  if (raw.peAInnerIf !== undefined) archive.peAInnerIf = normalizeText(raw.peAInnerIf) || null;
  if (raw.peBInnerIf !== undefined) archive.peBInnerIf = normalizeText(raw.peBInnerIf) || null;

  if (raw.rdRtMeta !== undefined && raw.rdRtMeta !== null) {
    const meta = raw.rdRtMeta as Record<string, unknown>;
    const rtCommon = normalizeText(meta.rtCommon);
    const rdMap = meta.rdMap;
    if (!rtCommon || !rdMap || typeof rdMap !== 'object') {
      return { ok: false, message: '路由标识（RD/RT）格式无效：缺少公共 RT 或 PE 侧 RD 映射' };
    }
    archive.rdRtMeta = { rtCommon, rdMap: rdMap as Record<string, string> };
  } else if (raw.rdRtMeta === null) {
    archive.rdRtMeta = null;
  }

  if (raw.injectedDelta !== undefined) {
    if (raw.injectedDelta !== null && typeof raw.injectedDelta !== 'object') {
      return { ok: false, message: '隧道配置变更清单格式无效' };
    }
    archive.injectedDelta = (raw.injectedDelta as Srv6InjectedDelta) ?? null;
  }

  if (raw.endpointFingerprint !== undefined) {
    if (raw.endpointFingerprint !== null && typeof raw.endpointFingerprint !== 'object') {
      return { ok: false, message: '端点配置指纹格式无效' };
    }
    archive.endpointFingerprint = (raw.endpointFingerprint as Srv6EndpointFingerprint) ?? null;
  }

  if (raw.tunnelTopology !== undefined) {
    const topo = normalizeText(raw.tunnelTopology).toUpperCase();
    if (topo && topo !== 'S' && topo !== 'H') {
      return { ok: false, message: 'tunnelTopology 须为 S 或 H' };
    }
    archive.tunnelTopology = (topo as Srv6TunnelTopology) || null;
  }

  if (raw.hubPeSlot !== undefined) {
    const slot = normalizeText(raw.hubPeSlot);
    if (slot && slot !== 'peA' && slot !== 'peB') {
      return { ok: false, message: 'hubPeSlot 须为 peA 或 peB' };
    }
    archive.hubPeSlot = (slot as 'peA' | 'peB') || null;
  }

  if (raw.hubVrfMode !== undefined) {
    const mode = normalizeText(raw.hubVrfMode).toUpperCase();
    if (mode && mode !== 'REUSE_VRF' && mode !== 'DEDICATED_VRF') {
      return { ok: false, message: 'hubVrfMode 须为 REUSE_VRF 或 DEDICATED_VRF' };
    }
    archive.hubVrfMode = (mode as Srv6HubVrfMode) || null;
  }

  if (raw.hubBindings !== undefined) {
    if (raw.hubBindings === null) {
      archive.hubBindings = null;
    } else {
      const parsedBinding = parseHubSlotBinding(raw.hubBindings);
      if (parsedBinding && 'error' in parsedBinding) {
        return { ok: false, message: parsedBinding.error };
      }
      archive.hubBindings = parsedBinding;
    }
  }

  return { ok: true, archive };
};

export const buildEndpointFingerprintFromRows = (
  payload: { peA: string; peB: string; ceA: string; ceB: string },
  rows: VrConfigRow[],
  inner: { peAInnerIf?: string; peBInnerIf?: string },
  hub?: {
    hubPeSlot?: 'peA' | 'peB' | null;
    hubBindings?: Srv6HubSlotBinding | null;
  },
): Srv6EndpointFingerprint => {
  const byUuid = new Map(rows.map((r) => [normalizeText(r.uuid), r]));
  const fp: Srv6EndpointFingerprint = {};
  const peA = byUuid.get(payload.peA);
  const peB = byUuid.get(payload.peB);
  const ceA = byUuid.get(payload.ceA);
  const ceB = byUuid.get(payload.ceB);
  const peACfg = parseJsonObject(peA?.config_json);
  const peBCfg = parseJsonObject(peB?.config_json);
  const ceACfg = parseJsonObject(ceA?.config_json);
  const ceBCfg = parseJsonObject(ceB?.config_json);
  const hubMetaForSlot = (slot: 'peA' | 'peB') =>
    hub?.hubPeSlot === slot && hub?.hubBindings
      ? { wanIf: hub.hubBindings.wanIf, peerPublicNeighbor: hub.hubBindings.peerPublicNeighbor }
      : undefined;
  if (peACfg) fp.peA = computePeFingerprint(peACfg, inner.peAInnerIf, hubMetaForSlot('peA'));
  if (peBCfg) fp.peB = computePeFingerprint(peBCfg, inner.peBInnerIf, hubMetaForSlot('peB'));
  if (ceACfg) fp.ceA = computeCeFingerprint(ceACfg);
  if (ceBCfg) fp.ceB = computeCeFingerprint(ceBCfg);
  return fp;
};

export const computeLiveFingerprintForSlot = (
  slot: Srv6EndpointSlot,
  cfg: Record<string, unknown>,
  tunnel: {
    peAInnerIf?: string | null;
    peBInnerIf?: string | null;
    hubPeSlot?: 'peA' | 'peB' | null;
    hubBindings?: Srv6HubSlotBinding | null;
  },
): Srv6PeFingerprint | Srv6CeFingerprint | undefined => {
  const hubMeta =
    tunnel.hubPeSlot === slot && tunnel.hubBindings
      ? {
          wanIf: tunnel.hubBindings.wanIf,
          peerPublicNeighbor: tunnel.hubBindings.peerPublicNeighbor,
        }
      : undefined;
  if (slot === 'peA') return computePeFingerprint(cfg, tunnel.peAInnerIf || undefined, hubMeta);
  if (slot === 'peB') return computePeFingerprint(cfg, tunnel.peBInnerIf || undefined, hubMeta);
  if (slot === 'ceA' || slot === 'ceB') return computeCeFingerprint(cfg);
  return undefined;
};

export const getStoredFingerprintForSlot = (
  tunnel: { endpointFingerprint?: Srv6EndpointFingerprint | null },
  slot: Srv6EndpointSlot,
) => tunnel.endpointFingerprint?.[slot];

/** 新建/更新隧道须携带完整关系档案（不考虑无档案存量隧道） */
export const validateTunnelArchiveRequired = (tunnel: {
  peAInnerIf?: string | null;
  peBInnerIf?: string | null;
  rdRtMeta?: Srv6RdRtMeta | null;
  injectedDelta?: Srv6InjectedDelta | null;
  endpointFingerprint?: Srv6EndpointFingerprint | null;
  tunnelTopology?: Srv6TunnelTopology | null;
  hubPeSlot?: 'peA' | 'peB' | null;
  hubBindings?: Srv6HubSlotBinding | null;
  hubVrfMode?: Srv6HubVrfMode | null;
  peA?: string;
  peB?: string;
}): { ok: true } | { ok: false; message: string } => {
  if (!normalizeText(tunnel.peAInnerIf) || !normalizeText(tunnel.peBInnerIf)) {
    return { ok: false, message: '缺少关系档案：须指定 PE-A / PE-B 内网接口' };
  }
  if (!tunnel.rdRtMeta?.rtCommon || !tunnel.rdRtMeta?.rdMap?.peA || !tunnel.rdRtMeta?.rdMap?.peB) {
    return { ok: false, message: '缺少关系档案：须包含公共 RT 与 PE-A / PE-B 的路由标识（RD）' };
  }
  const delta = tunnel.injectedDelta;
  if (!delta?.peA || !delta?.peB || !delta?.ceA || !delta?.ceB) {
    return { ok: false, message: '缺少关系档案：须包含四端（PE-A、PE-B、CE-A、CE-B）配置变更清单' };
  }
  const hasEntries = (entry: Srv6InjectedDelta[keyof Srv6InjectedDelta]) =>
    !!entry &&
    [
      entry.neighbors,
      entry.ipv6Routes,
      entry.rdRt,
      entry.activateAddressFamily,
      entry.neighborDisableConnectedCheck,
    ].some((arr) => Array.isArray(arr) && arr.length > 0);
  if (!hasEntries(delta.peA) || !hasEntries(delta.peB) || !hasEntries(delta.ceA) || !hasEntries(delta.ceB)) {
    return { ok: false, message: '缺少关系档案：四端配置变更清单不能为空' };
  }
  const fp = tunnel.endpointFingerprint;
  if (!fp?.peA || !fp?.peB || !fp?.ceA || !fp?.ceB) {
    return { ok: false, message: '缺少关系档案：须包含四端配置指纹' };
  }

  const topo = tunnel.tunnelTopology ?? 'S';
  if (topo === 'H') {
    if (!tunnel.hubPeSlot) {
      return { ok: false, message: '缺少关系档案：Hub 隧道须指定 hubPeSlot' };
    }
    if (!tunnel.hubVrfMode) {
      return { ok: false, message: '缺少关系档案：Hub 隧道须指定 hubVrfMode' };
    }
    if (!tunnel.hubBindings?.wanIf || !tunnel.hubBindings?.peerPublicNeighbor) {
      return { ok: false, message: '缺少关系档案：Hub 隧道须包含 hubBindings（wanIf、peerPublicNeighbor）' };
    }
    const hubUuid = tunnel.hubPeSlot === 'peA' ? tunnel.peA : tunnel.peB;
    const spokeUuid = tunnel.hubPeSlot === 'peA' ? tunnel.peB : tunnel.peA;
    if (hubUuid && tunnel.hubBindings.hubPeUuid !== hubUuid) {
      return { ok: false, message: 'Hub 绑定 hubPeUuid 与 hubPeSlot 不一致' };
    }
    if (spokeUuid && tunnel.hubBindings.spokePeUuid !== spokeUuid) {
      return { ok: false, message: 'Hub 绑定 spokePeUuid 与槽位不一致' };
    }
    if (tunnel.hubBindings.hubPeSlot !== tunnel.hubPeSlot) {
      return { ok: false, message: 'hubBindings.hubPeSlot 与 hubPeSlot 不一致' };
    }
  } else if (tunnel.hubBindings || tunnel.hubPeSlot || tunnel.hubVrfMode) {
    return { ok: false, message: 'Spoke 点对点隧道不应包含 hubBindings / hubPeSlot / hubVrfMode' };
  }

  return { ok: true };
};

export const mergeArchiveIntoTunnel = (
  target: {
    peAInnerIf?: string | null;
    peBInnerIf?: string | null;
    rdRtMeta?: Srv6RdRtMeta | null;
    injectedDelta?: Srv6InjectedDelta | null;
    endpointFingerprint?: Srv6EndpointFingerprint | null;
    tunnelTopology?: Srv6TunnelTopology | null;
    hubPeSlot?: 'peA' | 'peB' | null;
    hubBindings?: Srv6HubSlotBinding | null;
    hubVrfMode?: Srv6HubVrfMode | null;
  },
  archive: Srv6TunnelArchiveFields,
) => {
  if (archive.peAInnerIf !== undefined) target.peAInnerIf = archive.peAInnerIf;
  if (archive.peBInnerIf !== undefined) target.peBInnerIf = archive.peBInnerIf;
  if (archive.rdRtMeta !== undefined) target.rdRtMeta = archive.rdRtMeta;
  if (archive.injectedDelta !== undefined) target.injectedDelta = archive.injectedDelta;
  if (archive.endpointFingerprint !== undefined) target.endpointFingerprint = archive.endpointFingerprint;
  if (archive.tunnelTopology !== undefined) target.tunnelTopology = archive.tunnelTopology;
  if (archive.hubPeSlot !== undefined) target.hubPeSlot = archive.hubPeSlot;
  if (archive.hubBindings !== undefined) target.hubBindings = archive.hubBindings;
  if (archive.hubVrfMode !== undefined) target.hubVrfMode = archive.hubVrfMode;
};
