/**
 * SRv6 架构拓扑聚合（P2）：以入口隧道为起点，一次返回绘图所需的全部数据。
 * - Hub 发现：入口隧道的 Hub PE；再扩一跳——这些 Spoke 若还挂在其他 Hub（双 Hub / 多归属），一并纳入
 * - 对账：只对拓扑内涉及的 VR（PE+CE）做只读对账，语义精确（不在报告中 = 未扫描）
 */
import { AppDataSource } from '../../config/database';
import { SRv6Tunnel } from '../../entities/vRouter/SRv6Tunnel';
import { findAliveTunnelsByVr, type Srv6HubVrStatus } from './srv6.hub';
import { reconcileSrv6Vr, type Srv6ReconcileItem } from './srv6.reconcile';

const tunnelRepo = () => AppDataSource.getRepository(SRv6Tunnel);

/** 单次聚合最多展开的 Hub 数，防止异常数据导致扇出 */
const MAX_HUBS = 8;
const RECONCILE_CONCURRENCY = 4;

export type Srv6TopologyTunnelRow = {
  id: string;
  name: string;
  peA: string;
  peB: string;
  ceA: string;
  ceB: string;
  tunnelTopology: 'S' | 'H' | null;
  hubPeSlot: 'peA' | 'peB' | null;
  peAInnerIf: string | null;
  peBInnerIf: string | null;
};

export type Srv6TopologyResponse = {
  focusTunnelId: string;
  mode: 'hub' | 'p2p';
  hubs: Srv6HubVrStatus[];
  tunnels: Srv6TopologyTunnelRow[];
  reconcile: {
    scanned: number;
    withIssues: number;
    items: Srv6ReconcileItem[];
    /** 本次对账覆盖的 VR；不在此列表中的端点视为「未对账」 */
    scope: string[];
    error?: string;
  };
};

const s = (v: unknown) => String(v ?? '').trim();

export const toTopologyRow = (t: SRv6Tunnel): Srv6TopologyTunnelRow => ({
  id: t.id,
  name: t.name,
  peA: s(t.peA),
  peB: s(t.peB),
  ceA: s(t.ceA),
  ceB: s(t.ceB),
  tunnelTopology: ((t as any).tunnelTopology ?? null) as 'S' | 'H' | null,
  hubPeSlot: ((t as any).hubPeSlot ?? null) as 'peA' | 'peB' | null,
  peAInnerIf: (t as any).peAInnerIf ?? null,
  peBInnerIf: (t as any).peBInnerIf ?? null,
});

/** H 型取 hubPeSlot 指向的 PE；否则取被 ≥2 条隧道引用的一端 */
export const resolveHubPe = (
  row: Srv6TopologyTunnelRow,
  all: Srv6TopologyTunnelRow[],
): string | null => {
  if (row.tunnelTopology === 'H' && row.hubPeSlot) {
    return s(row.hubPeSlot === 'peA' ? row.peA : row.peB) || null;
  }
  const count = (pe: string) => (pe ? all.filter((t) => t.peA === pe || t.peB === pe).length : 0);
  const nA = count(row.peA);
  const nB = count(row.peB);
  if (nA >= 2 && nA >= nB) return row.peA;
  if (nB >= 2) return row.peB;
  return null;
};

/** Spoke PE → 它挂接的所有 Hub PE（仅 H 型隧道） */
export const hubsOfSpoke = (spoke: string, all: Srv6TopologyTunnelRow[]): string[] => {
  const out = new Set<string>();
  all.forEach((t) => {
    if (t.tunnelTopology !== 'H' || !t.hubPeSlot) return;
    const hub = t.hubPeSlot === 'peA' ? t.peA : t.peB;
    const sp = t.hubPeSlot === 'peA' ? t.peB : t.peA;
    if (sp === spoke && hub) out.add(hub);
  });
  return Array.from(out);
};

async function mapPool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

export const buildSrv6Topology = async (
  tunnelId: string,
  options?: { reconcile?: boolean },
): Promise<Srv6TopologyResponse | null> => {
  const focusEntity = await tunnelRepo().findOne({ where: { id: tunnelId } });
  if (!focusEntity) return null;
  const all = (await tunnelRepo().find()).map(toTopologyRow);
  const focus = toTopologyRow(focusEntity);

  const hubUuids: string[] = [];
  const primaryHub = resolveHubPe(focus, all);
  if (primaryHub) {
    hubUuids.push(primaryHub);
    // 一跳扩展：主 Hub 下的 Spoke 若还挂在其他 Hub，纳入（双 Hub）
    all
      .filter((t) => t.tunnelTopology === 'H' && t.hubPeSlot)
      .forEach((t) => {
        const hub = t.hubPeSlot === 'peA' ? t.peA : t.peB;
        if (hub !== primaryHub) return;
        const spoke = t.hubPeSlot === 'peA' ? t.peB : t.peA;
        hubsOfSpoke(spoke, all).forEach((h) => {
          if (!hubUuids.includes(h) && hubUuids.length < MAX_HUBS) hubUuids.push(h);
        });
      });
  }

  const hubs = await Promise.all(hubUuids.map((u) => findAliveTunnelsByVr(u)));
  const hubTunnelIds = new Set(hubs.flatMap((h) => (h.tunnels || []).map((t) => t.tunnelId)));
  const mode: 'hub' | 'p2p' = hubs.some((h) => (h.tunnels || []).length > 0) ? 'hub' : 'p2p';
  const tunnels = mode === 'hub' ? all.filter((t) => hubTunnelIds.has(t.id)) : [focus];
  if (!tunnels.some((t) => t.id === focus.id)) tunnels.push(focus);

  const scope = Array.from(
    new Set(tunnels.flatMap((t) => [t.peA, t.peB, t.ceA, t.ceB]).filter(Boolean)),
  );
  const reconcile: Srv6TopologyResponse['reconcile'] = { scanned: 0, withIssues: 0, items: [], scope: [] };
  if (options?.reconcile !== false) {
    try {
      const items = await mapPool(scope, RECONCILE_CONCURRENCY, (u) => reconcileSrv6Vr(u, { repair: false }));
      reconcile.items = items;
      reconcile.scanned = items.length;
      reconcile.withIssues = items.filter((i) => i.issues.length > 0).length;
      reconcile.scope = scope;
    } catch (e: any) {
      reconcile.error = e?.message || 'reconcile failed';
    }
  }

  return { focusTunnelId: focus.id, mode, hubs, tunnels, reconcile };
};
