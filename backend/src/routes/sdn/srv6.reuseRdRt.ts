import { AppDataSource } from '../../config/database';
import { SRv6Tunnel } from '../../entities/vRouter/SRv6Tunnel';
import type { Srv6InjectedDelta, Srv6RdRtMeta } from '../../entities/vRouter/srv6Tunnel.types';
import { getHubPeUuid, isHubTunnel } from './srv6.hub';

const tunnelRepo = () => AppDataSource.getRepository(SRv6Tunnel);

/** 路线 A · REUSE_VRF：取 Hub PE 上首条存活隧道的 RD/RT（createdAt 最早） */
export const findReuseVrfReferenceTunnel = async (
  hubPeUuid: string,
  excludeTunnelId?: string,
): Promise<SRv6Tunnel | null> => {
  const id = String(hubPeUuid || '').trim();
  if (!id) return null;
  const all = await tunnelRepo().find({ order: { createdAt: 'ASC' } });
  for (const t of all) {
    if (excludeTunnelId && t.id === excludeTunnelId) continue;
    if (!isHubTunnel(t) || t.hubVrfMode !== 'REUSE_VRF') continue;
    if (getHubPeUuid(t) !== id) continue;
    if (!t.rdRtMeta?.rtCommon || !t.injectedDelta) continue;
    return t;
  }
  return null;
};

export const randomSrv6RdOrdinal = (): number => 100 + Math.floor(Math.random() * 50000);

export const formatSrv6Rd = (ordinal: number): string => `200:${ordinal}`;

/** REUSE_VRF 第 2+ 条：Hub 槽位 RD + rtCommon 继承首条；Spoke 槽位 RD 每次独立 */
export const buildReuseVrfRdRtMeta = (
  ref: Srv6RdRtMeta,
  hubPeSlot: 'peA' | 'peB',
  spokeRd?: string,
): Srv6RdRtMeta => {
  const spokeSlot: 'peA' | 'peB' = hubPeSlot === 'peA' ? 'peB' : 'peA';
  const hubRd = ref.rdMap[hubPeSlot];
  const resolvedSpokeRd =
    spokeRd && spokeRd !== ref.rdMap[spokeSlot]
      ? spokeRd
      : formatSrv6Rd(randomSrv6RdOrdinal());
  return {
    rtCommon: ref.rtCommon,
    rdMap: {
      peA: hubPeSlot === 'peA' ? hubRd : resolvedSpokeRd,
      peB: hubPeSlot === 'peB' ? hubRd : resolvedSpokeRd,
    },
  };
};

export const resolveReuseVrfSpokeRd = (
  ref: Srv6RdRtMeta,
  hubPeSlot: 'peA' | 'peB',
  incoming?: Srv6RdRtMeta | null,
): string => {
  const spokeSlot: 'peA' | 'peB' = hubPeSlot === 'peA' ? 'peB' : 'peA';
  const fromIncoming = incoming?.rdMap?.[spokeSlot];
  if (fromIncoming && fromIncoming !== ref.rdMap[spokeSlot]) {
    return fromIncoming;
  }
  return formatSrv6Rd(randomSrv6RdOrdinal());
};

const patchPeRdRtInDelta = (
  delta: Srv6InjectedDelta | null | undefined,
  inherited: Srv6RdRtMeta,
): void => {
  if (!delta) return;
  for (const slot of ['peA', 'peB'] as const) {
    const contrib = delta[slot];
    if (!contrib?.rdRt?.length) continue;
    const rd = inherited.rdMap?.[slot];
    for (const item of contrib.rdRt) {
      item.route_target = inherited.rtCommon;
      if (rd) item.route_distinguisher = rd;
    }
  }
};

/**
 * REUSE_VRF 第 2+ 条 Spoke：Hub RD + RT 与首条一致；Spoke RD 独立（§14.4.6 + 方案1）。
 */
export const alignReuseVrfTunnelArchive = async (
  tunnel: SRv6Tunnel,
  options?: { excludeTunnelId?: string },
): Promise<boolean> => {
  if (tunnel.tunnelTopology !== 'H' || tunnel.hubVrfMode !== 'REUSE_VRF' || !tunnel.hubPeSlot) {
    return false;
  }
  const hubUuid = getHubPeUuid(tunnel);
  if (!hubUuid) return false;

  const ref = await findReuseVrfReferenceTunnel(hubUuid, options?.excludeTunnelId ?? tunnel.id);
  if (!ref?.rdRtMeta?.rtCommon || !ref.rdRtMeta.rdMap?.peA || !ref.rdRtMeta.rdMap?.peB) {
    return false;
  }

  const spokeRd = resolveReuseVrfSpokeRd(ref.rdRtMeta, tunnel.hubPeSlot, tunnel.rdRtMeta);
  tunnel.rdRtMeta = buildReuseVrfRdRtMeta(ref.rdRtMeta, tunnel.hubPeSlot, spokeRd);
  patchPeRdRtInDelta(tunnel.injectedDelta ?? undefined, tunnel.rdRtMeta);
  return true;
};
