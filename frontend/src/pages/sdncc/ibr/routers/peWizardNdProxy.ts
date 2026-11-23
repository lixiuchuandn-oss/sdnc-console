import { validateSrv6SidPrefixPhase1 } from '../srv6/srv6SidPrefix';

const MAC_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;
const MAC_KEYS = [
  'ethernet_address',
  'mac',
  'hwaddr',
  'hw_addr',
  'l2_address',
  'mac_address',
] as const;

/** Locator SID 主机地址：去掉 SID 前缀上的掩码，供 `ipv6 nd proxy` 使用。 */
export function ndProxySidHostFromPrefix(sidPrefix: unknown): string {
  const r = validateSrv6SidPrefixPhase1(sidPrefix);
  if (!r.ok) return '';
  return String(r.host || '').trim();
}

export function ifaceHasNdProxy(row: unknown): boolean {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  return String((row as Record<string, unknown>).ipv6_nd_proxy ?? '').trim() !== '';
}

/** VR3/VR2 接口行若带了硬件地址则取出；当前北向 DTO 通常没有该字段。 */
export function pickIfaceHardwareMac(row: unknown): string | undefined {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return undefined;
  const rec = row as Record<string, unknown>;
  for (const key of MAC_KEYS) {
    const raw = String(rec[key] ?? '').trim();
    if (MAC_RE.test(raw)) return raw.toLowerCase();
  }
  return undefined;
}

/** @returns true if ipv6_nd_proxy was written */
export function applyWanNdProxy(
  item: Record<string, unknown>,
  enabled: boolean,
  sidPrefix: unknown,
): boolean {
  if (!enabled) {
    delete item.ipv6_nd_proxy;
    return false;
  }
  const host = ndProxySidHostFromPrefix(sidPrefix);
  if (!host) {
    delete item.ipv6_nd_proxy;
    return false;
  }
  item.ipv6_nd_proxy = host;
  return true;
}

const IFACE_ARRAY_KEYS = [
  'interfaces_GigabitEthernet',
  'subinterfaces_GigabitEthernet',
  'interfaces_lo',
  'interfaces_Tunnel',
  'subinterfaces_Tunnel',
] as const;

const ifaceKey = (name: string): string =>
  String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

/** 隧道引用下的窄通道：只改现有 VR 配置上的 WAN ipv6_nd_proxy + pe.publicConfig 意图。 */
export function patchVrConfigWanNdProxy(
  cfg: Record<string, unknown>,
  values: {
    sidPrefix?: unknown;
    wanNdProxy?: boolean;
    wanDev?: string;
    hubWanInventory?: Array<{ ifName?: string; ndProxy?: boolean }>;
  },
): Record<string, unknown> {
  const wantNames = collectWanNdProxyIfNames(values);
  const hub = Array.isArray(values.hubWanInventory) ? values.hubWanInventory : [];
  const hubNamed = hub
    .map((row) => String(row?.ifName || '').trim())
    .filter(Boolean);
  const managedNames = hubNamed.length
    ? hubNamed
    : [String(values.wanDev || '').trim()].filter(Boolean);
  const host = ndProxySidHostFromPrefix(values.sidPrefix);

  for (const key of IFACE_ARRAY_KEYS) {
    const arr = cfg[key];
    if (!Array.isArray(arr)) continue;
    cfg[key] = arr.map((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
      const next = { ...(row as Record<string, unknown>) };
      const name = String(next.name || '').trim();
      if (!wanNdProxyEnabledOn(name, managedNames)) return next;
      applyWanNdProxy(next, wanNdProxyEnabledOn(name, wantNames), host || values.sidPrefix);
      return next;
    });
  }

  const pe =
    cfg.pe && typeof cfg.pe === 'object' && !Array.isArray(cfg.pe)
      ? { ...(cfg.pe as Record<string, unknown>) }
      : {};
  const publicConfig =
    pe.publicConfig && typeof pe.publicConfig === 'object' && !Array.isArray(pe.publicConfig)
      ? { ...(pe.publicConfig as Record<string, unknown>) }
      : {};
  if (!hubNamed.length) {
    publicConfig.wanNdProxy = Boolean(values.wanNdProxy);
  } else {
    delete publicConfig.wanNdProxy;
  }
  publicConfig.wanNdProxyIfNames = wantNames;
  pe.publicConfig = publicConfig;
  cfg.pe = pe;
  return cfg;
}

/**
 * 勾选了 ND Proxy 但无法得到 Locator SID 主机地址时返回错误文案。
 * Hub 按各 WAN 行 ndProxy；Spoke 看 wanNdProxy。
 */
export function validateWanNdProxyIntent(values: {
  sidPrefix?: unknown;
  wanNdProxy?: boolean;
  wanDev?: string;
  hubWanInventory?: Array<{ ifName?: string; ndProxy?: boolean }>;
}): string | null {
  const wants = collectWanNdProxyIfNames(values);
  if (!wants.length) return null;
  const host = ndProxySidHostFromPrefix(values.sidPrefix);
  if (!host) {
    return '已勾选 IPv6 ND Proxy，请先填写合法的 SRv6 SID 前缀（将作为代答地址）';
  }
  return null;
}

const uniqueIfaceNames = (names: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const key = ifaceKey(n);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(String(n || '').trim());
  }
  return out;
};

export function collectExistingWanNdProxyIfNames(cfg: Record<string, unknown> | null | undefined): string[] {
  if (!cfg || typeof cfg !== 'object') return [];
  const pe =
    cfg.pe && typeof cfg.pe === 'object' && !Array.isArray(cfg.pe)
      ? (cfg.pe as Record<string, unknown>)
      : {};
  const publicConfig =
    pe.publicConfig && typeof pe.publicConfig === 'object' && !Array.isArray(pe.publicConfig)
      ? (pe.publicConfig as Record<string, unknown>)
      : {};
  if (Array.isArray(publicConfig.wanNdProxyIfNames)) {
    return uniqueIfaceNames(publicConfig.wanNdProxyIfNames.map((n) => String(n ?? '').trim()).filter(Boolean));
  }
  const fromIfaces: string[] = [];
  for (const key of IFACE_ARRAY_KEYS) {
    const arr = cfg[key];
    if (!Array.isArray(arr)) continue;
    for (const row of arr) {
      if (!row || typeof row !== 'object') continue;
      const rec = row as Record<string, unknown>;
      if (!String(rec.ipv6_nd_proxy ?? '').trim()) continue;
      const name = String(rec.name ?? '').trim();
      if (name) fromIfaces.push(name);
    }
  }
  if (fromIfaces.length) return uniqueIfaceNames(fromIfaces);
  if (publicConfig.wanNdProxy) {
    const wan = String(publicConfig.wanName || publicConfig.wanDev || '').trim();
    return wan ? [wan] : [];
  }
  return [];
}

export function wanNdProxySelectionEqual(a: string[], b: string[]): boolean {
  const norm = (xs: string[]) =>
    [...new Set(xs.map((n) => ifaceKey(n)).filter(Boolean))].sort();
  const left = norm(a);
  const right = norm(b);
  return left.length === right.length && left.every((x, i) => x === right[i]);
}

/** 隧道引用窄通道：勾选集合或代答地址相对现网是否真有变化 */
export function wanNdProxyIntentDiffers(
  cfg: Record<string, unknown> | null | undefined,
  values: {
    sidPrefix?: unknown;
    wanNdProxy?: boolean;
    wanDev?: string;
    hubWanInventory?: Array<{ ifName?: string; ndProxy?: boolean }>;
  },
): boolean {
  const want = collectWanNdProxyIfNames(values);
  const have = collectExistingWanNdProxyIfNames(cfg);
  if (!wanNdProxySelectionEqual(want, have)) return true;
  if (!want.length) return false;
  const wantHost = ndProxySidHostFromPrefix(values.sidPrefix);
  const root = cfg && typeof cfg === 'object' ? cfg : {};
  for (const key of IFACE_ARRAY_KEYS) {
    const arr = root[key];
    if (!Array.isArray(arr)) continue;
    for (const row of arr) {
      if (!row || typeof row !== 'object') continue;
      const rec = row as Record<string, unknown>;
      const name = String(rec.name ?? '').trim();
      if (!wanNdProxyEnabledOn(name, want)) continue;
      if (String(rec.ipv6_nd_proxy ?? '').trim() !== wantHost) return true;
    }
  }
  return false;
}

export function collectWanNdProxyIfNames(values: {
  wanNdProxy?: boolean;
  wanDev?: string;
  hubWanInventory?: Array<{ ifName?: string; ndProxy?: boolean }>;
}): string[] {
  const hub = Array.isArray(values.hubWanInventory) ? values.hubWanInventory : [];
  const hubNamed = hub.filter((row) => String(row?.ifName || '').trim());
  // Hub 表单只要出现命名 WAN 行就按行勾选；空占位 [{}] 不抢 Spoke 语义
  if (hubNamed.length) {
    return hubNamed
      .filter((row) => Boolean(row?.ndProxy))
      .map((row) => String(row.ifName || '').trim())
      .filter(Boolean);
  }
  const wan = String(values.wanDev || '').trim();
  return values.wanNdProxy && wan ? [wan] : [];
}

export function wanNdProxyEnabledOn(ifName: string, proxyIfNames: unknown): boolean {
  const want = ifaceKey(ifName);
  if (!want || !Array.isArray(proxyIfNames)) return false;
  const wantTight = want.replace(/\s/g, '');
  return proxyIfNames.some((n) => {
    const got = ifaceKey(String(n || ''));
    return got === want || got.replace(/\s/g, '') === wantTight;
  });
}
