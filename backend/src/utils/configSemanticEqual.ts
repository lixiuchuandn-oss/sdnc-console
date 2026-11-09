/**
 * VR2 / 平台配置的语义比较：忽略 CSM 包装字段与对象 key 顺序，按业务结构比。
 * 供 SRv6 对账、下发漂移检测共用。
 */

export const CONFIG_META_KEYS = new Set([
  'msg',
  'code',
  'report_config_status',
  'updateDate',
  'createDate',
  '_id',
  'requestId',
  '_towerHubInventory',
  '_towerLocalMeta',
]);

export type ConfigSemanticDiffKind = 'added' | 'removed' | 'changed';

export type ConfigSemanticDiff = {
  path: string;
  kind: ConfigSemanticDiffKind;
  left?: unknown;
  right?: unknown;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export const isSemanticEmpty = (value: unknown): boolean => {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) {
    return Object.keys(value).every(
      (k) => CONFIG_META_KEYS.has(k) || isSemanticEmpty(value[k]),
    );
  }
  return false;
};

const preview = (value: unknown): string => {
  if (value == null) return '空';
  try {
    const s = JSON.stringify(value);
    return s.length > 160 ? `${s.slice(0, 157)}...` : s;
  } catch {
    return String(value);
  }
};

const joinPath = (base: string, part: string): string => (base ? `${base}.${part}` : part);

const indexPath = (base: string, index: number): string => `${base || '$'}[${index}]`;

const normStr = (value: unknown): string => String(value ?? '').trim().toLowerCase();

/** 数组元素指纹：能稳定配对则按业务身份，否则退回整段规范化 JSON */
const itemFingerprint = (item: unknown): string | null => {
  if (!isPlainObject(item)) return null;
  if (item.remote_ip != null && String(item.remote_ip).trim() !== '') {
    return `ip:${normStr(item.remote_ip)}`;
  }
  if (item.destination != null && String(item.destination).trim() !== '') {
    return `rt:${String(item.destination)}|${String(item.via ?? '')}|${String(item.vrf ?? '')}`;
  }
  if (item.name != null && String(item.name).trim() !== '') {
    return `name:${String(item.name).trim()}`;
  }
  if (item.ID != null) return `ID:${String(item.ID)}`;
  if (item.acl_id != null) return `acl:${String(item.acl_id)}`;
  if (item.group_id != null) return `ag:${String(item.group_id)}`;
  if (typeof item.address_family === 'string' && item.address_family.trim() !== '') {
    const mod = item.modifiler ?? item.modifier ?? '';
    return `af:${normStr(item.address_family)}|${normStr(mod)}`;
  }
  if (item.asn != null) {
    return `bgp:${String(item.vrf ?? '')}|${String(item.asn)}|${String(item.router_id ?? '')}`;
  }
  return null;
};

const allFingerprinted = (arr: unknown[]): boolean =>
  arr.length > 0 && arr.every((item) => itemFingerprint(item) != null);

export const canonicalizeConfigJson = (value: unknown): unknown => {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map((item) => canonicalizeConfigJson(item));
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      if (CONFIG_META_KEYS.has(key)) continue;
      const child = value[key];
      if (typeof child === 'undefined') continue;
      out[key] = canonicalizeConfigJson(child);
    }
    return out;
  }
  return value;
};

export const configSemanticEqual = (a: unknown, b: unknown): boolean =>
  JSON.stringify(canonicalizeConfigJson(a)) === JSON.stringify(canonicalizeConfigJson(b));

const diffInto = (left: unknown, right: unknown, path: string, out: ConfigSemanticDiff[]): void => {
  if (configSemanticEqual(left, right)) return;
  if (isSemanticEmpty(left) && isSemanticEmpty(right)) return;

  if (isSemanticEmpty(left) && !isSemanticEmpty(right)) {
    out.push({ path: path || '$', kind: 'added', right });
    return;
  }
  if (!isSemanticEmpty(left) && isSemanticEmpty(right)) {
    out.push({ path: path || '$', kind: 'removed', left });
    return;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    const leftPrim = left.every((x) => x == null || typeof x !== 'object');
    const rightPrim = right.every((x) => x == null || typeof x !== 'object');
    if (leftPrim && rightPrim) {
      const lset = new Set(left.map((x) => JSON.stringify(x)));
      const rset = new Set(right.map((x) => JSON.stringify(x)));
      for (const item of left) {
        const k = JSON.stringify(item);
        if (!rset.has(k)) out.push({ path: path || '$', kind: 'removed', left: item });
      }
      for (const item of right) {
        const k = JSON.stringify(item);
        if (!lset.has(k)) out.push({ path: path || '$', kind: 'added', right: item });
      }
      return;
    }

    if (allFingerprinted(left) && allFingerprinted(right)) {
      const rightMap = new Map<string, unknown>();
      const rightDup = new Set<string>();
      for (const item of right) {
        const fp = itemFingerprint(item)!;
        if (rightMap.has(fp)) rightDup.add(fp);
        rightMap.set(fp, item);
      }
      const leftMap = new Map<string, unknown>();
      const leftDup = new Set<string>();
      for (const item of left) {
        const fp = itemFingerprint(item)!;
        if (leftMap.has(fp)) leftDup.add(fp);
        leftMap.set(fp, item);
      }
      if (rightDup.size === 0 && leftDup.size === 0) {
        for (const [fp, litem] of leftMap) {
          if (!rightMap.has(fp)) {
            out.push({ path: path || '$', kind: 'removed', left: litem });
          } else {
            diffInto(litem, rightMap.get(fp), path, out);
          }
        }
        for (const [fp, ritem] of rightMap) {
          if (!leftMap.has(fp)) out.push({ path: path || '$', kind: 'added', right: ritem });
        }
        return;
      }
    }

    const n = Math.max(left.length, right.length);
    for (let i = 0; i < n; i += 1) {
      const lp = indexPath(path, i);
      if (i >= left.length) out.push({ path: lp, kind: 'added', right: right[i] });
      else if (i >= right.length) out.push({ path: lp, kind: 'removed', left: left[i] });
      else diffInto(left[i], right[i], lp, out);
    }
    return;
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
      if (CONFIG_META_KEYS.has(key)) continue;
      diffInto(left[key], right[key], joinPath(path, key), out);
    }
    return;
  }

  out.push({ path: path || '$', kind: 'changed', left, right });
};

export const diffConfigSemantic = (left: unknown, right: unknown): ConfigSemanticDiff[] => {
  const out: ConfigSemanticDiff[] = [];
  diffInto(left, right, '', out);
  return out;
};

/**
 * 业务语义相等：树形 diff 为空即相等（忽略对象 key 顺序、元数据，并按指纹配对数组项）。
 * 用于 SRv6 账本 vs 公式对账；勿用于 ACL/NAT 等「顺序即策略」的域。
 */
export const configBusinessEqual = (a: unknown, b: unknown): boolean =>
  diffConfigSemantic(a, b).length === 0;

export const hasDestructiveSemanticDiff = (diffs: ConfigSemanticDiff[]): boolean =>
  diffs.some((d) => d.kind === 'removed' || d.kind === 'changed');

export const formatConfigSemanticDiffs = (
  diffs: ConfigSemanticDiff[],
  options?: { leftLabel?: string; rightLabel?: string; limit?: number },
): string => {
  const leftLabel = options?.leftLabel ?? '左侧';
  const rightLabel = options?.rightLabel ?? '右侧';
  const limit = options?.limit ?? 4;
  const shown = diffs.slice(0, limit);
  const lines = shown.map((d) => {
    if (d.kind === 'added') return `${d.path}：${rightLabel}多出 ${preview(d.right)}`;
    if (d.kind === 'removed') return `${d.path}：${leftLabel}多出 ${preview(d.left)}`;
    return `${d.path}：${leftLabel}=${preview(d.left)}，${rightLabel}=${preview(d.right)}`;
  });
  if (diffs.length > limit) lines.push(`…另有 ${diffs.length - limit} 处`);
  return lines.join('；');
};
