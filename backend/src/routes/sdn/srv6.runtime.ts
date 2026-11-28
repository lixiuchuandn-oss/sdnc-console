/**
 * SRv6 隧道运行态（R2）：按需实时拉取各 PE 的 localsid 计数 + 公网 BGP，计算双向流量。
 * 设计：docs/ibr-srv6-runtime-topology.md §3 / §5.2
 * - 方向：本端 policy 最后一跳 segment = 对端 localsid（A→B 取 PE-B 的 localsid Good/Bad）
 * - 速率：Δcounter / Δt（设备 sampledAtMs）；首次或 Δ<0 → sampling，不把累计值当速率
 * - Hub 复用 VRF：同一 Hub localsid 被多条 Spoke 指向 → 该方向 hub_aggregate
 */
import { AppDataSource } from '../../config/database';
import { SRv6Tunnel } from '../../entities/vRouter/SRv6Tunnel';
import { getManagementIpForVr, ibrLocalWebNorthRequest, ibrLocalWebClient } from '../../services/vrouter/ibrLocalWebClient';
import { parseBgpSummaryNeighbors } from '../../utils/parseBgpSummary';
import { toTopologyRow, type Srv6TopologyTunnelRow } from './srv6.topology';

export type CounterPair = { packets: number; bytes: number };
export type LocalsidCounter = { address: string; behavior?: string; table?: string | null; good: CounterPair; bad: CounterPair };
export type PolicyInfo = { bsid: string; segmentLists: Array<{ segments: string[] }> };
export type VrCounters = { sampledAtMs: number; localsids: LocalsidCounter[]; policies: PolicyInfo[] };

export type Srv6DirectionTraffic = {
  state: 'active' | 'not_effective' | 'hub_aggregate' | 'sampling' | 'unknown';
  localsid?: string;
  pps?: number;
  bps?: number;
  goodTotal?: CounterPair;
  badDelta?: number;
  error?: string;
};

export type Srv6TopologyRuntime = {
  checkedAt: string;
  nodes: Record<string, { reachable: 'online' | 'unknown'; error?: string }>;
  tunnels: Record<string, { publicBgp: 'up' | 'down' | 'unknown'; directions: { aToB: Srv6DirectionTraffic; bToA: Srv6DirectionTraffic } }>;
  hubAggregates: Record<string, Srv6DirectionTraffic>;
};

const norm = (a: unknown) => String(a ?? '').trim().split('/')[0]!.trim().toLowerCase();
const CONCURRENCY = 4;

/** 上次样本：key = `${vrUuid}|${localsid}` */
type Sample = { ms: number; good: CounterPair; badPackets: number };
const lastSamples = new Map<string, Sample>();
export const __resetRuntimeSamples = () => lastSamples.clear();

/** 本端 policy 的最后一跳集合（多 segment 取最后一跳） */
export const policyTailSids = (c: VrCounters | undefined): Set<string> => {
  const out = new Set<string>();
  (c?.policies || []).forEach((p) =>
    (p.segmentLists || []).forEach((sl) => {
      const last = sl.segments?.[sl.segments.length - 1];
      if (last) out.add(norm(last));
    }),
  );
  return out;
};

/** 速率：用对端设备 localsid 的本次与上次样本 */
export const trafficFor = (vrUuid: string, counters: VrCounters, ls: LocalsidCounter, commit = true): Srv6DirectionTraffic => {
  const key = `${vrUuid}|${norm(ls.address)}`;
  const prev = lastSamples.get(key);
  const cur: Sample = { ms: counters.sampledAtMs, good: ls.good, badPackets: ls.bad.packets };
  if (commit) lastSamples.set(key, cur);
  const base: Srv6DirectionTraffic = { state: 'sampling', localsid: norm(ls.address), goodTotal: ls.good };
  if (!prev) return base;
  const dt = (cur.ms - prev.ms) / 1000;
  const dp = cur.good.packets - prev.good.packets;
  const db = cur.good.bytes - prev.good.bytes;
  const dBad = cur.badPackets - prev.badPackets;
  if (dt <= 0 || dp < 0 || db < 0 || dBad < 0) return base; // 重建 / clear / 时钟回退：本次不出数
  return { ...base, state: 'active', pps: dp / dt, bps: (db * 8) / dt, badDelta: dBad };
};

/** 公网 BGP（VRF default）：有邻居且全部 Established → up；有非 Established → down */
export const publicBgpState = (rawList: Array<string | undefined>): 'up' | 'down' | 'unknown' => {
  let seen = 0;
  for (const raw of rawList) {
    if (raw == null) return 'unknown';
    const rows = parseBgpSummaryNeighbors(raw).filter((r) => !r.vrf || r.vrf === 'default');
    for (const r of rows) {
      seen += 1;
      if (!/^established$/i.test(r.state)) return 'down';
    }
  }
  return seen > 0 ? 'up' : 'unknown';
};

/** 纯函数：给定各 VR 计数，计算每条隧道的双向流量（便于单测） */
export const computeTunnelDirections = (
  tunnels: Srv6TopologyTunnelRow[],
  counters: Record<string, VrCounters | undefined>,
): {
  directions: Record<string, { aToB: Srv6DirectionTraffic; bToA: Srv6DirectionTraffic }>;
  hubAggregates: Record<string, Srv6DirectionTraffic>;
} => {
  // 统计每个 (dstVr, localsid) 被多少条隧道指向 → >1 即 Hub 复用 VRF 汇总
  const refCount = new Map<string, number>();
  const pick = (src: string, dst: string): LocalsidCounter | null | undefined => {
    const s = counters[src];
    const d = counters[dst];
    if (!s || !d) return undefined; // 未知
    const tails = policyTailSids(s);
    return d.localsids.find((l) => tails.has(norm(l.address))) ?? null; // null = 未生效
  };
  const plan = tunnels.map((t) => {
    const ab = pick(t.peA, t.peB);
    const ba = pick(t.peB, t.peA);
    [
      [t.peB, ab],
      [t.peA, ba],
    ].forEach(([vr, ls]) => {
      if (ls && typeof ls === 'object') {
        const k = `${vr}|${norm((ls as LocalsidCounter).address)}`;
        refCount.set(k, (refCount.get(k) ?? 0) + 1);
      }
    });
    return { t, ab, ba };
  });

  const directions: Record<string, { aToB: Srv6DirectionTraffic; bToA: Srv6DirectionTraffic }> = {};
  const hubAggregates: Record<string, Srv6DirectionTraffic> = {};
  const done = new Set<string>();
  const one = (dstVr: string, ls: LocalsidCounter | null | undefined): Srv6DirectionTraffic => {
    if (ls === undefined) return { state: 'unknown' };
    if (ls === null) return { state: 'not_effective' };
    const k = `${dstVr}|${norm(ls.address)}`;
    const shared = (refCount.get(k) ?? 0) > 1;
    // 同一 localsid 只提交一次样本，避免多条隧道重复刷新导致 Δt=0
    const tr = trafficFor(dstVr, counters[dstVr]!, ls, !done.has(k));
    if (!done.has(k)) done.add(k);
    if (shared) {
      hubAggregates[dstVr] = tr;
      return { state: 'hub_aggregate', localsid: tr.localsid };
    }
    return tr;
  };
  // 先算共享（Hub）方向，保证 hubAggregates 用的是提交前的 prev
  plan.forEach(({ t, ab, ba }) => {
    directions[t.id] = { aToB: one(t.peB, ab), bToA: one(t.peA, ba) };
  });
  // 同一 Hub localsid 后续隧道复用已计算的 aggregate
  return { directions, hubAggregates };
};

async function mapPool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]!);
      }
    }),
  );
  return out;
}

type VrFetch = { vr: string; counters?: VrCounters; bgpRaw?: string; error?: string };

const fetchVr = async (vr: string): Promise<VrFetch> => {
  try {
    const ip = await getManagementIpForVr(vr);
    const [c, b] = await Promise.allSettled([
      ibrLocalWebNorthRequest<VrCounters & { error?: string }>({ managementIp: ip, path: '/forwarding/srv6/counters', timeoutMs: 20_000 }),
      ibrLocalWebClient.getForwardingBgpSummary(ip),
    ]);
    const out: VrFetch = { vr };
    if (c.status === 'fulfilled' && Array.isArray(c.value?.localsids)) out.counters = c.value;
    else out.error = c.status === 'rejected' ? String((c.reason as Error)?.message || c.reason) : c.value?.error || 'counters 不可用（设备 local-web 未升级？）';
    if (b.status === 'fulfilled' && typeof b.value?.raw === 'string') out.bgpRaw = b.value.raw;
    return out;
  } catch (e: any) {
    return { vr, error: e?.message || String(e) };
  }
};

export const buildSrv6TopologyRuntime = async (tunnelIds: string[]): Promise<Srv6TopologyRuntime> => {
  const ids = Array.from(new Set(tunnelIds.map((x) => String(x).trim()).filter(Boolean)));
  const rows = ids.length
    ? (await AppDataSource.getRepository(SRv6Tunnel).findByIds(ids)).map(toTopologyRow)
    : [];
  const vrs = Array.from(new Set(rows.flatMap((t) => [t.peA, t.peB]).filter(Boolean)));
  const fetched = await mapPool(vrs, CONCURRENCY, fetchVr);
  const byVr = new Map(fetched.map((f) => [f.vr, f]));

  const counters: Record<string, VrCounters | undefined> = {};
  const nodes: Srv6TopologyRuntime['nodes'] = {};
  fetched.forEach((f) => {
    counters[f.vr] = f.counters;
    nodes[f.vr] = f.counters ? { reachable: 'online' } : { reachable: 'unknown', error: f.error };
  });

  const { directions, hubAggregates } = computeTunnelDirections(rows, counters);
  const tunnels: Srv6TopologyRuntime['tunnels'] = {};
  rows.forEach((t) => {
    tunnels[t.id] = {
      publicBgp: publicBgpState([byVr.get(t.peA)?.bgpRaw, byVr.get(t.peB)?.bgpRaw]),
      directions: directions[t.id]!,
    };
  });
  return { checkedAt: new Date().toISOString(), nodes, tunnels, hubAggregates };
};
