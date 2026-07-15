import { AppDataSource } from '../../config/database';
import { SRv6Tunnel } from '../../entities/vRouter/SRv6Tunnel';
import type {
  Srv6BgpNeighborDelta,
  Srv6EndpointInjectedDelta,
  Srv6InjectedDelta,
  Srv6Ipv6RouteDelta,
} from '../../entities/vRouter/srv6Tunnel.types';
import { VRConfig } from '../../entities/vRouter/VRConfig';
import {
  ibrLocalWebClient,
  IbrLocalWebError,
  type IbrBgpNeighborRow,
  type IbrForwardingRouteRow,
} from '../../services/vrouter/ibrLocalWebClient';
import { computeCeFingerprint } from './srv6.archive';
import { reconcileSrv6Vr } from './srv6.reconcile';

export type Srv6HealthStepStatus = 'pass' | 'fail' | 'skip';

export type Srv6HealthStepKey = 'bgp' | 'privateBgp' | 'dataplane' | 'ceReach';

export type Srv6HealthStep = {
  key: Srv6HealthStepKey;
  status: Srv6HealthStepStatus;
  message: string;
};

export type Srv6HealthEndpoint = {
  slot: 'peA' | 'peB' | 'ceA' | 'ceB';
  vrUuid: string;
  vrName: string | null;
  reconcile: {
    issues: Array<{ code: string; message: string }>;
    tunnelCount: number;
  };
};

export type Srv6TunnelHealthReport = {
  tunnelId: string;
  name: string;
  lifecycleStatus: string;
  topology: 'S' | 'H' | null;
  hubPeSlot: 'peA' | 'peB' | null;
  hubBindings: SRv6Tunnel['hubBindings'];
  hasInjectedDelta: boolean;
  endpoints: Srv6HealthEndpoint[];
  steps: Srv6HealthStep[];
  checkedAt: string;
};

const tunnelRepo = () => AppDataSource.getRepository(SRv6Tunnel);
const vrRepo = () => AppDataSource.getRepository(VRConfig);

type ExpectNeighbor = {
  slot: 'peA' | 'peB' | 'ceA' | 'ceB';
  vrUuid: string;
  remoteIp: string;
  kind: 'public' | 'private';
};

/** 归一化邻居地址，便于匹配 IPv4 / IPv6 */
export function normalizeNeighborIp(ip: string): string {
  return String(ip || '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
}

export function isBgpSessionUp(state: string | undefined | null): boolean {
  const s = String(state ?? '').trim();
  if (!s) return false;
  if (/^established$/i.test(s)) return true;
  // FRR summary 在 Established 时第 10 列是前缀数（纯数字）
  if (/^\d+$/.test(s)) return true;
  return false;
}

function isPublicBgpBlock(b: unknown): boolean {
  if (!b || typeof b !== 'object') return false;
  const vrf = (b as Record<string, unknown>).vrf;
  return vrf === undefined || vrf === null || vrf === 0 || vrf === '0';
}

/** 与档案注入一致：公网 BGP 块下标（VRF 0 / publicBgpIndex） */
export function resolvePublicBgpIndex(cfg: Record<string, unknown> | null | undefined): number {
  if (!cfg || typeof cfg !== 'object') return 0;
  const pe = cfg.pe;
  const peObj = pe && typeof pe === 'object' ? (pe as Record<string, unknown>) : undefined;
  const pc = peObj?.publicConfig;
  const pcObj = pc && typeof pc === 'object' ? (pc as Record<string, unknown>) : undefined;
  if (pcObj && typeof pcObj.publicBgpIndex === 'number' && Number.isFinite(pcObj.publicBgpIndex)) {
    return pcObj.publicBgpIndex;
  }
  if (peObj && typeof peObj.publicBgpIndex === 'number' && Number.isFinite(peObj.publicBgpIndex)) {
    return peObj.publicBgpIndex;
  }
  const bgpArr = Array.isArray(cfg.bgp) ? cfg.bgp : [];
  const pubIdx = bgpArr.findIndex(isPublicBgpBlock);
  return pubIdx >= 0 ? pubIdx : 0;
}

function parseVrConfigJson(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function slotDelta(
  injected: Srv6InjectedDelta | null | undefined,
  slot: keyof Srv6InjectedDelta,
): Srv6EndpointInjectedDelta | undefined {
  if (!injected || typeof injected !== 'object') return undefined;
  return injected[slot];
}

function neighborsOf(delta: Srv6EndpointInjectedDelta | undefined): Srv6BgpNeighborDelta[] {
  return Array.isArray(delta?.neighbors) ? delta!.neighbors! : [];
}

/**
 * 按档案区分公网 / 私网邻居意图：
 * - PE：bgpIndex === 公网块下标 → 公网；否则私网（PE–CE VRF）
 * - CE：邻居一律视为私网（指向 PE 内网）
 */
export function collectExpectedNeighbors(input: {
  tunnel: Pick<SRv6Tunnel, 'peA' | 'peB' | 'ceA' | 'ceB' | 'injectedDelta'>;
  publicBgpIndexBySlot: Partial<Record<'peA' | 'peB', number>>;
}): { public: ExpectNeighbor[]; private: ExpectNeighbor[] } {
  const publicList: ExpectNeighbor[] = [];
  const privateList: ExpectNeighbor[] = [];
  const delta = (input.tunnel.injectedDelta || null) as Srv6InjectedDelta | null;

  const pushPe = (slot: 'peA' | 'peB') => {
    const vrUuid = String(input.tunnel[slot] || '').trim();
    if (!vrUuid) return;
    const pubIdx = input.publicBgpIndexBySlot[slot] ?? 0;
    for (const n of neighborsOf(slotDelta(delta, slot))) {
      const remoteIp = String(n.remote_ip || '').trim();
      if (!remoteIp) continue;
      const kind = Number(n.bgpIndex) === Number(pubIdx) ? 'public' : 'private';
      const row: ExpectNeighbor = { slot, vrUuid, remoteIp, kind };
      if (kind === 'public') publicList.push(row);
      else privateList.push(row);
    }
  };

  const pushCe = (slot: 'ceA' | 'ceB') => {
    const vrUuid = String(input.tunnel[slot] || '').trim();
    if (!vrUuid) return;
    for (const n of neighborsOf(slotDelta(delta, slot))) {
      const remoteIp = String(n.remote_ip || '').trim();
      if (!remoteIp) continue;
      privateList.push({ slot, vrUuid, remoteIp, kind: 'private' });
    }
  };

  pushPe('peA');
  pushPe('peB');
  pushCe('ceA');
  pushCe('ceB');
  return { public: publicList, private: privateList };
}

export function findLiveNeighbor(
  rows: IbrBgpNeighborRow[] | undefined,
  remoteIp: string,
): IbrBgpNeighborRow | undefined {
  const want = normalizeNeighborIp(remoteIp);
  if (!want) return undefined;
  return (rows || []).find((r) => normalizeNeighborIp(String(r.neighbor || '')) === want);
}

async function loadBgpRows(
  vrUuid: string,
): Promise<{ ok: true; rows: IbrBgpNeighborRow[] } | { ok: false; error: string }> {
  try {
    const managementIp = await ibrLocalWebClient.getManagementIpForVr(vrUuid);
    const data = await ibrLocalWebClient.getForwardingBgpSummary(managementIp);
    if (data?.error) {
      return { ok: false, error: String(data.error) };
    }
    return { ok: true, rows: Array.isArray(data?.neighbors) ? data.neighbors : [] };
  } catch (e: unknown) {
    const msg =
      e instanceof IbrLocalWebError
        ? e.message
        : e instanceof Error
          ? e.message
          : '读取 BGP summary 失败';
    return { ok: false, error: msg };
  }
}

async function evaluateNeighborGroup(
  expectations: ExpectNeighbor[],
  label: 'public' | 'private',
): Promise<Srv6HealthStep> {
  const key: Srv6HealthStepKey = label === 'public' ? 'bgp' : 'privateBgp';
  if (!expectations.length) {
    return {
      key,
      status: 'fail',
      message:
        label === 'public'
          ? '档案中无 BGP 公网邻居意图（injectedDelta）；请用向导重新保存隧道'
          : '档案中无 BGP 私网邻居意图（PE–CE / CE–PE）；请用向导重新保存隧道',
    };
  }

  const byVr = new Map<string, ExpectNeighbor[]>();
  for (const exp of expectations) {
    const list = byVr.get(exp.vrUuid) || [];
    list.push(exp);
    byVr.set(exp.vrUuid, list);
  }

  const fails: string[] = [];
  const passes: string[] = [];

  await Promise.all(
    [...byVr.entries()].map(async ([vrUuid, exps]) => {
      const live = await loadBgpRows(vrUuid);
      if (!live.ok) {
        for (const e of exps) {
          fails.push(`${e.slot} → ${e.remoteIp}：设备不可达（${live.error}）`);
        }
        return;
      }
      for (const e of exps) {
        const row = findLiveNeighbor(live.rows, e.remoteIp);
        if (!row) {
          fails.push(`${e.slot} → ${e.remoteIp}：未在 BGP summary 中找到`);
          continue;
        }
        if (!isBgpSessionUp(row.state)) {
          fails.push(`${e.slot} → ${e.remoteIp}：会话状态 ${row.state || 'unknown'}`);
          continue;
        }
        passes.push(`${e.slot} → ${e.remoteIp}`);
      }
    }),
  );

  if (fails.length) {
    return {
      key,
      status: 'fail',
      message: `未通过 ${fails.length}/${expectations.length}：${fails.slice(0, 6).join('；')}${
        fails.length > 6 ? '…' : ''
      }`,
    };
  }
  return {
    key,
    status: 'pass',
    message: `BGP ${label === 'public' ? '公网' : '私网'}邻居均已 Established（${passes.length}）`,
  };
}

type ExpectSidRoute = {
  slot: 'peA' | 'peB';
  vrUuid: string;
  destination: string;
  via: string;
};

/** 仅 SID/对端 locator 静态路由；排除 VRF 默认 ::/0（nexthop-vrf） */
export function isSidRouteExpectation(route: Pick<Srv6Ipv6RouteDelta, 'destination' | 'via'>): boolean {
  const dest = String(route.destination || '').trim().toLowerCase();
  const via = String(route.via || '').trim().toLowerCase();
  if (!dest || dest === '::/0') return false;
  if (via.includes('nexthop-vrf')) return false;
  return true;
}

export function collectExpectedSidRoutes(input: {
  tunnel: Pick<SRv6Tunnel, 'peA' | 'peB' | 'injectedDelta'>;
}): ExpectSidRoute[] {
  const delta = (input.tunnel.injectedDelta || null) as Srv6InjectedDelta | null;
  const out: ExpectSidRoute[] = [];
  for (const slot of ['peA', 'peB'] as const) {
    const vrUuid = String(input.tunnel[slot] || '').trim();
    if (!vrUuid) continue;
    const routes = slotDelta(delta, slot)?.ipv6Routes;
    if (!Array.isArray(routes)) continue;
    for (const r of routes) {
      if (!isSidRouteExpectation(r)) continue;
      const destination = String(r.destination || '').trim();
      const via = String(r.via || '').trim();
      if (!destination) continue;
      out.push({ slot, vrUuid, destination, via });
    }
  }
  return out;
}

/** 设备 IPv6 路由表是否出现档案 SID 前缀（via 有则尽量匹配下一跳） */
export function sidRoutePresentInLive(
  routes: IbrForwardingRouteRow[] | undefined,
  raw: string | undefined,
  destination: string,
  via?: string,
): boolean {
  const dest = normalizeNeighborIp(destination);
  if (!dest) return false;
  const viaN = via ? normalizeNeighborIp(via) : '';
  const viaSkip = !viaN || viaN.includes('nexthop-vrf');

  for (const r of routes || []) {
    if (normalizeNeighborIp(r.prefix) !== dest) continue;
    if (viaSkip) return true;
    const nh = normalizeNeighborIp(String(r.next_hop || '').replace(/,$/, ''));
    if (!nh || nh === viaN) return true;
  }

  const blob = `${raw || ''}\n${(routes || []).map((r) => r.raw || '').join('\n')}`.toLowerCase();
  return blob.includes(dest);
}

async function loadIpv6Routes(vrUuid: string): Promise<
  | { ok: true; routes: IbrForwardingRouteRow[]; raw: string }
  | { ok: false; error: string }
> {
  try {
    const managementIp = await ibrLocalWebClient.getManagementIpForVr(vrUuid);
    const data = await ibrLocalWebClient.getForwardingIpv6Routes(managementIp);
    if (data?.error) {
      return { ok: false, error: String(data.error) };
    }
    return {
      ok: true,
      routes: Array.isArray(data?.routes) ? data.routes : [],
      raw: String(data?.raw_output || data?.output || ''),
    };
  } catch (e: unknown) {
    const msg =
      e instanceof IbrLocalWebError
        ? e.message
        : e instanceof Error
          ? e.message
          : '读取 IPv6 路由失败';
    return { ok: false, error: msg };
  }
}

async function evaluateDataplane(tunnel: SRv6Tunnel): Promise<Srv6HealthStep> {
  const expectations = collectExpectedSidRoutes({ tunnel });
  if (!expectations.length) {
    return {
      key: 'dataplane',
      status: 'fail',
      message: '档案中无 SRv6 SID 路由意图（injectedDelta.ipv6Routes）；请用向导重新保存隧道',
    };
  }

  const byVr = new Map<string, ExpectSidRoute[]>();
  for (const exp of expectations) {
    const list = byVr.get(exp.vrUuid) || [];
    list.push(exp);
    byVr.set(exp.vrUuid, list);
  }

  const fails: string[] = [];
  const passes: string[] = [];

  await Promise.all(
    [...byVr.entries()].map(async ([vrUuid, exps]) => {
      const live = await loadIpv6Routes(vrUuid);
      if (!live.ok) {
        for (const e of exps) {
          fails.push(`${e.slot} ${e.destination}：设备不可达（${live.error}）`);
        }
        return;
      }
      for (const e of exps) {
        if (sidRoutePresentInLive(live.routes, live.raw, e.destination, e.via)) {
          passes.push(`${e.slot} ${e.destination}`);
        } else {
          fails.push(`${e.slot} ${e.destination} via ${e.via || '-'}：IPv6 路由表未命中`);
        }
      }
    }),
  );

  if (fails.length) {
    return {
      key: 'dataplane',
      status: 'fail',
      message: `未通过 ${fails.length}/${expectations.length}：${fails.slice(0, 6).join('；')}${
        fails.length > 6 ? '…' : ''
      }`,
    };
  }
  return {
    key: 'dataplane',
    status: 'pass',
    message: `SRv6 SID 路由均已出现在设备 IPv6 表（${passes.length}）`,
  };
}

async function pingOnce(
  fromVrUuid: string,
  targetIp: string,
): Promise<{ ok: boolean; detail: string }> {
  try {
    const managementIp = await ibrLocalWebClient.getManagementIpForVr(fromVrUuid);
    const res = await ibrLocalWebClient.ping(managementIp, { target: targetIp, repeat: 3 });
    if (res.ok) {
      const loss = res.stats?.packetLoss != null ? `，丢包 ${res.stats.packetLoss}` : '';
      return { ok: true, detail: `${targetIp} 可达${loss}` };
    }
    return {
      ok: false,
      detail: res.error || `ping ${targetIp} 失败（received=${res.stats?.received ?? 'n/a'}）`,
    };
  } catch (e: unknown) {
    const msg =
      e instanceof IbrLocalWebError
        ? e.message
        : e instanceof Error
          ? e.message
          : 'ping 请求失败';
    return { ok: false, detail: msg };
  }
}

async function resolveCeLanIpv4(
  tunnel: SRv6Tunnel,
  slot: 'ceA' | 'ceB',
  vrUuid: string,
): Promise<string> {
  const fromFp = String(tunnel.endpointFingerprint?.[slot]?.lanIpv4 || '').trim();
  if (fromFp) return fromFp;
  const vr = await vrRepo().findOne({
    where: { uuid: vrUuid },
    select: ['uuid', 'config_json'],
  });
  const cfg = parseVrConfigJson(vr?.config_json);
  if (!cfg) return '';
  return String(computeCeFingerprint(cfg).lanIpv4 || '').trim();
}

async function evaluateCeReach(tunnel: SRv6Tunnel): Promise<Srv6HealthStep> {
  const ceA = String(tunnel.ceA || '').trim();
  const ceB = String(tunnel.ceB || '').trim();
  if (!ceA || !ceB) {
    return {
      key: 'ceReach',
      status: 'fail',
      message: '隧道未绑定 CE A / CE B，无法探测互通',
    };
  }

  const [ipA, ipB] = await Promise.all([
    resolveCeLanIpv4(tunnel, 'ceA', ceA),
    resolveCeLanIpv4(tunnel, 'ceB', ceB),
  ]);
  if (!ipA || !ipB) {
    return {
      key: 'ceReach',
      status: 'fail',
      message: '缺少 CE LAN IPv4（请确认 CE 角色向导已配置 LAN，或重新保存隧道档案）',
    };
  }

  const [a2b, b2a] = await Promise.all([pingOnce(ceA, ipB), pingOnce(ceB, ipA)]);
  if (a2b.ok && b2a.ok) {
    return {
      key: 'ceReach',
      status: 'pass',
      message: `CE A LAN → CE B LAN（${a2b.detail}）；CE B LAN → CE A LAN（${b2a.detail}）`,
    };
  }
  const parts: string[] = [];
  if (!a2b.ok) parts.push(`CE A → CE B LAN ${ipB}：${a2b.detail}`);
  if (!b2a.ok) parts.push(`CE B → CE A LAN ${ipA}：${b2a.detail}`);
  return {
    key: 'ceReach',
    status: 'fail',
    message: parts.join('；'),
  };
}

export async function buildSrv6TunnelHealth(tunnelId: string): Promise<Srv6TunnelHealthReport | null> {
  const id = String(tunnelId || '').trim();
  if (!id) return null;
  const tunnel = await tunnelRepo().findOne({ where: { id } });
  if (!tunnel) return null;

  const slots: Array<'peA' | 'peB' | 'ceA' | 'ceB'> = ['peA', 'peB', 'ceA', 'ceB'];
  const endpoints: Srv6HealthEndpoint[] = [];
  const publicBgpIndexBySlot: Partial<Record<'peA' | 'peB', number>> = {};

  for (const slot of slots) {
    const vrUuid = String(tunnel[slot] || '').trim();
    if (!vrUuid) {
      endpoints.push({
        slot,
        vrUuid: '',
        vrName: null,
        reconcile: { issues: [{ code: 'MISSING_ENDPOINT', message: '端点未绑定' }], tunnelCount: 0 },
      });
      continue;
    }
    const vr = await vrRepo().findOne({
      where: { uuid: vrUuid },
      select: ['uuid', 'name', 'config_json'],
    });
    if ((slot === 'peA' || slot === 'peB') && vr?.config_json) {
      publicBgpIndexBySlot[slot] = resolvePublicBgpIndex(parseVrConfigJson(vr.config_json));
    }
    const item = await reconcileSrv6Vr(vrUuid);
    endpoints.push({
      slot,
      vrUuid,
      vrName: vr?.name ?? item.vrName ?? null,
      reconcile: {
        issues: item.issues.map((i) => ({ code: i.code, message: i.message })),
        tunnelCount: item.tunnelCount,
      },
    });
  }

  const hasInjectedDelta = Boolean(
    tunnel.injectedDelta &&
      typeof tunnel.injectedDelta === 'object' &&
      Object.keys(tunnel.injectedDelta as object).length > 0,
  );

  const expected = collectExpectedNeighbors({ tunnel, publicBgpIndexBySlot });

  const [bgpStep, privateStep, dataplaneStep, ceReachStep] = await Promise.all([
    evaluateNeighborGroup(expected.public, 'public'),
    evaluateNeighborGroup(expected.private, 'private'),
    evaluateDataplane(tunnel),
    evaluateCeReach(tunnel),
  ]);

  const steps: Srv6HealthStep[] = [bgpStep, privateStep, dataplaneStep, ceReachStep];

  return {
    tunnelId: tunnel.id,
    name: tunnel.name,
    lifecycleStatus: tunnel.status,
    topology: tunnel.tunnelTopology ?? null,
    hubPeSlot: tunnel.hubPeSlot ?? null,
    hubBindings: tunnel.hubBindings ?? null,
    hasInjectedDelta,
    endpoints,
    steps,
    checkedAt: new Date().toISOString(),
  };
}
