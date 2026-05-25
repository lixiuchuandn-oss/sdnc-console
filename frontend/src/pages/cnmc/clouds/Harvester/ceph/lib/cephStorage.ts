/**
 * Rook CephCluster 与 ceph-resources 聚合的轻量解析（Steve/K8s 对象形态可能随版本变化，字段读取保持宽松）。
 * RADOS 池列表另见 mgr Dashboard `GET /api/pool?stats=true`（与官方 Pools 页同源）。
 */

import { formatBps } from './cephDashboardLanding';

export type CephHealthLevel = 'ok' | 'warn' | 'err' | 'unknown';

export type CephResourceBundle = {
  clusters: any[];
  blockPools: any[];
  radosNamespaces: any[];
  filesystems: any[];
  filesystemSubvolumeGroups: any[];
  filesystemMirrors: any[];
  nfses: any[];
  objectStores: any[];
  objectStoreUsers: any[];
  objectRealms: any[];
  objectZones: any[];
  objectZoneGroups: any[];
  bucketTopics: any[];
  bucketNotifications: any[];
  cephClients: any[];
  cosiDrivers: any[];
  rbdMirrors: any[];
};

const EMPTY: CephResourceBundle = {
  clusters: [],
  blockPools: [],
  radosNamespaces: [],
  filesystems: [],
  filesystemSubvolumeGroups: [],
  filesystemMirrors: [],
  nfses: [],
  objectStores: [],
  objectStoreUsers: [],
  objectRealms: [],
  objectZones: [],
  objectZoneGroups: [],
  bucketTopics: [],
  bucketNotifications: [],
  cephClients: [],
  cosiDrivers: [],
  rbdMirrors: [],
};

function parseBigIntish(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function normalizeCephBundle(raw: unknown): CephResourceBundle {
  if (!raw || typeof raw !== 'object') return { ...EMPTY };
  const r = raw as Record<string, unknown>;
  const arr = (k: keyof CephResourceBundle) => (Array.isArray(r[k]) ? (r[k] as any[]) : []);
  return {
    clusters: arr('clusters'),
    blockPools: arr('blockPools'),
    radosNamespaces: arr('radosNamespaces'),
    filesystems: arr('filesystems'),
    filesystemSubvolumeGroups: arr('filesystemSubvolumeGroups'),
    filesystemMirrors: arr('filesystemMirrors'),
    nfses: arr('nfses'),
    objectStores: arr('objectStores'),
    objectStoreUsers: arr('objectStoreUsers'),
    objectRealms: arr('objectRealms'),
    objectZones: arr('objectZones'),
    objectZoneGroups: arr('objectZoneGroups'),
    bucketTopics: arr('bucketTopics'),
    bucketNotifications: arr('bucketNotifications'),
    cephClients: arr('cephClients'),
    cosiDrivers: arr('cosiDrivers'),
    rbdMirrors: arr('rbdMirrors'),
  };
}

export function cephClusterHealth(c: any): string {
  const st = c?.status?.ceph?.health?.status ?? c?.status?.ceph?.health ?? c?.status?.health;
  if (typeof st === 'string' && st.trim()) return st.trim();
  if (st && typeof st === 'object' && typeof (st as any).status === 'string') return String((st as any).status);
  return '-';
}

export function cephClusterPhase(c: any): string {
  const p = c?.status?.phase;
  return typeof p === 'string' && p.trim() ? p.trim() : '-';
}

export function cephClusterVersion(c: any): string {
  const v =
    c?.status?.version?.version ??
    c?.status?.ceph?.version ??
    c?.spec?.cephVersion?.image ??
    c?.status?.ceph?.details?.version;
  if (typeof v === 'string' && v.trim()) return v.trim();
  return '-';
}

export function cephClusterFsid(c: any): string {
  const f = c?.status?.ceph?.fsid ?? c?.status?.ceph?.info?.fsid ?? c?.status?.fsid;
  return typeof f === 'string' && f.trim() ? f.trim() : '-';
}

export function cephClusterCapacityBytes(c: any): { total: number; used: number; available: number } {
  const cap = c?.status?.ceph?.capacity;
  if (!cap || typeof cap !== 'object') {
    return { total: 0, used: 0, available: 0 };
  }
  const used = parseBigIntish((cap as any).bytesUsed ?? (cap as any).used);
  const avail = parseBigIntish((cap as any).bytesAvailable ?? (cap as any).available);
  const totalRaw = (cap as any).bytesTotal ?? (cap as any).total;
  let total = parseBigIntish(totalRaw);
  if (total <= 0 && (used > 0 || avail > 0)) total = used + avail;
  return { total, used, available: avail };
}

/** 多集群时取健康最差的那条的展示串（供总览卡片） */
function worstClusterHealthDisplay(clusters: any[]): string {
  if (!clusters.length) return '—';
  const RANK: Record<CephHealthLevel, number> = { unknown: 0, ok: 1, warn: 2, err: 3 };
  let worstRank = -1;
  let pick: any = clusters[0];
  for (const c of clusters) {
    const h = cephClusterHealth(c);
    const r = RANK[cephHealthLevel(h)];
    if (r > worstRank) {
      worstRank = r;
      pick = c;
    }
  }
  let s = cephClusterHealth(pick);
  if (!s || s === '-') {
    const ph = cephClusterPhase(pick);
    s = ph !== '-' ? ph : '—';
  }
  return s;
}

/**
 * Steve / Norman 列表响应中的对象条数（`data` / `items` / 数组根）。
 */
export function countSteveListItems(data: unknown): number {
  if (data == null) return 0;
  if (Array.isArray(data)) return data.length;
  if (typeof data === 'object') {
    const r = data as Record<string, unknown>;
    if (Array.isArray(r.data)) return r.data.length;
    if (Array.isArray(r.items)) return r.items.length;
  }
  return 0;
}

/** 多集群时取「健康最差」的 CephCluster，用于 daemon 指标（避免多集群误加总 MON/OSD）。 */
function pickPrimaryClusterForDaemons(clusters: any[]): any | null {
  if (!clusters.length) return null;
  const RANK: Record<CephHealthLevel, number> = { unknown: 0, ok: 1, warn: 2, err: 3 };
  let worstRank = -1;
  let pick: any = clusters[0];
  for (const c of clusters) {
    const r = RANK[cephHealthLevel(cephClusterHealth(c))];
    if (r > worstRank) {
      worstRank = r;
      pick = c;
    }
  }
  return pick;
}

/**
 * Rook `status.ceph.versions.<role>` 常见两种形态：
 * - 「Ceph 版本摘要串 → 守护进程数量」：应对 value 求和（勿用 key 个数，否则 3 个 mon 会显示成 1）；
 * - 「短守护进程名 → 版本串」：对 key 计数。
 */
export function daemonCountFromCephVersionsField(ver: unknown): number {
  if (!ver || typeof ver !== 'object' || Array.isArray(ver)) return 0;
  const o = ver as Record<string, unknown>;
  let sum = 0;
  let anyNumeric = false;
  for (const v of Object.values(o)) {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    if (Number.isFinite(n) && n > 0) {
      sum += Math.round(n);
      anyNumeric = true;
    }
  }
  if (anyNumeric && sum > 0) return sum;
  const keys = Object.keys(o);
  if (!keys.length) return 0;
  const allShortDaemonish = keys.every(
    (k) => k.length <= 32 && !/ceph\s+version/i.test(k),
  );
  return allShortDaemonish ? keys.length : 0;
}

function osdCountFromCephCluster(c: any): number {
  const fromVer = daemonCountFromCephVersionsField(c?.status?.ceph?.versions?.osd);
  if (fromVer > 0) return fromVer;
  const storeType = c?.status?.storage?.osd?.storeType;
  if (storeType && typeof storeType === 'object' && !Array.isArray(storeType)) {
    let s = 0;
    for (const v of Object.values(storeType)) {
      const n = typeof v === 'number' ? v : Number(v);
      if (Number.isFinite(n)) s += n;
    }
    if (s > 0) return Math.round(s);
  }
  return 0;
}

function monCountFromCephCluster(c: any): number {
  const fromVer = daemonCountFromCephVersionsField(c?.status?.ceph?.versions?.mon);
  if (fromVer > 0) return fromVer;
  const specCount = c?.spec?.mon?.count;
  const n = typeof specCount === 'number' ? specCount : Number(specCount);
  if (Number.isFinite(n) && n > 0) return Math.round(n);
  return 0;
}

function mgrCountFromCephCluster(c: any): number {
  return daemonCountFromCephVersionsField(c?.status?.ceph?.versions?.mgr);
}

/**
 * 用 Rook `/ceph/rook/bundle` 合成与 `api/health/minimal` + `api/summary` 相近的结构，
 * 供 `buildCephLandingModel` 消费。
 *
 * - 容量/健康：CephCluster CR（多集群时容量相加；daemon 取健康最差的那套集群）。
 * - MON/OSD/MGR：`status.ceph.versions`（及 `spec.mon.count`、`storage.osd.storeType` 兜底）。
 * - 主机数：可选 `hostCount`（通常来自 `GET .../monitoring/node-resources` 节点列表）。
 * - 对象数 / PG 分布 / 客户端 IOPS/吞吐 / scrub：CR 无 Dashboard 级字段，仍为 —（仅 mgr/Dashboard/Prometheus 可提供）。
 */
export function buildRookCephOverviewLandingInputs(
  bundle: CephResourceBundle,
  options?: { hostCount?: number | null },
): {
  minimal: Record<string, unknown>;
  summary: Record<string, unknown>;
} {
  const clusters = Array.isArray(bundle.clusters) ? bundle.clusters : [];
  const healthDisplay = worstClusterHealthDisplay(clusters);

  let used = 0;
  let avail = 0;
  let total = 0;
  for (const c of clusters) {
    const cap = cephClusterCapacityBytes(c);
    used += cap.used;
    avail += cap.available;
    total += cap.total;
  }
  if (total <= 0 && (used > 0 || avail > 0)) total = used + avail;

  const poolCount = bundle.blockPools?.length ?? 0;
  const fsCount = bundle.filesystems?.length ?? 0;
  const objStoreCount = bundle.objectStores?.length ?? 0;

  const primary = pickPrimaryClusterForDaemons(clusters);
  const monN = primary ? monCountFromCephCluster(primary) : 0;
  const osdN = primary ? osdCountFromCephCluster(primary) : 0;

  const mgrN = primary ? mgrCountFromCephCluster(primary) : 0;
  let mgrMap: Record<string, unknown> | undefined;
  if (mgrN > 0) {
    mgrMap = {
      active_name: 'a',
      standbys: Array.from({ length: Math.max(0, mgrN - 1) }, () => ({})),
    };
  }

  const hcRaw = options?.hostCount;
  const hostCount =
    hcRaw != null && Number.isFinite(Number(hcRaw)) && Number(hcRaw) >= 0 ? Math.round(Number(hcRaw)) : null;

  const minimal: Record<string, unknown> = {
    health: { status: healthDisplay },
    df: {
      stats: {
        total_bytes: total,
        total_used_raw_bytes: used,
        total_avail_bytes: avail,
      },
    },
    pools: poolCount,
  };

  if (hostCount != null) {
    minimal.hosts = hostCount;
  }

  if (monN > 0) {
    minimal.mon_status = {
      monmap: {
        mons: Array.from({ length: monN }, (_, i) => ({ name: `mon${i}` })),
      },
      quorum: Array.from({ length: monN }, (_, i) => i),
    };
  }

  if (osdN > 0) {
    minimal.osd_map = {
      osds: Array.from({ length: osdN }, () => ({ up: true, in: true })),
    };
  }

  if (mgrMap) {
    minimal.mgr_map = mgrMap;
  }

  minimal.fs_map = { filesystems: Array.from({ length: fsCount }, () => ({})) };
  minimal.rgw = objStoreCount;

  const summary: Record<string, unknown> = {
    health_status: healthDisplay,
  };

  return { minimal, summary };
}

const DASHBOARD_MINIMAL_PATCH_KEYS = [
  'client_perf',
  'scrub_status',
  'pg_info',
  'iscsi_daemons',
  /** Dashboard 真值：覆盖 Rook 合成的 mon/osd/mgr 数量与仲裁 */
  'mon_status',
  'osd_map',
  'mgr_map',
] as const;

/**
 * 在 Rook 合成的 `minimal` 上合并 mgr Dashboard `GET api/health/minimal` 中的补丁字段（性能、校验、PG 摘要、iSCSI）。
 * 失败或未返回时，`iscsi_daemons` 缺省为 `{ up: 0, down: 0 }` 以便总览展示 0 而非 —。
 *
 * @param dashEnvelope `fetchCephDashboardSummary` 返回的完整 JSON：`{ data, _tower }`
 */
export function mergeCephDashboardMinimalIntoRookMinimal(
  rookMinimal: Record<string, unknown>,
  dashEnvelope: unknown,
): Record<string, unknown> {
  const out = { ...rookMinimal };
  let dashMinimal: unknown = null;
  if (dashEnvelope != null && typeof dashEnvelope === 'object' && !Array.isArray(dashEnvelope)) {
    const env = dashEnvelope as Record<string, unknown>;
    const inner = env.data;
    const tower = env._tower as Record<string, unknown> | undefined;
    const err = tower?.cephDashboardError;
    if (inner != null && err !== true && err !== 'unreachable') {
      dashMinimal = inner;
    }
  }
  if (dashMinimal != null && typeof dashMinimal === 'object' && !Array.isArray(dashMinimal)) {
    const d = dashMinimal as Record<string, unknown>;
    for (const k of DASHBOARD_MINIMAL_PATCH_KEYS) {
      if (d[k] != null) out[k] = d[k];
    }
  }
  if (out.iscsi_daemons == null) {
    out.iscsi_daemons = { up: 0, down: 0 };
  }
  return out;
}

export function cephHealthLevel(h: string): CephHealthLevel {
  if (!h || h === '-') return 'unknown';
  const u = h.toUpperCase();
  if (u.includes('HEALTH_ERR') || u.includes('ERROR') || u.includes('FAIL')) return 'err';
  if (u.includes('HEALTH_WARN') || u.includes('WARN')) return 'warn';
  if (u.includes('HEALTH_OK') || (u.includes('OK') && !u.includes('WARN'))) return 'ok';
  return 'unknown';
}

const LEVEL_RANK: Record<CephHealthLevel, number> = {
  unknown: 0,
  ok: 1,
  warn: 2,
  err: 3,
};

export function worstCephHealthLevel(clusters: any[]): CephHealthLevel {
  let worst: CephHealthLevel = 'unknown';
  for (const c of clusters) {
    const lv = cephHealthLevel(cephClusterHealth(c));
    if (LEVEL_RANK[lv] > LEVEL_RANK[worst]) worst = lv;
  }
  return worst;
}

export function fmtBytesFromUnknown(n: number): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return '—';
  const gib = n / 1024 ** 3;
  if (gib < 1024) return `${Math.round(gib * 100) / 100} GiB`;
  const tib = n / 1024 ** 4;
  return `${Math.round(tib * 100) / 100} TiB`;
}

export function rookResourceRowKey(r: any, i: number): string {
  const uid = r?.metadata?.uid;
  if (typeof uid === 'string' && uid) return uid;
  const ns = r?.metadata?.namespace;
  const nm = r?.metadata?.name;
  if (ns != null && nm != null) return `${ns}/${nm}`;
  return `ceph-row-${i}`;
}

/** Rook CephBlockPool 列表行（Steve CR，字段宽松读取） */
export type CephBlockPoolRow = {
  key: string;
  name: string;
  namespace: string;
  phase: string;
  poolType: string;
  typeDetail: string;
  failureDomain: string;
  deviceClass: string;
};

/** 存储池列表统一行：Dashboard RADOS 池为主，Rook CR 为兜底 */
export type CephPoolTableRow = {
  key: string;
  name: string;
  namespace: string;
  dataProtection: string;
  applications: string;
  pgStatus: string;
  /** 过滤/标签：Rook 为 CR phase；Dashboard 可与 pg 摘要一致 */
  phase: string;
  usagePct: number | null;
  readIops: string;
  writeIops: string;
  readBps: string;
  writeBps: string;
  /** stats.rd.latest 累计读操作数 */
  readOpsTotal: string;
  /** stats.wr.latest 累计写操作数 */
  writeOpsTotal: string;
  /** stats.rd_bytes.latest 累计读字节 */
  readBytesTotal: string;
  /** stats.wr_bytes.latest 累计写字节 */
  writeBytesTotal: string;
  poolType: string;
  typeDetail: string;
  failureDomain: string;
  deviceClass: string;
  source: 'dashboard' | 'rook';
  /** Dashboard 池 JSON / Rook CephBlockPool CR，供展开「详细信息」等 Tab */
  detailRaw?: unknown;
};

function statLatest(stats: any, key: string): number | null {
  const o = stats?.[key];
  if (o != null && typeof o === 'object' && typeof o.latest === 'number' && Number.isFinite(o.latest)) {
    return o.latest;
  }
  if (typeof o === 'number' && Number.isFinite(o)) return o;
  return null;
}

function statRate(stats: any, key: string): number | null {
  const o = stats?.[key];
  if (o != null && typeof o === 'object' && typeof o.rate === 'number' && Number.isFinite(o.rate)) {
    return o.rate;
  }
  return null;
}

export function formatDashboardPgStatus(pg: unknown): string {
  if (!pg || typeof pg !== 'object') return '—';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(pg as Record<string, unknown>)) {
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isFinite(n) && n !== 0) parts.push(`${n} ${k}`);
  }
  return parts.length ? parts.join(', ') : '—';
}

export function normalizeDashboardPoolListPayload(data: unknown): any[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  const r = data as Record<string, unknown>;
  if (Array.isArray(r.pools)) return r.pools;
  if (r.body != null) return normalizeDashboardPoolListPayload(r.body);
  if (Array.isArray(r.data)) return r.data as any[];
  const inner = r.data;
  if (inner && typeof inner === 'object' && Array.isArray((inner as Record<string, unknown>).pools)) {
    return (inner as { pools: any[] }).pools;
  }
  return [];
}

/** Dashboard 的 rd/wr.latest 为累计值，不能当作 IOPS；仅用 rate。 */
function formatIopsFromRate(rate: number | null): string {
  if (rate == null || !Number.isFinite(rate)) return '—';
  if (rate === 0) return '0 /s';
  return `${rate < 10 ? rate.toFixed(1) : Math.round(rate)} /s`;
}

/** mgr Dashboard 池对象 → 数据保护展示（集群实际 size/type，优先于 Rook CR） */
export function cephDashboardPoolProtectionFields(
  pool: unknown,
): Pick<CephPoolTableRow, 'dataProtection' | 'poolType' | 'typeDetail'> | null {
  if (!pool || typeof pool !== 'object') return null;
  const p = pool as Record<string, unknown>;
  const type = String(p.type ?? '').toLowerCase();
  const opts = p.options != null && typeof p.options === 'object' && !Array.isArray(p.options)
    ? (p.options as Record<string, unknown>)
    : null;
  if (type.includes('erasure')) {
    const prof =
      typeof p.erasure_code_profile === 'string' && p.erasure_code_profile.trim()
        ? p.erasure_code_profile.trim()
        : '';
    const dataProtection = prof ? `纠删 · ${prof}` : '纠删码';
    return { dataProtection, poolType: '纠删码', typeDetail: prof || '—' };
  }
  const sizeRaw = p.size ?? opts?.size;
  if (sizeRaw != null && sizeRaw !== '') {
    const n = Number(sizeRaw);
    if (Number.isFinite(n) && n >= 1) {
      const sz = String(Math.floor(n));
      return { dataProtection: `replica · x${sz}`, poolType: '副本', typeDetail: sz };
    }
    const sz = String(sizeRaw).trim();
    if (sz) {
      return { dataProtection: `replica · x${sz}`, poolType: '副本', typeDetail: sz };
    }
  }
  if (type.includes('replic')) {
    return { dataProtection: 'replica', poolType: '副本', typeDetail: '—' };
  }
  return null;
}

export function cephDashboardPoolToTableRow(pool: any, index: number): CephPoolTableRow {
  const name =
    pool?.pool_name != null
      ? String(pool.pool_name)
      : pool?.name != null
        ? String(pool.name)
        : `pool-${index}`;
  const protection = cephDashboardPoolProtectionFields(pool);
  const dataProtection = protection?.dataProtection ?? '—';
  const appsRaw = pool?.application_metadata;
  let applications = '—';
  if (Array.isArray(appsRaw) && appsRaw.length) {
    applications = appsRaw.map((x: unknown) => String(x)).join(', ');
  } else if (appsRaw && typeof appsRaw === 'object' && !Array.isArray(appsRaw)) {
    applications = Object.keys(appsRaw as object).join(', ') || '—';
  }
  const pgStatus = formatDashboardPgStatus(pool?.pg_status);
  const stats = pool?.stats;
  const used = statLatest(stats, 'bytes_used');
  const maxAvail = statLatest(stats, 'max_avail');
  const pctRaw = statLatest(stats, 'percent_used');
  let usagePct: number | null = null;
  if (pctRaw != null && Number.isFinite(pctRaw) && pctRaw >= 0) {
    // Ceph 常为 0~1 小数（如 0.0097 ≈ 0.97%）；若 >1 则视为已是百分数
    const ratio = pctRaw > 1 ? pctRaw / 100 : pctRaw;
    usagePct = Math.round(ratio * 10000) / 100;
  } else if (used != null && maxAvail != null && used + maxAvail > 0) {
    usagePct = Math.round((used / (used + maxAvail)) * 10000) / 100;
  }
  const readIops = formatIopsFromRate(statRate(stats, 'rd'));
  const writeIops = formatIopsFromRate(statRate(stats, 'wr'));
  const rdBps = statRate(stats, 'rd_bytes');
  const wrBps = statRate(stats, 'wr_bytes');
  const readBps = rdBps != null && Number.isFinite(rdBps) ? formatBps(rdBps) : '—';
  const writeBps = wrBps != null && Number.isFinite(wrBps) ? formatBps(wrBps) : '—';
  const rdOpLatest = statLatest(stats, 'rd');
  const wrOpLatest = statLatest(stats, 'wr');
  const rdBytesLatest = statLatest(stats, 'rd_bytes');
  const wrBytesLatest = statLatest(stats, 'wr_bytes');
  const readOpsTotal =
    rdOpLatest != null && Number.isFinite(rdOpLatest) ? Math.round(rdOpLatest).toLocaleString() : '—';
  const writeOpsTotal =
    wrOpLatest != null && Number.isFinite(wrOpLatest) ? Math.round(wrOpLatest).toLocaleString() : '—';
  const readBytesTotal =
    rdBytesLatest != null && Number.isFinite(rdBytesLatest)
      ? rdBytesLatest > 0
        ? fmtBytesFromUnknown(rdBytesLatest)
        : '0 B'
      : '—';
  const writeBytesTotal =
    wrBytesLatest != null && Number.isFinite(wrBytesLatest)
      ? wrBytesLatest > 0
        ? fmtBytesFromUnknown(wrBytesLatest)
        : '0 B'
      : '—';
  const crush = pool?.crush_rule;
  return {
    key: `dash-pool-${name}-${index}`,
    name,
    namespace: '—',
    dataProtection,
    applications,
    pgStatus,
    phase: pgStatus,
    usagePct,
    readIops,
    writeIops,
    readBps,
    writeBps,
    readOpsTotal,
    writeOpsTotal,
    readBytesTotal,
    writeBytesTotal,
    poolType: '—',
    typeDetail: '—',
    failureDomain: typeof crush === 'string' && crush.trim() ? crush.trim() : '—',
    deviceClass: '—',
    source: 'dashboard',
    detailRaw: pool,
  };
}

/**
 * 云存储列表以 Rook CR 为主；mgr Dashboard `api/pool?stats=true` 按池名合并：
 * - 数据保护（size/type）以 Dashboard 为准（反映集群实际池配置，可与 CR 不同步）；
 * - 读写性能、使用率、PG 摘要来自 stats/pg_status。
 */
export function enrichRookPoolRowWithDashboardStats(row: CephPoolTableRow, dashPool: unknown): CephPoolTableRow {
  if (row.source !== 'rook') return row;
  if (!dashPool || typeof dashPool !== 'object') return row;
  const pool = dashPool as Record<string, unknown>;
  const protection = cephDashboardPoolProtectionFields(pool);
  const stats = pool.stats;
  const hasStats = stats != null && typeof stats === 'object';
  const dashPg = formatDashboardPgStatus(pool.pg_status);
  const hasPg = dashPg !== '—';

  if (!hasStats && !hasPg && !protection) return row;

  let usagePct: number | null = row.usagePct;
  let readIops = row.readIops;
  let writeIops = row.writeIops;
  let readBps = row.readBps;
  let writeBps = row.writeBps;
  let readOpsTotal = row.readOpsTotal;
  let writeOpsTotal = row.writeOpsTotal;
  let readBytesTotal = row.readBytesTotal;
  let writeBytesTotal = row.writeBytesTotal;

  if (hasStats) {
    const s = stats as Record<string, unknown>;
    const used = statLatest(s, 'bytes_used');
    const maxAvail = statLatest(s, 'max_avail');
    const pctRaw = statLatest(s, 'percent_used');
    if (pctRaw != null && Number.isFinite(pctRaw) && pctRaw >= 0) {
      const ratio = pctRaw > 1 ? pctRaw / 100 : pctRaw;
      usagePct = Math.round(ratio * 10000) / 100;
    } else if (used != null && maxAvail != null && used + maxAvail > 0) {
      usagePct = Math.round((used / (used + maxAvail)) * 10000) / 100;
    }
    readIops = formatIopsFromRate(statRate(s, 'rd'));
    writeIops = formatIopsFromRate(statRate(s, 'wr'));
    const rdBps = statRate(s, 'rd_bytes');
    const wrBps = statRate(s, 'wr_bytes');
    readBps = rdBps != null && Number.isFinite(rdBps) ? formatBps(rdBps) : '—';
    writeBps = wrBps != null && Number.isFinite(wrBps) ? formatBps(wrBps) : '—';
    const rdOpLatest = statLatest(s, 'rd');
    const wrOpLatest = statLatest(s, 'wr');
    const rdBytesLatest = statLatest(s, 'rd_bytes');
    const wrBytesLatest = statLatest(s, 'wr_bytes');
    readOpsTotal =
      rdOpLatest != null && Number.isFinite(rdOpLatest) ? Math.round(rdOpLatest).toLocaleString() : '—';
    writeOpsTotal =
      wrOpLatest != null && Number.isFinite(wrOpLatest) ? Math.round(wrOpLatest).toLocaleString() : '—';
    readBytesTotal =
      rdBytesLatest != null && Number.isFinite(rdBytesLatest)
        ? rdBytesLatest > 0
          ? fmtBytesFromUnknown(rdBytesLatest)
          : '0 B'
        : '—';
    writeBytesTotal =
      wrBytesLatest != null && Number.isFinite(wrBytesLatest)
        ? wrBytesLatest > 0
          ? fmtBytesFromUnknown(wrBytesLatest)
          : '0 B'
        : '—';
  }

  return {
    ...row,
    ...(protection ?? {}),
    pgStatus: hasPg ? dashPg : row.pgStatus,
    usagePct,
    readIops,
    writeIops,
    readBps,
    writeBps,
    readOpsTotal,
    writeOpsTotal,
    readBytesTotal,
    writeBytesTotal,
  };
}

/** 从 CR / Dashboard 片段读取 `application_metadata` token（表单与列表共用） */
export function cephPoolApplicationMetadataTokens(blob: unknown): string[] {
  if (!blob || typeof blob !== 'object' || Array.isArray(blob)) return [];
  const r = blob as Record<string, unknown>;
  const appsRaw = r.application_metadata;
  if (Array.isArray(appsRaw) && appsRaw.length) {
    return appsRaw.map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  }
  if (appsRaw && typeof appsRaw === 'object' && !Array.isArray(appsRaw)) {
    return Object.keys(appsRaw as object)
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
  }
  return [];
}

/**
 * Rook `CephBlockPool` CR 对应集群里的块池；未在 CR 中声明 application 时 Ceph 侧一般为 rbd。
 * 若 spec/status 中带有 `application_metadata` 则优先采用。
 */
export function rookCephBlockPoolApplicationsCsv(rookCrRaw: unknown): string {
  if (rookCrRaw == null || typeof rookCrRaw !== 'object') return 'rbd';
  const cr = rookCrRaw as Record<string, unknown>;
  const spec = cr.spec;
  const status = cr.status;
  const merged = [
    ...cephPoolApplicationMetadataTokens(spec),
    ...cephPoolApplicationMetadataTokens(status),
    ...cephPoolApplicationMetadataTokens(cr),
  ];
  const uniq = Array.from(new Set(merged.filter(Boolean)));
  if (uniq.length) return uniq.join(',');
  return 'rbd';
}

/** 池行 `applications` CSV → 英文 token（小写） */
export function parseCephPoolApplicationTokens(applicationsCsv: string): string[] {
  const t = typeof applicationsCsv === 'string' ? applicationsCsv.trim() : '';
  if (!t || t === '—') return [];
  return t
    .split(/[,，]/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Cloudmap 双入口：云存储列出块/RBD/CephFS 向池（排除 Dashboard 语义下「仅 rgw」的池）；
 * 对象存储仅列出标注含 **rgw** 的 RADOS 池（走 Dashboard api/pool 列表）。
 */
export function cephPoolTableRowMatchesApplicationScope(
  row: CephPoolTableRow,
  scope: 'cloud' | 'object',
): boolean {
  const apps = parseCephPoolApplicationTokens(row.applications);
  const has = (x: string) => apps.includes(x);
  if (scope === 'object') {
    return has('rgw');
  }
  if (!apps.length) return true;
  if (has('rgw') && !has('rbd') && !has('cephfs')) return false;
  return true;
}

const CEPH_POOL_APP_TOKEN_ZH: Record<string, string> = {
  rbd: 'RBD（块存储）',
  cephfs: 'CephFS（文件存储）',
  rgw: 'RGW（对象存储）',
};

/** Pools 创建/编辑：应用类型多选选项（Dashboard 与 Rook CephBlockPool 表单共用） */
export const CEPH_POOL_APPLICATION_METADATA_SELECT_OPTIONS = [
  { label: 'rbd（块）', value: 'rbd' },
  { label: 'cephfs（文件）', value: 'cephfs' },
  { label: 'rgw（对象）', value: 'rgw' },
];

const CEPH_POOL_KIND_CARD_SHORT: Record<string, string> = {
  rbd: '块存储',
  cephfs: '文件存储',
  rgw: '对象存储',
};

/** 将 `application_metadata` 导出的逗号分隔英文 token 转为中文短标签 */
export function formatCephPoolApplicationsCsvZh(applicationsCsv: string): string {
  const t = typeof applicationsCsv === 'string' ? applicationsCsv.trim() : '';
  if (!t || t === '—') return '—';
  const parts = t
    .split(/[,，]/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  if (!parts.length) return '—';
  const zh = parts.map((p) => CEPH_POOL_APP_TOKEN_ZH[p] ?? p.toUpperCase());
  return zh.join('、');
}

/** 表格行 → 卡片/概览用的「池类型」中文文案 */
export function formatCephPoolTableRowPoolKindZh(row: CephPoolTableRow): string {
  const raw = typeof row.applications === 'string' ? row.applications.trim() : '';
  if (raw && raw !== '—') return formatCephPoolApplicationsCsvZh(raw);
  if (row.source === 'rook') return CEPH_POOL_APP_TOKEN_ZH.rbd;
  return '—';
}

export function formatCephPoolKindShortZhFromRow(row: CephPoolTableRow): string {
  const raw = typeof row.applications === 'string' ? row.applications.trim() : '';
  if (raw && raw !== '—') {
    const parts = raw
      .split(/[,，]/)
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
    if (!parts.length) return row.source === 'rook' ? CEPH_POOL_KIND_CARD_SHORT.rbd : '—';
    return parts.map((p) => CEPH_POOL_KIND_CARD_SHORT[p] ?? p.toUpperCase()).join('、');
  }
  if (row.source === 'rook') return CEPH_POOL_KIND_CARD_SHORT.rbd;
  return '—';
}

/** `dataProtection`（replica · xN / 纠删 · …）→ 卡片用短中文 */
export function formatCephPoolDataProtectionShortZh(dataProtection: string): string {
  const dp = typeof dataProtection === 'string' ? dataProtection.trim() : '';
  if (!dp || dp === '—') return '';
  const rep = dp.match(/replica\s*[·•]\s*x\s*(\d+)/i) ?? dp.match(/\breplica\b[^0-9]{0,12}x\s*(\d+)/i);
  if (rep) return `${rep[1]}副本`;
  if (/replica/i.test(dp)) {
    const xn = dp.match(/\bx\s*(\d+)\b/i);
    if (xn) return `${xn[1]}副本`;
    return '副本';
  }
  if (/纠删|erasure/i.test(dp)) {
    const m = dp.match(/[·•]\s*(.+)$/);
    const tail = m ? String(m[1]).trim() : '';
    if (tail && tail !== '—') {
      if (/^\d+\+\d+$/.test(tail)) return `纠删 ${tail}`;
      return `纠删码（${tail}）`;
    }
    return '纠删码';
  }
  return dp;
}

/** 存储池概览卡片：一行「用途 + 副本/纠删」 */
export function formatCephPoolCardSummaryLineZh(row: CephPoolTableRow): string {
  const kind = formatCephPoolKindShortZhFromRow(row);
  const prot = formatCephPoolDataProtectionShortZh(row.dataProtection);
  if (!prot) return kind;
  return `${kind}  ${prot}`;
}

export function cephBlockPoolRowToTableRow(r: CephBlockPoolRow, rookCrRaw?: unknown): CephPoolTableRow {
  const dataProtection =
    r.poolType === '—' ? '—' : r.poolType === '副本' ? `replica · x${r.typeDetail}` : `纠删 · ${r.typeDetail}`;
  return {
    key: r.key,
    name: r.name,
    namespace: r.namespace,
    dataProtection,
    applications: rookCephBlockPoolApplicationsCsv(rookCrRaw),
    pgStatus: '—',
    phase: r.phase,
    usagePct: null,
    readIops: '—',
    writeIops: '—',
    readBps: '—',
    writeBps: '—',
    readOpsTotal: '—',
    writeOpsTotal: '—',
    readBytesTotal: '—',
    writeBytesTotal: '—',
    poolType: r.poolType,
    typeDetail: r.typeDetail,
    failureDomain: r.failureDomain,
    deviceClass: r.deviceClass,
    source: 'rook',
    detailRaw: rookCrRaw,
  };
}

export function cephBlockPoolToRow(pool: any, index: number): CephBlockPoolRow {
  const name = typeof pool?.metadata?.name === 'string' ? pool.metadata.name : '—';
  const namespace = typeof pool?.metadata?.namespace === 'string' ? pool.metadata.namespace : '—';
  const phaseRaw = pool?.status?.phase ?? pool?.status?.state ?? pool?.status?.conditions?.[0]?.type;
  const phase = phaseRaw != null && String(phaseRaw).trim() ? String(phaseRaw).trim() : '—';
  const spec = pool?.spec && typeof pool.spec === 'object' ? pool.spec : {};
  const rep = (spec as any).replicated;
  const ec = (spec as any).erasureCoded;
  let poolType = '—';
  let typeDetail = '—';
  if (rep && typeof rep === 'object') {
    poolType = '副本';
    const sz = (rep as any).size ?? (rep as any).targetSize;
    typeDetail = sz != null && sz !== '' ? String(sz) : '—';
  } else if (ec && typeof ec === 'object') {
    poolType = '纠删码';
    const dc = (ec as any).dataChunks;
    const cc = (ec as any).codingChunks;
    typeDetail = dc != null && cc != null ? `${dc}+${cc}` : '—';
  }
  const fd = (spec as any).failureDomain;
  const failureDomain = typeof fd === 'string' && fd.trim() ? fd.trim() : '—';
  const dev =
    (spec as any).deviceClass ??
    (spec as any).parameters?.deviceClass ??
    (spec as any).parameters?.['device-class'];
  const deviceClass = typeof dev === 'string' && dev.trim() ? dev.trim() : '—';
  return {
    key: rookResourceRowKey(pool, index),
    name,
    namespace,
    phase,
    poolType,
    typeDetail,
    failureDomain,
    deviceClass,
  };
}

// —— 存储池展开详情（Dashboard / Rook）——

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

export type CephPoolDetailKV = { key: string; label: string; value: string };

/** 常见标量字符串（英）→ 中文展示 */
const POOL_SCALAR_VALUE_MAP: Record<string, string> = {
  none: '无',
  on: '开启',
  off: '关闭',
  replicated: '副本',
  erasure: '纠删码',
  selfmanaged: '自管理',
  rbd: 'RBD',
  cephfs: 'CephFS',
  rgw: '对象网关',
  hashpspool: 'PG 按池哈希（hashpspool）',
  selfmanaged_snaps: '自管理快照',
};

/** 嵌套对象属性名（与业务无关的通用项）→ 中文 */
const POOL_NESTED_KEY_LABELS: Record<string, string> = {
  type: '类型',
  ready_epoch: '就绪世代',
  last_epoch_started: '上次已启动世代',
  last_epoch_clean: '上次洁净世代',
  source_pgid: '源 PG',
  source_version: '源版本',
  target_version: '目标版本',
};

const MAX_POOL_DETAIL_NEST_DEPTH = 6;
const MAX_POOL_DETAIL_CHARS = 12000;

function translatePoolScalarString(raw: string, fieldKey?: string): string {
  const t = raw.trim();
  if (t === '' || t === '[]' || t === '{}') return '';
  const lower = t.toLowerCase();
  if (lower === 'null' || lower === 'undefined') return '';
  if (POOL_SCALAR_VALUE_MAP[t]) return POOL_SCALAR_VALUE_MAP[t];
  if (POOL_SCALAR_VALUE_MAP[lower]) return POOL_SCALAR_VALUE_MAP[lower];
  if (t.includes(',')) {
    return t
      .split(',')
      .map((p) => translatePoolScalarString(p.trim(), fieldKey))
      .filter(Boolean)
      .join('，');
  }
  return t;
}

function formatPoolScalarNoStruct(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? '是' : '否';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'string') return translatePoolScalarString(v);
  return '…';
}

/** 池详情「值」列：可读文本，避免 JSON 花括号样式；`fieldKey` 用于分层、-1 层级等语义 */
export function formatCephPoolDetailCell(v: unknown, fieldKey?: string, depth = 0): string {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? '是' : '否';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '';
    if (
      fieldKey &&
      (fieldKey === 'write_tier' || fieldKey === 'read_tier' || fieldKey === 'tier_of') &&
      v === -1
    ) {
      return '无';
    }
    return String(v);
  }
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return '';
    if (fieldKey === 'create_time') {
      const ms = Date.parse(t);
      if (Number.isFinite(ms)) {
        return new Date(ms).toLocaleString('zh-CN', { hour12: false });
      }
    }
    return translatePoolScalarString(t, fieldKey);
  }
  if (depth >= MAX_POOL_DETAIL_NEST_DEPTH) {
    if (isPlainRecord(v)) {
      return Object.entries(v)
        .map(([k, val]) => {
          const fv = formatPoolScalarNoStruct(val);
          return fv ? `${POOL_NESTED_KEY_LABELS[k] ?? k}=${fv}` : '';
        })
        .filter(Boolean)
        .join('；');
    }
    if (Array.isArray(v)) {
      return v
        .map((x) => formatPoolScalarNoStruct(x))
        .filter(Boolean)
        .join('，');
    }
    return String(v);
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return '';
    const primitiveLike = (x: unknown) =>
      x == null || ['string', 'number', 'boolean'].includes(typeof x);
    if (v.every(primitiveLike)) {
      return v
        .map((x) => (x == null ? '' : formatCephPoolDetailCell(x, fieldKey, depth + 1)))
        .filter(Boolean)
        .join('，');
    }
    return v
      .map((item, i) => {
        const line = formatCephPoolDetailCell(item, fieldKey, depth + 1);
        const flat = line.replace(/\n/g, ' ').trim();
        if (!flat) return '';
        return `${i + 1}）${flat}`;
      })
      .filter(Boolean)
      .join('\n');
  }
  if (isPlainRecord(v)) {
    const entries = Object.entries(v).filter(([, val]) => val !== undefined);
    if (entries.length === 0) return '';
    if (fieldKey === 'application_metadata') {
      return Object.keys(v)
        .map((k) => translatePoolScalarString(k))
        .filter(Boolean)
        .join('，');
    }
    const isPgStatusLike =
      fieldKey === 'pg_status' &&
      entries.length > 0 &&
      entries.every(([, val]) => typeof val === 'number' && Number.isFinite(val));
    if (isPgStatusLike) {
      return entries.map(([k, val]) => `${k}：${val} 个`).join('\n');
    }
    const lines = entries
      .map(([k, val]) => {
        const nk = POOL_NESTED_KEY_LABELS[k] ?? k;
        const inner = formatCephPoolDetailCell(val, k, depth + 1).trimEnd();
        if (!inner) return '';
        return inner.includes('\n') ? `${nk}：\n${inner}` : `${nk}：${inner}`;
      })
      .filter(Boolean);
    let out = lines.join('\n');
    if (out.length > MAX_POOL_DETAIL_CHARS) {
      out = `${out.slice(0, MAX_POOL_DETAIL_CHARS)}\n…（已截断）`;
    }
    return out;
  }
  try {
    return String(v);
  } catch {
    return '';
  }
}

/** Dashboard 池详情字段 → 中文（含部分 `options.xxx` 全键） */
const DASH_POOL_FIELD_LABELS: Record<string, string> = {
  pool_name: '池名称',
  name: '名称',
  pool: '池编号',
  pool_id: '池编号',
  type: '类型',
  size: '副本数',
  min_size: '最小副本数',
  pg_num: 'PG 数量',
  pgp_num: 'PGP 数量',
  pg_num_pending: '待生效 PG 数',
  pg_num_target: '目标 PG 数',
  pg_placement_num: 'PG 放置数量',
  pg_placement_num_target: '目标 PG 放置数量',
  crush_rule: 'CRUSH 规则',
  erasure_code_profile: '纠删码配置',
  application_metadata: '应用元数据',
  create_time: '创建时间',
  last_change: '最后变更',
  flags: '标志位',
  flags_names: '标志名称',
  auid: 'AU ID',
  expected_num_objects: '预期对象数',
  quota_max_bytes: '配额上限（字节）',
  quota_max_objects: '配额上限（对象数）',
  compression_algorithm: '压缩算法',
  compression_mode: '压缩模式',
  compression_min_blob_size: '压缩最小小块',
  compression_max_blob_size: '压缩最大小块',
  compression_required_ratio: '压缩所需比例',
  snap_seq: '快照序列号',
  snap_mode: '快照模式',
  snap_epoch: '快照世代',
  tier_of: '缓存层上级池',
  write_tier: '写层',
  read_tier: '读层',
  cache_target_dirty_high_ratio_micro: '缓存脏数据高水位（微比率）',
  cache_target_dirty_ratio_micro: '缓存脏数据中水位（微比率）',
  cache_target_full_ratio_micro: '缓存满水位（微比率）',
  cache_min_flush_age: '缓存最小刷盘时间',
  cache_min_evict_age: '缓存最小驱逐时间',
  cache_mode: '缓存模式',
  pg_status: 'PG 状态（原始）',
  pg_autoscale_mode: 'PG 自动伸缩模式',
  target_size_bytes: '目标容量（字节）',
  target_size_ratio: '目标容量比例',
  target_max_bytes: '目标最大字节数',
  target_max_objects: '目标最大对象数',
  fast_read: '快速读',
  grade_table: '分级表',
  hit_set_count: '热点集合数量',
  hit_set_grade_decay_rate: '热点集合分级衰减速率',
  hit_set_params: '热点集合参数',
  hit_set_period: '热点集合周期',
  hit_set_search_last_n: '热点集合检索最近次数',
  last_force_op_resend: '上次强制操作重发',
  last_force_op_resend_preluminous: '强制操作重发（pre-Luminous）',
  last_force_op_resend_prenautilus: '强制操作重发（pre-Nautilus）',
  last_pg_merge_meta: '上次 PG 合并元数据',
  min_read_recency_for_promote: '提升所需最小读新近度',
  min_write_recency_for_promote: '提升所需最小写新近度',
  object_hash: '对象哈希算法',
  peering_crush_bucket_barrier: '互联 CRUSH 桶屏障',
  peering_crush_bucket_count: '互联 CRUSH 桶数量',
  peering_crush_bucket_mandatory_member: '互联 CRUSH 桶必选成员',
  peering_crush_bucket_target: '互联 CRUSH 桶目标',
  pool_snaps: '池快照列表',
  removed_snaps: '已移除快照',
  stripe_width: '条带宽度',
  tiers: '缓存层列表',
  use_gmt_hitset: '使用 GMT 热点集合',
  'options.compression_mode': '选项 · 压缩模式',
};

/** `pool.options` 子键 → 中文（展示为「选项 · …」） */
const POOL_OPTIONS_LABELS: Record<string, string> = {
  compression_mode: '压缩模式',
  compression_algorithm: '压缩算法',
  compression_min_blob_size: '压缩最小小块',
  compression_max_blob_size: '压缩最大小块',
  compression_required_ratio: '压缩所需比例',
  pg_autoscale_mode: 'PG 自动伸缩模式',
  pg_num_min: 'PG 最小数量',
  target_size_bytes: '目标容量（字节）',
  target_size_ratio: '目标容量比例',
  bulk: '批量（bulk）',
  nodelete: '禁止删除',
  nopgchange: '禁止变更 PG',
  nosizechange: '禁止变更副本数',
  csd_mode: 'CSD 模式',
  ec_overwrites: '纠删码覆盖写',
};

function labelForDashPoolFieldKey(fullKey: string): string {
  const direct = DASH_POOL_FIELD_LABELS[fullKey];
  if (direct) return direct;
  if (fullKey.startsWith('options.')) {
    const sub = fullKey.slice('options.'.length);
    const opt = POOL_OPTIONS_LABELS[sub];
    return opt != null ? `选项 · ${opt}` : `选项 · ${sub}`;
  }
  return fullKey;
}

const GENERAL_DETAIL_KEY_ORDER: string[] = [
  'pool_name',
  'name',
  'pool',
  'pool_id',
  'type',
  'size',
  'min_size',
  'pg_num',
  'pgp_num',
  'pg_num_pending',
  'pg_num_target',
  'crush_rule',
  'erasure_code_profile',
  'application_metadata',
  'create_time',
  'last_change',
  'flags',
  'flags_names',
  'auid',
  'expected_num_objects',
  'quota_max_bytes',
  'quota_max_objects',
  'compression_algorithm',
  'compression_mode',
  'compression_min_blob_size',
  'compression_max_blob_size',
  'compression_required_ratio',
  'cache_mode',
  'cache_min_flush_age',
  'cache_min_evict_age',
  'cache_target_dirty_high_ratio_micro',
  'cache_target_dirty_ratio_micro',
  'cache_target_full_ratio_micro',
  'snap_mode',
  'snap_seq',
  'write_tier',
  'read_tier',
  'tier_of',
  'pg_status',
];

const SKIP_GENERAL_TOP_KEYS = new Set(['stats', 'options']);

/** Dashboard `api/pool?stats=true` 单池：详细信息 Tab（含 options.* 展开） */
export function buildDashboardPoolGeneralDetailEntries(pool: unknown): CephPoolDetailKV[] {
  if (!isPlainRecord(pool)) return [];
  const out: CephPoolDetailKV[] = [];
  const seen = new Set<string>();

  for (const k of GENERAL_DETAIL_KEY_ORDER) {
    if (!(k in pool)) continue;
    seen.add(k);
    out.push({
      key: k,
      label: labelForDashPoolFieldKey(k),
      value: formatCephPoolDetailCell(pool[k], k),
    });
  }

  const rest = Object.keys(pool)
    .filter((k) => !seen.has(k) && !SKIP_GENERAL_TOP_KEYS.has(k))
    .sort((a, b) => a.localeCompare(b));
  for (const k of rest) {
    out.push({
      key: k,
      label: labelForDashPoolFieldKey(k),
      value: formatCephPoolDetailCell(pool[k], k),
    });
  }

  const opts = pool.options;
  if (isPlainRecord(opts)) {
    for (const [ok, ov] of Object.entries(opts).sort(([a], [b]) => a.localeCompare(b))) {
      const fk = `options.${ok}`;
      out.push({ key: fk, label: labelForDashPoolFieldKey(fk), value: formatCephPoolDetailCell(ov, fk) });
    }
  }

  return out;
}

const DASH_POOL_STAT_METRIC_LABELS: Record<string, string> = {
  avail: '可用量',
  avail_raw: '可用原始量（字节）',
  bytes_used: '已用字节数',
  compress_bytes_used: '压缩后占用',
  compress_under_bytes: '压缩前估算',
  data_bytes_used: '数据占用（字节）',
  dirty: '脏数据量',
  kb_used: '已用 KiB',
  max_avail: '最大可用',
  objects: '对象数',
  omap_bytes_used: 'OMAP 占用（字节）',
  percent_used: '使用占比',
  quota_bytes: '配额（字节）',
  quota_objects: '配额（对象数）',
  rd: '读操作（累计）',
  rd_bytes: '读字节（累计）',
  stored: '逻辑存储量',
  stored_data: '已存数据量',
  stored_omap: '已存 OMAP',
  stored_raw: '原始存储量',
  wr: '写操作（累计）',
  wr_bytes: '写字节（累计）',
};

export type CephPoolStatDetailRow = {
  key: string;
  /** 中文指标名 */
  label: string;
  latest: string;
  rate: string;
  ratesHint: string;
};

/** 性能详细信息 Tab：`stats.*` 的 latest / rate / 序列点数 */
export function buildDashboardPoolStatsDetailRows(pool: unknown): CephPoolStatDetailRow[] {
  if (!isPlainRecord(pool)) return [];
  const stats = pool.stats;
  if (!isPlainRecord(stats)) return [];

  return Object.keys(stats)
    .sort((a, b) => a.localeCompare(b))
    .map((metric) => {
      const label = DASH_POOL_STAT_METRIC_LABELS[metric] ?? metric;
      const o = stats[metric];
      if (isPlainRecord(o)) {
        const ratesLen = Array.isArray(o.rates) ? o.rates.length : 0;
        return {
          key: metric,
          label,
          latest: formatCephPoolDetailCell(o.latest, metric),
          rate: formatCephPoolDetailCell(o.rate, `${metric}.rate`),
          ratesHint: ratesLen ? `${ratesLen} 个采样点` : '',
        };
      }
      return {
        key: metric,
        label,
        latest: formatCephPoolDetailCell(o, metric),
        rate: '',
        ratesHint: '',
      };
    });
}

export type RookPoolSplitDetail = { general: CephPoolDetailKV[]; config: CephPoolDetailKV[] };

/** Rook CephBlockPool CR：metadata + spec/status 分块展示 */
export function buildRookBlockPoolDetailEntries(cr: unknown): RookPoolSplitDetail {
  const general: CephPoolDetailKV[] = [];
  const config: CephPoolDetailKV[] = [];
  if (!isPlainRecord(cr)) return { general, config };

  const rookMetaLabels: Record<string, string> = {
    name: '名称',
    namespace: '命名空间',
    uid: 'UID',
    resourceVersion: '资源版本',
    generation: '世代',
  };

  const md = cr.metadata;
  if (isPlainRecord(md)) {
    for (const k of ['name', 'namespace', 'uid', 'resourceVersion', 'generation']) {
      if (!(k in md)) continue;
      general.push({
        key: `metadata.${k}`,
        label: rookMetaLabels[k] ?? `元数据 · ${k}`,
        value: formatCephPoolDetailCell(md[k], `metadata.${k}`),
      });
    }
  }

  const spec = cr.spec;
  if (isPlainRecord(spec)) {
    for (const [k, v] of Object.entries(spec).sort(([a], [b]) => a.localeCompare(b))) {
      const fk = `spec.${k}`;
      const sl = `规格 · ${k}`;
      general.push({ key: fk, label: sl, value: formatCephPoolDetailCell(v, fk) });
      config.push({ key: fk, label: sl, value: formatCephPoolDetailCell(v, fk) });
    }
  }

  const st = cr.status;
  if (st != null) {
    general.push({ key: 'status', label: '状态', value: formatCephPoolDetailCell(st, 'status') });
  }

  return { general, config };
}
