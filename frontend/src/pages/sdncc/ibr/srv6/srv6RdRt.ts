/**
 * SRv6 RD/RT 档案辅助（隧道侧从 PE 配置回读；REUSE_VRF 对齐见 backend srv6.reuseRdRt.ts）。
 */

export type Srv6RdRtMeta = {
  rtCommon: string;
  rdMap: Record<string, string>;
};

/** Type-0 RD/RT：`数字:数字`（不强制 200: 前缀，便于网工手工指定） */
const RD_RT_TOKEN_RE = /^\d+:\d+$/;

export const isValidRdRtToken = (value: unknown): boolean =>
  RD_RT_TOKEN_RE.test(String(value ?? '').trim());

export const validateSrv6RdRtMeta = (meta: Srv6RdRtMeta | null | undefined): string | null => {
  const rt = String(meta?.rtCommon ?? '').trim();
  const peA = String(meta?.rdMap?.peA ?? '').trim();
  const peB = String(meta?.rdMap?.peB ?? '').trim();
  if (!rt || !peA || !peB) {
    return '请填写公共 RT 与 PE-A / PE-B 的 RD';
  }
  if (![rt, peA, peB].every(isValidRdRtToken)) {
    return 'RD/RT 须为「数字:数字」格式（例如 200:100 或 65001:1）';
  }
  if (peA === peB) {
    return 'PE-A 与 PE-B 的 RD 不能相同';
  }
  return null;
};

/** 从 PE 配置指定 VRF 的 BGP ipv4 unicast AF 读取 RD/RT（PE 角色向导落点） */
export const extractRdRtFromPeConfigForVrf = (
  cfg: unknown,
  vrf: unknown,
): { rd?: string; rt?: string } => {
  if (vrf == null || vrf === '' || !cfg || typeof cfg !== 'object') return {};
  const bgpArr = Array.isArray((cfg as { bgp?: unknown }).bgp)
    ? ((cfg as { bgp: unknown[] }).bgp as Record<string, unknown>[])
    : [];
  const hit = bgpArr.find((b) => b && String(b.vrf) === String(vrf));
  if (!hit) return {};
  const afs = Array.isArray(hit.address_family) ? (hit.address_family as Record<string, unknown>[]) : [];
  const af =
    afs.find(
      (a) =>
        String(a?.address_family || '').toLowerCase() === 'ipv4' &&
        String(a?.modifiler || a?.modifier || '').toLowerCase() === 'unicast',
    ) || afs[0];
  const rd = String(af?.route_distinguisher ?? '').trim();
  const rt = String(af?.route_target ?? '').trim();
  return {
    ...(rd ? { rd } : {}),
    ...(rt ? { rt } : {}),
  };
};

/**
 * 由两端 PE 已选内网 VRF 组装隧道 rdRtMeta。
 * 两端 RT 须一致；不一致或任一侧缺失时返回 null。
 */
export const buildSrv6RdRtMetaFromPeEndpoints = (args: {
  peACfg?: unknown;
  peBCfg?: unknown;
  peAVrf?: unknown;
  peBVrf?: unknown;
}): Srv6RdRtMeta | null => {
  const a = extractRdRtFromPeConfigForVrf(args.peACfg, args.peAVrf);
  const b = extractRdRtFromPeConfigForVrf(args.peBCfg, args.peBVrf);
  if (!a.rd || !b.rd || !a.rt || !b.rt) return null;
  if (a.rt !== b.rt) return null;
  return {
    rtCommon: a.rt,
    rdMap: { peA: a.rd, peB: b.rd },
  };
};
