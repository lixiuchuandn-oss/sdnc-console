/** PE → RR 反射域邻居注入（RR 模式；§7.3 / §7.3.1） */

const PUBLIC_EBGP_MULTIHOP = 255;

export type RrNeighborTarget = {
  neighborAddress: string;
  remoteAs: number;
};

const readPePublicBgpIndex = (pe: unknown): number | undefined => {
  if (!pe || typeof pe !== 'object') return undefined;
  const p = pe as Record<string, unknown>;
  const fromPublic = p.publicConfig;
  if (fromPublic && typeof fromPublic === 'object') {
    const idx = (fromPublic as Record<string, unknown>).publicBgpIndex;
    if (typeof idx === 'number' && idx >= 0) return idx;
  }
  const direct = p.publicBgpIndex;
  if (typeof direct === 'number' && direct >= 0) return direct;
  return undefined;
};

const isPublicBgp = (b: unknown): boolean =>
  !!b &&
  typeof b === 'object' &&
  !((b as Record<string, unknown>).vrf &&
    (b as Record<string, unknown>).vrf !== 0 &&
    (b as Record<string, unknown>).vrf !== '0');

/** 域内全部 RR 节点建 neighbor + ipv4 vpn activate_address_family */
export const injectNeighborsForRrDomain = (
  selfCfg: unknown,
  targets: RrNeighborTarget[],
): unknown => {
  if (!selfCfg || typeof selfCfg !== 'object' || targets.length === 0) return selfCfg;
  try {
    const cloned = JSON.parse(JSON.stringify(selfCfg)) as Record<string, unknown>;
    const validTargets = targets.filter(
      (t) => t.neighborAddress && Number.isInteger(t.remoteAs) && t.remoteAs > 0,
    );
    if (validTargets.length === 0) return cloned;

    let bgpArr = Array.isArray(cloned.bgp) ? [...(cloned.bgp as unknown[])] : [];
    const pubIdxFromMeta = readPePublicBgpIndex(cloned.pe);
    let pubIdx = -1;
    if (
      typeof pubIdxFromMeta === 'number' &&
      pubIdxFromMeta >= 0 &&
      pubIdxFromMeta < bgpArr.length &&
      isPublicBgp(bgpArr[pubIdxFromMeta])
    ) {
      pubIdx = pubIdxFromMeta;
    } else {
      pubIdx = bgpArr.findIndex(isPublicBgp);
    }
    if (pubIdx < 0) {
      bgpArr = [{ bgp_ebgp_requires_policy: 'disable', address_family: [] }, ...bgpArr];
      pubIdx = 0;
    }

    const bgpPub = bgpArr[pubIdx];
    if (!bgpPub || typeof bgpPub !== 'object') return cloned;
    const bgpObj = bgpPub as Record<string, unknown>;

    const afArr = Array.isArray(bgpObj.address_family) ? [...bgpObj.address_family] : [];
    const afNoV6 = afArr.filter(
      (af) => String((af as Record<string, unknown>)?.address_family).toLowerCase() !== 'ipv6',
    );
    let afV4Idx = afNoV6.findIndex(
      (af) => String((af as Record<string, unknown>)?.address_family).toLowerCase() === 'ipv4',
    );
    const peerIps = validTargets.map((t) => t.neighborAddress);
    if (afV4Idx >= 0) {
      const af = { ...(afNoV6[afV4Idx] as Record<string, unknown>) };
      delete af.modifier;
      af.modifiler = 'vpn';
      const act = Array.isArray(af.activate_address_family)
        ? [...(af.activate_address_family as string[])]
        : [];
      peerIps.forEach((ip) => {
        if (!act.includes(ip)) act.push(ip);
      });
      af.activate_address_family = act;
      afNoV6[afV4Idx] = af;
    } else {
      afNoV6.push({
        address_family: 'ipv4',
        modifiler: 'vpn',
        activate_address_family: [...peerIps],
      });
    }
    bgpObj.address_family = afNoV6;

    const neighbors = Array.isArray(bgpObj.neighbor)
      ? [...(bgpObj.neighbor as Record<string, unknown>[])]
      : [];
    validTargets.forEach((t) => {
      const idx = neighbors.findIndex((n) => String(n?.remote_ip) === String(t.neighborAddress));
      if (idx < 0) {
        neighbors.push({
          remote_ip: t.neighborAddress,
          remote_as: t.remoteAs,
          ebgp_multihop: PUBLIC_EBGP_MULTIHOP,
        });
      } else {
        neighbors[idx] = {
          ...neighbors[idx],
          remote_as: neighbors[idx]?.remote_as ?? t.remoteAs,
          ebgp_multihop: (neighbors[idx]?.ebgp_multihop as number | undefined) ?? PUBLIC_EBGP_MULTIHOP,
        };
      }
    });
    bgpObj.neighbor = neighbors;

    const ndc = Array.isArray(bgpObj.neighbor_disable_connected_check)
      ? [...(bgpObj.neighbor_disable_connected_check as string[])]
      : [];
    peerIps.forEach((ip) => {
      if (!ndc.some((x) => String(x) === String(ip))) ndc.push(ip);
    });
    bgpObj.neighbor_disable_connected_check = ndc;

    bgpArr[pubIdx] = bgpObj;
    cloned.bgp = bgpArr;
    return cloned;
  } catch {
    return selfCfg;
  }
};

export const buildRrNeighborTargetsFromDomain = (domain: {
  remoteAs: number;
  localAs?: number | null;
  nodes: Array<{
    neighborAddress: string;
    remoteAs?: number | null;
    localAs?: number | null;
  }>;
}): RrNeighborTarget[] =>
  domain.nodes.map((node) => ({
    neighborAddress: node.neighborAddress,
    remoteAs: node.remoteAs ?? domain.remoteAs,
  }));
