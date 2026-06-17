import { AppDataSource } from '../../config/database';
import { SRv6Tunnel } from '../../entities/vRouter/SRv6Tunnel';
import { VRConfig } from '../../entities/vRouter/VRConfig';
import type {
  Srv6EndpointInjectedDelta,
  Srv6EndpointSlot,
  Srv6HubVrfMode,
  Srv6TunnelTopology,
} from '../../entities/vRouter/srv6Tunnel.types';
import { parseSrv6Baseline } from './srv6.baseline';
import { mergeBaselineWithContributions, type Srv6MergeContribution } from './srv6.merge';

const vrRepo = () => AppDataSource.getRepository(VRConfig);
const tunnelRepo = () => AppDataSource.getRepository(SRv6Tunnel);

export type Srv6AliveContribution = {
  tunnelId: string;
  tunnelName: string;
  slot: Srv6EndpointSlot;
  contribution: Srv6EndpointInjectedDelta;
  createdAt: Date;
  tunnelTopology?: Srv6TunnelTopology | null;
  hubPeSlot?: 'peA' | 'peB' | null;
  hubVrfMode?: Srv6HubVrfMode | null;
};

const toMergeContribution = (c: Srv6AliveContribution): Srv6MergeContribution => ({
  delta: c.contribution,
  isHubPeSlot: c.tunnelTopology === 'H' && c.hubPeSlot === c.slot,
  hubVrfMode: c.tunnelTopology === 'H' && c.hubPeSlot === c.slot ? c.hubVrfMode ?? undefined : undefined,
});

const slotFromTunnel = (
  tunnel: SRv6Tunnel,
  vrUuid: string,
): { slot: Srv6EndpointSlot; contribution: Srv6EndpointInjectedDelta } | null => {
  const delta = tunnel.injectedDelta;
  if (!delta || typeof delta !== 'object') return null;
  const pairs: { slot: Srv6EndpointSlot; vrId: string }[] = [
    { slot: 'peA', vrId: tunnel.peA },
    { slot: 'peB', vrId: tunnel.peB },
    { slot: 'ceA', vrId: tunnel.ceA },
    { slot: 'ceB', vrId: tunnel.ceB },
  ];
  for (const { slot, vrId } of pairs) {
    if (vrId !== vrUuid) continue;
    const contrib = delta[slot];
    if (!contrib || typeof contrib !== 'object') return null;
    return { slot, contribution: contrib };
  }
  return null;
};

/** 列出仍存活且引用该 VR 的隧道贡献（按 createdAt 升序） */
export const listAliveContributionsForVr = async (
  vrUuid: string,
  options?: { excludeTunnelId?: string },
): Promise<Srv6AliveContribution[]> => {
  const id = String(vrUuid || '').trim();
  if (!id) return [];

  const tunnels = await tunnelRepo().find({ order: { createdAt: 'ASC' } });
  const out: Srv6AliveContribution[] = [];
  for (const tunnel of tunnels) {
    if (options?.excludeTunnelId && tunnel.id === options.excludeTunnelId) continue;
    const mapped = slotFromTunnel(tunnel, id);
    if (!mapped) continue;
    out.push({
      tunnelId: tunnel.id,
      tunnelName: tunnel.name,
      slot: mapped.slot,
      contribution: mapped.contribution,
      createdAt: tunnel.createdAt,
      tunnelTopology: tunnel.tunnelTopology ?? null,
      hubPeSlot: tunnel.hubPeSlot ?? null,
      hubVrfMode: tunnel.hubVrfMode ?? null,
    });
  }
  return out;
};

/**
 * 由基线 + 存活隧道贡献重算该 VR 的生效 config_json。
 */
export const recomputeVrEffectiveConfig = async (
  vrUuid: string,
  options?: { excludeTunnelId?: string },
): Promise<Record<string, unknown>> => {
  const record = await vrRepo().findOne({ where: { uuid: vrUuid } });
  if (!record) {
    const err = new Error('VR 配置不存在');
    (err as Error & { statusCode: number }).statusCode = 404;
    throw err;
  }

  const baseline = parseSrv6Baseline(record);
  if (!baseline) {
    const err = new Error('该设备尚未保存向导基线，无法生成生效配置');
    (err as Error & { statusCode: number }).statusCode = 409;
    throw err;
  }

  const contribs = await listAliveContributionsForVr(vrUuid, options);
  return mergeBaselineWithContributions(
    baseline,
    contribs.map((c) => toMergeContribution(c)),
  );
};
