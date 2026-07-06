import { AppDataSource } from '../../config/database';
import { SRv6Tunnel } from '../../entities/vRouter/SRv6Tunnel';
import { VRConfig } from '../../entities/vRouter/VRConfig';
import type {
  Srv6EndpointFingerprint,
  Srv6EndpointSlot,
  Srv6HubSlotBinding,
  Srv6HubVrfMode,
  Srv6TunnelTopology,
} from '../../entities/vRouter/srv6Tunnel.types';
import { parseSrv6Baseline } from './srv6.baseline';
import {
  buildHubInventoryUi,
  getHubInventoryFromVrRecord,
  mergeInventoryWithBaselineCandidates,
  type HubInventory,
  type HubInventoryUi,
} from './srv6.hubInventory';
import {
  detectContributionConflicts,
  formatSrv6ContributionConflicts,
  pickPrimaryConflicts,
  type Srv6ContributionConflict,
  type Srv6InnerIfMeta,
} from './srv6.conflict';
import { listAliveContributionsForVr } from './srv6.recompute';
import { normalizeVrRole } from './srv6.roles';

const tunnelRepo = () => AppDataSource.getRepository(SRv6Tunnel);
const vrRepo = () => AppDataSource.getRepository(VRConfig);

export type Srv6HubTunnelRef = {
  tunnelId: string;
  tunnelName: string;
  slot: Srv6EndpointSlot;
  peAInnerIf?: string | null;
  peBInnerIf?: string | null;
  ceA?: string | null;
  ceB?: string | null;
  innerIfMeta?: Srv6InnerIfMeta;
  tunnelTopology?: Srv6TunnelTopology | null;
  hubPeSlot?: 'peA' | 'peB' | null;
  hubVrfMode?: Srv6HubVrfMode | null;
  hubBindings?: Srv6HubSlotBinding | null;
};

export type Srv6HubPortRegistryEntry = {
  tunnelId: string;
  tunnelName: string;
  hubPeSlot: 'peA' | 'peB';
  wanIf: string;
  lanIf?: string;
  /** Hub LAN inventory 行 id（与 ifName+VRF 一一对应；优先于仅 ifName 匹配） */
  lanInventoryId?: string;
  peerPublicNeighbor: string;
  spokePeUuid: string;
  hubVrfMode?: Srv6HubVrfMode | null;
};

export type Srv6HubVrStatus = {
  vrUuid: string;
  tunnelCount: number;
  isHub: boolean;
  role?: string | null;
  tunnels: Srv6HubTunnelRef[];
  portRegistry: Srv6HubPortRegistryEntry[];
  /** §14.17 · Hub PE 基线 inventory */
  hubInventory: HubInventory;
  hubInventoryUi: HubInventoryUi;
};

const slotLabel = (slot: Srv6EndpointSlot) =>
  ({ peA: 'PE-A', peB: 'PE-B', ceA: 'CE-A', ceB: 'CE-B' } as const)[slot];

const normIp = (raw: unknown) => String(raw ?? '').trim().toLowerCase();

const innerIfForSlot = (tunnel: SRv6Tunnel, slot: Srv6EndpointSlot): string | null | undefined => {
  if (slot === 'peA') return tunnel.peAInnerIf;
  if (slot === 'peB') return tunnel.peBInnerIf;
  return undefined;
};

const peInnerVrfFromFingerprint = (
  fp: Srv6EndpointFingerprint | null | undefined,
  slot: 'peA' | 'peB',
): string | number | null | undefined => fp?.[slot]?.innerVrf;

export const isHubTunnel = (tunnel: Pick<SRv6Tunnel, 'tunnelTopology'>): boolean =>
  tunnel.tunnelTopology === 'H';

export const getHubPeUuid = (tunnel: Pick<SRv6Tunnel, 'hubPeSlot' | 'peA' | 'peB'>): string | null => {
  if (tunnel.hubPeSlot === 'peA') return tunnel.peA;
  if (tunnel.hubPeSlot === 'peB') return tunnel.peB;
  return null;
};

/** C-H1 · Blocking：(hubPeUuid, peerPublicNeighbor) 唯一（纯函数，便于单测） */
export const findHubBlockingConflictAmong = (
  tunnel: Pick<SRv6Tunnel, 'id' | 'tunnelTopology' | 'hubBindings'>,
  others: Array<Pick<SRv6Tunnel, 'id' | 'name' | 'tunnelTopology' | 'hubBindings'>>,
  excludeTunnelId?: string,
): Srv6ContributionConflict | null => {
  if (!isHubTunnel(tunnel) || !tunnel.hubBindings?.peerPublicNeighbor) return null;
  const { hubPeUuid, peerPublicNeighbor } = tunnel.hubBindings;
  for (const t of others) {
    if (excludeTunnelId && t.id === excludeTunnelId) continue;
    if (tunnel.id && t.id === tunnel.id) continue;
    if (!isHubTunnel(t) || !t.hubBindings) continue;
    if (normIp(t.hubBindings.hubPeUuid) !== normIp(hubPeUuid)) continue;
    if (normIp(t.hubBindings.peerPublicNeighbor) === normIp(peerPublicNeighbor)) {
      return {
        code: 'C-H1',
        message: `公网 BGP 邻居 ${peerPublicNeighbor} 已在 Hub 设备上被隧道「${t.name}」使用`,
        tunnelId: t.id,
        tunnelName: t.name,
      };
    }
  }
  return null;
};

export const findHubBlockingConflict = async (
  tunnel: Pick<SRv6Tunnel, 'id' | 'tunnelTopology' | 'hubBindings'>,
  excludeTunnelId?: string,
): Promise<Srv6ContributionConflict | null> => {
  const all = await tunnelRepo().find();
  return findHubBlockingConflictAmong(tunnel, all, excludeTunnelId);
};

export const resolveHubLanIfFromTunnel = (
  tunnel: Pick<SRv6Tunnel, 'hubBindings' | 'peAInnerIf' | 'peBInnerIf'>,
): string | undefined => {
  const bindings = tunnel.hubBindings;
  if (!bindings) return undefined;
  const explicit = String(bindings.lanIf ?? '').trim();
  if (explicit) return explicit;
  const slot = bindings.hubPeSlot;
  if (slot === 'peA') return String(tunnel.peAInnerIf ?? '').trim() || undefined;
  if (slot === 'peB') return String(tunnel.peBInnerIf ?? '').trim() || undefined;
  return undefined;
};

export const buildHubPortRegistryFromTunnels = (
  vrUuid: string,
  tunnels: Array<
    Pick<SRv6Tunnel, 'id' | 'name' | 'tunnelTopology' | 'hubBindings' | 'hubVrfMode' | 'peAInnerIf' | 'peBInnerIf'>
  >,
): Srv6HubPortRegistryEntry[] => {
  const id = String(vrUuid || '').trim();
  if (!id) return [];
  const entries: Srv6HubPortRegistryEntry[] = [];
  for (const t of tunnels) {
    if (!isHubTunnel(t) || !t.hubBindings) continue;
    if (normIp(t.hubBindings.hubPeUuid) !== normIp(id)) continue;
    entries.push({
      tunnelId: t.id,
      tunnelName: t.name,
      hubPeSlot: t.hubBindings.hubPeSlot,
      wanIf: t.hubBindings.wanIf,
      lanIf: resolveHubLanIfFromTunnel(t),
      lanInventoryId: t.hubBindings.lanInventoryId,
      peerPublicNeighbor: t.hubBindings.peerPublicNeighbor,
      spokePeUuid: t.hubBindings.spokePeUuid,
      hubVrfMode: t.hubVrfMode ?? undefined,
    });
  }
  return entries;
};

/** 聚合 Hub PE 口占用表（按 hubBindings.hubPeUuid） */
export const buildHubPortRegistryForVr = async (vrUuid: string): Promise<Srv6HubPortRegistryEntry[]> => {
  const all = await tunnelRepo().find();
  return buildHubPortRegistryFromTunnels(vrUuid, all);
};

/** P3/P5：列出引用该 VR 的存活隧道（含槽位与 Hub 档案摘要） */
export const findAliveTunnelsByVr = async (vrUuid: string): Promise<Srv6HubVrStatus> => {
  const id = String(vrUuid || '').trim();
  const contribs = await listAliveContributionsForVr(id);
  const tunnels: Srv6HubTunnelRef[] = [];
  const vrRow = await vrRepo().findOne({ where: { uuid: id } });

  for (const c of contribs) {
    const tunnel = await tunnelRepo().findOne({ where: { id: c.tunnelId } });
    if (!tunnel) continue;
    const innerIf = innerIfForSlot(tunnel, c.slot);
    const innerVrf =
      c.slot === 'peA' || c.slot === 'peB'
        ? peInnerVrfFromFingerprint(tunnel.endpointFingerprint ?? undefined, c.slot)
        : undefined;
    tunnels.push({
      tunnelId: tunnel.id,
      tunnelName: tunnel.name,
      slot: c.slot,
      peAInnerIf: tunnel.peAInnerIf,
      peBInnerIf: tunnel.peBInnerIf,
      ceA: tunnel.ceA,
      ceB: tunnel.ceB,
      innerIfMeta:
        c.slot === 'peA' || c.slot === 'peB'
          ? { innerIf: innerIf ?? undefined, innerVrf }
          : undefined,
      tunnelTopology: tunnel.tunnelTopology ?? undefined,
      hubPeSlot: tunnel.hubPeSlot ?? undefined,
      hubVrfMode: tunnel.hubVrfMode ?? undefined,
      hubBindings: tunnel.hubBindings ?? undefined,
    });
  }

  const portRegistry = await buildHubPortRegistryForVr(id);
  const role = vrRow?.role ?? null;
  const persistedInventory = getHubInventoryFromVrRecord(vrRow);
  const baseline = vrRow ? parseSrv6Baseline(vrRow) : null;
  const displayInventory = mergeInventoryWithBaselineCandidates(persistedInventory, baseline);
  const hubInventoryUi = buildHubInventoryUi(displayInventory, portRegistry);

  return {
    vrUuid: id,
    tunnelCount: tunnels.length,
    isHub: normalizeVrRole(role) === 'HUB_PE' || portRegistry.length > 0,
    role,
    tunnels,
    portRegistry,
    hubInventory: persistedInventory,
    hubInventoryUi,
  };
};

const buildExistingInnerIfMetas = async (
  vrUuid: string,
  slot: Srv6EndpointSlot,
  excludeTunnelId?: string,
): Promise<Array<Srv6InnerIfMeta & { tunnelId: string; tunnelName: string }>> => {
  if (slot !== 'peA' && slot !== 'peB') return [];
  const hub = await findAliveTunnelsByVr(vrUuid);
  return hub.tunnels
    .filter((t) => t.slot === slot && (!excludeTunnelId || t.tunnelId !== excludeTunnelId))
    .map((t) => ({
      tunnelId: t.tunnelId,
      tunnelName: t.tunnelName,
      innerIf: t.innerIfMeta?.innerIf,
      innerVrf: t.innerIfMeta?.innerVrf,
    }));
};

const isHubPeSlotForTunnel = (tunnel: SRv6Tunnel, slot: Srv6EndpointSlot): boolean =>
  isHubTunnel(tunnel) && tunnel.hubPeSlot === slot;

/** 路线 A · REUSE_VRF：Hub 侧 CE（与 Hub PE 同侧）贡献与首条隧道幂等 */
const isHubSharedCeSlot = (tunnel: SRv6Tunnel, slot: Srv6EndpointSlot): boolean => {
  if (!isHubTunnel(tunnel) || tunnel.hubVrfMode !== 'REUSE_VRF') return false;
  if (tunnel.hubPeSlot === 'peA') return slot === 'ceA';
  if (tunnel.hubPeSlot === 'peB') return slot === 'ceB';
  return false;
};

/** 创建/更新隧道前：Hub Blocking + 四端贡献冲突检测 */
export const assertNoSrv6ContributionConflictsForTunnel = async (
  tunnel: SRv6Tunnel,
  options?: { excludeTunnelId?: string },
): Promise<void> => {
  const blocking = await findHubBlockingConflict(tunnel, options?.excludeTunnelId ?? tunnel.id);
  if (blocking) {
    const err = new Error(formatSrv6ContributionConflicts([blocking]));
    (err as Error & { statusCode: number; conflicts: Srv6ContributionConflict[] }).statusCode = 409;
    (err as Error & { conflicts: Srv6ContributionConflict[] }).conflicts = [blocking];
    throw err;
  }

  const delta = tunnel.injectedDelta;
  if (!delta || typeof delta !== 'object') return;

  const endpoints: { slot: Srv6EndpointSlot; vrId: string }[] = [
    { slot: 'peA', vrId: tunnel.peA },
    { slot: 'peB', vrId: tunnel.peB },
    { slot: 'ceA', vrId: tunnel.ceA },
    { slot: 'ceB', vrId: tunnel.ceB },
  ];

  const allConflicts: Srv6ContributionConflict[] = [];

  for (const { slot, vrId } of endpoints) {
    const newContrib = delta[slot];
    if (!newContrib || typeof newContrib !== 'object') continue;

    const record = await vrRepo().findOne({ where: { uuid: vrId } });
    const baseline = record ? parseSrv6Baseline(record) : null;

    const existing = await listAliveContributionsForVr(vrId, {
      excludeTunnelId: options?.excludeTunnelId ?? tunnel.id,
    });

    if (!baseline) {
      if (existing.length > 0) {
        allConflicts.push({
          code: 'NO_BASELINE',
          message: `${slotLabel(slot)}：该设备尚未保存向导基线，无法校验多隧道冲突。请使用「配置对账」检查，或删除相关历史隧道后重新创建`,
        });
      }
      continue;
    }

    const fp = tunnel.endpointFingerprint;
    const innerIfMeta: Srv6InnerIfMeta | undefined =
      slot === 'peA' || slot === 'peB'
        ? {
            innerIf: innerIfForSlot(tunnel, slot),
            innerVrf: peInnerVrfFromFingerprint(fp ?? undefined, slot),
          }
        : undefined;

    const existingInnerIfMetas = await buildExistingInnerIfMetas(
      vrId,
      slot,
      options?.excludeTunnelId ?? tunnel.id,
    );

    const hubPeSlot = isHubPeSlotForTunnel(tunnel, slot);
    const sharedCeReuse = isHubSharedCeSlot(tunnel, slot);

    const conflicts = detectContributionConflicts(newContrib, existing, baseline, {
      innerIfMeta,
      existingInnerIfMetas,
      hubPeSlot,
      hubVrfMode: hubPeSlot ? tunnel.hubVrfMode ?? undefined : undefined,
      sharedCeReuse,
    });

    for (const c of conflicts) {
      allConflicts.push({
        ...c,
        message: `${slotLabel(slot)}：${c.message}`,
      });
    }
  }

  const primary = pickPrimaryConflicts(allConflicts, {
    hubTunnel: isHubTunnel(tunnel),
    hubVrfMode: tunnel.hubVrfMode ?? undefined,
  });
  if (primary.length) {
    const err = new Error(formatSrv6ContributionConflicts(primary));
    (err as Error & { statusCode: number; conflicts: Srv6ContributionConflict[] }).statusCode = 409;
    (err as Error & { conflicts: Srv6ContributionConflict[] }).conflicts = primary;
    throw err;
  }
};
