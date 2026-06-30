/**
 * SRv6 RD/RT 档案辅助（与 backend srv6.reuseRdRt.ts 语义对齐）。
 */

export type Srv6RdRtMeta = {
  rtCommon: string;
  rdMap: Record<string, string>;
};

export const randomSrv6RdOrdinal = (): number => 100 + Math.floor(Math.random() * 50000);

export const formatSrv6Rd = (ordinal: number): string => `200:${ordinal}`;

/** REUSE_VRF 第 2+ 条：Hub 槽位 RD + rtCommon 继承首条；Spoke 槽位 RD 独立生成 */
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

/** 保留客户端已生成的 Spoke RD；若仍与首条 Spoke 相同则新生成 */
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
