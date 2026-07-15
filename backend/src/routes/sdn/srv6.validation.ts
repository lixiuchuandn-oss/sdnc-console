import {
  isLegacyPeRole,
  isSrv6PeRole,
  normalizeVrRole,
  parseTunnelTopology,
} from './srv6.roles';
import type { Srv6TunnelTopology } from '../../entities/vRouter/srv6Tunnel.types';

export type Srv6TunnelLike = {
  id?: string;
  name?: string;
  peA?: string;
  peB?: string;
  ceA?: string;
  ceB?: string;
};

export type Srv6TunnelPayload = {
  name: string;
  peA: string;
  peB: string;
  ceA: string;
  ceB: string;
  /** Hub–Spoke (H) 或 Spoke 点对点 (S)；创建校验须与档案字段一致 */
  tunnelTopology?: Srv6TunnelTopology;
};

type NormalizeResult = { ok: true; value: Srv6TunnelPayload } | { ok: false; message: string };

const normalizeText = (value: unknown) => String(value ?? '').trim();

const sameId = (a: unknown, b: unknown) => String(a ?? '') === String(b ?? '');

const sameName = (a: unknown, b: unknown) =>
  normalizeText(a).toLowerCase() === normalizeText(b).toLowerCase();

export const normalizeSrv6TunnelPayload = (payload: unknown): NormalizeResult => {
  const body = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const value: Srv6TunnelPayload = {
    name: normalizeText(body.name),
    peA: normalizeText(body.peA),
    peB: normalizeText(body.peB),
    ceA: normalizeText(body.ceA),
    ceB: normalizeText(body.ceB),
    tunnelTopology:
      body.tunnelTopology !== undefined ? parseTunnelTopology(body.tunnelTopology) : undefined,
  };

  if (!value.name || !value.peA || !value.peB || !value.ceA || !value.ceB) {
    return { ok: false, message: '请填写隧道名称并选择四端（PE-A、PE-B、CE-A、CE-B）' };
  }
  if (sameId(value.peA, value.peB)) {
    return { ok: false, message: 'PE-A 与 PE-B 不能相同' };
  }
  if (sameId(value.ceA, value.ceB)) {
    return { ok: false, message: 'CE-A 与 CE-B 不能相同' };
  }

  return { ok: true, value };
};

export const hasSrv6NameConflict = (tunnels: Srv6TunnelLike[], name: string, excludeId?: string) =>
  tunnels.some((item) => (!excludeId || !sameId(item.id, excludeId)) && sameName(item.name, name));

const endpointsMatch = (a: Srv6TunnelLike, b: Srv6TunnelLike) =>
  sameId(a.peA, b.peA) && sameId(a.peB, b.peB) && sameId(a.ceA, b.ceA) && sameId(a.ceB, b.ceB);

const endpointsMatchSymmetric = (a: Srv6TunnelLike, b: Srv6TunnelLike) =>
  sameId(a.peA, b.peB) && sameId(a.peB, b.peA) && sameId(a.ceA, b.ceB) && sameId(a.ceB, b.ceA);

export const hasSrv6EndpointConflict = (
  tunnels: Srv6TunnelLike[],
  payload: Srv6TunnelLike,
  excludeId?: string,
) =>
  tunnels.some(
    (item) =>
      (!excludeId || !sameId(item.id, excludeId)) &&
      (endpointsMatch(item, payload) || endpointsMatchSymmetric(item, payload)),
  );

/** 平台库 VR 行（POST 创建隧道时做端点完整性校验） */
export type VrConfigRow = {
  uuid: string;
  role?: string | null;
  config_json?: string | null;
};

type EndpointSlot = {
  label: string;
  uuid: string;
  kind: 'pe' | 'ce';
};

const peRoleIssue = (label: string, roleRaw: unknown, topology: ReturnType<typeof parseTunnelTopology>): string | null => {
  const role = normalizeVrRole(roleRaw);
  if (isLegacyPeRole(role)) {
    return `${label}：角色 PE 已废弃，请在 VR 配置中将角色改为 SPOKE_PE 或 HUB_PE`;
  }
  if (!isSrv6PeRole(role)) {
    return `${label}：角色应为 SPOKE_PE 或 HUB_PE，当前为 ${roleRaw ?? '未设置'}`;
  }
  if (topology === 'S' && role !== 'SPOKE_PE') {
    return `${label}：Spoke 点对点隧道要求角色为 SPOKE_PE，当前为 ${role}`;
  }
  return null;
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
        const ip = ipv6HostFromRaw((arr[portIndex] as Record<string, unknown>)?.ipv6_static ??
          (arr[portIndex] as Record<string, unknown>)?.ipv6);
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
          const ip = ipv6HostFromRaw((it as Record<string, unknown>)?.ipv6_static ??
            (it as Record<string, unknown>)?.ipv6);
          if (ip) candidates.push(ip);
        }
      }
    }
  }
  if (portIndex === 0) {
    return candidates[0] || ipv6HostFromRaw(cfg.ipv6_static ?? cfg.ipv6);
  }
  if (portIndex === 1) return candidates[1] || candidates[0];
  return undefined;
};

/** 按端口索引取 IPv4（仅 v4，用于 CE 公网口必填校验） */
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
  if (portIndex === 0) {
    return candidates[0] || trimPrefix(cfg.ipv4_static ?? cfg.ipv4);
  }
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

/** CE 公网口 IPv4：优先 ce.publicConfig.wanName/wanDev 对应接口，否则回退「第一个网口」 */
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

const isPublicBgpBlock = (b: unknown): boolean => {
  if (!b || typeof b !== 'object') return false;
  const vrf = (b as Record<string, unknown>).vrf;
  return vrf === undefined || vrf === null || vrf === 0 || vrf === '0';
};

const extractPublicBgpAsn = (cfg: Record<string, unknown>): number | undefined => {
  const pe = cfg.pe;
  const peObj = pe && typeof pe === 'object' ? (pe as Record<string, unknown>) : undefined;
  const pc = peObj?.publicConfig;
  const pcObj = pc && typeof pc === 'object' ? (pc as Record<string, unknown>) : undefined;
  let idx: number | undefined;
  if (pcObj && typeof pcObj.publicBgpIndex === 'number') idx = pcObj.publicBgpIndex;
  else if (peObj && typeof peObj.publicBgpIndex === 'number') idx = peObj.publicBgpIndex;

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

  if (typeof idx === 'number') {
    const at = pick(idx);
    if (at !== undefined) return at;
  }
  const pubIdx = bgpArr.findIndex(isPublicBgpBlock);
  if (pubIdx >= 0) {
    const at = pick(pubIdx);
    if (at !== undefined) return at;
  }
  return pick(0);
};

export const extractSrv6PrefixFromConfig = (cfg: Record<string, unknown>): string | undefined => {
  const sr = cfg.segment_routing_srv6;
  if (sr && typeof sr === 'object') {
    const top = normalizeText((sr as Record<string, unknown>).prefix);
    if (top) return top;
  }
  const pe = cfg.pe;
  if (pe && typeof pe === 'object') {
    const peObj = pe as Record<string, unknown>;
    const pc = peObj.publicConfig;
    const legacy =
      (pc && typeof pc === 'object'
        ? normalizeText((pc as Record<string, unknown>).sidPrefix)
        : '') ||
      normalizeText(peObj.sidPrefix) ||
      normalizeText(cfg.sidPrefix);
    if (legacy) return legacy;
  }
  return undefined;
};

const extractSrv6LocatorFromConfig = (cfg: Record<string, unknown>): string | undefined => {
  const sr = cfg.segment_routing_srv6;
  if (sr && typeof sr === 'object') {
    const loc = normalizeText((sr as Record<string, unknown>).locator);
    if (loc) return loc;
  }
  const pe = cfg.pe;
  if (pe && typeof pe === 'object') {
    const peObj = pe as Record<string, unknown>;
    const pc = peObj.publicConfig;
    const fromPc =
      pc && typeof pc === 'object'
        ? normalizeText((pc as Record<string, unknown>).locatorName)
        : '';
    return fromPc || normalizeText(peObj.locatorName);
  }
  return undefined;
};

const hasInterfaceWithVrf = (cfg: Record<string, unknown>): boolean => {
  for (const k of Object.keys(cfg)) {
    if (!k.startsWith('interfaces_') && !k.startsWith('subinterfaces_')) continue;
    const arr = cfg[k];
    if (!Array.isArray(arr)) continue;
    for (const it of arr) {
      if (!it || typeof it !== 'object') continue;
      const vrf = (it as Record<string, unknown>).vrf;
      if (vrf !== undefined && vrf !== null && String(vrf).trim() !== '') return true;
    }
  }
  return false;
};

const parseConfigJson = (raw: string | null | undefined): Record<string, unknown> | null => {
  const text = normalizeText(raw);
  if (!text || text === '{}') return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

const collectPeIssues = (cfg: Record<string, unknown>): string[] => {
  const issues: string[] = [];
  if (!extractSrv6LocatorFromConfig(cfg)) {
    issues.push('缺少 SRv6 Locator（请在角色配置向导中填写 Locator 名称）');
  }
  const prefix = extractSrv6PrefixFromConfig(cfg);
  if (!prefix) {
    issues.push('缺少 SRv6 SID 前缀（请在角色配置向导中填写 SID 前缀）');
  } else if (prefix.includes('/')) {
    issues.push('SRv6 SID 前缀不允许包含 / 掩码');
  }
  if (extractPublicBgpAsn(cfg) === undefined) {
    issues.push('缺少公网 BGP ASN');
  }
  if (!extractPortIpv6(cfg, 0)) {
    issues.push('缺少公网口 IPv6（用于 PE 互联与路由注入）');
  }
  if (!hasInterfaceWithVrf(cfg)) {
    issues.push('缺少带 VRF 的内网接口（请在角色配置向导中为内网口指定 VRF）');
  }
  return issues;
};

const collectCeIssues = (cfg: Record<string, unknown>): string[] => {
  const issues: string[] = [];
  if (extractPublicBgpAsn(cfg) === undefined) {
    issues.push('缺少公网 BGP ASN');
  }
  if (!extractCeWanIpv4(cfg)) {
    issues.push('缺少公网口 IPv4（IPv6 可选，不作为创建隧道的前置条件）');
  }
  return issues;
};

/**
 * 仅在 POST 创建隧道时校验四端 VR 平台库配置是否满足 SRv6 向导注入前提。
 * PUT 编辑不做此项校验（由调用方保证）。
 */
/** Hub–Spoke / Spoke 点对点拓扑与 PE 角色配对校验 */
export const validateSrv6TunnelTopology = (
  payload: Srv6TunnelPayload,
  rows: VrConfigRow[],
  explicitTopology?: unknown,
): { ok: true } | { ok: false; message: string } => {
  const topology = parseTunnelTopology(explicitTopology);
  const byUuid = new Map(rows.map((r) => [normalizeText(r.uuid), r]));
  const peARole = normalizeVrRole(byUuid.get(payload.peA)?.role);
  const peBRole = normalizeVrRole(byUuid.get(payload.peB)?.role);
  const hubCount = [peARole, peBRole].filter((r) => r === 'HUB_PE').length;

  if (topology === 'H') {
    if (hubCount !== 1) {
      return {
        ok: false,
        message: 'Spoke–Hub（Hub–Spoke）隧道须恰好一端为 HUB_PE、另一端为 SPOKE_PE',
      };
    }
  } else if (hubCount === 1) {
    return {
      ok: false,
      message: '仅一端为 HUB_PE 时须选用 Spoke–Hub 拓扑；Spoke–Spoke 两端须均为 SPOKE_PE，Hub–Hub 两端须均为 HUB_PE',
    };
  }
  // S：Spoke–Spoke（0×HUB）或 Hub–Hub（2×HUB）点对点
  return { ok: true };
};

export const validateSrv6VrEndpointsForCreate = (
  payload: Srv6TunnelPayload,
  rows: VrConfigRow[],
): { ok: true } | { ok: false; message: string } => {
  const byUuid = new Map(rows.map((r) => [normalizeText(r.uuid), r]));
  const topology = parseTunnelTopology(
    payload && typeof payload === 'object' ? (payload as Record<string, unknown>).tunnelTopology : undefined,
  );
  const slots: EndpointSlot[] = [
    { label: 'PE-A', uuid: payload.peA, kind: 'pe' },
    { label: 'PE-B', uuid: payload.peB, kind: 'pe' },
    { label: 'CE-A', uuid: payload.ceA, kind: 'ce' },
    { label: 'CE-B', uuid: payload.ceB, kind: 'ce' },
  ];

  const messages: string[] = [];

  for (const slot of slots) {
    const row = byUuid.get(slot.uuid);
    if (!row) {
      messages.push(`${slot.label}（${slot.uuid}）：平台库中未找到 VR 配置`);
      continue;
    }
    const role = normalizeVrRole(row.role);
    if (slot.kind === 'pe') {
      const roleIssue = peRoleIssue(slot.label, row.role, topology);
      if (roleIssue) messages.push(roleIssue);
    } else if (role && role !== 'CE') {
      messages.push(`${slot.label}：角色应为 CE，当前为 ${row.role}`);
    }
    const cfg = parseConfigJson(row.config_json);
    if (!cfg) {
      messages.push(`${slot.label}：平台库中的设备配置为空或格式异常`);
      continue;
    }
    const issues = slot.kind === 'pe' ? collectPeIssues(cfg) : collectCeIssues(cfg);
    for (const issue of issues) {
      messages.push(`${slot.label}：${issue}`);
    }
  }

  const topoCheck = validateSrv6TunnelTopology(
    payload,
    rows,
    payload && typeof payload === 'object' ? (payload as Record<string, unknown>).tunnelTopology : undefined,
  );
  if (!topoCheck.ok) messages.push(topoCheck.message);

  if (messages.length === 0) return { ok: true };
  return { ok: false, message: messages.join('；') };
};
