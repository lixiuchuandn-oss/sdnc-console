/**
 * 与 GET /api/vr-instances/:uuid 聚合接口对齐（含 vr1 元数据、vr2_info、vr3_info 等）：
 *
 * 1）进入 PE/CE 等向导应调用该聚合接口拉全量。
 * 2）左侧「设备回读」仅展示/推断 vr2_info（pickDeviceBlobForLookup）。
 * 3）右侧「配置编辑」默认用 vr2_info 跟接口 IP 等；用户主动改「公网口」Select 时，
 *    该次对齐仅查 vr3_info（接口权威）。网卡下拉选项见 collectIfaceNamesForSelect（vr3 优先，vr2/基线兜底）。
 */

const IFC_NAME_KEYS = ['name', 'iface', 'ifName', 'interface', 'devName'] as const;

/** VR3 缓存偶发写入的 status / 错误文案 token（含常见变体） */
const JUNK_IFACE_TOKENS = new Set([
  'enabled',
  'enabled.',
  'disabled',
  'disabled.',
  'is',
  'not',
  'true',
  'false',
  'up',
  'down',
  'tap',
  'inject',
  'tap-inject',
  'tapinject',
  'status',
  'error',
  'invalid',
]);

/** 常见真实网卡名前缀（勿用裸 `tap`，避免误匹配 tap-inject） */
const STRICT_IFACE_PREFIX =
  /^(GigabitEthernet|Ethernet\d|eth\d*|eth$|lo\d*|lo$|Tunnel|BondEthernet|Bond|memif|TapEthernet|vlan\d*|GE\d|Gi\d|Te\d)/i;

function normalizeIfaceToken(raw: string): string {
  return String(raw ?? '')
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .replace(/[.,;:!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isJunkPhrase(s: string): boolean {
  const lower = s.toLowerCase();
  if (JUNK_IFACE_TOKENS.has(lower)) return true;
  if (/\bis\s+not\b/i.test(s)) return true;
  const parts = lower.split(/[\s._-]+/).filter(Boolean);
  if (parts.length > 0 && parts.every((p) => JUNK_IFACE_TOKENS.has(p))) return true;
  return false;
}

/** 过滤 VR3 缓存中误当作接口名的状态/错误文案 token */
export function looksLikeIfaceName(raw: string): boolean {
  const s = normalizeIfaceToken(raw);
  if (!s || s.length < 2) return false;
  if (isJunkPhrase(s)) return false;
  if (STRICT_IFACE_PREFIX.test(s)) return true;
  if (/GigabitEthernet\s+\d/i.test(s)) return true;
  if (/[\d/]/.test(s) && /[A-Za-z]/.test(s) && s.length >= 3) return true;
  return false;
}

function readIfaceNameFromRow(it: unknown): string | null {
  if (!it) return null;
  if (typeof it === 'string') {
    const s = normalizeIfaceToken(it);
    return s && looksLikeIfaceName(s) ? s : null;
  }
  if (typeof it !== 'object') return null;
  const row = it as Record<string, unknown>;
  for (const k of IFC_NAME_KEYS) {
    const v = normalizeIfaceToken(String(row[k] ?? ''));
    if (v && looksLikeIfaceName(v)) return v;
  }
  return null;
}

function collectIfaceNamesFromDeviceBlob(dev: any): string[] {
  if (!dev || typeof dev !== 'object') return [];
  const names: string[] = [];
  const collectFromArray = (arr?: unknown[]) => {
    (arr || []).forEach((it) => {
      const n = readIfaceNameFromRow(it);
      if (n) names.push(n);
    });
  };
  collectFromArray(Array.isArray(dev.interfaces) ? dev.interfaces : undefined);
  Object.keys(dev).forEach((key) => {
    if (
      (key.startsWith('interfaces_') || key.startsWith('subinterfaces_')) &&
      Array.isArray((dev as any)[key])
    ) {
      collectFromArray((dev as any)[key]);
    }
  });
  return Array.from(new Set(names)).filter((n) => looksLikeIfaceName(n));
}

/** 仅 VR2 上的接口名（与历史行为一致，供仅需 VR2 的场景） */
export function collectIfaceNamesFromMerged(merged: Record<string, any>): string[] {
  return collectIfaceNamesFromDeviceBlob(merged?.vr2_info);
}

export type CollectIfaceNamesOptions = {
  /** 平台已保存设备配置 / SRv6 基线（interfaces_*） */
  baseline?: Record<string, unknown> | null;
  /** inventory 或其它已知口名 */
  extraNames?: string[];
};

/**
 * 向导网卡下拉：vr2 / 基线 / inventory 为主；vr3 仅补充通过严格校验的口名。
 */
export function collectIfaceNamesForSelect(
  merged: Record<string, any>,
  opts?: CollectIfaceNamesOptions,
): string[] {
  const fromVr3 = collectIfaceNamesFromDeviceBlob(merged?.vr3_info);
  const fromVr2 = collectIfaceNamesFromDeviceBlob(merged?.vr2_info);
  const fromBaseline = opts?.baseline ? collectIfaceNamesFromDeviceBlob(opts.baseline) : [];
  const extra = (opts?.extraNames ?? [])
    .map((n) => normalizeIfaceToken(String(n)))
    .filter((n) => n && looksLikeIfaceName(n));
  const trusted = [...fromVr2, ...fromBaseline, ...extra];
  const mergedNames = Array.from(new Set([...trusted, ...fromVr3].filter(looksLikeIfaceName)));
  if (mergedNames.length > 0) return mergedNames;
  return Array.from(new Set(trusted.filter(looksLikeIfaceName)));
}

/** 仅 VR2：按接口查 IP/BGP；无 vr2_info 时为 null */
export function pickDeviceBlobForLookup(merged: Record<string, any>): Record<string, any> | null {
  const vr2 = merged?.vr2_info;
  if (vr2 && typeof vr2 === 'object') return vr2 as Record<string, any>;
  return null;
}
