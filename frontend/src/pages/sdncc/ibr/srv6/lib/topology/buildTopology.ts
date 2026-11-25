/**
 * SRv6 架构拓扑：纯数据模型（与渲染解耦）。
 * - 节点按 PE / CE uuid 去重（同一 Spoke 多隧道只出一个节点）
 * - 隧道 = PE↔PE 边；接入链路 = PE↔CE 边
 * - 同一节点对之间的多条隧道分组（groupIndex/groupSize），供平行偏移与 ×N 折叠
 */
import type { Srv6HubVrStatus } from '../../../../../../services/api';

export type TunnelLite = {
  id: string;
  name: string;
  peA: string;
  peB: string;
  ceA: string;
  ceB: string;
  tunnelTopology?: 'S' | 'H' | null;
  hubPeSlot?: 'peA' | 'peB' | null;
  peAInnerIf?: string | null;
  peBInnerIf?: string | null;
};

export type TopoNodeRole = 'hub' | 'spoke' | 'pe' | 'ce';
/** p2p：a/b 端；hub 模式：hub/spoke 侧 */
export type TopoSide = 'a' | 'b' | 'hub' | 'spoke';

export type TopoNode = {
  id: string;
  uuid: string;
  role: TopoNodeRole;
  side: TopoSide;
  /** CE 所接入的 PE 节点 id */
  attachTo?: string;
  tunnelIds: string[];
  focus: boolean;
};

export type TopoTunnel = {
  id: string;
  name: string;
  topology: 'S' | 'H';
  source: string;
  target: string;
  sourceUuid: string;
  targetUuid: string;
  hubWanIf?: string;
  lanIf?: string;
  peerPublicNeighbor?: string;
  vrfMode?: 'REUSE_VRF' | 'DEDICATED_VRF' | null;
  focus: boolean;
  groupKey: string;
  groupIndex: number;
  groupSize: number;
};

export type TopoAttach = {
  id: string;
  peNodeId: string;
  ceNodeId: string;
  innerIf?: string;
  tunnelIds: string[];
  focus: boolean;
};

export type Srv6Topology = {
  mode: 'hub' | 'p2p';
  centerUuid?: string;
  nodes: TopoNode[];
  tunnels: TopoTunnel[];
  attaches: TopoAttach[];
};

export const peNodeId = (uuid: string) => `pe:${uuid}`;
export const ceNodeId = (uuid: string) => `ce:${uuid}`;

const s = (v: unknown) => String(v ?? '').trim();

class TopoBuilder {
  private nodes = new Map<string, TopoNode>();
  private attaches = new Map<string, TopoAttach>();
  tunnels: TopoTunnel[] = [];

  node(id: string, uuid: string, role: TopoNodeRole, side: TopoSide, tunnelId: string, focus: boolean, attachTo?: string) {
    const cur = this.nodes.get(id);
    if (cur) {
      if (!cur.tunnelIds.includes(tunnelId)) cur.tunnelIds.push(tunnelId);
      cur.focus = cur.focus || focus;
      return cur;
    }
    const n: TopoNode = { id, uuid, role, side, attachTo, tunnelIds: [tunnelId], focus };
    this.nodes.set(id, n);
    return n;
  }

  attach(peId: string, ceUuid: string, side: TopoSide, tunnelId: string, focus: boolean, innerIf?: string | null) {
    const ceUuidT = s(ceUuid);
    if (!ceUuidT) return;
    const ceId = ceNodeId(ceUuidT);
    this.node(ceId, ceUuidT, 'ce', side, tunnelId, focus, peId);
    const key = `${peId}|${ceId}`;
    const cur = this.attaches.get(key);
    if (cur) {
      if (!cur.tunnelIds.includes(tunnelId)) cur.tunnelIds.push(tunnelId);
      cur.focus = cur.focus || focus;
      if (!cur.innerIf && s(innerIf)) cur.innerIf = s(innerIf);
      return;
    }
    this.attaches.set(key, {
      id: `att:${key}`,
      peNodeId: peId,
      ceNodeId: ceId,
      innerIf: s(innerIf) || undefined,
      tunnelIds: [tunnelId],
      focus,
    });
  }

  build(mode: Srv6Topology['mode'], centerUuid?: string): Srv6Topology {
    assignGroups(this.tunnels);
    return {
      mode,
      centerUuid,
      nodes: Array.from(this.nodes.values()),
      tunnels: this.tunnels,
      attaches: Array.from(this.attaches.values()),
    };
  }
}

/** 同一无向节点对的隧道分组 */
export function assignGroups(tunnels: TopoTunnel[]): void {
  const groups = new Map<string, TopoTunnel[]>();
  tunnels.forEach((t) => {
    const key = [t.source, t.target].sort().join('~');
    t.groupKey = key;
    const arr = groups.get(key) || [];
    arr.push(t);
    groups.set(key, arr);
  });
  groups.forEach((arr) =>
    arr.forEach((t, i) => {
      t.groupIndex = i;
      t.groupSize = arr.length;
    }),
  );
}

/** S 型 / 点对点：CE-A ─ PE-A ══ PE-B ─ CE-B */
export function buildP2pTopology(t: TunnelLite, focusId: string): Srv6Topology {
  const b = new TopoBuilder();
  const peA = s(t.peA);
  const peB = s(t.peB);
  const focus = t.id === focusId;
  if (peA) b.node(peNodeId(peA), peA, 'pe', 'a', t.id, focus);
  if (peB) b.node(peNodeId(peB), peB, 'pe', 'b', t.id, focus);
  if (peA) b.attach(peNodeId(peA), t.ceA, 'a', t.id, focus, t.peAInnerIf);
  if (peB) b.attach(peNodeId(peB), t.ceB, 'b', t.id, focus, t.peBInnerIf);
  if (peA && peB) {
    b.tunnels.push({
      id: t.id,
      name: t.name,
      topology: (t.tunnelTopology as 'S' | 'H') || 'S',
      source: peNodeId(peA),
      target: peNodeId(peB),
      sourceUuid: peA,
      targetUuid: peB,
      focus,
      groupKey: '',
      groupIndex: 0,
      groupSize: 1,
    });
  }
  return b.build('p2p');
}

/** Hub 多 Spoke：Hub CE（复用场景直接画）─ Hub PE ══ Spoke PE ─ Spoke CE */
export function buildHubTopology(
  hubOrHubs: Srv6HubVrStatus | Srv6HubVrStatus[],
  list: TunnelLite[],
  focusId: string,
): Srv6Topology {
  const hubs = Array.isArray(hubOrHubs) ? hubOrHubs : [hubOrHubs];
  const b = new TopoBuilder();
  const seen = new Set<string>();
  hubs.forEach((hub) => addHub(b, hub, list, focusId, seen));
  return b.build('hub', s(hubs[0]?.vrUuid) || undefined);
}

function addHub(
  b: TopoBuilder,
  hub: Srv6HubVrStatus,
  list: TunnelLite[],
  focusId: string,
  seen: Set<string>,
): void {
  const hubUuid = s(hub.vrUuid);
  const hubId = peNodeId(hubUuid);
  (hub.tunnels || [])
    .filter((t) => !seen.has(t.tunnelId))
    // 该 VR 仅以 PE 身份出现在隧道中才算 Hub 侧（CE 槽位引用跳过）
    .filter((t) => !t.slot || t.slot === 'peA' || t.slot === 'peB')
    .filter((t) => t.tunnelTopology === 'H' || hub.isHub || hub.tunnelCount >= 2)
    .forEach((t) => {
      const row = list.find((r) => r.id === t.tunnelId);
      const hubSlot: 'peA' | 'peB' =
        t.hubBindings?.hubPeSlot ||
        t.hubPeSlot ||
        row?.hubPeSlot ||
        (s(row?.peA) === hubUuid ? 'peA' : 'peB');
      const spokeUuid =
        s(t.hubBindings?.spokePeUuid) || s(hubSlot === 'peA' ? row?.peB : row?.peA);
      if (!spokeUuid || spokeUuid === hubUuid) return;
      const focus = t.tunnelId === focusId;
      const ceA = s(t.ceA) || s(row?.ceA);
      const ceB = s(t.ceB) || s(row?.ceB);
      const hubCe = hubSlot === 'peA' ? ceA : ceB;
      const spokeCe = hubSlot === 'peA' ? ceB : ceA;
      const hubInner = hubSlot === 'peA' ? t.peAInnerIf : t.peBInnerIf;
      const spokeInner = hubSlot === 'peA' ? t.peBInnerIf : t.peAInnerIf;
      const spokeId = peNodeId(spokeUuid);

      b.node(hubId, hubUuid, 'hub', 'hub', t.tunnelId, focus);
      b.node(spokeId, spokeUuid, 'spoke', 'spoke', t.tunnelId, focus);
      b.attach(hubId, hubCe, 'hub', t.tunnelId, focus, hubInner);
      b.attach(spokeId, spokeCe, 'spoke', t.tunnelId, focus, spokeInner);
      b.tunnels.push({
        id: t.tunnelId,
        name: t.tunnelName,
        topology: t.tunnelTopology || 'H',
        source: hubId,
        target: spokeId,
        sourceUuid: hubUuid,
        targetUuid: spokeUuid,
        hubWanIf: s(t.hubBindings?.wanIf) || undefined,
        lanIf: s(t.hubBindings?.lanIf) || undefined,
        peerPublicNeighbor: s(t.hubBindings?.peerPublicNeighbor) || undefined,
        vrfMode: t.hubVrfMode ?? null,
        focus,
        groupKey: '',
        groupIndex: 0,
        groupSize: 1,
      });
      seen.add(t.tunnelId);
    });
}

export function summarizeTopology(topo: Srv6Topology) {
  const count = (role: TopoNodeRole) => topo.nodes.filter((n) => n.role === role).length;
  return {
    hub: count('hub'),
    spoke: count('spoke'),
    pe: count('pe'),
    ce: count('ce'),
    tunnels: topo.tunnels.length,
  };
}

/** GigabitEthernet0/7/0 → GE0/7/0 */
export function abbrIfName(name?: string | null): string {
  const v = s(name);
  if (!v) return '';
  return v
    .replace(/^XGigabitEthernet/i, 'XGE')
    .replace(/^GigabitEthernet/i, 'GE')
    .replace(/^Ethernet/i, 'Eth')
    .replace(/^Eth-Trunk/i, 'Eth-Trunk');
}
