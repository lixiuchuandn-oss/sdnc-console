import type { Srv6EndpointInjectedDelta } from '../../entities/vRouter/srv6Tunnel.types';

export type ConfigJson = Record<string, unknown>;

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
    if (!arr.some((n) => neighborMatches(n as Record<string, unknown>, item.remote_ip))) {
      arr.push({
        remote_ip: item.remote_ip,
        remote_as: item.remote_as ?? 0,
      });
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

const mergeRdRt = (cfg: ConfigJson, items: Srv6EndpointInjectedDelta['rdRt']): void => {
  if (!items?.length) return;
  for (const item of items) {
    const bgp = ensureBgpBlock(cfg, item.bgpIndex);
    const afArr = Array.isArray(bgp.address_family)
      ? [...(bgp.address_family as Record<string, unknown>[])]
      : [];
    const af = findOrCreateIpv4UnicastAf(afArr);
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

const mergeOneContribution = (cfg: ConfigJson, contrib: Srv6EndpointInjectedDelta): void => {
  mergeNeighbors(cfg, contrib.neighbors);
  mergeActivateAf(cfg, contrib.activateAddressFamily);
  mergeNdc(cfg, contrib.neighborDisableConnectedCheck);
  mergeRdRt(cfg, contrib.rdRt);
  mergeIpv6Routes(cfg, contrib.ipv6Routes);
};

/**
 * Layer-2 生效配置：基线 + 按创建顺序叠加各隧道贡献（P1 merge 引擎）。
 */
export const mergeBaselineWithContributions = (
  baseline: ConfigJson,
  contributions: Srv6EndpointInjectedDelta[],
): ConfigJson => {
  const result = deepClone(baseline);
  for (const contrib of contributions) {
    if (!contrib || typeof contrib !== 'object') continue;
    mergeOneContribution(result, contrib);
  }
  return result;
};
