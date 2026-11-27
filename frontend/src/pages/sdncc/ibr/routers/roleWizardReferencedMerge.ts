/**
 * 被 SRv6 隧道引用时：角色向导禁止全量骨架覆盖，只在现网底稿上叠加非指纹字段。
 * CE / 标准 / SASE 共用；Hub-PE 仍走 peWizardReferencedPatch。
 */

import { pickPrimaryIpv4Cidr } from './vrIpv4Utils';
import type { IpsecPresetWizardFormValues } from './ipsecPresetWizardLib';

export type ReferencedMergeResult = {
  cfg: Record<string, unknown>;
  changedLabels: string[];
  blockedReasons?: string[];
};

export type CeWizardFormValues = {
  wanName?: string;
  wanIpv4?: unknown;
  wanIpv6?: unknown;
  bgpAsn?: unknown;
  bgpRouterId?: unknown;
  lanName?: string;
  lanIpv4?: unknown;
  lanIpv6?: unknown;
};

const IFACE_BUCKETS = [
  'interfaces_GigabitEthernet',
  'subinterfaces_GigabitEthernet',
  'interfaces_lo',
  'interfaces_Tunnel',
  'subinterfaces_Tunnel',
] as const;

const text = (v: unknown) => String(v ?? '').trim();

const cloneCfg = <T>(v: T): T => JSON.parse(JSON.stringify(v ?? {})) as T;

const stableStringify = (v: unknown): string => {
  try {
    return JSON.stringify(v ?? null);
  } catch {
    return '';
  }
};

const normIpv4 = (v: unknown) => pickPrimaryIpv4Cidr(v) || text(v);

const normAsn = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : text(v);
};

const isPublicBgp = (b: Record<string, unknown>) =>
  b.vrf === undefined || b.vrf === null || String(b.vrf).trim() === '' || Number(b.vrf) === 0;

export const tunnelRefLockTip = (tunnelNames: string[] | null | undefined) =>
  `该字段已被隧道${
    tunnelNames?.length ? `「${tunnelNames.join('、')}」` : ''
  }引用，如需修改请先删除相关隧道`;

export const formatTunnelRefBlockedMessage = (refNamesPart: string, details: string[]) =>
  `该 IBR 已被 SRv6 隧道引用（${refNamesPart}），以下字段影响隧道通路，不能直接修改：${details.join(
    '；',
  )}。如需修改，请先删除相关隧道后再调整。`;

export const TUNNEL_REF_NOOP_TOAST = '该 IBR 已被隧道引用，未检测到可下发的变更，已跳过设备下发。';

export const TUNNEL_REF_OK_TOAST = '该 IBR 已被隧道引用，配置已更新并下发。';

export const TUNNEL_REF_CONFIRM_LEAD =
  '该 IBR 已被 SRv6 隧道引用：本次仅把向导中的非身份字段叠加到现网底稿，不会用向导骨架覆盖隧道注入的路由/邻居。';

const getCeObj = (cfg: Record<string, unknown>): Record<string, unknown> => {
  const ce = cfg.ce;
  return ce && typeof ce === 'object' && !Array.isArray(ce) ? { ...(ce as Record<string, unknown>) } : {};
};

const getCePublic = (ce: Record<string, unknown>): Record<string, unknown> => {
  const pub = ce.publicConfig;
  if (pub && typeof pub === 'object' && !Array.isArray(pub)) return { ...(pub as Record<string, unknown>) };
  const legacy: Record<string, unknown> = {};
  for (const k of ['wanName', 'wanDev', 'wanIpv4', 'wanIpv6', 'bgpAsn', 'bgpRouterId']) {
    if (ce[k] !== undefined) legacy[k] = ce[k];
  }
  return legacy;
};

const firstLanRow = (ce: Record<string, unknown>): Record<string, unknown> => {
  const list = ce.lanConfig;
  if (Array.isArray(list) && list[0] && typeof list[0] === 'object') {
    return { ...(list[0] as Record<string, unknown>) };
  }
  return {
    lanName: ce.lanName ?? ce.ifName,
    lanIpv4: ce.lanIpv4 ?? ce.ifIpv4,
    lanIpv6: ce.lanIpv6 ?? ce.ifIpv6,
  };
};

const publicBgp = (cfg: Record<string, unknown>): Record<string, unknown> | undefined => {
  const arr = Array.isArray(cfg.bgp) ? (cfg.bgp as Record<string, unknown>[]) : [];
  return arr.find((b) => b && isPublicBgp(b)) || arr[0];
};

const findIface = (
  cfg: Record<string, unknown>,
  ifName: string,
): { key: string; idx: number; row: Record<string, unknown> } | null => {
  const want = text(ifName).toLowerCase().replace(/\s+/g, ' ');
  if (!want) return null;
  for (const key of IFACE_BUCKETS) {
    const arr = Array.isArray(cfg[key]) ? (cfg[key] as Record<string, unknown>[]) : [];
    const idx = arr.findIndex((it) => text(it?.name).toLowerCase().replace(/\s+/g, ' ') === want);
    if (idx >= 0) return { key, idx, row: { ...arr[idx] } };
  }
  return null;
};

const patchIfaceField = (
  cfg: Record<string, unknown>,
  ifName: string,
  field: string,
  value: unknown,
): boolean => {
  const hit = findIface(cfg, ifName);
  if (!hit) return false;
  if (stableStringify(hit.row[field]) === stableStringify(value)) return false;
  const arr = [...(cfg[hit.key] as Record<string, unknown>[])];
  arr[hit.idx] = { ...hit.row, [field]: value };
  cfg[hit.key] = arr;
  return true;
};

const pushChange = (labels: string[], label: string) => {
  if (!labels.includes(label)) labels.push(label);
};

/** 从已保存 CE 配置读取指纹快照（与后端 CE fingerprint 对齐） */
export const readCeFingerprintSnapshot = (cfg: Record<string, unknown>) => {
  const ce = getCeObj(cfg);
  const pub = getCePublic(ce);
  const lan = firstLanRow(ce);
  const bgp0 = publicBgp(cfg);
  const pb = pub.publicBgp && typeof pub.publicBgp === 'object' ? (pub.publicBgp as Record<string, unknown>) : {};
  const wanName = text(pub.wanName || pub.wanDev || ce.wanDev);
  const lanIf = text(lan.lanName || lan.ifName);
  const wanIpv4 =
    normIpv4(pub.wanIpv4) || (wanName ? normIpv4(findIface(cfg, wanName)?.row.ipv4_static) : '');
  const lanIpv4 =
    normIpv4(lan.lanIpv4 ?? lan.ifIpv4) || (lanIf ? normIpv4(findIface(cfg, lanIf)?.row.ipv4_static) : '');
  return {
    wanIpv4,
    lanIf,
    lanIpv4,
    bgpAsn: normAsn(pb.asn ?? pb.bgpAsn ?? pub.bgpAsn ?? bgp0?.asn),
  };
};

export function applyCeWizardReferencedChanges(
  existing: Record<string, unknown>,
  values: CeWizardFormValues,
): ReferencedMergeResult {
  const cfg = cloneCfg(existing && typeof existing === 'object' ? existing : {});
  const saved = readCeFingerprintSnapshot(cfg);
  const blocked: string[] = [];
  const nextWan4 = normIpv4(values.wanIpv4);
  const nextLanIf = text(values.lanName);
  const nextLan4 = normIpv4(values.lanIpv4);
  const nextAsn = normAsn(values.bgpAsn);

  if (saved.wanIpv4 && nextWan4 && nextWan4 !== saved.wanIpv4) {
    blocked.push(`WAN IPv4 ${saved.wanIpv4}→${nextWan4}`);
  }
  if (saved.lanIf && nextLanIf && nextLanIf !== saved.lanIf) {
    blocked.push(`LAN 口 ${saved.lanIf}→${nextLanIf}`);
  }
  if (saved.lanIpv4 && nextLan4 && nextLan4 !== saved.lanIpv4) {
    blocked.push(`LAN IPv4 ${saved.lanIpv4}→${nextLan4}`);
  }
  if (saved.bgpAsn && nextAsn && nextAsn !== saved.bgpAsn) {
    blocked.push(`BGP ASN ${saved.bgpAsn}→${nextAsn}`);
  }
  if (blocked.length) {
    return { cfg: cloneCfg(existing), changedLabels: [], blockedReasons: blocked };
  }

  const labels: string[] = [];
  const ce = getCeObj(cfg);
  const pub = getCePublic(ce);
  const wanName = text(values.wanName) || text(pub.wanName || pub.wanDev);
  const lanIf = text(values.lanName) || saved.lanIf;
  const wan6 = text(values.wanIpv6) || undefined;
  const lan6 = text(values.lanIpv6) || undefined;
  const rid = text(values.bgpRouterId) || undefined;

  if (wanName && wan6 !== undefined) {
    const before = text(pub.wanIpv6);
    if (wan6 !== before) {
      pub.wanIpv6 = wan6 || undefined;
      patchIfaceField(cfg, wanName, 'ipv6_static', wan6 || undefined);
      pushChange(labels, 'WAN 侧 IPv6');
    }
  }
  if (lanIf && lan6 !== undefined) {
    const lanRows = Array.isArray(ce.lanConfig)
      ? (ce.lanConfig as Record<string, unknown>[]).map((r) => ({ ...r }))
      : [{ lanName: lanIf, lanIpv4: saved.lanIpv4 }];
    const before = text(lanRows[0]?.lanIpv6 ?? lanRows[0]?.ifIpv6);
    if (lan6 !== before) {
      lanRows[0] = { ...lanRows[0], lanName: lanIf, lanIpv6: lan6 || undefined };
      ce.lanConfig = lanRows;
      patchIfaceField(cfg, lanIf, 'ipv6_static', lan6 || undefined);
      pushChange(labels, 'LAN 侧 IPv6');
    }
  }
  if (rid) {
    const bgpArr = Array.isArray(cfg.bgp) ? [...(cfg.bgp as Record<string, unknown>[])] : [];
    const idx = bgpArr.findIndex((b) => b && isPublicBgp(b));
    if (idx >= 0 && text(bgpArr[idx].router_id) !== rid) {
      bgpArr[idx] = { ...bgpArr[idx], router_id: rid };
      cfg.bgp = bgpArr;
      pushChange(labels, 'BGP Router-ID');
    }
    const pb =
      pub.publicBgp && typeof pub.publicBgp === 'object'
        ? { ...(pub.publicBgp as Record<string, unknown>) }
        : {};
    if (text(pb.routerId ?? pb.bgpRouterId) !== rid) {
      pub.publicBgp = { ...pb, routerId: rid };
      pushChange(labels, 'BGP Router-ID');
    }
  }

  cfg.ce = { ...ce, publicConfig: pub };
  cfg.role = cfg.role || 'CE';
  return { cfg, changedLabels: [...new Set(labels)] };
}

const readIpsecLockSnapshot = (cfg: Record<string, unknown>) => {
  const preset =
    cfg.ipsec_preset && typeof cfg.ipsec_preset === 'object'
      ? (cfg.ipsec_preset as Record<string, unknown>)
      : {};
  const lanIf = text(preset.lan_interface);
  const wanIf = text(preset.wan_interface);
  return {
    wanIpv4: normIpv4(preset.wan_ipv4) || (wanIf ? normIpv4(findIface(cfg, wanIf)?.row.ipv4_static) : ''),
    lanIf,
    lanIpv4: normIpv4(preset.lan_ipv4) || (lanIf ? normIpv4(findIface(cfg, lanIf)?.row.ipv4_static) : ''),
    wanIf,
    wanIpv6: text(preset.wan_ipv6),
    lanIpv6: text(preset.lan_ipv6),
    gateway: text(preset.gateway),
    enableNat: Boolean(preset.enable_nat),
  };
};

export function applyIpsecPresetWizardReferencedChanges(
  existing: Record<string, unknown>,
  values: IpsecPresetWizardFormValues,
): ReferencedMergeResult {
  const cfg = cloneCfg(existing && typeof existing === 'object' ? existing : {});
  const saved = readIpsecLockSnapshot(cfg);
  const blocked: string[] = [];
  const nextWan4 = normIpv4(values.wanIpv4);
  const nextLanIf = text(values.lanInterface);
  const nextLan4 = normIpv4(values.lanIpv4);

  if (saved.wanIpv4 && nextWan4 && nextWan4 !== saved.wanIpv4) {
    blocked.push(`WAN IPv4 ${saved.wanIpv4}→${nextWan4}`);
  }
  if (saved.lanIf && nextLanIf && nextLanIf !== saved.lanIf) {
    blocked.push(`LAN 口 ${saved.lanIf}→${nextLanIf}`);
  }
  if (saved.lanIpv4 && nextLan4 && nextLan4 !== saved.lanIpv4) {
    blocked.push(`LAN IPv4 ${saved.lanIpv4}→${nextLan4}`);
  }
  if (blocked.length) {
    return { cfg: cloneCfg(existing), changedLabels: [], blockedReasons: blocked };
  }

  const labels: string[] = [];
  const preset = {
    ...((cfg.ipsec_preset && typeof cfg.ipsec_preset === 'object'
      ? cfg.ipsec_preset
      : {}) as Record<string, unknown>),
  };
  const wanIf = saved.wanIf || text(values.wanInterface);
  const lanIf = saved.lanIf || text(values.lanInterface);
  const wan6 = text(values.wanIpv6);
  const lan6 = text(values.lanIpv6);
  const gw = text(values.ipsecPublicIp);
  const nat = Boolean(values.enableNat);

  if (wanIf && wan6 !== saved.wanIpv6) {
    preset.wan_ipv6 = wan6 || undefined;
    patchIfaceField(cfg, wanIf, 'ipv6_static', wan6 || undefined);
    pushChange(labels, 'WAN 侧 IPv6');
  }
  if (lanIf && lan6 !== saved.lanIpv6) {
    preset.lan_ipv6 = lan6 || undefined;
    patchIfaceField(cfg, lanIf, 'ipv6_static', lan6 || undefined);
    pushChange(labels, 'LAN 侧 IPv6');
  }
  if (gw !== saved.gateway) {
    preset.gateway = gw || undefined;
    const routes = Array.isArray(cfg.ipv4_route) ? [...(cfg.ipv4_route as Record<string, unknown>[])] : [];
    const defIdx = routes.findIndex((r) => text(r?.destination) === '0.0.0.0/0');
    if (gw) {
      const row = { destination: '0.0.0.0/0', via: gw, priority: 100 };
      if (defIdx >= 0) routes[defIdx] = { ...routes[defIdx], ...row };
      else routes.push(row);
      cfg.ipv4_route = routes;
    }
    pushChange(labels, '公网网关');
  }
  if (nat !== saved.enableNat) {
    preset.enable_nat = nat;
    if (wanIf) patchIfaceField(cfg, wanIf, 'nat', nat ? { type: 'outside' } : undefined);
    if (lanIf) patchIfaceField(cfg, lanIf, 'nat', nat ? { type: 'inside' } : undefined);
    pushChange(labels, 'NAT');
  }

  cfg.ipsec_preset = preset;
  return { cfg, changedLabels: [...new Set(labels)] };
}
