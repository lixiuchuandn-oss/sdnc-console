/**
 * SRv6 对端 SID 静态路由 destination：按 /64 网段截断（非完整 SID 主机位 + /64）。
 * §14.14.1：SID/64 via 择优（本端 WAN IPv6 网关 → 对端 PE 公网 IPv6 直连）。
 */

const trimIpv6Host = (raw?: string): string | undefined => {
  const s = String(raw ?? '').trim();
  if (!s) return undefined;
  const host = s.split('/')[0]?.trim();
  if (!host || host.toLowerCase().startsWith('fe80:')) return undefined;
  return host;
};

/** 从 PE 配置取公网口（第一个接口）IPv6 主机地址 */
export function extractPePublicIpv6(cfg: unknown): string | undefined {
  if (!cfg || typeof cfg !== 'object') return undefined;
  const c = cfg as Record<string, unknown>;
  for (const k of Object.keys(c)) {
    if (!k.startsWith('interfaces_') && !k.startsWith('subinterfaces_')) continue;
    const arr = c[k];
    if (!Array.isArray(arr) || !arr[0]) continue;
    const ip = trimIpv6Host(
      (arr[0] as Record<string, unknown>)?.ipv6_static as string | undefined ||
        ((arr[0] as Record<string, unknown>)?.ipv6 as string | undefined),
    );
    if (ip) return ip;
  }
  return trimIpv6Host(c.ipv6_static as string | undefined || (c.ipv6 as string | undefined));
}

const pickPublicIpv6RouteVia = (row: Record<string, unknown>): string | undefined => {
  const vrf = row.vrf;
  if (vrf !== undefined && vrf !== null && vrf !== '' && Number(vrf) !== 0) return undefined;
  const viaRaw = String(row.via ?? '').trim();
  if (!viaRaw || /^nexthop-vrf/i.test(viaRaw)) return undefined;
  const host = trimIpv6Host(viaRaw);
  return host && host.includes(':') ? host : undefined;
};

const listPublicIpv6Routes = (cfg: Record<string, unknown>): Record<string, unknown>[] => {
  const routes = cfg.ipv6_route;
  if (!Array.isArray(routes)) return [];
  return routes.filter(
    (item) => item && typeof item === 'object' && !!pickPublicIpv6RouteVia(item as Record<string, unknown>),
  ) as Record<string, unknown>[];
};

/** Hub 多 WAN：inventory 顺序或 ipv4_route.dev 对齐的 WAN 序号 */
const hubWanOrdinalIndex = (cfg: Record<string, unknown>, wanIf: string): number => {
  const inv = cfg._towerHubInventory as { wan?: Array<{ ifName?: string }> } | undefined;
  const invWan = inv?.wan;
  if (Array.isArray(invWan)) {
    const idx = invWan.findIndex((w) => String(w.ifName ?? '').trim() === wanIf);
    if (idx >= 0) return idx;
  }
  const v4 = cfg.ipv4_route;
  if (Array.isArray(v4)) {
    const idx = v4.findIndex(
      (r) => r && typeof r === 'object' && String((r as Record<string, unknown>).dev ?? '').trim() === wanIf,
    );
    if (idx >= 0) return idx;
  }
  return -1;
};

/**
 * 本端基线中公网 IPv6 静态路由的 via（IPv6 网关）。
 * 仅认无 vrf 且 via 为有效 IPv6（非 nexthop-vrf）。
 * Hub 多 WAN：优先 inventory.ipv6Via → 与 WAN 同序的 ipv6_route → 首条公网路由。
 */
export function extractWanIpv6Gateway(cfg: unknown, wanIf?: string): string | undefined {
  if (!cfg || typeof cfg !== 'object') return undefined;
  const c = cfg as Record<string, unknown>;
  const wanIfNorm = String(wanIf ?? '').trim();

  if (wanIfNorm) {
    const inv = c._towerHubInventory as
      | { wan?: Array<{ ifName?: string; ipv6Via?: string; ipv6Dest?: string }> }
      | undefined;
    const invHit = inv?.wan?.find((w) => String(w.ifName ?? '').trim() === wanIfNorm);
    const invVia = trimIpv6Host(invHit?.ipv6Via);
    if (invVia) return invVia;

    const routes = c.ipv6_route;
    const invDest = String(invHit?.ipv6Dest ?? '').trim();
    if (invDest && Array.isArray(routes)) {
      for (const item of routes) {
        if (!item || typeof item !== 'object') continue;
        const row = item as Record<string, unknown>;
        if (String(row.destination ?? '').trim() !== invDest) continue;
        const via = pickPublicIpv6RouteVia(row);
        if (via) return via;
      }
    }

    const ordinal = hubWanOrdinalIndex(c, wanIfNorm);
    const publicRoutes = listPublicIpv6Routes(c);
    if (ordinal >= 0 && publicRoutes[ordinal]) {
      const via = pickPublicIpv6RouteVia(publicRoutes[ordinal]);
      if (via) return via;
    }

    // 兼容旧平台库中残留的 ipv6_route.dev（下发前已剥离）
    if (Array.isArray(routes)) {
      for (const item of routes) {
        if (!item || typeof item !== 'object') continue;
        const row = item as Record<string, unknown>;
        if (String(row.dev ?? '').trim() !== wanIfNorm) continue;
        const via = pickPublicIpv6RouteVia(row);
        if (via) return via;
      }
    }
  }

  for (const row of listPublicIpv6Routes(c)) {
    const via = pickPublicIpv6RouteVia(row);
    if (via) return via;
  }
  return undefined;
}

/** SID/64 路由 via：本端已配 IPv6 网关则用网关，否则对端 PE 公网 IPv6（直连） */
export function resolveSid64Via(selfCfg: unknown, peerCfg: unknown, wanIf?: string): string | undefined {
  const gateway = extractWanIpv6Gateway(selfCfg, wanIf);
  if (gateway) return gateway;
  return extractPePublicIpv6(peerCfg);
}

/** 将 IPv6 主机地址按 prefixLen 掩码为网段地址（不含 /prefix 后缀） */
export function maskToIpv6Network(addr: string, prefixLen: number): string {
  try {
    const clean = String(addr || '')
      .replace(/\/\d+$/, '')
      .trim();
    if (!clean) return '';

    const halves = clean.split('::');
    let groups: string[];
    if (halves.length === 2) {
      const left = halves[0] ? halves[0].split(':').filter((g) => g.length > 0) : [];
      const right = halves[1] ? halves[1].split(':').filter((g) => g.length > 0) : [];
      const fillLen = Math.max(0, 8 - left.length - right.length);
      groups = [...left, ...Array(fillLen).fill('0'), ...right];
    } else {
      groups = clean.split(':').filter((g) => g.length > 0);
      while (groups.length < 8) groups.push('0');
    }

    if (groups.length !== 8) return clean;

    if (prefixLen < 0 || prefixLen > 128) return clean;

    const fullGroups = Math.floor(prefixLen / 16);
    const partialBits = prefixLen % 16;
    for (let i = 0; i < 8; i++) {
      if (i < fullGroups) continue;
      if (i === fullGroups && partialBits > 0) {
        const val = parseInt(groups[i], 16) || 0;
        const keepMask = (0xffff << (16 - partialBits)) & 0xffff;
        groups[i] = (val & keepMask).toString(16);
      } else {
        groups[i] = '0';
      }
    }

    let bestStart = -1;
    let bestLen = 0;
    let curStart = -1;
    let curLen = 0;
    for (let i = 0; i < 8; i++) {
      if (groups[i] === '0') {
        if (curStart < 0) curStart = i;
        curLen = i - curStart + 1;
        if (curLen > bestLen) {
          bestStart = curStart;
          bestLen = curLen;
        }
      } else {
        curStart = -1;
      }
    }
    if (bestLen >= 2) {
      const left = groups.slice(0, bestStart).join(':');
      const right = groups.slice(bestStart + bestLen).join(':');
      return right ? `${left}::${right}` : `${left}::`;
    }
    return groups.join(':');
  } catch {
    return String(addr || '').replace(/\/\d+$/, '').trim();
  }
}

/** 对端 SID → ipv6_route.destination（形如 240f:2033::/64） */
export function buildSrv6PeerRouteDestination(peerSidPrefix: string | undefined): string | undefined {
  const raw = String(peerSidPrefix ?? '').trim();
  if (!raw) return undefined;
  const host = raw.split('/')[0].trim();
  if (!host) return undefined;
  const net = maskToIpv6Network(host, 64);
  return net ? `${net}/64` : undefined;
}
