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
 * REUSE_VRF 第 2+ 条 Spoke：Spoke/Hub PE 档案与 injectedDelta 中的 RT/RD 须与首条隧道一致（§14.4.6）。
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

  tunnel.rdRtMeta = {
    rtCommon: ref.rdRtMeta.rtCommon,
    rdMap: { peA: ref.rdRtMeta.rdMap.peA, peB: ref.rdRtMeta.rdMap.peB },
  };
  patchPeRdRtInDelta(tunnel.injectedDelta ?? undefined, tunnel.rdRtMeta);
  return true;
};
