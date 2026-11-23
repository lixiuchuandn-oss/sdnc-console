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
function extractPePublicIpv6(cfg: unknown): string | undefined {
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

  const publicRoutes = listPublicIpv6Routes(c);
  const ordered = [
    ...publicRoutes.filter((r) => String(r.destination ?? '').trim() === '::/0'),
    ...publicRoutes.filter((r) => String(r.destination ?? '').trim() !== '::/0'),
  ];
  for (const row of ordered) {
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

/** 展开为 8 个 hextet 数值，便于按前缀位比较 */
export function expandIpv6Hextets(addr: string): number[] | null {
  const clean = String(addr || '')
    .replace(/\/\d+$/, '')
    .trim()
    .toLowerCase();
  if (!clean || !clean.includes(':')) return null;
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
  if (groups.length !== 8) return null;
  const nums = groups.map((g) => parseInt(g, 16));
  if (nums.some((n) => !Number.isFinite(n) || n < 0 || n > 0xffff)) return null;
  return nums;
}

/** host 是否落在 cidr（如 2200::/64）内 */
export function isIpv6HostInCidr(host: string, cidr: string): boolean {
  const raw = String(cidr || '').trim();
  const slash = raw.lastIndexOf('/');
  if (slash <= 0) return false;
  const net = raw.slice(0, slash).trim();
  const plen = Number(raw.slice(slash + 1));
  if (!net || !Number.isFinite(plen) || plen < 0 || plen > 128) return false;
  const hostGroups = expandIpv6Hextets(host);
  const netGroups = expandIpv6Hextets(net);
  if (!hostGroups || !netGroups) return false;
  let bitsLeft = Math.trunc(plen);
  for (let i = 0; i < 8 && bitsLeft > 0; i++) {
    const take = Math.min(16, bitsLeft);
    const shift = 16 - take;
    const mask = take === 16 ? 0xffff : (0xffff << shift) & 0xffff;
    if ((hostGroups[i]! & mask) !== (netGroups[i]! & mask)) return false;
    bitsLeft -= take;
  }
  return true;
}

export const SID64_VIA_IN_DEST_MESSAGE =
  '无法为该 PE 注入到对端 SID 前缀的静态路由：下一跳落在目的网段内，设备不会按该路由转发。请先在该 PE 角色向导「静态路由（WAN）」填写公网 IPv6 网关（上游下一跳，且不得落在 SID 前缀内）。';

export const SID64_SKIP_ONLINK_MESSAGE =
  '对端 SID 前缀与本端公网同网段，已省略 SID 静态路由（接口直连可达）。';

export type Sid64RouteDecision = 'inject' | 'skip_onlink' | 'invalid';

export type Sid64InjectPlan = {
  sid?: { destination: string; via: string };
  sidDecision?: Sid64RouteDecision;
  vrfDefault?: { destination: string; vrf: number | string; via: string };
};

export function formatSid64RouteSnippet(destination?: string, via?: string): string | undefined {
  const dest = String(destination ?? '').trim();
  const hop = String(via ?? '').trim();
  if (!dest || !hop) return undefined;
  return `{ "destination": "${dest}", "via": "${hop}" }`;
}

export function describeSid64InvalidRoute(destination?: string, via?: string): string {
  const snippet = formatSid64RouteSnippet(destination, via);
  const inject = snippet ? `\n本将随隧道注入 ipv6_route：${snippet}。因下一跳落在 SID 目的网段内，该路由无效，已拦截。` : '';
  return `${SID64_VIA_IN_DEST_MESSAGE}${inject}`;
}

export function formatSid64InjectPlanNote(plan?: Sid64InjectPlan): string | undefined {
  if (!plan?.sid && !plan?.vrfDefault) return undefined;
  const lines: string[] = [];
  if (plan.sid) {
    const snippet = formatSid64RouteSnippet(plan.sid.destination, plan.sid.via);
    if (plan.sidDecision === 'invalid') {
      lines.push(`SID 前缀路由（拦截未下发）：${snippet}`);
    } else if (plan.sidDecision === 'skip_onlink') {
      lines.push('SID 前缀路由：已省略（本端公网与对端 SID 同网段，直连可达）');
    } else if (snippet) {
      lines.push(`SID 前缀路由：${snippet}`);
    }
  }
  if (plan.vrfDefault) {
    const held = plan.sidDecision === 'invalid' ? '（SID 拦截时本端暂不注入）' : '';
    lines.push(
      `VRF 默认路由：{ "destination": "${plan.vrfDefault.destination}", "vrf": ${JSON.stringify(
        plan.vrfDefault.vrf,
      )}, "via": "${plan.vrfDefault.via}" }${held}`,
    );
  }
  return lines.join('\n');
}

/**
 * SID 前缀静态路由下一跳：via 不得落在 destination 网段内。
 * @returns 错误文案；合法则 undefined
 */
export function validateSid64NextHop(destination?: string, via?: string): string | undefined {
  const dest = String(destination ?? '').trim();
  const hop = String(via ?? '').trim();
  if (!dest || !hop) return undefined;
  if (/^nexthop-vrf/i.test(hop)) return undefined;
  if (!hop.includes(':') || !dest.includes(':')) return undefined;
  if (isIpv6HostInCidr(hop, dest)) return SID64_VIA_IN_DEST_MESSAGE;
  return undefined;
}

/**
 * 直连同网段：本端 WAN 也在对端 SID 前缀内 → 省略 SID 静态路由（connected 已覆盖）。
 * 跨网段且 via 落在 SID 前缀内 → 仍拦截（缺 WAN 网关）。
 */
export function decideSid64Route(
  destination?: string,
  via?: string,
  localWanIpv6?: string,
): { decision: Sid64RouteDecision; message?: string } {
  const invalid = validateSid64NextHop(destination, via);
  if (!invalid) return { decision: 'inject' };
  const dest = String(destination ?? '').trim();
  const local = String(localWanIpv6 ?? '')
    .trim()
    .split('/')[0];
  if (local && dest && isIpv6HostInCidr(local, dest)) {
    return { decision: 'skip_onlink', message: SID64_SKIP_ONLINK_MESSAGE };
  }
  return { decision: 'invalid', message: describeSid64InvalidRoute(destination, via) };
}

export function assertValidSid64NextHop(
  destination?: string,
  via?: string,
  localWanIpv6?: string,
): Sid64RouteDecision {
  const decided = decideSid64Route(destination, via, localWanIpv6);
  if (decided.decision === 'invalid') {
    throw new Error(decided.message || SID64_VIA_IN_DEST_MESSAGE);
  }
  return decided.decision;
}

/** PE-A / PE-B 同类说明去重：原因完全相同时 PE-B 只标「同 PE-A」。 */
export function formatPairedEndpointNotes(peA?: string, peB?: string): string | undefined {
  if (!peA && !peB) return undefined;
  if (peA && peB) {
    if (peA === peB) return `PE-A：${peA}\nPE-B：同 PE-A`;
    return `PE-A：${peA}\nPE-B：${peB}`;
  }
  if (peA) return `PE-A：${peA}`;
  return `PE-B：${peB}`;
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

/** 对端 SID → ipv6_route.destination；带掩码且 plen∈[40,88] 时用该 plen，否则 /64 */
export function buildSrv6PeerRouteDestination(peerSidPrefix: string | undefined): string | undefined {
  const raw = String(peerSidPrefix ?? '').trim();
  if (!raw) return undefined;
  const parts = raw.split('/');
  const host = parts[0]?.trim();
  if (!host) return undefined;
  let plen = 64;
  if (parts.length > 1) {
    const n = Number(parts[1]);
    if (Number.isFinite(n) && n >= 40 && n <= 88) plen = Math.trunc(n);
  }
  const net = maskToIpv6Network(host, plen);
  return net ? `${net}/${plen}` : undefined;
}
