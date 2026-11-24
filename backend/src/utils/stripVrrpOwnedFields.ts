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

const mapIfaceRows = (
  config: Record<string, unknown>,
  mapRow: (row: Record<string, unknown>) => Record<string, unknown>,
): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...config };
  for (const key of Object.keys(out)) {
    if (!isIfaceArrayKey(key) || !Array.isArray(out[key])) continue;
    out[key] = (out[key] as unknown[]).map((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
      return mapRow(row as Record<string, unknown>);
    });
  }
  return out;
};

/** 仅剥 HA VRRP 片（顶层 vrrp + 接口 vrrp）。保留 ipv6_nd_proxy（向导/SRv6 窄通道）。 */
export const stripHaVrrpSlice = (config: unknown): unknown => {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return config;
  const out = mapIfaceRows(config as Record<string, unknown>, (rec) => {
    if (!Object.prototype.hasOwnProperty.call(rec, 'vrrp')) return rec;
    const { vrrp: _vrrp, ...rest } = rec;
    return rest;
  });
  delete out.vrrp;
  return out;
};

/**
 * 冻结进 srv6BaselineJson 前去掉 HA VRRP，避免删隧道/recompute 把旧口令、priority 等盖回设备。
 * 解析失败则原样返回（调用方仍会因 JSON 非法在别处失败）。
 */
export const freezeSrv6BaselineJson = (raw: string): string => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return raw;
    return JSON.stringify(stripHaVrrpSlice(parsed));
  } catch {
    return raw;
  }
};

const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const ifaceNameOf = (row: Record<string, unknown>): string =>
  String(row.name ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const ifaceNamesEqualLoose = (a: string, b: string): boolean => {
  if (!a || !b) return false;
  if (a === b) return true;
  return a.replace(/\s/g, '') === b.replace(/\s/g, '');
};

/**
 * 把 source 上的 HA VRRP 片缝回 SRv6 公式，再写入共享 config_json。
 * 公式本身不拥有 VRRP；共享整机账本仍须保留邻域（HA）现网片，避免删隧道/对账写回把 HA 抹掉。
 * 不读 HA 组意图——只从 source（通常为下发前账本或 H0 合并后的设备底稿）拷贝。
 */
export const stitchHaVrrpSlice = (
  formula: unknown,
  source: unknown,
): Record<string, unknown> => {
  const base =
    formula && typeof formula === 'object' && !Array.isArray(formula)
      ? deepClone(formula as Record<string, unknown>)
      : {};
  const out = stripHaVrrpSlice(base) as Record<string, unknown>;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return out;
  const src = source as Record<string, unknown>;

  if (Array.isArray(src.vrrp) && src.vrrp.length > 0) {
    out.vrrp = deepClone(src.vrrp);
  }

  const srcIfaceIndex = new Map<string, Record<string, unknown>>();
  for (const key of Object.keys(src)) {
    if (!isIfaceArrayKey(key) || !Array.isArray(src[key])) continue;
    for (const row of src[key] as unknown[]) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
      const rec = row as Record<string, unknown>;
      const name = ifaceNameOf(rec);
      if (!name || !Object.prototype.hasOwnProperty.call(rec, 'vrrp')) continue;
      srcIfaceIndex.set(name, rec);
    }
  }
  if (srcIfaceIndex.size === 0) return out;

  for (const key of Object.keys(out)) {
    if (!isIfaceArrayKey(key) || !Array.isArray(out[key])) continue;
    out[key] = (out[key] as unknown[]).map((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
      const rec = row as Record<string, unknown>;
      const name = ifaceNameOf(rec);
      if (!name) return rec;
      let match: Record<string, unknown> | undefined = srcIfaceIndex.get(name);
      if (!match) {
        for (const [srcName, srcRow] of srcIfaceIndex) {
          if (ifaceNamesEqualLoose(name, srcName)) {
            match = srcRow;
            break;
          }
        }
      }
      if (!match || !Object.prototype.hasOwnProperty.call(match, 'vrrp')) return rec;
      return { ...rec, vrrp: deepClone(match.vrrp) };
    });
  }
  return out;
};

export const stripVrrpOwnedFields = (config: unknown): unknown => {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return config;
  const out = mapIfaceRows(config as Record<string, unknown>, (rec) => {
    if (
      !Object.prototype.hasOwnProperty.call(rec, 'vrrp') &&
      !Object.prototype.hasOwnProperty.call(rec, 'ipv6_nd_proxy')
    ) {
      return rec;
    }
    const { vrrp: _vrrp, ipv6_nd_proxy: _ndProxy, ...rest } = rec;
    return rest;
  });
  delete out.vrrp;
  return out;
};
