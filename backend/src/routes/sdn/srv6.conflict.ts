import type {
  Srv6EndpointInjectedDelta,
  Srv6HubVrfMode,
} from '../../entities/vRouter/srv6Tunnel.types';
import type { Srv6AliveContribution } from './srv6.recompute';
import { routeKey } from './srv6.merge';

export type Srv6ContributionConflict = {
  code: string;
  message: string;
  tunnelId?: string;
  tunnelName?: string;
};

export type Srv6InnerIfMeta = {
  innerIf?: string | null;
  innerVrf?: string | number | null;
};

export type DetectContributionConflictsOptions = {
  innerIfMeta?: Srv6InnerIfMeta;
  existingInnerIfMetas?: Array<Srv6InnerIfMeta & { tunnelId: string; tunnelName: string }>;
  /** Hub PE 槽位：公网 neighbor 才作 C-N1；REUSE_VRF 允许复用内网段 */
  hubPeSlot?: boolean;
  hubVrfMode?: Srv6HubVrfMode;
  /** Hub 路线 A：Hub 侧 CE 槽位与已有隧道贡献幂等，不做 pairwise 检测 */
  sharedCeReuse?: boolean;
};

export type PickPrimaryConflictsOptions = {
  hubTunnel?: boolean;
  hubVrfMode?: Srv6HubVrfMode;
};

const normIp = (raw: unknown) => String(raw ?? '').trim().toLowerCase();
const normVrf = (v: unknown) => String(v ?? '');
const normIf = (v: unknown) => String(v ?? '').trim();

const neighborKey = (bgpIndex: number, remoteIp: string) => `${bgpIndex}|${normIp(remoteIp)}`;

/** merge 幂等：Hub 多隧道共用 VRF 时固定的 ::/0 注入项 */
export const isIdempotentHubIpv6Route = (r: {
  destination?: unknown;
  via?: unknown;
}): boolean => {
  const dest = String(r.destination ?? '').trim().toLowerCase();
  const via = String(r.via ?? '').trim();
  return dest === '::/0' && via === 'nexthop-vrf 0';
};

const HUB_DEDICATED_BLOCKING_CODES = new Set([
  'C-N1',
  'C-N2',
  'C-R1',
  'C-R2',
  'C-I1',
  'C-V1',
  'NO_BASELINE',
]);

const baselineNeighbors = (baseline: Record<string, unknown>): Map<string, { remote_as?: number }> => {
  const out = new Map<string, { remote_as?: number }>();
  const bgpArr = Array.isArray(baseline.bgp) ? (baseline.bgp as Record<string, unknown>[]) : [];
  bgpArr.forEach((bgp, bgpIndex) => {
    const neighbors = Array.isArray(bgp?.neighbor) ? (bgp.neighbor as Record<string, unknown>[]) : [];
    for (const n of neighbors) {
      const ip = String(n.remote_ip || '');
      if (!ip) continue;
      out.set(neighborKey(bgpIndex, ip), { remote_as: n.remote_as as number | undefined });
    }
  });
  return out;
};

const checkNeighborOverlap = (
  newItems: Srv6EndpointInjectedDelta['neighbors'],
  oldItems: Srv6EndpointInjectedDelta['neighbors'],
  ref: Srv6AliveContribution,
  options?: { publicOnly?: boolean },
): Srv6ContributionConflict[] => {
  const conflicts: Srv6ContributionConflict[] = [];
  if (!newItems?.length || !oldItems?.length) return conflicts;
  for (const n of newItems) {
    if (options?.publicOnly && n.bgpIndex !== 0) continue;
    for (const o of oldItems) {
      if (options?.publicOnly && o.bgpIndex !== 0) continue;
      if (n.bgpIndex === o.bgpIndex && normIp(n.remote_ip) === normIp(o.remote_ip)) {
        conflicts.push({
          code: 'C-N1',
          message: `公网 BGP 邻居 ${n.remote_ip} 已被隧道「${ref.tunnelName}」使用`,
          tunnelId: ref.tunnelId,
          tunnelName: ref.tunnelName,
        });
      }
    }
  }
  return conflicts;
};

const checkBaselineNeighborCollision = (
  newItems: Srv6EndpointInjectedDelta['neighbors'],
  baseline: Record<string, unknown>,
): Srv6ContributionConflict[] => {
  const conflicts: Srv6ContributionConflict[] = [];
  if (!newItems?.length) return conflicts;
  const base = baselineNeighbors(baseline);
  for (const n of newItems) {
    const key = neighborKey(n.bgpIndex, n.remote_ip);
    if (base.has(key)) {
      conflicts.push({
        code: 'C-N2',
        message: `邻居 ${n.remote_ip} 已在角色配置向导的基线中，请勿重复创建隧道；如需调整请先在向导中修改后再建隧道`,
      });
    }
  }
  return conflicts;
};

const checkActivateOverlap = (
  newItems: Srv6EndpointInjectedDelta['activateAddressFamily'],
  oldItems: Srv6EndpointInjectedDelta['activateAddressFamily'],
  ref: Srv6AliveContribution,
  options?: { publicOnly?: boolean },
): Srv6ContributionConflict[] => {
  const conflicts: Srv6ContributionConflict[] = [];
  if (!newItems?.length || !oldItems?.length) return conflicts;
  for (const n of newItems) {
    if (options?.publicOnly && n.bgpIndex !== 0) continue;
    for (const o of oldItems) {
      if (options?.publicOnly && o.bgpIndex !== 0) continue;
      if (n.bgpIndex === o.bgpIndex && normIp(n.peerIp) === normIp(o.peerIp)) {
        conflicts.push({
          code: 'C-A1',
          message: `公网 VPN 已激活对端 ${n.peerIp}（隧道「${ref.tunnelName}」）`,
          tunnelId: ref.tunnelId,
          tunnelName: ref.tunnelName,
        });
      }
    }
  }
  return conflicts;
};

const checkNdcOverlap = (
  newItems: Srv6EndpointInjectedDelta['neighborDisableConnectedCheck'],
  oldItems: Srv6EndpointInjectedDelta['neighborDisableConnectedCheck'],
  ref: Srv6AliveContribution,
  options?: { publicOnly?: boolean },
): Srv6ContributionConflict[] => {
  const conflicts: Srv6ContributionConflict[] = [];
  if (!newItems?.length || !oldItems?.length) return conflicts;
  for (const n of newItems) {
    if (options?.publicOnly && n.bgpIndex !== 0) continue;
    for (const o of oldItems) {
      if (options?.publicOnly && o.bgpIndex !== 0) continue;
      if (n.bgpIndex === o.bgpIndex && normIp(n.remote_ip) === normIp(o.remote_ip)) {
        conflicts.push({
          code: 'C-D1',
          message: `公网邻居 ${n.remote_ip} 的直连检查豁免已与隧道「${ref.tunnelName}」重复配置`,
          tunnelId: ref.tunnelId,
          tunnelName: ref.tunnelName,
        });
      }
    }
  }
  return conflicts;
};

const checkRdRtOverlap = (
  newItems: Srv6EndpointInjectedDelta['rdRt'],
  oldItems: Srv6EndpointInjectedDelta['rdRt'],
  ref: Srv6AliveContribution,
  options?: { skipSameBgpIndex?: boolean; skipRtRdValueOverlap?: boolean },
): Srv6ContributionConflict[] => {
  const conflicts: Srv6ContributionConflict[] = [];
  if (!newItems?.length || !oldItems?.length) return conflicts;
  for (const n of newItems) {
    for (const o of oldItems) {
      if (n.bgpIndex === o.bgpIndex) {
        if (options?.skipSameBgpIndex) continue;
        conflicts.push({
          code: 'C-R1',
          message: `内网 VPN 的路由标识（RD/RT）已被隧道「${ref.tunnelName}」占用`,
          tunnelId: ref.tunnelId,
          tunnelName: ref.tunnelName,
        });
      }
      if (options?.skipRtRdValueOverlap) continue;
      if (
        (n.route_distinguisher && n.route_distinguisher === o.route_distinguisher) ||
        (n.route_target && n.route_target === o.route_target)
      ) {
        conflicts.push({
          code: 'C-R2',
          message: `路由标识 ${n.route_distinguisher || n.route_target} 与隧道「${ref.tunnelName}」重复`,
          tunnelId: ref.tunnelId,
          tunnelName: ref.tunnelName,
        });
      }
    }
  }
  return conflicts;
};

const checkIpv6Overlap = (
  newItems: Srv6EndpointInjectedDelta['ipv6Routes'],
  oldItems: Srv6EndpointInjectedDelta['ipv6Routes'],
  ref: Srv6AliveContribution,
  options?: { skipIdempotentHubRoutes?: boolean },
): Srv6ContributionConflict[] => {
  const conflicts: Srv6ContributionConflict[] = [];
  if (!newItems?.length || !oldItems?.length) return conflicts;
  for (const n of newItems) {
    for (const o of oldItems) {
      if (
        options?.skipIdempotentHubRoutes &&
        isIdempotentHubIpv6Route(n) &&
        isIdempotentHubIpv6Route(o)
      ) {
        continue;
      }
      if (routeKey(n) === routeKey(o)) {
        conflicts.push({
          code: 'C-V1',
          message: `IPv6 路由 ${n.destination}（下一跳 ${n.via}）已被隧道「${ref.tunnelName}」使用`,
          tunnelId: ref.tunnelId,
          tunnelName: ref.tunnelName,
        });
      }
    }
  }
  return conflicts;
};

/** C-I1：Hub PE 同内网口 + 同 VRF 已被其它隧道占用 */
export const checkInnerIfVrfOverlap = (
  newMeta: Srv6InnerIfMeta,
  existingMeta: Srv6InnerIfMeta,
  ref: { tunnelId: string; tunnelName: string },
): Srv6ContributionConflict[] => {
  const innerIf = normIf(newMeta.innerIf);
  const vrf = normVrf(newMeta.innerVrf);
  const exIf = normIf(existingMeta.innerIf);
  const exVrf = normVrf(existingMeta.innerVrf);
  if (!innerIf || !vrf || !exIf || !exVrf) return [];
  if (innerIf === exIf && vrf === exVrf) {
    return [
      {
        code: 'C-I1',
        message: `内网口 ${innerIf}（VRF ${vrf}）已被隧道「${ref.tunnelName}」占用`,
        tunnelId: ref.tunnelId,
        tunnelName: ref.tunnelName,
      },
    ];
  }
  return [];
};

const dedupeConflicts = (conflicts: Srv6ContributionConflict[]): Srv6ContributionConflict[] => {
  const seen = new Set<string>();
  return conflicts.filter((c) => {
    const key = `${c.code}|${c.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * 检测新贡献与已有存活贡献、基线的冲突（P3 Hub 多隧道；P5 REUSE / DEDICATED 分支）。
 */
export const detectContributionConflicts = (
  newContrib: Srv6EndpointInjectedDelta,
  existingRefs: Srv6AliveContribution[],
  baseline: Record<string, unknown>,
  options?: DetectContributionConflictsOptions,
): Srv6ContributionConflict[] => {
  if (options?.sharedCeReuse) {
    return [];
  }

  const conflicts: Srv6ContributionConflict[] = [];
  const reuseVrf = options?.hubPeSlot && options?.hubVrfMode === 'REUSE_VRF';
  const dedicatedHubPe = options?.hubPeSlot && options?.hubVrfMode === 'DEDICATED_VRF';
  const publicOnlyNeighbor = !!options?.hubPeSlot;

  for (const ref of existingRefs) {
    const old = ref.contribution;
    conflicts.push(
      ...checkNeighborOverlap(newContrib.neighbors, old.neighbors, ref, {
        publicOnly: publicOnlyNeighbor,
      }),
    );

    if (!options?.hubPeSlot) {
      conflicts.push(
        ...checkActivateOverlap(newContrib.activateAddressFamily, old.activateAddressFamily, ref),
      );
      conflicts.push(
        ...checkNdcOverlap(
          newContrib.neighborDisableConnectedCheck,
          old.neighborDisableConnectedCheck,
          ref,
        ),
      );
    }

    conflicts.push(
      ...checkRdRtOverlap(newContrib.rdRt, old.rdRt, ref, {
        skipSameBgpIndex: reuseVrf,
        skipRtRdValueOverlap: reuseVrf,
      }),
    );
    conflicts.push(
      ...checkIpv6Overlap(newContrib.ipv6Routes, old.ipv6Routes, ref, {
        skipIdempotentHubRoutes: reuseVrf,
      }),
    );
  }

  conflicts.push(...checkBaselineNeighborCollision(newContrib.neighbors, baseline));

  if (options?.innerIfMeta && options.existingInnerIfMetas?.length) {
    if (dedicatedHubPe) {
      for (const ex of options.existingInnerIfMetas) {
        conflicts.push(
          ...checkInnerIfVrfOverlap(options.innerIfMeta, ex, {
            tunnelId: ex.tunnelId,
            tunnelName: ex.tunnelName,
          }),
        );
      }
    }
  }

  return dedupeConflicts(conflicts);
};

export const formatSrv6ContributionConflicts = (conflicts: Srv6ContributionConflict[]): string => {
  if (!conflicts.length) return '';
  const detail = conflicts.map((c) => c.message).join('；');
  return `无法保存隧道：与已有隧道的网络配置冲突。${detail}`;
};

/** H6：Hub 场景仅返回 Blocking 类冲突；REUSE_VRF 仅 C-H1（在 hub 层）与 NO_BASELINE */
export const pickPrimaryConflicts = (
  conflicts: Srv6ContributionConflict[],
  options?: PickPrimaryConflictsOptions,
): Srv6ContributionConflict[] => {
  const cH1 = conflicts.filter((c) => c.code === 'C-H1');
  if (cH1.length) return cH1;

  if (options?.hubTunnel && options?.hubVrfMode === 'REUSE_VRF') {
    return conflicts.filter((c) => c.code === 'NO_BASELINE');
  }

  if (options?.hubTunnel) {
    return conflicts.filter((c) => HUB_DEDICATED_BLOCKING_CODES.has(c.code));
  }

  return conflicts;
};
