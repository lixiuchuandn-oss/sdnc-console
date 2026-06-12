import { AppDataSource } from '../../config/database';
import { SRv6Tunnel } from '../../entities/vRouter/SRv6Tunnel';
import { VRConfig } from '../../entities/vRouter/VRConfig';
import type { Srv6EndpointFingerprint, Srv6EndpointSlot } from '../../entities/vRouter/srv6Tunnel.types';
import { parseSrv6Baseline } from './srv6.baseline';
import {
  detectContributionConflicts,
  formatSrv6ContributionConflicts,
  type Srv6ContributionConflict,
  type Srv6InnerIfMeta,
} from './srv6.conflict';
import { listAliveContributionsForVr } from './srv6.recompute';

const tunnelRepo = () => AppDataSource.getRepository(SRv6Tunnel);
const vrRepo = () => AppDataSource.getRepository(VRConfig);

export type Srv6HubTunnelRef = {
  tunnelId: string;
  tunnelName: string;
  slot: Srv6EndpointSlot;
  peAInnerIf?: string | null;
  peBInnerIf?: string | null;
  innerIfMeta?: Srv6InnerIfMeta;
};

export type Srv6HubVrStatus = {
  vrUuid: string;
  tunnelCount: number;
  isHub: boolean;
  tunnels: Srv6HubTunnelRef[];
};

const slotLabel = (slot: Srv6EndpointSlot) =>
  ({ peA: 'PE-A', peB: 'PE-B', ceA: 'CE-A', ceB: 'CE-B' } as const)[slot];

const innerIfForSlot = (tunnel: SRv6Tunnel, slot: Srv6EndpointSlot): string | null | undefined => {
  if (slot === 'peA') return tunnel.peAInnerIf;
  if (slot === 'peB') return tunnel.peBInnerIf;
  return undefined;
};

const peInnerVrfFromFingerprint = (
  fp: Srv6EndpointFingerprint | null | undefined,
  slot: 'peA' | 'peB',
): string | number | null | undefined => fp?.[slot]?.innerVrf;

/** P3：列出引用该 VR 的存活隧道（含槽位与内网口元数据） */
export const findAliveTunnelsByVr = async (vrUuid: string): Promise<Srv6HubVrStatus> => {
  const id = String(vrUuid || '').trim();
  const contribs = await listAliveContributionsForVr(id);
  const tunnels: Srv6HubTunnelRef[] = [];

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
      innerIfMeta:
        c.slot === 'peA' || c.slot === 'peB'
          ? { innerIf: innerIf ?? undefined, innerVrf }
          : undefined,
    });
  }

  return {
    vrUuid: id,
    tunnelCount: tunnels.length,
    isHub: tunnels.length > 1,
    tunnels,
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

/** 创建/更新隧道前：四端贡献冲突检测 */
export const assertNoSrv6ContributionConflictsForTunnel = async (
  tunnel: SRv6Tunnel,
  options?: { excludeTunnelId?: string },
): Promise<void> => {
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

    const conflicts = detectContributionConflicts(newContrib, existing, baseline, {
      innerIfMeta,
      existingInnerIfMetas,
    });

    for (const c of conflicts) {
      allConflicts.push({
        ...c,
        message: `${slotLabel(slot)}：${c.message}`,
      });
    }
  }

  if (allConflicts.length) {
    const err = new Error(formatSrv6ContributionConflicts(allConflicts));
    (err as Error & { statusCode: number; conflicts: Srv6ContributionConflict[] }).statusCode = 409;
    (err as Error & { conflicts: Srv6ContributionConflict[] }).conflicts = allConflicts;
    throw err;
  }
};
