/**
 * SRv6 对端 SID 静态路由 destination：按 /64 网段截断（非完整 SID 主机位 + /64）。
 */

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
