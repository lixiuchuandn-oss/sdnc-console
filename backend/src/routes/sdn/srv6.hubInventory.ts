import { randomUUID } from 'crypto';
import { AppDataSource } from '../../config/database';
import { VRConfig } from '../../entities/vRouter/VRConfig';
import type { Srv6HubSlotBinding, Srv6HubVrfMode } from '../../entities/vRouter/srv6Tunnel.types';
import { parseSrv6Baseline } from './srv6.baseline';
import type { Srv6HubPortRegistryEntry } from './srv6.hub';

/** Tower 扩展字段：存于 srv6BaselineJson，merge / 设备下发前须剥离 */
export const TOWER_HUB_INVENTORY_KEY = '_towerHubInventory';

export type HubInventorySource = 'role_wizard' | 'device_baseline';

export type HubWanInventoryItem = {
  id: string;
  ifName: string;
  ipv4?: string;
  ipv6: string;
  ipv4RouteDest?: string;
  ipv4RoutePriority?: number;
  ipv6Dest?: string;
  ipv6Via?: string;
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

export type HubInventoryOptionTag = 'idle' | 'wan_reusable' | 'lan_dedicated_occupied';

export type HubWanInventoryOption = HubWanInventoryItem & {
  tags: HubInventoryOptionTag[];
  label: string;
  selectable: boolean;
};

export type HubLanInventoryOption = HubLanInventoryItem & {
  tags: HubInventoryOptionTag[];
  label: string;
  selectable: boolean;
};

export type HubInventoryUi = {
  inventory: HubInventory;
  inventoryEmpty: boolean;
  guidance?: string;
  wanOptions: HubWanInventoryOption[];
  lanOptions: HubLanInventoryOption[];
};

const normalizeInventorySource = (source: unknown): HubInventorySource =>
  source === 'device_baseline' ? 'device_baseline' : 'role_wizard';

const normalizeWanItem = (item: HubWanInventoryItem): HubWanInventoryItem => ({
  ...item,
  source: normalizeInventorySource(item.source),
});

const normalizeLanItem = (item: HubLanInventoryItem): HubLanInventoryItem => ({
  ...item,
  source: normalizeInventorySource(item.source),
});

const vrRepo = () => AppDataSource.getRepository(VRConfig);

const normIf = (v: unknown) => String(v ?? '').trim();
const normVrf = (v: unknown) => String(v ?? '').trim();

export const emptyHubInventory = (): HubInventory => ({ wan: [], lan: [] });

export const isHubInventory = (v: unknown): v is HubInventory => {
  if (!v || typeof v !== 'object') return false;
  const o = v as HubInventory;
  return Array.isArray(o.wan) && Array.isArray(o.lan);
};

export const parseHubInventoryFromBaseline = (
  baseline: Record<string, unknown> | null | undefined,
): HubInventory => {
  if (!baseline) return emptyHubInventory();
  const raw = baseline[TOWER_HUB_INVENTORY_KEY];
  if (!isHubInventory(raw)) return emptyHubInventory();
  return {
    wan: raw.wan.map(normalizeWanItem),
    lan: raw.lan.map(normalizeLanItem),
  };
};

/** 供 merge / 设备下发：移除 Tower 扩展，仅保留设备配置 */
export const sanitizeIpv6RoutesForDeviceBaseline = (
  baseline: Record<string, unknown>,
): Record<string, unknown> => {
  const routes = baseline.ipv6_route;
  if (!Array.isArray(routes) || !routes.length) return baseline;
  return {
    ...baseline,
    ipv6_route: routes.map((item) => {
      if (!item || typeof item !== 'object') return item;
      const row = { ...(item as Record<string, unknown>) };
      delete row.dev;
      return row;
    }),
  };
};

export const stripTowerExtensionsFromDeviceBaseline = (
  baseline: Record<string, unknown>,
): Record<string, unknown> => {
  const cloned = JSON.parse(JSON.stringify(baseline)) as Record<string, unknown>;
  delete cloned[TOWER_HUB_INVENTORY_KEY];
  return sanitizeIpv6RoutesForDeviceBaseline(cloned);
};

export const getHubInventoryFromVrRecord = (record: VRConfig | null | undefined): HubInventory => {
  if (!record) return emptyHubInventory();
  return parseHubInventoryFromBaseline(parseSrv6Baseline(record));
};

export const writeHubInventoryIntoBaselineJson = (
  baselineJson: Record<string, unknown>,
  inventory: HubInventory,
): Record<string, unknown> => {
  const next = { ...baselineJson, [TOWER_HUB_INVENTORY_KEY]: inventory };
  return next;
};

export const persistHubInventoryForVr = async (
  vrUuid: string,
  inventory: HubInventory,
): Promise<void> => {
  const id = String(vrUuid || '').trim();
  if (!id) {
    const err = new Error('缺少 Hub PE VR UUID');
    (err as Error & { statusCode: number }).statusCode = 400;
    throw err;
  }
  const record = await vrRepo().findOne({ where: { uuid: id } });
  if (!record?.srv6BaselineJson?.trim()) {
    const err = new Error('Hub PE 尚未保存 SRv6 基线，请先在 HUB_PE 角色配置向导完成配置');
    (err as Error & { statusCode: number }).statusCode = 409;
    throw err;
  }
  const baseline = parseSrv6Baseline(record);
  if (!baseline) {
    const err = new Error('Hub PE SRv6 基线格式异常');
    (err as Error & { statusCode: number }).statusCode = 409;
    throw err;
  }
  const merged = writeHubInventoryIntoBaselineJson(baseline, inventory);
  record.srv6BaselineJson = JSON.stringify(merged);
  await vrRepo().save(record);
};

const wanUsedBy = (
  item: HubWanInventoryItem,
  registry: Srv6HubPortRegistryEntry[],
): Srv6HubPortRegistryEntry[] =>
  registry.filter((e) => normIf(e.wanIf) === normIf(item.ifName));

const lanDedicatedUsedBy = (
  item: HubLanInventoryItem,
  registry: Srv6HubPortRegistryEntry[],
): Srv6HubPortRegistryEntry[] =>
  registry.filter((e) => {
    if (e.hubVrfMode !== 'DEDICATED_VRF') return false;
    if (e.lanIf && normIf(e.lanIf) === normIf(item.ifName)) return true;
    return false;
  });

const formatWanLabel = (item: HubWanInventoryItem, tags: HubInventoryOptionTag[], used: Srv6HubPortRegistryEntry[]) => {
  const tagText =
    item.source === 'device_baseline'
      ? 'Hub 已有公网口'
      : tags.includes('idle')
        ? '空闲'
        : tags.includes('wan_reusable')
          ? `已用于 ${used.map((u) => u.tunnelName).join('、')} · 可复用`
          : '';
  return `${item.ifName} · ${item.ipv6}${item.ipv6Via ? ` · gw ${item.ipv6Via}` : ''}${tagText ? ` [${tagText}]` : ''}`;
};

const formatLanLabel = (
  item: HubLanInventoryItem,
  tags: HubInventoryOptionTag[],
  used: Srv6HubPortRegistryEntry[],
) => {
  const tagText =
    item.source === 'device_baseline'
      ? 'Hub 已有内网口'
      : tags.includes('idle')
        ? '空闲'
        : tags.includes('lan_dedicated_occupied')
          ? `已用于 ${used.map((u) => u.tunnelName).join('、')} · 专网占用`
          : '';
  return `${item.ifName} · VRF ${item.vrf}${tagText ? ` [${tagText}]` : ''}`;
};

const baselineWanId = (ifName: string) => `baseline-wan:${normIf(ifName)}`;
const baselineLanId = (ifName: string, vrf: number) => `baseline-lan:${normIf(ifName)}:${vrf}`;

const readIfaceIpv6 = (row: Record<string, unknown>): string =>
  normIf(row.ipv6_static ?? row.ipv6);

const readIfaceIpv4 = (row: Record<string, unknown>): string | undefined => {
  const v = normIf(row.ipv4_static ?? row.ipv4);
  return v || undefined;
};

const findBgpForVrf = (
  baseline: Record<string, unknown>,
  vrf: number,
): { asn: number; routerId: string } | null => {
  const bgp = baseline.bgp;
  if (!Array.isArray(bgp)) return null;
  const hit = bgp.find((b) => b && typeof b === 'object' && Number((b as Record<string, unknown>).vrf) === vrf) as
    | Record<string, unknown>
    | undefined;
  if (!hit) return null;
  const asn = Number(hit.asn);
  const routerId = normIf(hit.router_id ?? hit.routerId);
  if (!Number.isFinite(asn) || !routerId) return null;
  return { asn, routerId };
};

/** 从 Hub PE SRv6 基线 interfaces_* 提取尚未写入 inventory 的 WAN/LAN 候选 */
export const extractHubBaselineInterfaceCandidates = (
  baseline: Record<string, unknown> | null | undefined,
): HubInventory => {
  const out = emptyHubInventory();
  if (!baseline || typeof baseline !== 'object') return out;
  const now = new Date().toISOString();

  for (const k of Object.keys(baseline)) {
    if (!k.startsWith('interfaces_') && !k.startsWith('subinterfaces_')) continue;
    const arr = baseline[k];
    if (!Array.isArray(arr)) continue;
    for (const raw of arr) {
      if (!raw || typeof raw !== 'object') continue;
      const row = raw as Record<string, unknown>;
      const ifName = normIf(row.name);
      if (!ifName) continue;
      const vrfRaw = row.vrf;
      const vrfNum =
        vrfRaw !== undefined && vrfRaw !== null && String(vrfRaw).trim() !== ''
          ? Number(vrfRaw)
          : 0;
      const ipv6 = readIfaceIpv6(row);
      const ipv4 = readIfaceIpv4(row);

      if (vrfNum > 0) {
        const bgpMeta = findBgpForVrf(baseline, vrfNum);
        if (!bgpMeta) continue;
        out.lan.push({
          id: baselineLanId(ifName, vrfNum),
          ifName,
          vrf: vrfNum,
          ipv4,
          ipv6: ipv6 || undefined,
          privateAsn: bgpMeta.asn,
          routerId: bgpMeta.routerId,
          source: 'device_baseline',
          createdAt: now,
        });
      } else if (ipv6) {
        out.wan.push({
          id: baselineWanId(ifName),
          ifName,
          ipv4,
          ipv6,
          source: 'device_baseline',
          createdAt: now,
        });
      }
    }
  }
  return out;
};

/** UI 展示：inventory + 基线已有接口（按 ifName/VRF 去重，inventory 优先） */
export const mergeInventoryWithBaselineCandidates = (
  inventory: HubInventory,
  baseline: Record<string, unknown> | null | undefined,
): HubInventory => {
  const candidates = extractHubBaselineInterfaceCandidates(baseline);
  const wan = [...inventory.wan];
  const lan = [...inventory.lan];
  for (const w of candidates.wan) {
    if (!wan.some((x) => normIf(x.ifName) === normIf(w.ifName))) wan.push(w);
  }
  for (const l of candidates.lan) {
    if (
      !lan.some(
        (x) => normIf(x.ifName) === normIf(l.ifName) || normVrf(x.vrf) === normVrf(l.vrf),
      )
    ) {
      lan.push(l);
    }
  }
  return { wan, lan };
};

/** 隧道保存：将用户选用的基线口登记入持久化 inventory */
export const persistBaselineBindingSelectionsToInventory = (
  inventory: HubInventory,
  baseline: Record<string, unknown> | null | undefined,
  bindings: Srv6HubSlotBinding,
): HubInventory => {
  const merged = mergeInventoryWithBaselineCandidates(inventory, baseline);
  const next: HubInventory = { wan: [...inventory.wan], lan: [...inventory.lan] };
  const now = new Date().toISOString();

  const wanSel = findWanInventoryItem(merged, {
    id: bindings.wanInventoryId,
    ifName: bindings.wanIf,
  });
  if (wanSel && !findWanInventoryItem(next, { ifName: wanSel.ifName })) {
    next.wan.push({
      ...wanSel,
      id: randomUUID(),
      source: 'role_wizard',
      createdAt: now,
    });
  }

  const lanSel = findLanInventoryItem(merged, {
    id: bindings.lanInventoryId,
    ifName: bindings.lanIf,
  });
  if (lanSel && !findLanInventoryItem(next, { ifName: lanSel.ifName, vrf: lanSel.vrf })) {
    next.lan.push({
      ...lanSel,
      id: randomUUID(),
      source: 'role_wizard',
      createdAt: now,
    });
  }
  return next;
};

export const buildHubInventoryUi = (
  inventory: HubInventory,
  portRegistry: Srv6HubPortRegistryEntry[],
  options?: { lanSelectMode?: 'reuse' | 'dedicated' },
): HubInventoryUi => {
  const lanSelectMode = options?.lanSelectMode ?? 'dedicated';
  const inventoryEmpty = inventory.wan.length === 0 && inventory.lan.length === 0;
  const guidance = inventoryEmpty
    ? 'Hub 尚未登记可用公网/内网口：请先在 HUB_PE 角色配置向导完成 WAN/LAN 并保存基线。'
    : undefined;

  const wanOptions: HubWanInventoryOption[] = inventory.wan.map((item) => {
    const used = wanUsedBy(item, portRegistry);
    const tags: HubInventoryOptionTag[] = used.length ? ['wan_reusable'] : ['idle'];
    return {
      ...item,
      tags,
      selectable: true,
      label: formatWanLabel(item, tags, used),
    };
  });

  const lanOptions: HubLanInventoryOption[] = inventory.lan.map((item) => {
    const dedicatedUsed = lanDedicatedUsedBy(item, portRegistry);
    if (lanSelectMode === 'reuse') {
      return {
        ...item,
        tags: ['wan_reusable'],
        selectable: true,
        label: `${item.ifName} · VRF ${item.vrf} [共用客户侧]`,
      };
    }
    const occupied = dedicatedUsed.length > 0;
    const tags: HubInventoryOptionTag[] = occupied ? ['lan_dedicated_occupied'] : ['idle'];
    return {
      ...item,
      tags,
      selectable: !occupied,
      label: formatLanLabel(item, tags, dedicatedUsed),
    };
  });

  return { inventory, inventoryEmpty, guidance, wanOptions, lanOptions };
};

export const findWanInventoryItem = (
  inventory: HubInventory,
  ref?: { id?: string; ifName?: string },
): HubWanInventoryItem | null => {
  if (!ref) return null;
  if (ref.id) {
    const hit = inventory.wan.find((w) => w.id === ref.id);
    if (hit) return hit;
  }
  if (ref.ifName) {
    const hit = inventory.wan.find((w) => normIf(w.ifName) === normIf(ref.ifName));
    if (hit) return hit;
  }
  return null;
};

export const findLanInventoryItem = (
  inventory: HubInventory,
  ref?: { id?: string; ifName?: string; vrf?: number },
): HubLanInventoryItem | null => {
  if (!ref) return null;
  if (ref.id) {
    const hit = inventory.lan.find((l) => l.id === ref.id);
    if (hit) return hit;
  }
  if (ref.ifName) {
    const hit = inventory.lan.find((l) => normIf(l.ifName) === normIf(ref.ifName));
    if (hit) return hit;
  }
  if (ref.vrf !== undefined) {
    const hit = inventory.lan.find((l) => normVrf(l.vrf) === normVrf(ref.vrf));
    if (hit) return hit;
  }
  return null;
};

/**
 * POST/PUT 保存 Hub 隧道时：补全 hubBindings 的 inventoryId，并将选用的基线口登记入 inventory。
 */
export const resolveHubBindingsWithInventory = async (
  hubPeUuid: string,
  _tunnelId: string,
  hubBindings: Srv6HubSlotBinding | null | undefined,
  _hubVrfMode?: Srv6HubVrfMode | null,
): Promise<Srv6HubSlotBinding | null | undefined> => {
  if (!hubBindings) return hubBindings;
  const record = await vrRepo().findOne({ where: { uuid: hubPeUuid } });
  const baseline = record ? parseSrv6Baseline(record) : null;
  let hubInventory = getHubInventoryFromVrRecord(record);
  const withBaseline = persistBaselineBindingSelectionsToInventory(
    hubInventory,
    baseline,
    hubBindings,
  );
  if (JSON.stringify(withBaseline) !== JSON.stringify(hubInventory)) {
    await persistHubInventoryForVr(hubPeUuid, withBaseline);
    hubInventory = withBaseline;
  }
  return patchHubBindingsInventoryIds(hubBindings, hubInventory);
};

export type HubInventoryBindingRef = {
  wanIf?: string;
  lanIf?: string;
  wanInventoryId?: string;
  lanInventoryId?: string;
};

const ifaceBucketKey = (ifName: string): string => {
  const name = normIf(ifName);
  const typePart = name.split(' ')[0];
  const isSub = name.includes('.');
  switch (typePart) {
    case 'GigabitEthernet':
      return isSub ? 'subinterfaces_GigabitEthernet' : 'interfaces_GigabitEthernet';
    case 'lo':
      return 'interfaces_lo';
    case 'Tunnel':
      return isSub ? 'subinterfaces_Tunnel' : 'interfaces_Tunnel';
    default:
      return isSub ? 'subinterfaces_GigabitEthernet' : 'interfaces_GigabitEthernet';
  }
};

const findInterfaceInConfig = (
  cfg: Record<string, unknown>,
  ifName: string,
): Record<string, unknown> | null => {
  const target = normIf(ifName).toLowerCase();
  for (const k of Object.keys(cfg)) {
    if (!k.startsWith('interfaces_') && !k.startsWith('subinterfaces_')) continue;
    const arr = cfg[k];
    if (!Array.isArray(arr)) continue;
    const hit = arr.find(
      (it: unknown) =>
        it &&
        typeof it === 'object' &&
        normIf((it as Record<string, unknown>).name).toLowerCase() === target,
    );
    if (hit && typeof hit === 'object') return hit as Record<string, unknown>;
  }
  return null;
};

/** §14.17.6：inventory 首次引用时物化 interfaces_*（基线尚无该口时） */
export const ensureInterfaceFromInventory = (
  cfg: Record<string, unknown>,
  item: { ifName: string; ipv4?: string; ipv6?: string; vrf?: number },
): void => {
  if (!normIf(item.ifName)) return;
  if (findInterfaceInConfig(cfg, item.ifName)) return;
  const key = ifaceBucketKey(item.ifName);
  const arr = Array.isArray(cfg[key]) ? [...(cfg[key] as unknown[])] : [];
  const row: Record<string, unknown> = { name: normIf(item.ifName), status: 'up' };
  if (item.ipv4) row.ipv4_static = item.ipv4;
  if (item.ipv6) row.ipv6_static = item.ipv6;
  if (item.vrf != null) row.vrf = item.vrf;
  arr.push(row);
  cfg[key] = arr;
  if (item.vrf != null) {
    const vrfNum = Number(item.vrf);
    const vrfArr = Array.isArray(cfg.vrf) ? [...(cfg.vrf as unknown[])] : [];
    if (!vrfArr.some((v: unknown) => Number((v as Record<string, unknown>)?.id ?? v) === vrfNum)) {
      vrfArr.push(vrfNum);
      cfg.vrf = vrfArr;
    }
  }
};

/** 路线 B：按 LAN inventory 物化独立 bgp[N] 段 */
export const ensureBgpSegmentFromLanInventory = (
  cfg: Record<string, unknown>,
  lan: HubLanInventoryItem,
): void => {
  if (!Array.isArray(cfg.bgp)) cfg.bgp = [];
  const bgpArr = cfg.bgp as Record<string, unknown>[];
  const vrfNum = Number(lan.vrf);
  if (bgpArr.some((b) => Number(b.vrf) === vrfNum)) return;
  const enableAutoSid = vrfNum >= 4001;
  bgpArr.push({
    vrf: vrfNum,
    asn: lan.privateAsn,
    router_id: lan.routerId,
    bgp_ebgp_requires_policy: 'disable',
    address_family: [
      {
        address_family: 'ipv4',
        modifiler: 'unicast',
        export_route: 'enable',
        import_route: 'enable',
        auto_assign_sid: enableAutoSid ? 'enable' : 'disable',
      },
    ],
  });
};

export const ipv6HostFromInventoryCidr = (cidr?: string): string | undefined => {
  const s = String(cidr ?? '').trim();
  if (!s) return undefined;
  return s.split('/')[0]?.trim() || undefined;
};

export type HubInventoryMaterializeCtx = {
  inventory: HubInventory;
  binding?: HubInventoryBindingRef | null;
  hubVrfMode?: Srv6HubVrfMode | null;
};

export const materializeHubInventoryForBinding = (
  cfg: Record<string, unknown>,
  ctx: HubInventoryMaterializeCtx,
): void => {
  const { inventory, binding, hubVrfMode } = ctx;
  if (!binding) return;
  const wan = findWanInventoryItem(inventory, { id: binding.wanInventoryId, ifName: binding.wanIf });
  if (wan) {
    ensureInterfaceFromInventory(cfg, { ifName: wan.ifName, ipv4: wan.ipv4, ipv6: wan.ipv6 });
  }
  const lan = findLanInventoryItem(inventory, {
    id: binding.lanInventoryId,
    ifName: binding.lanIf,
  });
  if (lan) {
    ensureInterfaceFromInventory(cfg, {
      ifName: lan.ifName,
      ipv4: lan.ipv4,
      ipv6: lan.ipv6,
      vrf: lan.vrf,
    });
    if (hubVrfMode === 'DEDICATED_VRF') {
      ensureBgpSegmentFromLanInventory(cfg, lan);
    }
  }
};

/** 按 inventory 补全 hubBindings 的 wan/lan inventoryId */
export const patchHubBindingsInventoryIds = (
  bindings: Srv6HubSlotBinding,
  inventory: HubInventory,
): Srv6HubSlotBinding => {
  const next: Srv6HubSlotBinding = { ...bindings };
  const wan = findWanInventoryItem(inventory, {
    id: next.wanInventoryId,
    ifName: next.wanIf,
  });
  if (wan) {
    next.wanIf = wan.ifName;
    next.wanInventoryId = wan.id;
  }
  if (next.lanIf || next.lanInventoryId) {
    const lan = findLanInventoryItem(inventory, {
      id: next.lanInventoryId,
      ifName: next.lanIf,
    });
    if (lan) {
      next.lanIf = lan.ifName;
      next.lanInventoryId = lan.id;
    }
  }
  return next;
};
