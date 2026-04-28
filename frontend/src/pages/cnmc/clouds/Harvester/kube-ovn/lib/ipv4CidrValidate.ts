/**
 * IPv4 + CIDR 校验（Kube-OVN 子网排除 IP 等场景复用）
 */

function ipv4ToInt(ip: string): number | null {
  const m = ip.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const p = [m[1], m[2], m[3], m[4]].map((x) => Number(x));
  if (p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}

export function ipv4InCidr(ip: string, cidr: string): boolean {
  const parts = cidr.trim().split('/');
  if (parts.length !== 2) return false;
  const prefix = ipv4ToInt(parts[0]);
  const bits = Number(parts[1]);
  if (prefix === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const host = ipv4ToInt(ip);
  if (host === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (host & mask) === (prefix & mask);
}

function ipv4InRange(ip: string, start: string, end: string): boolean {
  const a = ipv4ToInt(start);
  const b = ipv4ToInt(end);
  const x = ipv4ToInt(ip);
  if (a === null || b === null || x === null) return false;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return x >= lo && x <= hi;
}

/**
 * 校验单条排除项是否落在子网 CIDR 内。
 * 支持：单 IPv4、`a.b.c.d..a.b.c.e`（Kube-OVN 区间写法，两个点）。
 */
export function validateExcludeIpWithinCidr(cidrBlock: string, entry: string): string | null {
  const cidr = String(cidrBlock || '').trim();
  const raw = String(entry || '').trim();
  if (!raw) return null;
  if (!cidr.includes('/')) return '请先填写有效的子网 CIDR';

  if (raw.includes('..')) {
    const parts = raw.split('..').map((s) => s.trim());
    if (parts.length !== 2) {
      return `排除 IP「${raw}」格式无效（区间请使用 .. 连接两个 IPv4）`;
    }
    const [a, b] = parts;
    if (!ipv4ToInt(a) || !ipv4ToInt(b)) {
      return `排除 IP「${raw}」不是有效的 IPv4 区间`;
    }
    if (!ipv4InCidr(a, cidr) || !ipv4InCidr(b, cidr)) {
      return `排除 IP「${raw}」须完全落在子网 CIDR「${cidr}」内`;
    }
    return null;
  }

  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(raw)) {
    if (!ipv4InCidr(raw, cidr)) {
      return `排除 IP「${raw}」须落在子网 CIDR「${cidr}」内`;
    }
    return null;
  }

  return `排除 IP「${raw}」不是有效的 IPv4 或区间写法`;
}
