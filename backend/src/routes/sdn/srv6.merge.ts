import {
  SRV6_PUBLIC_EBGP_MULTIHOP,
  type Srv6EndpointInjectedDelta,
  type Srv6HubVrfMode,
} from '../../entities/vRouter/srv6Tunnel.types';
import {
  type HubInventoryBindingRef,
  materializeHubInventoryForBinding,
  parseHubInventoryFromBaseline,
  stripTowerExtensionsFromDeviceBaseline,
} from './srv6.hubInventory';

export type ConfigJson = Record<string, unknown>;

/** 单条隧道贡献 + Hub merge 上下文（P5.3） */
export type Srv6MergeContribution = {
  delta: Srv6EndpointInjectedDelta;
  /** Hub PE 槽位贡献 */
  isHubPeSlot?: boolean;
  hubVrfMode?: Srv6HubVrfMode;
  /** §14.17.6 Hub 绑定 → inventory 物化 */
  hubBindings?: HubInventoryBindingRef;
};

export type Srv6MergeContributionInput = Srv6EndpointInjectedDelta | Srv6MergeContribution;

const normalizeMergeInput = (input: Srv6MergeContributionInput): Srv6MergeContribution => {
  if (input && typeof input === 'object' && 'delta' in input && (input as Srv6MergeContribution).delta) {
    return input as Srv6MergeContribution;
  }
  return { delta: input as Srv6EndpointInjectedDelta };
};

const normIp = (raw: unknown) => String(raw ?? '').trim().toLowerCase();
const normVrf = (v: unknown) => String(v ?? '');

export const routeKey = (r: {
  destination?: unknown;
  via?: unknown;
  vrf?: unknown;
}): string => `${String(r.destination || '')}|${String(r.via || '')}|${normVrf(r.vrf)}`;

const neighborMatches = (n: Record<string, unknown>, remoteIp: string) =>
  normIp(n.remote_ip) === normIp(remoteIp);

const isIpv4VpnAf = (af: Record<string, unknown>) =>
  String(af.address_family || '').toLowerCase() === 'ipv4' &&
  String(af.modifiler || af.modifier || '').toLowerCase() === 'vpn';

const isIpv4UnicastAf = (af: Record<string, unknown>) =>
  String(af.address_family || '').toLowerCase() === 'ipv4' &&
  String(af.modifiler || af.modifier || '').toLowerCase() === 'unicast';

const deepClone = <T>(obj: T): T => JSON.parse(JSON.stringify(obj)) as T;

const ensureBgpBlock = (cfg: ConfigJson, bgpIndex: number): Record<string, unknown> => {
  if (!Array.isArray(cfg.bgp)) cfg.bgp = [];
  const bgpArr = cfg.bgp as Record<string, unknown>[];
  while (bgpArr.length <= bgpIndex) {
    bgpArr.push({ bgp_ebgp_requires_policy: 'disable', address_family: [] });
  }
  const bgp = bgpArr[bgpIndex];
  if (!bgp || typeof bgp !== 'object') {
    bgpArr[bgpIndex] = { bgp_ebgp_requires_policy: 'disable', address_family: [] };
    return bgpArr[bgpIndex] as Record<string, unknown>;
  }
  return bgp as Record<string, unknown>;
};

const findOrCreateIpv4VpnAf = (afArr: Record<string, unknown>[]): Record<string, unknown> => {
  const idx = afArr.findIndex((af) => af && typeof af === 'object' && isIpv4VpnAf(af as Record<string, unknown>));
  if (idx >= 0) return afArr[idx] as Record<string, unknown>;
  const newAf: Record<string, unknown> = {
    address_family: 'ipv4',
    modifiler: 'vpn',
    activate_address_family: [],
  };
  afArr.push(newAf);
  return newAf;
};

const findOrCreateIpv4UnicastAf = (afArr: Record<string, unknown>[]): Record<string, unknown> => {
  const idx = afArr.findIndex(
    (af) => af && typeof af === 'object' && isIpv4UnicastAf(af as Record<string, unknown>),
  );
  if (idx >= 0) return afArr[idx] as Record<string, unknown>;
  const newAf: Record<string, unknown> = {
    address_family: 'ipv4',
    modifiler: 'unicast',
    export_route: 'enable',
    import_route: 'enable',
    auto_assign_sid: 'enable',
  };
  afArr.push(newAf);
  return newAf;
};

const mergeNeighbors = (
  cfg: ConfigJson,
  items: Srv6EndpointInjectedDelta['neighbors'],
): void => {
  if (!items?.length) return;
  for (const item of items) {
    const bgp = ensureBgpBlock(cfg, item.bgpIndex);
    const arr = Array.isArray(bgp.neighbor) ? [...(bgp.neighbor as unknown[])] : [];
    const idx = arr.findIndex((n) => neighborMatches(n as Record<string, unknown>, item.remote_ip));
    if (idx < 0) {
      arr.push({
        remote_ip: item.remote_ip,
        remote_as: item.remote_as ?? 0,
        ...(item.ebgp_multihop != null ? { ebgp_multihop: item.ebgp_multihop } : {}),
      });
    } else if (item.ebgp_multihop != null || item.remote_as != null) {
      const existing = { ...(arr[idx] as Record<string, unknown>) };
      if (item.remote_as != null) existing.remote_as = item.remote_as;
      if (item.ebgp_multihop != null) existing.ebgp_multihop = item.ebgp_multihop;
      arr[idx] = existing;
    }
    bgp.neighbor = arr;
  }
};

const mergeActivateAf = (
  cfg: ConfigJson,
  items: Srv6EndpointInjectedDelta['activateAddressFamily'],
): void => {
  if (!items?.length) return;
  for (const item of items) {
    const bgp = ensureBgpBlock(cfg, item.bgpIndex);
    const afArr = Array.isArray(bgp.address_family)
      ? [...(bgp.address_family as Record<string, unknown>[])]
      : [];
    const af = findOrCreateIpv4VpnAf(afArr);
    const act = Array.isArray(af.activate_address_family)
      ? [...(af.activate_address_family as unknown[]).map(String)]
      : [];
    if (!act.some((ip) => normIp(ip) === normIp(item.peerIp))) {
      act.push(item.peerIp);
    }
    af.activate_address_family = act;
    bgp.address_family = afArr;
  }
};

const mergeNdc = (
  cfg: ConfigJson,
  items: Srv6EndpointInjectedDelta['neighborDisableConnectedCheck'],
): void => {
  if (!items?.length) return;
  for (const item of items) {
    const bgp = ensureBgpBlock(cfg, item.bgpIndex);
    const arr = Array.isArray(bgp.neighbor_disable_connected_check)
      ? [...(bgp.neighbor_disable_connected_check as unknown[]).map(String)]
      : [];
    if (!arr.some((ip) => normIp(ip) === normIp(item.remote_ip))) {
      arr.push(item.remote_ip);
    }
    bgp.neighbor_disable_connected_check = arr;
  }
};

const mergeRdRt = (
  cfg: ConfigJson,
  items: Srv6EndpointInjectedDelta['rdRt'],
  options?: { hubReuseSkipExisting?: boolean },
): void => {
  if (!items?.length) return;
  for (const item of items) {
    const bgp = ensureBgpBlock(cfg, item.bgpIndex);
    const afArr = Array.isArray(bgp.address_family)
      ? [...(bgp.address_family as Record<string, unknown>[])]
      : [];
    const af = findOrCreateIpv4UnicastAf(afArr);
    const hasExistingRd =
      af.route_distinguisher !== undefined &&
      af.route_distinguisher !== null &&
      String(af.route_distinguisher) !== '';
    if (options?.hubReuseSkipExisting && hasExistingRd) {
      bgp.address_family = afArr;
      continue;
    }
    af.route_distinguisher = item.route_distinguisher;
    af.route_target = item.route_target;
    delete (af as Record<string, unknown>).modifier;
    bgp.address_family = afArr;
  }
};

const mergeIpv6Routes = (
  cfg: ConfigJson,
  items: Srv6EndpointInjectedDelta['ipv6Routes'],
): void => {
  if (!items?.length) return;
  const routes = Array.isArray(cfg.ipv6_route)
    ? [...(cfg.ipv6_route as Record<string, unknown>[])]
    : [];
  for (const item of items) {
    const key = routeKey(item);
    if (!routes.some((r) => routeKey(r as Record<string, unknown>) === key)) {
      const row: Record<string, unknown> = {
        destination: item.destination,
        via: item.via,
      };
      if (item.vrf !== undefined && item.vrf !== null && String(item.vrf) !== '') {
        row.vrf = item.vrf;
      }
      routes.push(row);
    }
  }
  if (routes.length) cfg.ipv6_route = routes;
};

const mergeOneContribution = (cfg: ConfigJson, packed: Srv6MergeContribution): void => {
  const contrib = packed.delta;
  const hubReuseVrf = !!(packed.isHubPeSlot && packed.hubVrfMode === 'REUSE_VRF');
  mergeNeighbors(cfg, contrib.neighbors);
  mergeActivateAf(cfg, contrib.activateAddressFamily);
  mergeNdc(cfg, contrib.neighborDisableConnectedCheck);
  mergeRdRt(cfg, contrib.rdRt, { hubReuseSkipExisting: hubReuseVrf });
  mergeIpv6Routes(cfg, contrib.ipv6Routes);
};

/**
 * 旧档案可能只有 NDC、没有 ebgp_multihop。
 * NDC 是 PE–PE / RR 公网邻居标记；CE LAN 贡献不写 NDC，故不会被误加 255。
 */
const backfillPublicEbgpMultihop = (cfg: ConfigJson): void => {
  if (!Array.isArray(cfg.bgp)) return;
  for (const rawBgp of cfg.bgp) {
    if (!rawBgp || typeof rawBgp !== 'object') continue;
    const bgp = rawBgp as Record<string, unknown>;
    const ndc = Array.isArray(bgp.neighbor_disable_connected_check)
      ? (bgp.neighbor_disable_connected_check as unknown[]).map((ip) => normIp(ip)).filter(Boolean)
      : [];
    if (!ndc.length) continue;
    const ndcSet = new Set(ndc);
    const neighbors = Array.isArray(bgp.neighbor) ? [...(bgp.neighbor as unknown[])] : [];
    let changed = false;
    const next = neighbors.map((raw) => {
      if (!raw || typeof raw !== 'object') return raw;
      const n = raw as Record<string, unknown>;
      if (!ndcSet.has(normIp(n.remote_ip))) return raw;
      if (n.ebgp_multihop != null) return raw;
      changed = true;
      return { ...n, ebgp_multihop: SRV6_PUBLIC_EBGP_MULTIHOP };
    });
    if (changed) bgp.neighbor = next;
  }
};

/**
 * Layer-2 生效配置：基线 + 按创建顺序叠加各隧道贡献（P1 merge 引擎；P5.3 Hub 分支）。
 */
export const mergeBaselineWithContributions = (
  baseline: ConfigJson,
  contributions: Srv6MergeContributionInput[],
): ConfigJson => {
  const hubInventory = parseHubInventoryFromBaseline(baseline);
  const deviceBaseline = stripTowerExtensionsFromDeviceBaseline(baseline);
  const result = deepClone(deviceBaseline);
  for (const raw of contributions) {
    const packed = normalizeMergeInput(raw);
    if (
      packed.isHubPeSlot &&
      packed.hubBindings &&
      (hubInventory.wan.length > 0 || hubInventory.lan.length > 0)
    ) {
      materializeHubInventoryForBinding(result, {
        inventory: hubInventory,
        binding: packed.hubBindings,
        hubVrfMode: packed.hubVrfMode,
      });
    }
    if (!packed.delta || typeof packed.delta !== 'object') continue;
    mergeOneContribution(result, packed);
  }
  backfillPublicEbgpMultihop(result);
  return result;
};
