/**
 * SRv6 隧道运行态（R2/R3）：按需实时拉取各 VR 的 localsid 计数、BGP、vbras、VRRP。
 * 设计：docs/ibr-srv6-runtime-topology.md §3 / §4 / §5.2
 * - 方向：本端 policy 最后一跳 segment = 对端 localsid（A→B 取 PE-B 的 localsid Good/Bad）
 * - 速率：Δcounter / Δt（设备 sampledAtMs）；首次或 Δ<0 → sampling，不把累计值当速率
 * - Hub 复用 VRF：同一 Hub localsid 被多条 Spoke 指向 → 该方向 hub_aggregate
 * - 私网 BGP：按接入边 `${peUuid}|${ceUuid}`，对齐档案 injectedDelta 私网邻居
 * - VRRP 角色：仅 HA 组成员解析 forwarding/vrrp
 */
import { In } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { IbrHaGroupMember } from '../../entities/vRouter/IbrHaGroupMember';
import { SRv6Tunnel } from '../../entities/vRouter/SRv6Tunnel';
import type { Srv6EndpointFingerprint } from '../../entities/vRouter/srv6Tunnel.types';
import {
  getManagementIpForVr,
  ibrLocalWebNorthRequest,
  ibrLocalWebClient,
  type IbrForwardingVrrpResult,
} from '../../services/vrouter/ibrLocalWebClient';
import { parseBgpSummaryNeighbors } from '../../utils/parseBgpSummary';
import { parseVrrpGroupsShow, parseVrrpInstancesShow } from '../../utils/parseVrrpShow';
import { collectExpectedNeighbors, isBgpSessionUp, normalizeNeighborIp } from './srv6.health';
import { toTopologyRow, type Srv6TopologyTunnelRow } from './srv6.topology';

export type CounterPair = { packets: number; bytes: number };
export type LocalsidCounter = { address: string; behavior?: string; table?: string | null; good: CounterPair; bad: CounterPair };
export type PolicyInfo = { bsid: string; segmentLists: Array<{ segments: string[] }> };
export type VrCounters = { sampledAtMs: number; localsids: LocalsidCounter[]; policies: PolicyInfo[] };

export type LinkHealth = 'up' | 'down' | 'unknown';
export type VbrasState = 'running' | 'stopped' | 'unknown';
export type VrrpRole = 'master' | 'backup' | null;

export type Srv6DirectionTraffic = {
  state: 'active' | 'not_effective' | 'hub_aggregate' | 'sampling' | 'unknown';
  localsid?: string;
  pps?: number;
  bps?: number;
  goodTotal?: CounterPair;
  badDelta?: number;
  error?: string;
};

export type Srv6RuntimeNode = {
  reachable: 'online' | 'unknown';
  vbras: VbrasState;
  vrrpRole?: VrrpRole;
  error?: string;
};

export type Srv6RuntimeAttach = {
  privateBgp: LinkHealth;
  vrf?: string;
  prefixReceived?: number;
};

export type Srv6TopologyRuntime = {
  checkedAt: string;
  nodes: Record<string, Srv6RuntimeNode>;
  tunnels: Record<string, { publicBgp: LinkHealth; directions: { aToB: Srv6DirectionTraffic; bToA: Srv6DirectionTraffic } }>;
  attaches: Record<string, Srv6RuntimeAttach>;
  hubAggregates: Record<string, Srv6DirectionTraffic>;
};

const norm = (a: unknown) => String(a ?? '').trim().split('/')[0]!.trim().toLowerCase();
const s = (v: unknown) => String(v ?? '').trim();
const CONCURRENCY = 4;

/** 上次样本：key = `${vrUuid}|${localsid}`（进程级，仅作跨请求基线；单次请求内用本地 store 隔离） */
type Sample = { ms: number; good: CounterPair; badPackets: number };
type SampleStore = Map<string, Sample>;
const lastSamples: SampleStore = new Map();
export const __resetRuntimeSamples = () => lastSamples.clear();

const sampleKey = (vrUuid: string, address: string) => `${vrUuid}|${norm(address)}`;

/** 把计数写入样本库（覆盖）；用于 sample=2 把第一拍当作 prev */
export const seedSamplesFromCounters = (
  store: SampleStore,
  counters: Record<string, VrCounters | undefined>,
  onlyVrs?: Set<string>,
): void => {
  Object.entries(counters).forEach(([vr, c]) => {
    if (!c || (onlyVrs && !onlyVrs.has(vr))) return;
    (c.localsids || []).forEach((ls) => {
      store.set(sampleKey(vr, ls.address), {
        ms: c.sampledAtMs,
        good: { packets: ls.good.packets, bytes: ls.good.bytes },
        badPackets: ls.bad.packets,
      });
    });
  });
};

const publishSamples = (store: SampleStore) => {
  store.forEach((v, k) => lastSamples.set(k, v));
};

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

export type TrafficForOpts = { commit?: boolean; store?: SampleStore };

/** 速率：用对端设备 localsid 的本次与上次样本 */
export const trafficFor = (
  vrUuid: string,
  counters: VrCounters,
  ls: LocalsidCounter,
  commitOrOpts: boolean | TrafficForOpts = true,
): Srv6DirectionTraffic => {
  const opts: TrafficForOpts = typeof commitOrOpts === 'boolean' ? { commit: commitOrOpts } : commitOrOpts || {};
  const store = opts.store ?? lastSamples;
  const commit = opts.commit !== false;
  const key = sampleKey(vrUuid, ls.address);
  const prev = store.get(key);
  const cur: Sample = { ms: counters.sampledAtMs, good: ls.good, badPackets: ls.bad.packets };
  if (commit) store.set(key, cur);
  const base: Srv6DirectionTraffic = { state: 'sampling', localsid: norm(ls.address), goodTotal: ls.good };
  if (!prev) return base;
  const dt = (cur.ms - prev.ms) / 1000;
  const dp = cur.good.packets - prev.good.packets;
  const db = cur.good.bytes - prev.good.bytes;
  const dBad = cur.badPackets - prev.badPackets;
  if (dt <= 0 || dp < 0 || db < 0 || dBad < 0) return base; // 重建 / clear / 时钟回退：本次不出数
  return { ...base, state: 'active', pps: dp / dt, bps: (db * 8) / dt, badDelta: dBad };
};

const isDefaultVrf = (vrf: string | undefined) => !vrf || vrf === 'default' || vrf === '0';

/** BGP：指定 VRF（空/`default` = 公网）；有邻居且全部 Established → up */
export const bgpStateForVrf = (raw: string | undefined, vrf?: string | null): LinkHealth => {
  if (raw == null) return 'unknown';
  const want = vrf != null ? String(vrf).trim() : '';
  const rows = parseBgpSummaryNeighbors(raw).filter((r) =>
    want && !isDefaultVrf(want) ? r.vrf === want : isDefaultVrf(r.vrf),
  );
  if (!rows.length) return 'unknown';
  return rows.every((r) => isBgpSessionUp(r.state)) ? 'up' : 'down';
};

/** 公网 BGP（VRF default）：两端都有 raw 才判定；任一缺失 → unknown */
export const publicBgpState = (rawList: Array<string | undefined>): LinkHealth => {
  if (rawList.some((raw) => raw == null)) return 'unknown';
  const parts = rawList.map((raw) => bgpStateForVrf(raw, 'default'));
  if (parts.some((p) => p === 'down')) return 'down';
  if (parts.some((p) => p === 'unknown')) return 'unknown';
  return parts.length ? 'up' : 'unknown';
};

/** 接入边私网 BGP：档案私网邻居 vs 设备 summary */
export const privateBgpFromExpectations = (
  exps: Array<{ vrUuid: string; remoteIp: string }>,
  bgpRawByVr: Record<string, string | undefined>,
): LinkHealth => {
  if (!exps.length) return 'unknown';
  let seen = 0;
  for (const e of exps) {
    const raw = bgpRawByVr[e.vrUuid];
    if (raw == null) return 'unknown';
    const want = normalizeNeighborIp(e.remoteIp);
    const row = parseBgpSummaryNeighbors(raw).find((r) => normalizeNeighborIp(r.neighbor) === want);
    if (!row || !isBgpSessionUp(row.state)) return 'down';
    seen += 1;
  }
  return seen > 0 ? 'up' : 'unknown';
};

/** 接入边前缀数：PE 侧私网邻居 PfxRcd 合计 */
export const prefixReceivedFromExpectations = (
  exps: Array<{ vrUuid: string; remoteIp: string; slot?: string }>,
  bgpRawByVr: Record<string, string | undefined>,
): number | undefined => {
  let total: number | undefined;
  for (const e of exps) {
    if (e.slot && !String(e.slot).startsWith('pe')) continue;
    const raw = bgpRawByVr[e.vrUuid];
    if (raw == null) continue;
    const want = normalizeNeighborIp(e.remoteIp);
    const row = parseBgpSummaryNeighbors(raw).find((r) => normalizeNeighborIp(r.neighbor) === want);
    const rawPfx = String(row?.pfx_rcd ?? '').trim();
    if (!rawPfx || !/^\d+$/.test(rawPfx)) continue; // Idle/Active 等非数字 PfxRcd 不当 0
    const n = Number(rawPfx);
    if (!Number.isFinite(n)) continue;
    total = (total ?? 0) + n;
  }
  return total;
};

export const vbrasFromStatus = (data: Record<string, unknown> | undefined | null): VbrasState => {
  if (!data) return 'unknown';
  if (data.vbras_running === true) return 'running';
  if (data.vbras_running === false) return 'stopped';
  const proc = data.vbras_process && typeof data.vbras_process === 'object' ? (data.vbras_process as Record<string, unknown>) : null;
  const active = String(proc?.active_state ?? '').toLowerCase();
  if (active.includes('running')) return 'running';
  if (active.includes('inactive') || active.includes('dead') || active.includes('failed')) return 'stopped';
  return 'unknown';
};

/** HA 成员 live 角色：优先 Sync Group，其次 instances；混合或不存在 → null */
export const vrrpRoleFromShow = (instancesRaw?: string, groupsRaw?: string): VrrpRole => {
  const groupStates = parseVrrpGroupsShow(groupsRaw || '')
    .map((g) => String(g.state || '').toUpperCase())
    .filter(Boolean);
  const instStates = parseVrrpInstancesShow(instancesRaw || '')
    .map((i) => String(i.state || '').toUpperCase())
    .filter(Boolean);
  const states = groupStates.length ? groupStates : instStates;
  const uniq = [...new Set(states)];
  if (uniq.length === 1 && uniq[0] === 'MASTER') return 'master';
  if (uniq.length === 1 && uniq[0] === 'BACKUP') return 'backup';
  return null;
};

export type ComputeTunnelOpts = { store?: SampleStore; commit?: boolean };

/** 纯函数：给定各 VR 计数，计算每条隧道的双向流量（便于单测） */
export const computeTunnelDirections = (
  tunnels: Srv6TopologyTunnelRow[],
  counters: Record<string, VrCounters | undefined>,
  opts?: ComputeTunnelOpts,
): {
  directions: Record<string, { aToB: Srv6DirectionTraffic; bToA: Srv6DirectionTraffic }>;
  hubAggregates: Record<string, Srv6DirectionTraffic>;
} => {
  const store = opts?.store ?? lastSamples;
  const commitDefault = opts?.commit !== false;
  const refCount = new Map<string, number>();
  const pick = (src: string, dst: string): LocalsidCounter | null | undefined => {
    const srcC = counters[src];
    const dstC = counters[dst];
    if (!srcC || !dstC) return undefined;
    const tails = policyTailSids(srcC);
    return dstC.localsids.find((l) => tails.has(norm(l.address))) ?? null;
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
    if (done.has(k)) {
      // 共享 localsid：只按第一次 trafficFor 入账，避免第二条隧道用已提交的当前样本把 Δt 算成 0
      return shared
        ? { state: 'hub_aggregate', localsid: norm(ls.address) }
        : trafficFor(dstVr, counters[dstVr]!, ls, { commit: false, store });
    }
    const tr = trafficFor(dstVr, counters[dstVr]!, ls, { commit: commitDefault, store });
    done.add(k);
    if (shared) {
      hubAggregates[dstVr] = tr;
      return { state: 'hub_aggregate', localsid: tr.localsid };
    }
    return tr;
  };
  plan.forEach(({ t, ab, ba }) => {
    directions[t.id] = { aToB: one(t.peB, ab), bToA: one(t.peA, ba) };
  });
  return { directions, hubAggregates };
};

/** sample=2 二次计算后合并：勿用 sampling 盖掉已算出的 active */
const preferDirection = (prev: Srv6DirectionTraffic, next: Srv6DirectionTraffic): Srv6DirectionTraffic => {
  if (next.state === 'active') return next;
  if (next.state === 'hub_aggregate') return next;
  if (prev.state === 'active') return prev;
  if (prev.state === 'hub_aggregate') return prev;
  return next;
};

const mergeDirectionMaps = (
  prev: Record<string, { aToB: Srv6DirectionTraffic; bToA: Srv6DirectionTraffic }>,
  next: Record<string, { aToB: Srv6DirectionTraffic; bToA: Srv6DirectionTraffic }>,
) => {
  const out: Record<string, { aToB: Srv6DirectionTraffic; bToA: Srv6DirectionTraffic }> = { ...prev };
  Object.entries(next).forEach(([id, d]) => {
    const p = prev[id];
    out[id] = p
      ? { aToB: preferDirection(p.aToB, d.aToB), bToA: preferDirection(p.bToA, d.bToA) }
      : d;
  });
  return out;
};

const mergeHubAggregates = (
  prev: Record<string, Srv6DirectionTraffic>,
  next: Record<string, Srv6DirectionTraffic>,
) => {
  const out: Record<string, Srv6DirectionTraffic> = { ...prev };
  Object.entries(next).forEach(([id, d]) => {
    out[id] = preferDirection(prev[id] || { state: 'unknown' }, d);
  });
  return out;
};

export const attachKey = (peUuid: string, ceUuid: string) => `${s(peUuid)}|${s(ceUuid)}`;

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

type VrFetch = {
  vr: string;
  counters?: VrCounters;
  bgpRaw?: string;
  vbras: VbrasState;
  vrrpRole?: VrrpRole;
  error?: string;
};

const fetchCountersOnly = async (vr: string): Promise<VrCounters | undefined> => {
  try {
    const ip = await getManagementIpForVr(vr);
    const c = await ibrLocalWebNorthRequest<VrCounters & { error?: string }>({
      managementIp: ip,
      path: '/forwarding/srv6/counters',
      timeoutMs: 20_000,
    });
    return Array.isArray(c?.localsids) ? c : undefined;
  } catch {
    return undefined;
  }
};

const fetchVr = async (vr: string, wantVrrp: boolean): Promise<VrFetch> => {
  try {
    const ip = await getManagementIpForVr(vr);
    const [c, b, st, vrrp] = await Promise.allSettled([
      ibrLocalWebNorthRequest<VrCounters & { error?: string }>({
        managementIp: ip,
        path: '/forwarding/srv6/counters',
        timeoutMs: 20_000,
      }),
      ibrLocalWebClient.getForwardingBgpSummary(ip),
      ibrLocalWebClient.status(ip),
      wantVrrp
        ? ibrLocalWebClient.getForwardingVrrp(ip)
        : Promise.resolve(null as IbrForwardingVrrpResult | null),
    ]);
    const out: VrFetch = { vr, vbras: 'unknown' };
    const errors: string[] = [];
    if (c.status === 'fulfilled' && Array.isArray(c.value?.localsids)) out.counters = c.value;
    else if (c.status === 'rejected') errors.push(String((c.reason as Error)?.message || c.reason));
    if (b.status === 'fulfilled' && typeof b.value?.raw === 'string') out.bgpRaw = b.value.raw;
    else if (b.status === 'rejected') errors.push(String((b.reason as Error)?.message || b.reason));
    if (st.status === 'fulfilled') out.vbras = vbrasFromStatus(st.value);
    else if (st.status === 'rejected') errors.push(String((st.reason as Error)?.message || st.reason));
    if (wantVrrp && vrrp.status === 'fulfilled' && vrrp.value) {
      const rec = vrrp.value;
      out.vrrpRole = vrrpRoleFromShow(rec.instancesRaw, rec.groupsRaw);
    }
    if (!out.counters && out.bgpRaw == null && out.vbras === 'unknown') {
      out.error = errors[0] || '设备运行态不可用';
    }
    return out;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { vr, vbras: 'unknown', error: msg };
  }
};

export const buildSrv6TopologyRuntime = async (
  tunnelIds: string[],
  opts?: { sample?: 1 | 2 },
): Promise<Srv6TopologyRuntime> => {
  const ids = Array.from(new Set(tunnelIds.map((x) => String(x).trim()).filter(Boolean)));
  const entities = ids.length ? await AppDataSource.getRepository(SRv6Tunnel).findByIds(ids) : [];
  const rows = entities.map(toTopologyRow);
  const vrs = Array.from(
    new Set(entities.flatMap((t) => [t.peA, t.peB, t.ceA, t.ceB]).map((x) => s(x)).filter(Boolean)),
  );

  const haSet = new Set<string>();
  if (vrs.length) {
    try {
      const members = await AppDataSource.getRepository(IbrHaGroupMember).find({ where: { vrUuid: In(vrs) } });
      members.forEach((m) => haSet.add(m.vrUuid));
    } catch {
      // HA 表不可用时跳过 VRRP，不影响流量 / BGP
    }
  }

  const fetched = await mapPool(vrs, CONCURRENCY, (vr) => fetchVr(vr, haSet.has(vr)));
  const byVr = new Map(fetched.map((f) => [f.vr, f]));

  const counters: Record<string, VrCounters | undefined> = {};
  const bgpRawByVr: Record<string, string | undefined> = {};
  const nodes: Srv6TopologyRuntime['nodes'] = {};
  fetched.forEach((f) => {
    counters[f.vr] = f.counters;
    bgpRawByVr[f.vr] = f.bgpRaw;
    const reachable: Srv6RuntimeNode['reachable'] =
      f.counters || f.bgpRaw != null || f.vbras !== 'unknown' ? 'online' : 'unknown';
    const node: Srv6RuntimeNode = { reachable, vbras: f.vbras };
    if (haSet.has(f.vr)) node.vrrpRole = f.vrrpRole ?? null;
    if (f.error) node.error = f.error;
    nodes[f.vr] = node;
  });

  // 请求内本地样本：隔离并发 sample=1/2，避免 sleep 期间互相提交导致 Δt≤0
  const store: SampleStore = new Map(lastSamples);
  let { directions, hubAggregates } = computeTunnelDirections(rows, counters, { store });
  if (opts?.sample === 2 && vrs.length) {
    const firstCounters: Record<string, VrCounters | undefined> = { ...counters };
    await new Promise((r) => setTimeout(r, 3000));
    const second = await mapPool(vrs, CONCURRENCY, fetchCountersOnly);
    const paired = new Set<string>();
    const nextCounters: Record<string, VrCounters | undefined> = { ...counters };
    second.forEach((c, i) => {
      const vr = vrs[i]!;
      if (!c) return;
      nextCounters[vr] = c;
      if (firstCounters[vr]) paired.add(vr);
      else counters[vr] = c; // 仅第二拍有数：写入供后续展示，但仍无 prev → sampling
    });
    if (paired.size) {
      // 把第一拍重新写入 prev，确保第二拍相对第一拍算 Δ，而不是相对已被本请求提交的当前值
      seedSamplesFromCounters(store, firstCounters, paired);
      paired.forEach((vr) => {
        counters[vr] = nextCounters[vr];
      });
      const again = computeTunnelDirections(rows, nextCounters, { store });
      directions = mergeDirectionMaps(directions, again.directions);
      hubAggregates = mergeHubAggregates(hubAggregates, again.hubAggregates);
    }
  }
  publishSamples(store);
  const tunnels: Srv6TopologyRuntime['tunnels'] = {};
  rows.forEach((t) => {
    tunnels[t.id] = {
      publicBgp: publicBgpState([byVr.get(t.peA)?.bgpRaw, byVr.get(t.peB)?.bgpRaw]),
      directions: directions[t.id]!,
    };
  });

  const attaches: Record<string, Srv6RuntimeAttach> = {};
  entities.forEach((t) => {
    const expected = collectExpectedNeighbors({
      tunnel: t,
      publicBgpIndexBySlot: {},
    });
    const fp = (t.endpointFingerprint || null) as Srv6EndpointFingerprint | null;
    const pairs: Array<{ pe: string; ce: string; slots: Array<'peA' | 'peB' | 'ceA' | 'ceB'>; vrf?: string | number }> = [
      { pe: t.peA, ce: t.ceA, slots: ['peA', 'ceA'], vrf: fp?.peA?.innerVrf },
      { pe: t.peB, ce: t.ceB, slots: ['peB', 'ceB'], vrf: fp?.peB?.innerVrf },
    ];
    pairs.forEach((p) => {
      const pe = s(p.pe);
      const ce = s(p.ce);
      if (!pe || !ce) return;
      const key = attachKey(pe, ce);
      if (attaches[key]) return;
      const exps = expected.private.filter((e) => p.slots.includes(e.slot));
      const row: Srv6RuntimeAttach = { privateBgp: privateBgpFromExpectations(exps, bgpRawByVr) };
      if (p.vrf != null && String(p.vrf).trim()) row.vrf = String(p.vrf).trim();
      const pfx = prefixReceivedFromExpectations(exps, bgpRawByVr);
      if (pfx != null) row.prefixReceived = pfx;
      attaches[key] = row;
    });
  });

  return { checkedAt: new Date().toISOString(), nodes, tunnels, attaches, hubAggregates };
};
