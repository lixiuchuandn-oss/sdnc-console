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
  if (!enabled) return false;
  const host = ndProxySidHostFromPrefix(sidPrefix);
  if (!host) return false;
  item.ipv6_nd_proxy = host;
  return true;
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

const ifaceKey = (name: string): string =>
  String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

export function wanNdProxyEnabledOn(ifName: string, proxyIfNames: unknown): boolean {
  const want = ifaceKey(ifName);
  if (!want || !Array.isArray(proxyIfNames)) return false;
  const wantTight = want.replace(/\s/g, '');
  return proxyIfNames.some((n) => {
    const got = ifaceKey(String(n || ''));
    return got === want || got.replace(/\s/g, '') === wantTight;
  });
}
