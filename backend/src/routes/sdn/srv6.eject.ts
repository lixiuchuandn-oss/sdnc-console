import type { Srv6EndpointInjectedDelta } from './srv6.archive.types';

/**
 * @deprecated 主路径已改为 baseline+recompute（P1 删除 / P2 创建更新）。
 * 设备删除回退仍用分阶段 eject 顺序满足 CSM lua 依赖。
 */

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

const isIpv4VpnAf = (af: Record<string, unknown>) =>
  String(af.address_family || '').toLowerCase() === 'ipv4' &&
  String(af.modifiler || af.modifier || '').toLowerCase() === 'vpn';

const deepClone = <T>(obj: T): T => JSON.parse(JSON.stringify(obj)) as T;

/**
 * CSMctl 约束：公网 BGP 无 neighbor 时不得保留 ipv4 vpn 的 activate_address_family。
 * 删除回退后做一次收尾，避免 neighbor 已摘净但 activate 仍残留导致 push 被拒。
 */
export const cleanupBgpAfterTunnelEject = (bgp: Record<string, unknown>) => {
  const neighbors = Array.isArray(bgp.neighbor)
    ? bgp.neighbor.filter((n) => n && typeof n === 'object')
    : [];
  const hasNeighbors = neighbors.length > 0;
  if (hasNeighbors) {
    bgp.neighbor = neighbors;
  } else if ('neighbor' in bgp) {
    delete bgp.neighbor;
  }

  if (Array.isArray(bgp.address_family)) {
    const kept: Record<string, unknown>[] = [];
    for (const raw of bgp.address_family) {
      if (!raw || typeof raw !== 'object') continue;
      const af = { ...(raw as Record<string, unknown>) };
      if (isIpv4VpnAf(af)) {
        if (!hasNeighbors) {
          continue;
        }
        if (Array.isArray(af.activate_address_family)) {
          const act = af.activate_address_family
            .map(String)
            .map((s) => s.trim())
            .filter(Boolean);
          if (act.length) af.activate_address_family = act;
          else delete af.activate_address_family;
        }
      }
      kept.push(af);
    }
    if (kept.length) bgp.address_family = kept;
    else delete bgp.address_family;
  }

  if (
    Array.isArray(bgp.neighbor_disable_connected_check) &&
    bgp.neighbor_disable_connected_check.length === 0
  ) {
    delete bgp.neighbor_disable_connected_check;
  }
};

const collectTouchedBgpIndices = (delta: Srv6EndpointInjectedDelta): Set<number> => {
  const indices = new Set<number>();
  for (const list of [
    delta.neighbors,
    delta.neighborDisableConnectedCheck,
    delta.activateAddressFamily,
    delta.rdRt,
  ]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (item && typeof item === 'object' && typeof (item as { bgpIndex?: number }).bgpIndex === 'number') {
        indices.add((item as { bgpIndex: number }).bgpIndex);
      }
    }
  }
  return indices;
};

const ejectActivateFromConfig = (
  config: Record<string, unknown>,
  delta: Srv6EndpointInjectedDelta,
  skipped: string[],
): void => {
  if (!Array.isArray(delta.activateAddressFamily) || !Array.isArray(config.bgp)) return;
  const bgpArr = [...(config.bgp as unknown[])];
  for (const item of delta.activateAddressFamily) {
    const bgp = bgpArr[item.bgpIndex] as Record<string, unknown> | undefined;
    if (!bgp || typeof bgp !== 'object') {
      skipped.push(`activate:bgp[${item.bgpIndex}] missing`);
      continue;
    }
    const afArr = Array.isArray(bgp.address_family) ? [...bgp.address_family] : [];
    let removed = false;
    for (let i = 0; i < afArr.length; i++) {
      const af = afArr[i] as Record<string, unknown>;
      if (!isIpv4VpnAf(af)) continue;
      const act = Array.isArray(af.activate_address_family)
        ? [...af.activate_address_family]
        : [];
      const next = act.filter((ip) => String(ip) !== String(item.peerIp));
      if (next.length !== act.length) removed = true;
      if (next.length) af.activate_address_family = next;
      else delete af.activate_address_family;
      afArr[i] = af;
    }
    if (!removed) skipped.push(`activate:${item.peerIp} not found`);
    bgp.address_family = afArr;
    bgpArr[item.bgpIndex] = bgp;
  }
  config.bgp = bgpArr;
};

const ejectNdcFromConfig = (
  config: Record<string, unknown>,
  delta: Srv6EndpointInjectedDelta,
): void => {
  if (!Array.isArray(delta.neighborDisableConnectedCheck) || !Array.isArray(config.bgp)) return;
  const bgpArr = [...(config.bgp as unknown[])];
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
  config.bgp = bgpArr;
};

const ejectNeighborsFromConfig = (
  config: Record<string, unknown>,
  delta: Srv6EndpointInjectedDelta,
  skipped: string[],
): void => {
  if (!Array.isArray(delta.neighbors) || !Array.isArray(config.bgp)) return;
  const bgpArr = [...(config.bgp as unknown[])];
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
  config.bgp = bgpArr;
};

const ejectIpv6FromConfig = (
  config: Record<string, unknown>,
  delta: Srv6EndpointInjectedDelta,
  skipped: string[],
): void => {
  if (!Array.isArray(delta.ipv6Routes)) return;
  const routes = Array.isArray(config.ipv6_route) ? [...config.ipv6_route] : [];
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
  if (routes.length) config.ipv6_route = routes;
  else delete config.ipv6_route;
};

const ejectRdRtFromConfig = (
  config: Record<string, unknown>,
  delta: Srv6EndpointInjectedDelta,
  skipped: string[],
): void => {
  if (!Array.isArray(delta.rdRt) || !Array.isArray(config.bgp)) return;
  const bgpArr = [...(config.bgp as unknown[])];
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
  config.bgp = bgpArr;
};

const finalizeBgpCleanup = (
  config: Record<string, unknown>,
  delta: Srv6EndpointInjectedDelta,
): void => {
  if (!Array.isArray(config.bgp)) return;
  const bgpArr = [...(config.bgp as unknown[])];
  for (const idx of collectTouchedBgpIndices(delta)) {
    const bgp = bgpArr[idx] as Record<string, unknown> | undefined;
    if (bgp && typeof bgp === 'object') {
      cleanupBgpAfterTunnelEject(bgp);
      bgpArr[idx] = bgp;
    }
  }
  config.bgp = bgpArr;
};

const hasPublicBgpEjectItems = (delta: Srv6EndpointInjectedDelta): boolean =>
  !!(
    delta.activateAddressFamily?.length ||
    delta.neighborDisableConnectedCheck?.length ||
    delta.neighbors?.length
  );

const configSignature = (cfg: Record<string, unknown>) => JSON.stringify(cfg);

/**
 * 设备 lua 依赖：先摘 activate → ndc → neighbor，再摘 ipv6/rdRt。
 * 返回从 currentConfig 到「仅移除本隧道 delta」的递增中间态（不含最终 recompute 态）。
 */
export const buildOrderedDeviceEjectPushStages = (
  currentConfig: Record<string, unknown>,
  delta: Srv6EndpointInjectedDelta,
): Record<string, unknown>[] => {
  if (!hasPublicBgpEjectItems(delta) && !delta.ipv6Routes?.length && !delta.rdRt?.length) {
    return [];
  }

  const stages: Record<string, unknown>[] = [];
  let cur = deepClone(currentConfig);
  const skipped: string[] = [];
  const pushStage = () => {
    const snap = deepClone(cur);
    if (!stages.length || configSignature(stages[stages.length - 1]) !== configSignature(snap)) {
      stages.push(snap);
    }
  };

  if (delta.activateAddressFamily?.length) {
    ejectActivateFromConfig(cur, delta, skipped);
    pushStage();
  }
  if (delta.neighborDisableConnectedCheck?.length) {
    ejectNdcFromConfig(cur, delta);
    pushStage();
  }
  if (delta.neighbors?.length) {
    ejectNeighborsFromConfig(cur, delta, skipped);
    finalizeBgpCleanup(cur, delta);
    pushStage();
  }
  if (delta.ipv6Routes?.length) {
    ejectIpv6FromConfig(cur, delta, skipped);
    pushStage();
  }
  if (delta.rdRt?.length) {
    ejectRdRtFromConfig(cur, delta, skipped);
    pushStage();
  }

  return stages;
};

/**
 * 从 VR 配置中移除 injectedDelta 记录的条目（仅删除仍匹配的项，避免误删用户手改内容）。
 * 顺序：activate → ndc → neighbor → ipv6 → rdRt（与设备 lua 一致）。
 */
export const ejectInjectedDeltaFromConfig = (
  config: Record<string, unknown>,
  delta?: Srv6EndpointInjectedDelta | null,
): { config: Record<string, unknown>; skipped: string[] } => {
  if (!delta) return { config, skipped: [] };
  const cloned = deepClone(config);
  const skipped: string[] = [];

  ejectActivateFromConfig(cloned, delta, skipped);
  ejectNdcFromConfig(cloned, delta);
  ejectNeighborsFromConfig(cloned, delta, skipped);
  ejectIpv6FromConfig(cloned, delta, skipped);
  ejectRdRtFromConfig(cloned, delta, skipped);
  finalizeBgpCleanup(cloned, delta);

  return { config: cloned, skipped };
};
