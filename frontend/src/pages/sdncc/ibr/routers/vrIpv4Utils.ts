/**
 * VR3 / 设备回读 IPv4 字段解析：多地址（主地址 + VRRP VIP 等）拆 token，向导只取第一条主 CIDR。
 */

const IPV4_OCTET = '(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])';
const IPV4_HOST = `${IPV4_OCTET}(?:\\.${IPV4_OCTET}){3}`;
/** 掩码须长匹配优先，避免 /24 被 [0-9] 吃成 /2 */
const IPV4_PREFIX = '(?:3[0-2]|[12]\\d|\\d)';
/** 带掩码的 CIDR（用于粘连串全局提取，避免把 /24 误切成 /2） */
const IPV4_CIDR_FIND = new RegExp(`${IPV4_HOST}\\/${IPV4_PREFIX}`, 'g');
const IPV4_TOKEN_PATTERN = new RegExp(`^${IPV4_HOST}(?:\\/${IPV4_PREFIX})?$`);

/** 将 VR3 多地址文本拆成单条 token（可为 CIDR） */
export function splitIpv4AddressTokens(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.flatMap((item) => splitIpv4AddressTokens(item));
  }
  const s = String(raw).trim();
  if (!s) return [];

  const normalized = s.replace(/\r\n/g, '\n');
  if (/[\s,;]/.test(normalized)) {
    return normalized
      .split(/[\s,;]+/)
      .map((t) => t.trim())
      .filter(Boolean);
  }

  // VR3/展示层常见：34.1.1.3/2434.1.1.254/24（无分隔符粘连）——按完整 CIDR 提取
  const jammed = normalized.match(IPV4_CIDR_FIND);
  if (jammed && jammed.length > 0) return jammed;

  return [normalized];
}

/** 返回第一条合法 IPv4（保留 /prefix）；无则空串 */
export function pickPrimaryIpv4Cidr(raw: unknown): string {
  const tokens = splitIpv4AddressTokens(raw);
  return tokens.find((t) => IPV4_TOKEN_PATTERN.test(t)) ?? '';
}

/** 从 VR3 接口对象取主 IPv4（多地址时取第一条） */
export function pickIfaceIpv4FromDevice(iface: any): string {
  const raw =
    iface?.ipv4_static ??
    iface?.ipv4Static ??
    iface?.ipv4 ??
    iface?.ipv4_address ??
    iface?.ipv4Address ??
    iface?.ip_address ??
    iface?.ipAddress ??
    iface?.ip ??
    iface?.address ??
    '';
  return pickPrimaryIpv4Cidr(raw);
}
