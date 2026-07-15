import { AppDataSource } from '../../config/database';
import { SRv6Tunnel } from '../../entities/vRouter/SRv6Tunnel';
import { VRConfig } from '../../entities/vRouter/VRConfig';
import { parseSrv6Baseline, resetSrv6BaselineWhenNoTunnels } from './srv6.baseline';
import { listAliveContributionsForVr, recomputeVrEffectiveConfig } from './srv6.recompute';
import { persistSrv6VrEffectiveConfig } from './srv6.sync';

const vrRepo = () => AppDataSource.getRepository(VRConfig);
const tunnelRepo = () => AppDataSource.getRepository(SRv6Tunnel);

export type Srv6ReconcileIssueCode =
  | 'NO_BASELINE'
  | 'ORPHAN_BASELINE_DRIFT'
  | 'INVARIANT_DRIFT'
  | 'CONFIG_PARSE_ERROR'
  | 'BASELINE_PARSE_ERROR';

export type Srv6ReconcileIssue = {
  code: Srv6ReconcileIssueCode;
  message: string;
};

export type Srv6ReconcileItem = {
  vrUuid: string;
  vrName?: string | null;
  tunnelCount: number;
  issues: Srv6ReconcileIssue[];
  repaired: boolean;
  repairActions: string[];
};

export type Srv6ReconcileReport = {
  scanned: number;
  withIssues: number;
  repaired: number;
  items: Srv6ReconcileItem[];
};

export const jsonEqual = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

const parseConfigJson = (raw: string | null | undefined): Record<string, unknown> | null => {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** 收集需对账的 VR uuid（有基线或被隧道引用） */
export const listSrv6ReconcileCandidateVrUuids = async (): Promise<string[]> => {
  const ids = new Set<string>();
  const tunnels = await tunnelRepo().find();
  for (const t of tunnels) {
    [t.peA, t.peB, t.ceA, t.ceB].forEach((id) => {
      if (id) ids.add(String(id));
    });
  }
  const rows = await vrRepo().find();
  for (const row of rows) {
    if (row.srv6BaselineJson?.trim()) ids.add(row.uuid);
  }
  return [...ids].sort();
};

/** 单 VR 对账（可选 repair） */
export const reconcileSrv6Vr = async (
  vrUuid: string,
  options?: { repair?: boolean },
): Promise<Srv6ReconcileItem> => {
  const id = String(vrUuid || '').trim();
  const record = await vrRepo().findOne({ where: { uuid: id } });
  const item: Srv6ReconcileItem = {
    vrUuid: id,
    vrName: record?.name ?? null,
    tunnelCount: 0,
    issues: [],
    repaired: false,
    repairActions: [],
  };

  if (!record) {
    item.issues.push({ code: 'CONFIG_PARSE_ERROR', message: 'VR 配置记录不存在' });
    return item;
  }

  const contribs = await listAliveContributionsForVr(id);
  item.tunnelCount = contribs.length;

  const actual = parseConfigJson(record.config_json);
  if (!actual) {
    item.issues.push({ code: 'CONFIG_PARSE_ERROR', message: '平台库中的设备配置无法解析' });
    return item;
  }

  const baseline = parseSrv6Baseline(record);
  if (contribs.length > 0 && !baseline) {
    item.issues.push({
      code: 'NO_BASELINE',
      message: '有存活隧道引用但缺少 SRv6 向导基线',
    });
  }
  if (baseline === null && record.srv6BaselineJson?.trim()) {
    item.issues.push({ code: 'BASELINE_PARSE_ERROR', message: '向导基线配置无法解析' });
  }

  if (contribs.length === 0 && baseline && !jsonEqual(actual, baseline)) {
    item.issues.push({
      code: 'ORPHAN_BASELINE_DRIFT',
      message: '当前无存活隧道，但平台生效配置与向导基线不一致',
    });
  }

  if (baseline && contribs.length > 0) {
    try {
      const expected = await recomputeVrEffectiveConfig(id);
      if (!jsonEqual(actual, expected)) {
        item.issues.push({
          code: 'INVARIANT_DRIFT',
          message: '平台生效配置与「向导基线 + 存活隧道叠加」不一致',
        });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      item.issues.push({ code: 'INVARIANT_DRIFT', message: `无法重算生效配置：${msg}` });
    }
  }

  if (options?.repair && item.issues.length) {
    for (const issue of [...item.issues]) {
      if (issue.code === 'INVARIANT_DRIFT' && contribs.length > 0) {
        await persistSrv6VrEffectiveConfig(id);
        item.repairActions.push('已按向导基线与存活隧道重算并写回平台生效配置');
        item.repaired = true;
      }
      if (issue.code === 'ORPHAN_BASELINE_DRIFT' && contribs.length === 0) {
        await resetSrv6BaselineWhenNoTunnels(id);
        item.repairActions.push('无存活隧道：已将向导基线对齐为当前平台配置');
        item.repaired = true;
      }
    }
    if (item.repaired) {
      item.issues = [];
    }
  }

  return item;
};

const RECONCILE_ALL_CONCURRENCY = 4;

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

/** 批量对账（VR 级并发上限，避免串行过久 / 写库打爆） */
export const reconcileAllSrv6Vrs = async (options?: {
  repair?: boolean;
  vrUuid?: string;
}): Promise<Srv6ReconcileReport> => {
  const targets = options?.vrUuid
    ? [String(options.vrUuid).trim()]
    : await listSrv6ReconcileCandidateVrUuids();
  const uuids = targets.map((u) => String(u || '').trim()).filter(Boolean);

  const items = await mapPool(uuids, RECONCILE_ALL_CONCURRENCY, (vrUuid) =>
    reconcileSrv6Vr(vrUuid, { repair: options?.repair }),
  );

  const withIssues = items.filter((i) => i.issues.length > 0).length;
  const repaired = items.filter((i) => i.repaired).length;
  return { scanned: items.length, withIssues, repaired, items };
};
