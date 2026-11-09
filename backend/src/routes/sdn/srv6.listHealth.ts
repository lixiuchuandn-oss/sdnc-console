/**
 * SRv6 列表配置健康摘要（按 VR 去重 reconcile，非 live BGP/流量）。
 */
import { SRv6Tunnel } from '../../entities/vRouter/SRv6Tunnel';
import { reconcileSrv6Vr, type Srv6ReconcileItem } from './srv6.reconcile';

export type Srv6ConfigHealth = 'ok' | 'drift' | 'missing_archive' | 'endpoint_missing';

export type Srv6TunnelListHealth = {
  configHealth: Srv6ConfigHealth;
  message: string;
  issueCount: number;
  checkedAt: string;
};

const ENDPOINT_SLOTS = ['peA', 'peB', 'ceA', 'ceB'] as const;

/** 列表健康对账 VR 并发上限（避免隧道多时打爆 SQLite） */
const RECONCILE_CONCURRENCY = 4;

/** 递归判定：空对象 / 空数组 / 值全空 不算有效注入 */
function isMeaningfulValue(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (typeof v === 'number' || typeof v === 'boolean') return true;
  if (Array.isArray(v)) return v.some((x) => isMeaningfulValue(x));
  if (typeof v === 'object') {
    return Object.values(v as Record<string, unknown>).some((x) => isMeaningfulValue(x));
  }
  return false;
}

function slotHasDelta(delta: unknown, slot: string): boolean {
  if (!delta || typeof delta !== 'object') return false;
  return isMeaningfulValue((delta as Record<string, unknown>)[slot]);
}

/** 档案是否含任一端非空注入（仅有空壳 key 不算） */
function hasMeaningfulInjectedDelta(delta: unknown): boolean {
  if (!delta || typeof delta !== 'object') return false;
  return ENDPOINT_SLOTS.some((slot) => slotHasDelta(delta, slot));
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const run = async () => {
    while (cursor < items.length) {
      const i = cursor;
      cursor += 1;
      results[i] = await worker(items[i]);
    }
  };
  const n = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: n }, () => run()));
  return results;
}

export function summarizeSrv6TunnelHealth(
  tunnel: Pick<SRv6Tunnel, 'id' | 'peA' | 'peB' | 'ceA' | 'ceB' | 'injectedDelta'>,
  reconcileByVr: Map<string, Pick<Srv6ReconcileItem, 'issues'>>,
  checkedAt: string,
): Srv6TunnelListHealth {
  const missingSlots: string[] = [];
  const issueMsgs: string[] = [];

  for (const slot of ENDPOINT_SLOTS) {
    const vrUuid = String(tunnel[slot] || '').trim();
    if (!vrUuid) {
      missingSlots.push(slot);
      continue;
    }
    const item = reconcileByVr.get(vrUuid);
    for (const iss of item?.issues || []) {
      issueMsgs.push(`${slot}: ${iss.message}`);
    }
  }

  const hasInjectedDelta = hasMeaningfulInjectedDelta(tunnel.injectedDelta);
  const peHasDelta =
    slotHasDelta(tunnel.injectedDelta, 'peA') || slotHasDelta(tunnel.injectedDelta, 'peB');

  if (missingSlots.length) {
    return {
      configHealth: 'endpoint_missing',
      message: `端点未绑定：${missingSlots.join(', ')}`,
      issueCount: missingSlots.length + issueMsgs.length,
      checkedAt,
    };
  }
  if (issueMsgs.length) {
    return {
      configHealth: 'drift',
      message: issueMsgs.slice(0, 3).join('；') + (issueMsgs.length > 3 ? '…' : ''),
      issueCount: issueMsgs.length,
      checkedAt,
    };
  }
  if (!hasInjectedDelta && !peHasDelta) {
    return {
      configHealth: 'missing_archive',
      message: '缺少 injectedDelta，请用向导重新保存隧道档案',
      issueCount: 1,
      checkedAt,
    };
  }
  return {
    configHealth: 'ok',
    message: '四端平台账本与隧道公式一致（配置面；非 live BGP）',
    issueCount: 0,
    checkedAt,
  };
}

export async function buildSrv6TunnelHealthSummaries(
  tunnels: SRv6Tunnel[],
): Promise<Record<string, Srv6TunnelListHealth>> {
  const vrUuids = new Set<string>();
  for (const t of tunnels) {
    for (const slot of ENDPOINT_SLOTS) {
      const u = String(t[slot] || '').trim();
      if (u) vrUuids.add(u);
    }
  }

  const uuidList = [...vrUuids];
  const items = await mapPool(uuidList, RECONCILE_CONCURRENCY, (u) => reconcileSrv6Vr(u));
  const reconcileByVr = new Map<string, Srv6ReconcileItem>();
  uuidList.forEach((u, i) => {
    reconcileByVr.set(u, items[i]);
  });

  const checkedAt = new Date().toISOString();
  const out: Record<string, Srv6TunnelListHealth> = {};
  for (const t of tunnels) {
    out[t.id] = summarizeSrv6TunnelHealth(t, reconcileByVr, checkedAt);
  }
  return out;
}
