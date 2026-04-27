/**
 * IPv4 / CIDR 轻量工具（无第三方依赖）。
 *
 * 用于子网 CIDR 重叠判断、主机地址是否落在网段内等场景；
 * 与 Harvester / Kube-OVN 子网直连 handler 中的历史算法保持一致。
 */

/** 点分十进制 IPv4 → 32 位无符号整数 */
export function ipv4ToUint32(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

/**
 * 解析 IPv4 CIDR，返回闭区间 [网络地址, 广播地址] 的 uint32 表示。
 * 非法格式返回 null。
 */
export function ipv4CidrToUint32Range(cidr: string): [number, number] | null {
  try {
    const [ip, mask] = cidr.split('/');
    const maskNum = parseInt(mask, 10);
    if (Number.isNaN(maskNum) || maskNum < 0 || maskNum > 32) return null;
    const ipNum = ipv4ToUint32(ip);
    const hostBits = 32 - maskNum;
    const start = (ipNum >>> hostBits) << hostBits;
    const end = start + 2 ** hostBits - 1;
    return [start >>> 0, end >>> 0];
  } catch {
    return null;
  }
}

/** 两个 uint32 闭区间是否相交（含端点） */
export function ipv4Uint32RangesOverlap(r1: [number, number], r2: [number, number]): boolean {
  return Math.max(r1[0], r2[0]) <= Math.min(r1[1], r2[1]);
}
