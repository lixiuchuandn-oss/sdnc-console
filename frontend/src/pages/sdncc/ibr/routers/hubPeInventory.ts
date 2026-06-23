/** §14.17 · Hub PE 基线 inventory（与 backend srv6.hubInventory 对齐） */

export const TOWER_HUB_INVENTORY_KEY = '_towerHubInventory';

export type HubInventorySource = 'role_wizard' | 'tunnel_inline';

export type HubWanInventoryItem = {
  id: string;
  ifName: string;
  ipv4?: string;
  ipv6: string;
  source: HubInventorySource;
  createdByTunnelId?: string;
  createdAt: string;
};

export type HubLanInventoryItem = {
  id: string;
  ifName: string;
  vrf: number;
  ipv4?: string;
  ipv6?: string;
  privateAsn: number;
  routerId: string;
  source: HubInventorySource;
  createdByTunnelId?: string;
  createdAt: string;
};

export type HubInventory = {
  wan: HubWanInventoryItem[];
  lan: HubLanInventoryItem[];
};

export type HubWanFormRow = {
  id?: string;
  ifName?: string;
  ipv4?: string;
  ipv6?: string;
};

export type HubLanFormRow = {
  id?: string;
  ifName?: string;
  vrf?: number;
  ipv4?: string;
  ipv6?: string;
  asn?: number;
  routerId?: string;
};

const normIf = (v: unknown) => String(v ?? '').trim();
const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `inv-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const emptyHubInventory = (): HubInventory => ({ wan: [], lan: [] });

export const isHubInventory = (v: unknown): v is HubInventory => {
  if (!v || typeof v !== 'object') return false;
  const o = v as HubInventory;
  return Array.isArray(o.wan) && Array.isArray(o.lan);
};

export const parseHubInventoryFromConfig = (cfg: unknown): HubInventory | null => {
  if (!cfg || typeof cfg !== 'object') return null;
  const raw = (cfg as Record<string, unknown>)[TOWER_HUB_INVENTORY_KEY];
  if (!isHubInventory(raw)) return null;
  return { wan: [...raw.wan], lan: [...raw.lan] };
};

export const stripTowerExtensionsFromDeviceConfig = (
  cfg: Record<string, unknown>,
): Record<string, unknown> => {
  const next = { ...cfg };
  delete next[TOWER_HUB_INVENTORY_KEY];
  return next;
};

const resolveWanId = (
  row: HubWanFormRow,
  existing: HubInventory | null | undefined,
): string => {
  if (row.id) return row.id;
  const hit = existing?.wan.find((w) => normIf(w.ifName) === normIf(row.ifName));
  return hit?.id ?? newId();
};

const resolveLanId = (
  row: HubLanFormRow,
  existing: HubInventory | null | undefined,
): string => {
  if (row.id) return row.id;
  const byIf = existing?.lan.find((l) => normIf(l.ifName) === normIf(row.ifName));
  if (byIf) return byIf.id;
  if (row.vrf != null) {
    const byVrf = existing?.lan.find((l) => String(l.vrf) === String(row.vrf));
    if (byVrf) return byVrf.id;
  }
  return newId();
};

/** HUB_PE 向导表单 → inventory（role_wizard 段；保留 tunnel_inline 段） */
export const buildHubInventoryFromPeWizardValues = (
  values: {
    hubWanInventory?: HubWanFormRow[];
    lanConfigs?: HubLanFormRow[];
    wanDev?: string;
    wanIpv4?: string;
    wanIpv6?: string;
  },
  existing?: HubInventory | null,
): HubInventory => {
  const now = new Date().toISOString();
  const wanRows: HubWanFormRow[] = Array.isArray(values.hubWanInventory)
    ? values.hubWanInventory
    : values.wanDev
      ? [{ ifName: values.wanDev, ipv4: values.wanIpv4, ipv6: values.wanIpv6 }]
      : [];

  const wizardWan: HubWanInventoryItem[] = wanRows
    .filter((r) => normIf(r.ifName) && normIf(r.ipv6))
    .map((r) => ({
      id: resolveWanId(r, existing),
      ifName: normIf(r.ifName),
      ipv4: r.ipv4?.trim() || undefined,
      ipv6: normIf(r.ipv6),
      source: 'role_wizard' as const,
      createdAt: existing?.wan.find((w) => w.id === resolveWanId(r, existing))?.createdAt ?? now,
    }));

  const lanRows: HubLanFormRow[] = Array.isArray(values.lanConfigs) ? values.lanConfigs : [];
  const wizardLan: HubLanInventoryItem[] = lanRows
    .filter((r) => normIf(r.ifName) && r.vrf != null && r.asn != null && normIf(r.routerId))
    .map((r) => ({
      id: resolveLanId(r, existing),
      ifName: normIf(r.ifName),
      vrf: Number(r.vrf),
      ipv4: r.ipv4?.trim() || undefined,
      ipv6: r.ipv6?.trim() || undefined,
      privateAsn: Number(r.asn),
      routerId: normIf(r.routerId),
      source: 'role_wizard' as const,
      createdAt: existing?.lan.find((l) => l.id === resolveLanId(r, existing))?.createdAt ?? now,
    }));

  const inlineWan = (existing?.wan ?? []).filter((w) => w.source === 'tunnel_inline');
  const inlineLan = (existing?.lan ?? []).filter((l) => l.source === 'tunnel_inline');

  return {
    wan: [...wizardWan, ...inlineWan],
    lan: [...wizardLan, ...inlineLan],
  };
};

export const attachHubInventoryToConfig = (
  cfg: Record<string, unknown>,
  inventory: HubInventory,
): Record<string, unknown> => ({
  ...cfg,
  [TOWER_HUB_INVENTORY_KEY]: inventory,
});

/** 从已保存配置还原 HUB_PE 向导表单字段 */
export const hubInventoryToPeWizardForm = (
  cfg: unknown,
  legacyPe?: {
    wanDev?: string;
    wanIpv4?: string;
    wanIpv6?: string;
    lanConfigs?: HubLanFormRow[];
  },
): { hubWanInventory: HubWanFormRow[]; lanConfigs: HubLanFormRow[] } => {
  const inv = parseHubInventoryFromConfig(cfg);
  if (inv && (inv.wan.length || inv.lan.length)) {
    return {
      hubWanInventory: inv.wan
        .filter((w) => w.source === 'role_wizard')
        .map((w) => ({
          id: w.id,
          ifName: w.ifName,
          ipv4: w.ipv4,
          ipv6: w.ipv6,
        })),
      lanConfigs: inv.lan
        .filter((l) => l.source === 'role_wizard')
        .map((l) => ({
          id: l.id,
          ifName: l.ifName,
          vrf: l.vrf,
          ipv4: l.ipv4,
          ipv6: l.ipv6,
          asn: l.privateAsn,
          routerId: l.routerId,
        })),
    };
  }
  const hubWanInventory: HubWanFormRow[] = legacyPe?.wanDev
    ? [{ ifName: legacyPe.wanDev, ipv4: legacyPe.wanIpv4, ipv6: legacyPe.wanIpv6 }]
    : [{}];
  return {
    hubWanInventory,
    lanConfigs: legacyPe?.lanConfigs?.length ? legacyPe.lanConfigs : [{}],
  };
};
