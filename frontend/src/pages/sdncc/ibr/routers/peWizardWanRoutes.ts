/** Hub / PE 向导 · 每 WAN 口静态路由生成（P2） */

export type WanRouteFormRow = {
  ifName?: string;
  ipv4?: string;
  ipv6?: string;
  ipv4RouteDest?: string;
  ipv4RouteVia?: string;
  ipv6Dest?: string;
  ipv6Via?: string;
};

const IPV4_CIDR =
  /^(?:(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\/([0-9]|[1-2]\d|3[0-2])$/;
const IPV6_CIDR = /^[0-9a-fA-F:]+\/([0-9]|[1-9]\d|1[01]\d|12[0-8])$/;

export const normalizePeWizardIpv4Cidr = (raw: unknown): string | undefined => {
  const t = String(raw ?? '').trim();
  return IPV4_CIDR.test(t) ? t : undefined;
};

export const normalizePeWizardIpv6Cidr = (raw: unknown): string | undefined => {
  const t = String(raw ?? '').trim();
  if (!t || t.includes('.')) return undefined;
  return IPV6_CIDR.test(t) ? t : undefined;
};

export function buildWanStaticRoutesFromRows(rows: WanRouteFormRow[]): {
  ipv4_route: Array<{ destination: string; via: string; dev: string }>;
  ipv6_route: Array<{ destination: string; via?: string }>;
} {
  const ipv4_route: Array<{ destination: string; via: string; dev: string }> = [];
  const ipv6_route: Array<{ destination: string; via?: string }> = [];

  for (const row of rows) {
    const ifName = String(row?.ifName ?? '').trim();
    if (!ifName) continue;

    const dest4Raw = String(row.ipv4RouteDest ?? '').trim();
    const via4 = String(row.ipv4RouteVia ?? '').trim();
    const dest4 = dest4Raw ? normalizePeWizardIpv4Cidr(dest4Raw) : undefined;
    if (dest4 && via4) {
      ipv4_route.push({
        destination: dest4,
        via: via4,
        dev: ifName,
      });
    }

    const dest6 = normalizePeWizardIpv6Cidr(row.ipv6Dest);
    if (dest6) {
      const via = String(row.ipv6Via ?? '').trim();
      const route: { destination: string; via?: string } = { destination: dest6 };
      if (via) route.via = via;
      ipv6_route.push(route);
    }
  }

  return { ipv4_route, ipv6_route };
}

/** Hub 向导提交前：WAN/LAN ifName 不可重复 */
export function assertUniqueHubInventoryIfNames(
  hubWanInventory: Array<{ ifName?: string }> | undefined,
  lanConfigs: Array<{ ifName?: string }> | undefined,
): string | null {
  const wanNames = (hubWanInventory ?? [])
    .map((r) => String(r?.ifName ?? '').trim())
    .filter(Boolean);
  const dupWan = wanNames.find((n, i) => wanNames.indexOf(n) !== i);
  if (dupWan) return `Hub WAN 接口名重复：${dupWan}`;

  const lanNames = (lanConfigs ?? [])
    .map((r) => String(r?.ifName ?? '').trim())
    .filter(Boolean);
  const dupLan = lanNames.find((n, i) => lanNames.indexOf(n) !== i);
  if (dupLan) return `Hub LAN 接口名重复：${dupLan}`;

  return null;
}

/** 设备下发契约：ipv6_route 仅 destination + via（剥离 Tower 侧 dev 等扩展字段） */
export function sanitizeIpv6RoutesForDevice<T extends Record<string, unknown>>(cfg: T): T {
  const routes = cfg.ipv6_route;
  if (!Array.isArray(routes) || !routes.length) return cfg;
  return {
    ...cfg,
    ipv6_route: routes.map((item) => {
      if (!item || typeof item !== 'object') return item;
      const row = { ...(item as Record<string, unknown>) };
      delete row.dev;
      return row;
    }),
  } as T;
}

/** 从设备 config 回填 Hub WAN 行静态路由（ipv4 按 dev；ipv6 按序与 ipv4/WAN 行对齐） */
export function enrichHubWanRowsFromDeviceRoutes<T extends WanRouteFormRow>(
  rows: T[],
  cfg: { ipv4_route?: unknown; ipv6_route?: unknown },
): T[] {
  const ipv4List = Array.isArray(cfg.ipv4_route) ? cfg.ipv4_route : [];
  const ipv6List = Array.isArray(cfg.ipv6_route) ? cfg.ipv6_route : [];
  const usedV6 = new Set<number>();

  return rows.map((row) => {
    const ifName = String(row.ifName ?? '').trim();
    if (!ifName) return row;
    const next = { ...row };

    const v4 = ipv4List.find(
      (r) => r && typeof r === 'object' && String((r as Record<string, unknown>).dev ?? '').trim() === ifName,
    ) as Record<string, unknown> | undefined;
    if (v4?.destination && !next.ipv4RouteDest) {
      next.ipv4RouteDest = String(v4.destination);
    }
    if (v4?.via && !next.ipv4RouteVia) {
      next.ipv4RouteVia = String(v4.via);
    }

    const hasInventoryV6 =
      String(next.ipv6Dest ?? '').trim() || String(next.ipv6Via ?? '').trim();
    if (hasInventoryV6) {
      return next;
    }

    let v6Idx = ipv6List.findIndex((r, i) => {
      if (usedV6.has(i) || !r || typeof r !== 'object') return false;
      const rowObj = r as Record<string, unknown>;
      const dev = String(rowObj.dev ?? '').trim();
      if (dev) return dev === ifName;
      return false;
    });
    if (v6Idx < 0 && ipv6List.length === 1 && rows.length === 1) {
      v6Idx = 0;
    }
    if (v6Idx < 0 && rows.length > 1) {
      v6Idx = ipv6List.findIndex((_, i) => !usedV6.has(i));
    }
    if (v6Idx >= 0) {
      usedV6.add(v6Idx);
      const v6 = ipv6List[v6Idx] as Record<string, unknown>;
      if (v6.destination) next.ipv6Dest = String(v6.destination);
      if (v6.via) next.ipv6Via = String(v6.via);
    }

    return next;
  });
}

type DeviceIfaceRow = {
  name?: string;
  ipv4_static?: string;
  ipv6_static?: string;
  vrf?: unknown;
};

/** 设备回读：从公网接口列表 + 路由表构建 Hub WAN Mirror 行 */
export function buildHubWanMirrorRowsFromDevice(
  ifaceItems: DeviceIfaceRow[],
  cfg: { ipv4_route?: unknown; ipv6_route?: unknown },
): WanRouteFormRow[] {
  const wanIfaces = ifaceItems.filter((it) => {
    const vrf = it.vrf;
    const hasVrf =
      vrf !== undefined && vrf !== null && String(vrf).trim() !== '' && Number(vrf) > 0;
    return !!String(it.name ?? '').trim() && !hasVrf;
  });
  const rows: WanRouteFormRow[] = wanIfaces.map((it) => ({
    ifName: String(it.name).trim(),
    ipv4: it.ipv4_static,
    ipv6: it.ipv6_static,
  }));
  if (!rows.length) return rows;
  return enrichHubWanRowsFromDeviceRoutes(rows, cfg);
}

const normWanIfKey = (v: unknown) =>
  String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

/**
 * 再次进入 HUB_PE 向导：已保存 inventory 行与设备公网口列表对齐，避免编辑区 WAN Tab 少于 Mirror。
 */
export function mergeHubWanFormRowsForWizard(
  savedRows: WanRouteFormRow[] | undefined,
  deviceRows: WanRouteFormRow[] | undefined,
): WanRouteFormRow[] {
  const saved = Array.isArray(savedRows) ? savedRows : [];
  const device = Array.isArray(deviceRows) ? deviceRows : [];
  const savedByIf = new Map<string, WanRouteFormRow>();
  saved.forEach((row) => {
    const key = normWanIfKey(row.ifName);
    if (key) savedByIf.set(key, { ...row });
  });

  if (!device.length) {
    return saved.length ? saved : [{}];
  }

  const merged: WanRouteFormRow[] = [];
  const seen = new Set<string>();

  for (const devRow of device) {
    const key = normWanIfKey(devRow.ifName);
    if (!key) continue;
    const hit = savedByIf.get(key);
    merged.push({
      ...(hit ?? {}),
      ifName: devRow.ifName ?? hit?.ifName,
      ipv4: hit?.ipv4 ?? devRow.ipv4,
      ipv6: hit?.ipv6 ?? devRow.ipv6,
      ipv4RouteDest: hit?.ipv4RouteDest ?? devRow.ipv4RouteDest,
      ipv4RouteVia: hit?.ipv4RouteVia ?? devRow.ipv4RouteVia,
      ipv6Dest: hit?.ipv6Dest ?? devRow.ipv6Dest,
      ipv6Via: hit?.ipv6Via ?? devRow.ipv6Via,
    });
    seen.add(key);
  }

  saved.forEach((row) => {
    const key = normWanIfKey(row.ifName);
    if (key && !seen.has(key)) {
      merged.push(row);
      seen.add(key);
    }
  });

  return merged.length ? merged : [{}];
}

/** HUB_PE 向导编辑区：inventory + 设备公网口合并（与 Mirror 行数对齐） */
export function resolveHubWanRowsForPeWizardForm(
  savedRows: WanRouteFormRow[] | undefined,
  ifaceItems: DeviceIfaceRow[],
  cfg: { ipv4_route?: unknown; ipv6_route?: unknown },
): WanRouteFormRow[] {
  const enrichedSaved = enrichHubWanRowsFromDeviceRoutes(savedRows ?? [], cfg);
  const deviceRows = buildHubWanMirrorRowsFromDevice(ifaceItems, cfg);
  return mergeHubWanFormRowsForWizard(enrichedSaved, deviceRows);
}
