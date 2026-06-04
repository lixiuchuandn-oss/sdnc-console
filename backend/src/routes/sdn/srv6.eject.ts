import type { Srv6EndpointInjectedDelta } from './srv6.archive.types';

const vrfKey = (v: unknown) => String(v ?? '');

const routeMatches = (
  route: Record<string, unknown>,
  target: { destination: string; via: string; vrf?: string | number | null },
) =>
  String(route.destination || '') === String(target.destination) &&
  String(route.via || '') === String(target.via) &&
  vrfKey(route.vrf) === vrfKey(target.vrf ?? '');

const neighborMatches = (
  n: Record<string, unknown>,
  target: { remote_ip: string },
) => String(n.remote_ip || '') === String(target.remote_ip);

/**
 * 从 VR 配置中移除 injectedDelta 记录的条目（仅删除仍匹配的项，避免误删用户手改内容）。
 */
export const ejectInjectedDeltaFromConfig = (
  config: Record<string, unknown>,
  delta?: Srv6EndpointInjectedDelta | null,
): { config: Record<string, unknown>; skipped: string[] } => {
  if (!delta) return { config, skipped: [] };
  const cloned = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
  const skipped: string[] = [];

  if (Array.isArray(delta.neighbors) && Array.isArray(cloned.bgp)) {
    const bgpArr = [...(cloned.bgp as unknown[])];
    for (const item of delta.neighbors) {
      const idx = item.bgpIndex;
      const bgp = bgpArr[idx] as Record<string, unknown> | undefined;
      if (!bgp || typeof bgp !== 'object') {
        skipped.push(`neighbor:bgp[${idx}] missing`);
        continue;
      }
      const neighbors = Array.isArray(bgp.neighbor) ? [...bgp.neighbor] : [];
      const before = neighbors.length;
      const filtered = neighbors.filter(
        (n) => !neighborMatches(n as Record<string, unknown>, item),
      );
      if (filtered.length === before) {
        skipped.push(`neighbor:${item.remote_ip} not found`);
      }
      bgp.neighbor = filtered;
      bgpArr[idx] = bgp;
    }
    cloned.bgp = bgpArr;
  }

  if (Array.isArray(delta.neighborDisableConnectedCheck) && Array.isArray(cloned.bgp)) {
    const bgpArr = [...(cloned.bgp as unknown[])];
    for (const item of delta.neighborDisableConnectedCheck) {
      const bgp = bgpArr[item.bgpIndex] as Record<string, unknown> | undefined;
      if (!bgp || typeof bgp !== 'object') continue;
      const ndc = Array.isArray(bgp.neighbor_disable_connected_check)
        ? [...bgp.neighbor_disable_connected_check]
        : [];
      bgp.neighbor_disable_connected_check = ndc.filter(
        (ip) => String(ip) !== String(item.remote_ip),
      );
      bgpArr[item.bgpIndex] = bgp;
    }
    cloned.bgp = bgpArr;
  }

  if (Array.isArray(delta.activateAddressFamily) && Array.isArray(cloned.bgp)) {
    const bgpArr = [...(cloned.bgp as unknown[])];
    for (const item of delta.activateAddressFamily) {
      const bgp = bgpArr[item.bgpIndex] as Record<string, unknown> | undefined;
      if (!bgp || typeof bgp !== 'object') continue;
      const afArr = Array.isArray(bgp.address_family) ? [...bgp.address_family] : [];
      for (let i = 0; i < afArr.length; i++) {
        const af = afArr[i] as Record<string, unknown>;
        if (String(af?.address_family || '').toLowerCase() !== 'ipv4') continue;
        const mod = String(af.modifiler || af.modifier || '').toLowerCase();
        if (mod !== 'vpn') continue;
        const act = Array.isArray(af.activate_address_family)
          ? [...af.activate_address_family]
          : [];
        af.activate_address_family = act.filter((ip) => String(ip) !== String(item.peerIp));
        afArr[i] = af;
      }
      bgp.address_family = afArr;
      bgpArr[item.bgpIndex] = bgp;
    }
    cloned.bgp = bgpArr;
  }

  if (Array.isArray(delta.ipv6Routes)) {
    const routes = Array.isArray(cloned.ipv6_route) ? [...cloned.ipv6_route] : [];
    for (const item of delta.ipv6Routes) {
      const before = routes.length;
      const filtered = routes.filter(
        (r) => !routeMatches(r as Record<string, unknown>, item),
      );
      if (filtered.length === before) {
        skipped.push(`ipv6_route:${item.destination}`);
      }
      routes.splice(0, routes.length, ...filtered);
    }
    if (routes.length) cloned.ipv6_route = routes;
    else delete cloned.ipv6_route;
  }

  if (Array.isArray(delta.rdRt) && Array.isArray(cloned.bgp)) {
    const bgpArr = [...(cloned.bgp as unknown[])];
    for (const item of delta.rdRt) {
      const bgp = bgpArr[item.bgpIndex] as Record<string, unknown> | undefined;
      if (!bgp || typeof bgp !== 'object') {
        skipped.push(`rdRt:bgp[${item.bgpIndex}] missing`);
        continue;
      }
      const afArr = Array.isArray(bgp.address_family) ? [...bgp.address_family] : [];
      let touched = false;
      for (let i = 0; i < afArr.length; i++) {
        const af = afArr[i] as Record<string, unknown>;
        const mod = String(af.modifiler || af.modifier || '').toLowerCase();
        if (String(af.address_family || '').toLowerCase() !== 'ipv4' || mod !== 'unicast') continue;
        if (
          String(af.route_distinguisher || '') === String(item.route_distinguisher) &&
          String(af.route_target || '') === String(item.route_target)
        ) {
          delete af.route_distinguisher;
          delete af.route_target;
          afArr[i] = af;
          touched = true;
        }
      }
      if (!touched) skipped.push(`rdRt:bgp[${item.bgpIndex}]`);
      bgp.address_family = afArr;
      bgpArr[item.bgpIndex] = bgp;
    }
    cloned.bgp = bgpArr;
  }

  return { config: cloned, skipped };
};
