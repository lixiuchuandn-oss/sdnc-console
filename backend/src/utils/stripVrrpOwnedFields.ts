/**
 * SRv6 账本/公式对账忽略：
 * - HA VRRP（顶层 vrrp[] 与接口行 vrrp）
 * - 接口 ipv6_nd_proxy（PE 向导/窄通道全量 POST 负责启停；SRv6 账本不拥有、不校正）
 * 不修改入参。
 */

const isIfaceArrayKey = (key: string): boolean =>
  key === 'interface' ||
  key === 'interfaces' ||
  key.startsWith('interfaces_') ||
  key.startsWith('subinterfaces_');

export const stripVrrpOwnedFields = (config: unknown): unknown => {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return config;
  const src = config as Record<string, unknown>;
  const out: Record<string, unknown> = { ...src };
  delete out.vrrp;
  for (const key of Object.keys(out)) {
    if (!isIfaceArrayKey(key) || !Array.isArray(out[key])) continue;
    out[key] = (out[key] as unknown[]).map((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
      const rec = row as Record<string, unknown>;
      if (
        !Object.prototype.hasOwnProperty.call(rec, 'vrrp') &&
        !Object.prototype.hasOwnProperty.call(rec, 'ipv6_nd_proxy')
      ) {
        return row;
      }
      const { vrrp: _vrrp, ipv6_nd_proxy: _ndProxy, ...rest } = rec;
      return rest;
    });
  }
  return out;
};
