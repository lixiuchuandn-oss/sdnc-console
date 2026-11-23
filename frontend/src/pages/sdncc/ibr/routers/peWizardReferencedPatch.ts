/**
 * 已被 SRv6 隧道引用时：在现有 VR 配置底稿上只叠加角色向导变更字段，
 * 避免 buildConfigFromValues 全量骨架覆盖隧道注入（neighbor / SID 路由等）。
 * ND 代答只是可变更字段之一，不单独作为通道开关。
 */

import {
  attachHubInventoryToConfig,
  buildHubInventoryFromPeWizardValues,
  parseHubInventoryFromConfig,
  type HubInventory,
  type HubWanFormRow,
} from './hubPeInventory';
import {
  buildWanStaticRoutesFromRows,
  type WanRouteFormRow,
} from './peWizardWanRoutes';
import {
  patchVrConfigWanNdProxy,
  wanNdProxyIntentDiffers,
} from './peWizardNdProxy';

export type PeWizardReferencedValues = {
  sidPrefix?: unknown;
  wanNdProxy?: boolean;
  wanDev?: string;
  wanRouteDest?: string;
  wanRoutePriority?: number;
  ipv6Dest?: string;
  ipv6Via?: string;
  hubWanInventory?: HubWanFormRow[];
  lanConfigs?: unknown[];
  wanIpv4?: string;
  wanIpv6?: string;
};

export type PeWizardReferencedPatchResult = {
  cfg: Record<string, unknown>;
  changedLabels: string[];
};

const text = (v: unknown) => String(v ?? '').trim();

const stableStringify = (v: unknown): string => {
  try {
    return JSON.stringify(v ?? null);
  } catch {
    return String(v);
  }
};

const cloneCfg = (cfg: Record<string, unknown>): Record<string, unknown> =>
  JSON.parse(JSON.stringify(cfg)) as Record<string, unknown>;

const isPreservedTunnelIpv6Route = (row: Record<string, unknown>): boolean => {
  const vrf = row.vrf;
  if (vrf !== undefined && vrf !== null && String(vrf).trim() !== '' && Number(vrf) !== 0) {
    return true;
  }
  return /^nexthop-vrf/i.test(String(row.via ?? '').trim());
};

const normalizeIpv4RouteList = (routes: unknown): Array<{ destination: string; dev: string; priority: number }> => {
  if (!Array.isArray(routes)) return [];
  return routes
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => ({
      destination: text(r.destination),
      dev: text(r.dev),
      priority: Number(r.priority ?? 100),
    }))
    .filter((r) => r.destination)
    .sort((a, b) => `${a.dev}|${a.destination}|${a.priority}`.localeCompare(`${b.dev}|${b.destination}|${b.priority}`));
};

const normalizeIpv6RouteList = (routes: unknown): Array<{ destination: string; via?: string }> => {
  if (!Array.isArray(routes)) return [];
  return routes
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => {
      const destination = text(r.destination);
      const via = text(r.via) || undefined;
      return via ? { destination, via } : { destination };
    })
    .filter((r) => r.destination)
    .sort((a, b) => `${a.destination}|${a.via || ''}`.localeCompare(`${b.destination}|${b.via || ''}`));
};

const collectWanRows = (values: PeWizardReferencedValues, isHubPe: boolean): WanRouteFormRow[] => {
  if (isHubPe && Array.isArray(values.hubWanInventory)) {
    return values.hubWanInventory;
  }
  const wan = text(values.wanDev);
  if (!wan) return [];
  return [
    {
      ifName: wan,
      ipv4: values.wanIpv4,
      ipv6: values.wanIpv6,
      ipv4RouteDest: values.wanRouteDest,
      ipv4RoutePriority: values.wanRoutePriority,
      ipv6Dest: values.ipv6Dest,
      ipv6Via: values.ipv6Via,
      ndProxy: Boolean(values.wanNdProxy),
    },
  ];
};

const existingRoleIpv6Dests = (cfg: Record<string, unknown>, isHubPe: boolean): string[] => {
  const out = new Set<string>();
  const pe =
    cfg.pe && typeof cfg.pe === 'object' && !Array.isArray(cfg.pe)
      ? (cfg.pe as Record<string, unknown>)
      : {};
  const publicConfig =
    pe.publicConfig && typeof pe.publicConfig === 'object' && !Array.isArray(pe.publicConfig)
      ? (pe.publicConfig as Record<string, unknown>)
      : {};
  const top = text(publicConfig.ipv6Dest);
  if (top) out.add(top);
  if (isHubPe) {
    const inv = parseHubInventoryFromConfig(cfg);
    (inv?.wan || []).forEach((w) => {
      const d = text(w.ipv6Dest);
      if (d) out.add(d);
    });
  }
  return [...out];
};

const ensurePePublicConfig = (cfg: Record<string, unknown>): Record<string, unknown> => {
  const pe =
    cfg.pe && typeof cfg.pe === 'object' && !Array.isArray(cfg.pe)
      ? { ...(cfg.pe as Record<string, unknown>) }
      : {};
  const publicConfig =
    pe.publicConfig && typeof pe.publicConfig === 'object' && !Array.isArray(pe.publicConfig)
      ? { ...(pe.publicConfig as Record<string, unknown>) }
      : {};
  pe.publicConfig = publicConfig;
  cfg.pe = pe;
  return publicConfig;
};

const syncPublicRouteMeta = (
  cfg: Record<string, unknown>,
  wanRows: WanRouteFormRow[],
  isHubPe: boolean,
): boolean => {
  const publicConfig = ensurePePublicConfig(cfg);
  const first = wanRows[0] || {};
  const nextDest = text(first.ipv4RouteDest) || undefined;
  const nextPrio =
    first.ipv4RoutePriority !== undefined && first.ipv4RoutePriority !== null
      ? Number(first.ipv4RoutePriority)
      : undefined;
  const nextV6Dest = text(first.ipv6Dest) || undefined;
  const nextV6Via = text(first.ipv6Via) || undefined;
  let changed = false;
  if (text(publicConfig.wanRouteDest) !== text(nextDest)) {
    if (nextDest) publicConfig.wanRouteDest = nextDest;
    else delete publicConfig.wanRouteDest;
    changed = true;
  }
  const curPrio =
    publicConfig.wanRoutePriority !== undefined && publicConfig.wanRoutePriority !== null
      ? Number(publicConfig.wanRoutePriority)
      : undefined;
  if (curPrio !== nextPrio) {
    if (nextPrio != null && Number.isFinite(nextPrio)) publicConfig.wanRoutePriority = nextPrio;
    else delete publicConfig.wanRoutePriority;
    changed = true;
  }
  if (text(publicConfig.ipv6Dest) !== text(nextV6Dest)) {
    if (nextV6Dest) publicConfig.ipv6Dest = nextV6Dest;
    else delete publicConfig.ipv6Dest;
    changed = true;
  }
  if (text(publicConfig.ipv6Via) !== text(nextV6Via)) {
    if (nextV6Via) publicConfig.ipv6Via = nextV6Via;
    else delete publicConfig.ipv6Via;
    changed = true;
  }
  // Hub 多 WAN：首口 meta 仍写 publicConfig，明细在 inventory
  void isHubPe;
  return changed;
};

const patchPublicIpv6Routes = (
  cfg: Record<string, unknown>,
  formRoutes: Array<{ destination: string; via?: string }>,
  roleDests: string[],
): boolean => {
  const existing = Array.isArray(cfg.ipv6_route) ? (cfg.ipv6_route as unknown[]) : [];
  const replaceDests = new Set(
    [...roleDests, ...formRoutes.map((r) => r.destination)].map((d) => text(d)).filter(Boolean),
  );
  const kept: unknown[] = [];
  for (const item of existing) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      kept.push(item);
      continue;
    }
    const row = item as Record<string, unknown>;
    if (isPreservedTunnelIpv6Route(row)) {
      kept.push(row);
      continue;
    }
    const dest = text(row.destination);
    if (replaceDests.has(dest)) continue;
    kept.push(row);
  }
  const next = [...kept, ...formRoutes];
  const before = normalizeIpv6RouteList(existing);
  const after = normalizeIpv6RouteList(next);
  if (stableStringify(before) === stableStringify(after)) return false;
  cfg.ipv6_route = next;
  return true;
};

const inventoryRouteSignature = (inv: HubInventory | null): string => {
  if (!inv) return '';
  const wan = [...inv.wan]
    .map((w) =>
      [
        w.source,
        w.ifName,
        w.ipv4 || '',
        w.ipv6 || '',
        w.ipv4RouteDest || '',
        w.ipv4RoutePriority ?? '',
        w.ipv6Dest || '',
        w.ipv6Via || '',
      ].join('|'),
    )
    .sort();
  const lan = [...inv.lan]
    .map((l) =>
      [
        l.source,
        l.ifName,
        l.vrf,
        l.ipv4 || '',
        l.ipv6 || '',
        l.privateAsn,
        l.routerId,
        l.routeDistinguisher || '',
        l.routeTarget || '',
      ].join('|'),
    )
    .sort();
  return stableStringify({ wan, lan });
};

/**
 * 在现网底稿上叠加角色向导变更；返回变更中文标签。无变更则 changedLabels 为空。
 */
export function applyPeWizardReferencedChanges(
  existing: Record<string, unknown>,
  values: PeWizardReferencedValues,
  opts: {
    isHubPe: boolean;
    existingHubInventory?: HubInventory | null;
  },
): PeWizardReferencedPatchResult {
  const cfg = cloneCfg(existing);
  const changedLabels: string[] = [];
  const wanRows = collectWanRows(values, opts.isHubPe);
  const { ipv4_route, ipv6_route } = buildWanStaticRoutesFromRows(wanRows);

  if (wanNdProxyIntentDiffers(cfg, values)) {
    patchVrConfigWanNdProxy(cfg, values);
    changedLabels.push('Locator SID ND 代答');
  }

  const beforeV4 = normalizeIpv4RouteList(cfg.ipv4_route);
  const afterV4 = normalizeIpv4RouteList(ipv4_route);
  if (stableStringify(beforeV4) !== stableStringify(afterV4)) {
    if (ipv4_route.length) cfg.ipv4_route = ipv4_route;
    else delete cfg.ipv4_route;
    changedLabels.push('IPv4 静态路由');
  }

  const roleDests = existingRoleIpv6Dests(cfg, opts.isHubPe);
  if (patchPublicIpv6Routes(cfg, ipv6_route, roleDests)) {
    changedLabels.push('IPv6 静态路由');
  }

  if (syncPublicRouteMeta(cfg, wanRows, opts.isHubPe)) {
    if (!changedLabels.includes('IPv4 静态路由') && !changedLabels.includes('IPv6 静态路由')) {
      changedLabels.push('WAN 静态路由元数据');
    }
  }

  if (opts.isHubPe) {
    const prevInv = parseHubInventoryFromConfig(cfg);
    const nextInv = buildHubInventoryFromPeWizardValues(values, opts.existingHubInventory ?? prevInv);
    if (inventoryRouteSignature(prevInv) !== inventoryRouteSignature(nextInv)) {
      attachHubInventoryToConfig(cfg, nextInv);
      if (
        !changedLabels.includes('IPv4 静态路由') &&
        !changedLabels.includes('IPv6 静态路由') &&
        !changedLabels.includes('WAN 静态路由元数据')
      ) {
        changedLabels.push('Hub WAN/LAN 清单');
      }
    }
  }

  return { cfg, changedLabels: [...new Set(changedLabels)] };
}
