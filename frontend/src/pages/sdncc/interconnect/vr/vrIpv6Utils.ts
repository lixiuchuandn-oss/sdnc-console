/**
 * VR3 / 设备回读 IPv6 字段解析：剔除 fe80:: 链路本地，并处理多地址粘连（换行、空格、/64 后直接接下一段等）。
 */

/** 将 VR3 多地址文本拆成单条 token（可为 CIDR） */
export function splitIpv6AddressTokens(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.flatMap((item) => splitIpv6AddressTokens(item));
  }
  const s = String(raw).trim();
  if (!s) return [];

  let normalized = s.replace(/\r\n/g, '\n');
  if (/[\s,;]/.test(normalized)) {
    return normalized
      .split(/[\s,;]+/)
      .map((t) => t.trim())
      .filter(Boolean);
  }

  // VR3 常见：fe80::.../64 与 203::22/64 粘在同一行（仅 /64、/128 后紧跟下一段全局 IPv6）
  const withBreaks = normalized.replace(
    /\/(64|128)(?=(?:fe80:|[2-9a-fA-F][0-9a-fA-F]*:))/gi,
    '/$1\n',
  );
  if (withBreaks.includes('\n')) {
    normalized = withBreaks;
    return normalized
      .split(/\n+/)
      .map((t) => t.trim())
      .filter(Boolean);
  }

  return [normalized];
}

const isLinkLocalToken = (token: string): boolean => {
  const host = token.split('/')[0].trim().toLowerCase();
  return !host || host.startsWith('fe80');
};

/** 返回第一个非 fe80:: 的全局 IPv6（保留 /prefix）；无则空串 */
export function filterLinkLocalIpv6(raw: unknown): string {
  const tokens = splitIpv6AddressTokens(raw);
  return tokens.find((t) => !isLinkLocalToken(t)) ?? '';
}

/** 从 VR3 接口对象取 IPv6（已过滤链路本地） */
export function pickIfaceIpv6FromDevice(iface: any): string {
  const raw =
    iface?.ipv6_static ??
    iface?.ipv6Static ??
    iface?.ipv6 ??
    iface?.ipv6_address ??
    iface?.ipv6Address ??
    '';
  return filterLinkLocalIpv6(raw);
}
