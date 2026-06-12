import {
  extractSrv6PrefixFromConfig,
  type VrConfigRow,
} from './srv6.validation';
import type {
  Srv6CeFingerprint,
  Srv6EndpointFingerprint,
  Srv6EndpointSlot,
  Srv6InjectedDelta,
  Srv6PeFingerprint,
  Srv6RdRtMeta,
  Srv6TunnelArchiveFields,
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

const isPublicBgpBlock = (b: unknown): boolean => {
  if (!b || typeof b !== 'object') return false;
  const vrf = (b as Record<string, unknown>).vrf;
  return vrf === undefined || vrf === null || vrf === 0 || vrf === '0';
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

export const computePeFingerprint = (
  cfg: Record<string, unknown>,
  innerIf?: string,
): Srv6PeFingerprint => ({
  publicIpv6: extractPortIpv6(cfg, 0),
  publicBgpAsn: extractBgpAsnAt(cfg, 0),
  sidPrefix: extractSrv6PrefixFromConfig(cfg),
  innerIf: innerIf || undefined,
  innerIp: innerIf ? extractInterfaceIp(cfg, innerIf) : extractPortIpv4(cfg, 1),
  innerVrf: innerIf ? extractInterfaceVrf(cfg, innerIf) : undefined,
  innerBgpAsn: extractBgpAsnAt(cfg, 1),
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

  return { ok: true, archive };
};

export const buildEndpointFingerprintFromRows = (
  payload: { peA: string; peB: string; ceA: string; ceB: string },
  rows: VrConfigRow[],
  inner: { peAInnerIf?: string; peBInnerIf?: string },
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
  if (peACfg) fp.peA = computePeFingerprint(peACfg, inner.peAInnerIf);
  if (peBCfg) fp.peB = computePeFingerprint(peBCfg, inner.peBInnerIf);
  if (ceACfg) fp.ceA = computeCeFingerprint(ceACfg);
  if (ceBCfg) fp.ceB = computeCeFingerprint(ceBCfg);
  return fp;
};

export const computeLiveFingerprintForSlot = (
  slot: Srv6EndpointSlot,
  cfg: Record<string, unknown>,
  tunnel: { peAInnerIf?: string | null; peBInnerIf?: string | null },
): Srv6PeFingerprint | Srv6CeFingerprint | undefined => {
  if (slot === 'peA') return computePeFingerprint(cfg, tunnel.peAInnerIf || undefined);
  if (slot === 'peB') return computePeFingerprint(cfg, tunnel.peBInnerIf || undefined);
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
  return { ok: true };
};

export const mergeArchiveIntoTunnel = (
  target: {
    peAInnerIf?: string | null;
    peBInnerIf?: string | null;
    rdRtMeta?: Srv6RdRtMeta | null;
    injectedDelta?: Srv6InjectedDelta | null;
    endpointFingerprint?: Srv6EndpointFingerprint | null;
  },
  archive: Srv6TunnelArchiveFields,
) => {
  if (archive.peAInnerIf !== undefined) target.peAInnerIf = archive.peAInnerIf;
  if (archive.peBInnerIf !== undefined) target.peBInnerIf = archive.peBInnerIf;
  if (archive.rdRtMeta !== undefined) target.rdRtMeta = archive.rdRtMeta;
  if (archive.injectedDelta !== undefined) target.injectedDelta = archive.injectedDelta;
  if (archive.endpointFingerprint !== undefined) target.endpointFingerprint = archive.endpointFingerprint;
};
