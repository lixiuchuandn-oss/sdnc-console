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
  type HubLanFormRow,
  type HubWanFormRow,
} from './hubPeInventory';
import {
  buildWanStaticRoutesFromRows,
  wanIfNamesMatch,
  type WanRouteFormRow,
} from './peWizardWanRoutes';
import {
  patchVrConfigWanNdProxy,
  wanNdProxyIntentDiffers,
} from './peWizardNdProxy';
import { pickPrimaryIpv4Cidr } from './vrIpv4Utils';

export type PeWizardReferencedValues = {
  sidPrefix?: unknown;
  wanNdProxy?: boolean;
  wanDev?: string;
  wanRouteDest?: string;
  wanRoutePriority?: number;
  ipv6Dest?: string;
  ipv6Via?: string;
  hubWanInventory?: HubWanFormRow[];
  lanConfigs?: HubLanFormRow[];
  wanIpv4?: string;
  wanIpv6?: string;
};

export type PeWizardReferencedPatchResult = {
  cfg: Record<string, unknown>;
  changedLabels: string[];
  /** 隧道依赖的关键字段被修改（LAN BGP 的 ASN/Router-ID/RD/RT），需先删除隧道 */
  blockedReasons?: string[];
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

/** 按 destination + via + vrf 去重（保留首次出现；也清理现网已存在的重复条目） */
export const dedupeIpv6Routes = (list: unknown[]): unknown[] => {
  const seen = new Set<string>();
  return list.filter((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return true;
    const r = item as Record<string, unknown>;
    const key = `${text(r.destination)}|${text(r.via)}|${text(r.vrf)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
  const next = dedupeIpv6Routes([...kept, ...formRoutes]);
  const before = normalizeIpv6RouteList(existing);
  const after = normalizeIpv6RouteList(next);
  if (stableStringify(before) === stableStringify(after)) return false;
  cfg.ipv6_route = next;
  return true;
};

const roleDevMatches = (dev: string, roleDevs: string[]): boolean =>
  Boolean(dev) && roleDevs.some((d) => wanIfNamesMatch(d, dev));

/**
 * 与后端 mergeRoleRoutes 对齐：只替换当前角色 WAN `dev` 上的 IPv4 路由，
 * 保留无 `dev` 或其它接口上的表项（隧道/业务注入）。
 */
const patchPublicIpv4Routes = (
  cfg: Record<string, unknown>,
  formRoutes: Array<{ destination: string; dev: string; priority: number }>,
  roleDevs: string[],
): boolean => {
  if (!roleDevs.length) return false;
  const existing = Array.isArray(cfg.ipv4_route) ? (cfg.ipv4_route as unknown[]) : [];
  const kept: unknown[] = [];
  for (const item of existing) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      kept.push(item);
      continue;
    }
    const row = item as Record<string, unknown>;
    const dev = text(row.dev);
    if (!dev || !roleDevMatches(dev, roleDevs)) kept.push(row);
  }
  const next = [...kept, ...formRoutes];
  const before = normalizeIpv4RouteList(existing);
  const after = normalizeIpv4RouteList(next);
  if (stableStringify(before) === stableStringify(after)) return false;
  if (next.length) cfg.ipv4_route = next;
  else delete cfg.ipv4_route;
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

const IFACE_BUCKETS = [
  'interfaces_GigabitEthernet',
  'subinterfaces_GigabitEthernet',
  'interfaces_lo',
  'interfaces_Tunnel',
  'subinterfaces_Tunnel',
] as const;

const IFACE_ROLE_KEYS = ['ipv4_static', 'ipv6_static', 'vrf', 'status'] as const;

const isPublicBgp = (b: Record<string, unknown>) =>
  b.vrf === undefined || b.vrf === null || String(b.vrf).trim() === '' || Number(b.vrf) === 0;

const bgpKey = (b: Record<string, unknown>) =>
  isPublicBgp(b) ? `rid:${text(b.router_id)}|asn:${text(b.asn)}` : `vrf:${text(b.vrf)}`;

/**
 * 接口 / VRF / LAN BGP 增量合并：
 * - 接口按名 upsert（只覆盖角色字段，保留隧道注入的其它字段）
 * - vrf 列表取并集
 * - LAN BGP：底稿中不存在的段才追加（已有段可能含隧道 neighbor，不覆盖）
 */
const bgpLockedFields = (b: Record<string, unknown>) => {
  const afs = Array.isArray(b.address_family) ? (b.address_family as Record<string, unknown>[]) : [];
  const af =
    afs.find(
      (a) =>
        text(a?.address_family).toLowerCase() === 'ipv4' &&
        text(a?.modifiler ?? a?.modifier).toLowerCase() === 'unicast',
    ) || afs[0] || {};
  return {
    asn: text(b.asn),
    rid: text(b.router_id),
    rd: text(af.route_distinguisher),
    rt: text(af.route_target),
  };
};

function mergeInterfacesAndLanBgp(
  cfg: Record<string, unknown>,
  full: Record<string, unknown>,
  blocked?: string[],
): string[] {
  const labels: string[] = [];
  const added: string[] = [];
  const updated: string[] = [];
  for (const key of IFACE_BUCKETS) {
    const next = Array.isArray(full[key]) ? (full[key] as Record<string, unknown>[]) : [];
    if (!next.length) continue;
    const cur = Array.isArray(cfg[key]) ? [...(cfg[key] as Record<string, unknown>[])] : [];
    for (const item of next) {
      const name = text(item?.name);
      if (!name) continue;
      const idx = cur.findIndex((c) => wanIfNamesMatch(c?.name, name));
      if (idx < 0) {
        cur.push({ ...item });
        added.push(name);
        continue;
      }
      const old = cur[idx];
      const merged: Record<string, unknown> = { ...old };
      let diff = false;
      for (const k of IFACE_ROLE_KEYS) {
        if (item[k] === undefined) continue;
        if (stableStringify(old[k]) !== stableStringify(item[k])) {
          merged[k] = item[k];
          diff = true;
        }
      }
      if (diff) {
        cur[idx] = merged;
        updated.push(name);
      }
    }
    cfg[key] = cur;
  }
  if (added.length) labels.push(`新增接口 ${added.join('、')}`);
  if (updated.length) labels.push(`接口地址/VRF（${updated.join('、')}）`);

  const nextVrf = Array.isArray(full.vrf) ? (full.vrf as unknown[]).map(Number) : [];
  if (nextVrf.length) {
    const curVrf = Array.isArray(cfg.vrf) ? (cfg.vrf as unknown[]).map(Number) : [];
    const newVrf = nextVrf.filter((v) => Number.isFinite(v) && !curVrf.includes(v));
    if (newVrf.length) {
      cfg.vrf = [...curVrf, ...newVrf];
      labels.push(`新增 VRF ${newVrf.join('、')}`);
    }
  }

  const nextBgp = Array.isArray(full.bgp) ? (full.bgp as Record<string, unknown>[]) : [];
  const curBgp = Array.isArray(cfg.bgp) ? [...(cfg.bgp as Record<string, unknown>[])] : [];
  const curKeys = new Set(curBgp.map(bgpKey));
  const newBgp: string[] = [];
  for (const b of nextBgp) {
    if (!b || typeof b !== 'object' || isPublicBgp(b) && !text(b.router_id)) continue;
    if (isPublicBgp(b) && curBgp.some(isPublicBgp) && !b.address_family) continue;
    const k = bgpKey(b);
    if (curKeys.has(k)) {
      if (!isPublicBgp(b) && blocked) {
        const old = curBgp.find((c) => bgpKey(c) === k) || {};
        const o = bgpLockedFields(old);
        const n = bgpLockedFields(b);
        const diffs: string[] = [];
        if (n.asn && o.asn && n.asn !== o.asn) diffs.push(`ASN ${o.asn}→${n.asn}`);
        if (n.rid && o.rid && n.rid !== o.rid) diffs.push(`Router-ID ${o.rid}→${n.rid}`);
        if (n.rd && n.rd !== o.rd) diffs.push(`RD ${o.rd || '-'}→${n.rd}`);
        if (n.rt && n.rt !== o.rt) diffs.push(`RT ${o.rt || '-'}→${n.rt}`);
        if (diffs.length) blocked.push(`VRF ${text(b.vrf)}：${diffs.join('，')}`);
      }
      continue;
    }
    curBgp.push(b);
    curKeys.add(k);
    newBgp.push(b.vrf != null ? `VRF ${b.vrf}` : `RID ${text(b.router_id)}`);
  }
  if (newBgp.length) {
    cfg.bgp = curBgp;
    labels.push(`新增 LAN BGP（${newBgp.join('、')}）`);
  }
  return labels;
}

type LockedLanRow = {
  vrf: string;
  ifName: string;
  ipv4: string;
  asn: string;
  routerId: string;
  rd: string;
  rt: string;
};

const ifNameInSet = (ifName: unknown, names: Iterable<string>): boolean => {
  const n = text(ifName);
  if (!n) return false;
  for (const s of names) {
    if (wanIfNamesMatch(n, s)) return true;
  }
  return false;
};

const ifaceIpv4ByName = (cfg: Record<string, unknown>, ifName: string): string => {
  if (!ifName) return '';
  for (const key of IFACE_BUCKETS) {
    const arr = Array.isArray(cfg[key]) ? (cfg[key] as Record<string, unknown>[]) : [];
    const hit = arr.find((it) => wanIfNamesMatch(it?.name, ifName));
    if (hit) return pickPrimaryIpv4Cidr(hit.ipv4_static ?? hit.ipv4);
  }
  return '';
};

/** Hub 状态 / 引用表里已绑定隧道的 LAN 口 */
export const collectBoundHubLanIfNames = (status: {
  portRegistry?: Array<{ lanIf?: string | null }>;
  tunnels?: Array<{
    hubBindings?: { lanIf?: string | null } | null;
    innerIfMeta?: { innerIf?: string | null };
  }>;
} | null | undefined): Set<string> => {
  const out = new Set<string>();
  const add = (v?: string | null) => {
    const n = text(v);
    if (n) out.add(n);
  };
  (status?.portRegistry || []).forEach((e) => add(e.lanIf));
  (status?.tunnels || []).forEach((t) => {
    add(t.hubBindings?.lanIf);
    add(t.innerIfMeta?.innerIf);
  });
  return out;
};

/** Hub：该 LAN 口的 ifName/主 IPv4 是否应锁定（绑定集为空未知时，对已保存口失败关闭） */
export const isHubLanIfNameLocked = (
  ifName: unknown,
  boundLanIfNames: Set<string> | null,
  savedLanIfNames: Iterable<string>,
): boolean => {
  const n = text(ifName);
  if (!n) return false;
  if (boundLanIfNames === null) return ifNameInSet(n, savedLanIfNames);
  return ifNameInSet(n, boundLanIfNames);
};

/** 现网配置 interfaces_* / subinterfaces_* 中已存在的口名 */
const existingIfaceNames = (cfg: Record<string, unknown>): string[] => {
  const out: string[] = [];
  Object.keys(cfg).forEach((k) => {
    if (!(k.startsWith('interfaces_') || k.startsWith('subinterfaces_'))) return;
    const arr = cfg[k];
    if (!Array.isArray(arr)) return;
    arr.forEach((it) => {
      const n = text((it as Record<string, unknown> | null)?.name);
      if (n) out.push(n);
    });
  });
  return out;
};

/**
 * Hub 清单变更标签。
 * 生效配置常被剥掉 inventory，只能用 pe.publicConfig 还原（只含主 WAN），其余 WAN 会被误判为“新增”。
 * 回退模式下：仅当口在现网接口表里也不存在时才算新增；路由/地址变化已由前面的路由、接口合并检测，不再用签名重复报。
 */
export const hubInventoryChangeLabel = (
  existing: Record<string, unknown>,
  prevInv: HubInventory | null,
  nextInv: HubInventory,
  fromFallback: boolean,
): string[] => {
  if (!fromFallback && inventoryRouteSignature(prevInv) === inventoryRouteSignature(nextInv)) return [];
  const known = fromFallback ? existingIfaceNames(existing) : [];
  const wanKnown = (n: string) =>
    (prevInv?.wan || []).some((w) => wanIfNamesMatch(w.ifName, n)) || known.some((k) => wanIfNamesMatch(k, n));
  const lanKnown = (n: string, vrf: unknown) =>
    (prevInv?.lan || []).some((l) => wanIfNamesMatch(l.ifName, n) && String(l.vrf) === String(vrf)) ||
    known.some((k) => wanIfNamesMatch(k, n));
  const newWan = nextInv.wan.filter((w) => !wanKnown(text(w.ifName))).map((w) => w.ifName);
  const newLan = nextInv.lan
    .filter((l) => !lanKnown(text(l.ifName), l.vrf))
    .map((l) => `${l.ifName}(VRF ${l.vrf})`);
  const out: string[] = [];
  if (newWan.length) out.push(`新增 WAN 口 ${newWan.join('、')}`);
  if (newLan.length) out.push(`新增 LAN 口 ${newLan.join('、')}`);
  if (!out.length && !fromFallback) out.push('Hub WAN/LAN 清单');
  return out;
};

/** 生效配置常被剥掉 inventory：用 pe.publicConfig / lanConfig 还原一份供 diff */
const inventoryFromPeFallback = (cfg: Record<string, unknown>): HubInventory | null => {
  const pe =
    cfg.pe && typeof cfg.pe === 'object' && !Array.isArray(cfg.pe)
      ? (cfg.pe as Record<string, unknown>)
      : null;
  if (!pe) return null;
  const pub =
    pe.publicConfig && typeof pe.publicConfig === 'object' && !Array.isArray(pe.publicConfig)
      ? (pe.publicConfig as Record<string, unknown>)
      : {};
  const list = [pe.lanConfig, pe.LanConfig, pe.lanConfigs].find(Array.isArray) as
    | Record<string, unknown>[]
    | undefined;
  const lanConfigs: HubLanFormRow[] = (list || []).map((r) => {
    const bgp = (r.lanBgp && typeof r.lanBgp === 'object' ? r.lanBgp : r) as Record<string, unknown>;
    const vrfN = Number(r.vrf);
    const asnN = Number(bgp.asn ?? r.asn);
    return {
      ifName: text(r.lanName || r.ifName) || undefined,
      vrf: Number.isFinite(vrfN) ? vrfN : undefined,
      ipv4: text(r.ipv4) || undefined,
      ipv6: text(r.ipv6) || undefined,
      asn: Number.isFinite(asnN) ? asnN : undefined,
      routerId: text(bgp.routerId ?? r.routerId) || undefined,
      routeDistinguisher: text(bgp.routeDistinguisher ?? r.routeDistinguisher) || undefined,
      routeTarget: text(bgp.routeTarget ?? r.routeTarget) || undefined,
    };
  });
  const wanName = text(pub.wanName || pub.wanDev);
  const inv = buildHubInventoryFromPeWizardValues(
    {
      hubWanInventory: wanName
        ? [
            {
              ifName: wanName,
              ipv4: text(pub.wanIpv4) || undefined,
              ipv6: text(pub.wanIpv6) || undefined,
              ipv4RouteDest: text(pub.wanRouteDest) || undefined,
              ipv4RoutePriority:
                pub.wanRoutePriority != null && String(pub.wanRoutePriority).trim() !== ''
                  ? Number(pub.wanRoutePriority)
                  : undefined,
              ipv6Dest: text(pub.ipv6Dest) || undefined,
              ipv6Via: text(pub.ipv6Via) || undefined,
            },
          ]
        : [],
      lanConfigs,
    },
    null,
  );
  if (!inv.wan.length && !inv.lan.length) return null;
  return inv;
};

/** 已保存配置中的 LAN BGP 行（pe.lanConfig / inventory.lan），按 VRF 索引 */
const savedLanRows = (cfg: unknown): Map<string, LockedLanRow> => {
  const out = new Map<string, LockedLanRow>();
  if (!cfg || typeof cfg !== 'object') return out;
  const c = cfg as Record<string, unknown>;
  const pe = (c.pe && typeof c.pe === 'object' ? c.pe : {}) as Record<string, unknown>;
  const list = [pe.lanConfig, pe.LanConfig, pe.lanConfigs].find(Array.isArray) as
    | Record<string, unknown>[]
    | undefined;
  (list || []).forEach((r) => {
    const vrf = text(r?.vrf);
    if (!vrf) return;
    const bgp = (r.lanBgp && typeof r.lanBgp === 'object' ? r.lanBgp : r) as Record<string, unknown>;
    const ifName = text(r.lanName || r.ifName);
    out.set(vrf, {
      vrf,
      ifName,
      ipv4: pickPrimaryIpv4Cidr(r.ipv4) || ifaceIpv4ByName(c, ifName),
      asn: text(bgp.asn),
      routerId: text(bgp.routerId),
      rd: text(bgp.routeDistinguisher),
      rt: text(bgp.routeTarget),
    });
  });
  (parseHubInventoryFromConfig(cfg)?.lan || []).forEach((l) => {
    const vrf = text(l.vrf);
    if (!vrf) return;
    const ifName = text(l.ifName);
    const ipv4 = pickPrimaryIpv4Cidr(l.ipv4) || ifaceIpv4ByName(c, ifName);
    const prev = out.get(vrf);
    if (!prev) {
      out.set(vrf, {
        vrf,
        ifName,
        ipv4,
        asn: text(l.privateAsn),
        routerId: text(l.routerId),
        rd: text(l.routeDistinguisher),
        rt: text(l.routeTarget),
      });
      return;
    }
    if (!prev.ifName && ifName) prev.ifName = ifName;
    if (!prev.ipv4 && ipv4) prev.ipv4 = ipv4;
  });
  return out;
};

/** 被隧道引用时锁定的 LAN VRF（已保存配置中存在的 VRF） */
export const lockedLanVrfsFromConfig = (cfg: unknown): Set<string> => new Set(savedLanRows(cfg).keys());

/** 已保存 LAN 口名（Hub 未解析绑定集时用于失败关闭） */
export const lockedLanIfNamesFromConfig = (cfg: unknown): Set<string> => {
  const out = new Set<string>();
  savedLanRows(cfg).forEach((row) => {
    if (row.ifName) out.add(row.ifName);
  });
  return out;
};

const lanRowIfNameBound = (
  savedIfName: string,
  boundLanIfNames: Set<string> | null | undefined,
): boolean => {
  if (!savedIfName || boundLanIfNames === undefined) return false;
  if (boundLanIfNames === null) return true;
  return ifNameInSet(savedIfName, boundLanIfNames);
};

/** 被隧道引用时锁定的 WAN 口（已保存 inventory / pe.publicConfig） */
export const lockedWanIfNamesFromConfig = (cfg: unknown): Set<string> => {
  const out = new Set<string>();
  (parseHubInventoryFromConfig(cfg)?.wan || []).forEach((w) => {
    const n = text(w.ifName);
    if (n) out.add(n);
  });
  const pe =
    cfg && typeof cfg === 'object' && !Array.isArray(cfg)
      ? ((cfg as Record<string, unknown>).pe as Record<string, unknown> | undefined)
      : undefined;
  const pub =
    pe?.publicConfig && typeof pe.publicConfig === 'object' && !Array.isArray(pe.publicConfig)
      ? (pe.publicConfig as Record<string, unknown>)
      : {};
  const wan = text(pub.wanName || pub.wanDev);
  if (wan) out.add(wan);
  return out;
};

/** 比较向导 LAN 行与已保存配置，返回被锁字段的修改说明（含缺失已锁定 VRF） */
export const lockedLanFieldChanges = (
  cfg: unknown,
  lanRows: HubLanFormRow[] | undefined,
  opts?: { boundLanIfNames?: Set<string> | null },
): string[] => {
  const saved = savedLanRows(cfg);
  const out: string[] = [];
  const present = new Set<string>();
  (lanRows || []).forEach((r) => {
    const vrf = text(r?.vrf);
    if (vrf) present.add(vrf);
    const o = vrf ? saved.get(vrf) : undefined;
    if (!o) return;
    const diffs: string[] = [];
    const cmp = (label: string, before: string, after: string) => {
      if (before && after !== before) diffs.push(`${label} ${before}→${after || '-'}`);
    };
    cmp('ASN', o.asn, text(r.asn));
    cmp('Router-ID', o.routerId, text(r.routerId));
    cmp('RD', o.rd, text(r.routeDistinguisher));
    cmp('RT', o.rt, text(r.routeTarget));
    if (lanRowIfNameBound(o.ifName, opts?.boundLanIfNames)) {
      const nextIf = text(r.ifName);
      if (o.ifName && nextIf && !wanIfNamesMatch(o.ifName, nextIf)) {
        diffs.push(`LAN 口 ${o.ifName}→${nextIf}`);
      } else if (o.ifName && !nextIf) {
        diffs.push(`LAN 口 ${o.ifName}→-`);
      }
      const savedIp = o.ipv4;
      const nextIp = pickPrimaryIpv4Cidr(r.ipv4);
      if (savedIp && nextIp && savedIp !== nextIp) {
        diffs.push(`LAN IPv4 ${savedIp}→${nextIp}`);
      } else if (savedIp && !nextIp) {
        diffs.push(`LAN IPv4 ${savedIp}→-`);
      }
    }
    if (diffs.length) out.push(`VRF ${vrf}：${diffs.join('，')}`);
  });
  for (const vrf of saved.keys()) {
    if (!present.has(vrf)) out.push(`VRF ${vrf}：不可删除（已被隧道引用）`);
  }
  return out;
};

/** 比较向导 WAN 行与已保存配置，返回缺失已锁定 WAN 口说明 */
export const lockedWanFieldChanges = (
  cfg: unknown,
  wanRows: HubWanFormRow[] | undefined,
): string[] => {
  const locked = lockedWanIfNamesFromConfig(cfg);
  if (!locked.size) return [];
  const present = (wanRows || []).map((r) => text(r?.ifName)).filter(Boolean);
  return [...locked]
    .filter((ifName) => !present.some((p) => wanIfNamesMatch(p, ifName)))
    .map((ifName) => `WAN ${ifName}：不可删除（已被隧道引用）`);
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
    /** 向导全量构建结果（buildConfigFromValues），仅用于取接口/VRF/LAN BGP 增量 */
    fullCfg?: Record<string, unknown>;
    /**
     * Hub：隧道已绑定的 LAN 口（hubBindings.lanIf / 注册表）。
     * `null` 表示引用关系已知但口名未解析，对已保存 LAN 的 ifName/主 IPv4 失败关闭。
     */
    boundLanIfNames?: Set<string> | null;
  },
): PeWizardReferencedPatchResult {
  const cfg = cloneCfg(existing);
  const changedLabels: string[] = [];
  const blockedReasons: string[] = [];
  if (opts.boundLanIfNames !== undefined) {
    const identity = lockedLanFieldChanges(existing, values.lanConfigs, {
      boundLanIfNames: opts.boundLanIfNames,
    }).filter((l) => /LAN 口|LAN IPv4/.test(l));
    if (identity.length) {
      return { cfg: cloneCfg(existing), changedLabels: [], blockedReasons: identity };
    }
  }
  const wanRows = collectWanRows(values, opts.isHubPe);
  const { ipv4_route, ipv6_route } = buildWanStaticRoutesFromRows(wanRows);

  if (wanNdProxyIntentDiffers(cfg, values)) {
    patchVrConfigWanNdProxy(cfg, values);
    changedLabels.push('Locator SID ND 代答');
  }

  const roleWanDevs = wanRows.map((r) => text(r.ifName)).filter(Boolean);
  if (patchPublicIpv4Routes(cfg, ipv4_route, roleWanDevs)) {
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

  if (opts.fullCfg) {
    changedLabels.push(...mergeInterfacesAndLanBgp(cfg, opts.fullCfg, blockedReasons));
    if (blockedReasons.length) {
      return { cfg: cloneCfg(existing), changedLabels: [], blockedReasons };
    }
    const fullPe = opts.fullCfg.pe;
    if (fullPe && typeof fullPe === 'object' && !Array.isArray(fullPe)) {
      const curPe =
        cfg.pe && typeof cfg.pe === 'object' && !Array.isArray(cfg.pe)
          ? { ...(cfg.pe as Record<string, unknown>) }
          : {};
      const nextPe = fullPe as Record<string, unknown>;
      const beforeLan = stableStringify(curPe.lanConfig ?? curPe.lanConfigs ?? []);
      const afterLan = stableStringify(nextPe.lanConfig ?? []);
      const curPub =
        curPe.publicConfig && typeof curPe.publicConfig === 'object'
          ? (curPe.publicConfig as Record<string, unknown>)
          : {};
      const nextPub =
        nextPe.publicConfig && typeof nextPe.publicConfig === 'object'
          ? (nextPe.publicConfig as Record<string, unknown>)
          : {};
      cfg.pe = {
        ...curPe,
        ...nextPe,
        publicConfig: { ...curPub, ...nextPub },
      };
      if (beforeLan !== afterLan && !changedLabels.some((l) => l.includes('LAN'))) {
        changedLabels.push('LAN 侧配置');
      }
    }
  }

  if (opts.isHubPe) {
    const realInv = parseHubInventoryFromConfig(cfg) || opts.existingHubInventory || null;
    const prevInv = realInv || inventoryFromPeFallback(cfg);
    const nextInv = buildHubInventoryFromPeWizardValues(values, opts.existingHubInventory ?? prevInv);
    attachHubInventoryToConfig(cfg, nextInv);
    const label = hubInventoryChangeLabel(existing, prevInv, nextInv, !realInv);
    if (label.length) changedLabels.push(...label);
  }

  return { cfg, changedLabels: [...new Set(changedLabels)] };
}
