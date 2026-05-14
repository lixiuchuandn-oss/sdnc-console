/** Ceph 仪表盘卡片数据：从集群健康摘要 JSON 抽取字段，缺失时降级为 null / —。 */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function countCollection(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (Array.isArray(v)) return v.length;
  if (isRecord(v)) return Object.keys(v).length;
  return null;
}

/** PG 状态聚合为四类：clean / working / warning / unknown */
export function categorizePgStateKey(stateKey: string): 'clean' | 'working' | 'warning' | 'unknown' {
  const s = String(stateKey || '').toLowerCase();
  if (!s || s === 'unknown') return 'unknown';
  if (s.includes('unknown')) return 'unknown';
  if (s.includes('incomplete') || s.includes('inconsistent')) return 'warning';
  if (
    s.includes('degraded') ||
    s.includes('undersized') ||
    s.includes('recovery_toofull') ||
    s.includes('backfill_toofull')
  ) {
    return 'warning';
  }
  if (s.includes('snaptrim') || s.includes('repair')) return 'warning';
  if (s.includes('remapped') || s.includes('backfill') || s.includes('recovering') || s.includes('wait')) {
    return 'working';
  }
  if (s.includes('peering') || s.includes('activating') || s.includes('creating')) return 'working';
  if (s.includes('clean')) return 'clean';
  if (s.includes('active')) return 'working';
  return 'unknown';
}

export function formatCompactCount(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs < 1000) return String(Math.round(n));
  if (abs < 1_000_000) return `${Math.round((n / 1000) * 10) / 10} k`;
  if (abs < 1_000_000_000) return `${Math.round((n / 1_000_000) * 10) / 10} M`;
  return `${Math.round((n / 1_000_000_000) * 10) / 10} G`;
}

/** 吞吐（字节/秒），小数值用 B/KiB/MiB 逐级显示 */
export function formatBps(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '0 B/s';
  const abs = Math.abs(n);
  if (abs < 1024) return `${Math.round(n)} B/s`;
  const u = ['KiB', 'MiB', 'GiB', 'TiB'] as const;
  let v = abs / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i += 1;
  }
  const rounded = Math.round(v * 100) / 100;
  const sign = n < 0 ? '-' : '';
  return `${sign}${rounded} ${u[i]}/s`;
}

export function formatIops(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '0';
  if (Math.abs(n) < 10) return String(Math.round(n * 10) / 10);
  return String(Math.round(n));
}

export type CephLandingStatus = {
  clusterHealth?: string;
  hosts: number | null;
  monitors: { total: number; quorum: number } | null;
  osd: { total: number; up: number; in: number } | null;
  mgr: { active?: string; standbyCount: number } | null;
  rgwTotal: number | null;
  /** CephFS：`fs_map.filesystems` 个数；`fs_map` 缺失时为 null */
  cephFilesystemCount: number | null;
  iscsi: { total: number; up: number; down: number } | null;
};

export type CephLandingCapacity = {
  raw: { used: number; avail: number; total: number; pctOfTotal: number } | null;
  objects: {
    numObjects: number;
    healthy: number;
    misplaced: number;
    degraded: number;
    unfound: number;
    replicas: number;
  } | null;
  pg: { clean: number; working: number; warning: number; unknown: number; total: number } | null;
  poolCount: number | null;
  pgsPerOsd: number | null;
};

export type CephLandingPerf = {
  readIops: number;
  writeIops: number;
  readBps: number;
  writeBps: number;
  recoverBps: number;
  scrubStatus: string;
};

export type CephLandingModel = {
  status: CephLandingStatus;
  capacity: CephLandingCapacity;
  perf: CephLandingPerf | null;
};

function parseMonitors(m: unknown): { total: number; quorum: number } | null {
  if (!isRecord(m)) return null;
  const monmap = m.monmap;
  const quorum = m.quorum;
  let total = 0;
  if (isRecord(monmap) && monmap.mons != null) {
    const c = countCollection(monmap.mons);
    if (c != null) total = c;
  }
  let qn = 0;
  if (Array.isArray(quorum)) qn = quorum.length;
  else {
    const q = num(quorum);
    if (q != null) qn = Math.max(0, Math.round(q));
  }
  if (total === 0 && qn === 0) return null;
  return { total: total || qn, quorum: qn };
}

function parseOsd(osdMap: unknown): { total: number; up: number; in: number } | null {
  if (!isRecord(osdMap)) return null;
  const osds = osdMap.osds;
  if (!Array.isArray(osds) || osds.length === 0) return null;
  let up = 0;
  let inn = 0;
  for (const o of osds) {
    if (!isRecord(o)) continue;
    const u = o.up;
    const i = o.in;
    const upOk = u === true || u === 1 || u === '1' || String(u).toLowerCase() === 'true';
    const inOk = i === true || i === 1 || i === '1' || String(i).toLowerCase() === 'true';
    if (upOk) up += 1;
    if (inOk) inn += 1;
  }
  return { total: osds.length, up, in: inn };
}

function parseMgr(mgrMap: unknown): { active?: string; standbyCount: number } | null {
  if (!isRecord(mgrMap)) return null;
  const active = typeof mgrMap.active_name === 'string' ? mgrMap.active_name : undefined;
  const sb = mgrMap.standbys;
  let standbyCount = 0;
  if (Array.isArray(sb)) standbyCount = sb.length;
  else if (typeof sb === 'number' && Number.isFinite(sb)) standbyCount = sb;
  else if (typeof sb === 'string' && sb.trim()) {
    try {
      const j = JSON.parse(sb);
      if (Array.isArray(j)) standbyCount = j.length;
    } catch {
      standbyCount = 0;
    }
  }
  if (!active && standbyCount === 0) return { active, standbyCount: 0 };
  return { active, standbyCount };
}

function parseIscsi(d: unknown): { total: number; up: number; down: number } | null {
  if (!isRecord(d)) return null;
  const up = num(d.up) ?? 0;
  const down = num(d.down) ?? 0;
  if (up === 0 && down === 0) return { total: 0, up: 0, down: 0 };
  return { total: up + down, up, down };
}

function parseCephFilesystemCount(fsMap: unknown): number | null {
  if (!isRecord(fsMap)) return null;
  const fss = fsMap.filesystems;
  return Array.isArray(fss) ? fss.length : 0;
}

function parsePools(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw);
  if (Array.isArray(raw)) return raw.length;
  if (isRecord(raw)) return Object.keys(raw).length;
  return null;
}

function parsePgBuckets(statuses: unknown): { clean: number; working: number; warning: number; unknown: number; total: number } | null {
  if (!isRecord(statuses)) return null;
  const acc = { clean: 0, working: 0, warning: 0, unknown: 0 };
  let total = 0;
  for (const [k, v] of Object.entries(statuses)) {
    const n = num(v);
    if (n == null || n <= 0) continue;
    total += n;
    acc[categorizePgStateKey(k)] += n;
  }
  if (total === 0) return null;
  return { ...acc, total };
}

export function pickSummaryHealth(data: unknown): string | undefined {
  if (!isRecord(data)) return undefined;
  const h = data.health_status;
  return typeof h === 'string' && h.trim() ? h.trim() : undefined;
}

/** 合并集群健康摘要 JSON 为仪表盘模型 */
export function buildCephLandingModel(minimal: unknown | null, summary: unknown | null): CephLandingModel {
  const summaryHealth = summary != null ? pickSummaryHealth(summary) : undefined;
  const st: CephLandingStatus = {
    clusterHealth: summaryHealth,
    hosts: null,
    monitors: null,
    osd: null,
    mgr: null,
    rgwTotal: null,
    cephFilesystemCount: null,
    iscsi: null,
  };
  const cap: CephLandingCapacity = {
    raw: null,
    objects: null,
    pg: null,
    poolCount: null,
    pgsPerOsd: null,
  };
  let perf: CephLandingPerf | null = null;

  if (minimal != null && isRecord(minimal)) {
    const h = minimal.health;
    if (isRecord(h) && typeof h.status === 'string' && h.status.trim()) {
      if (!st.clusterHealth) st.clusterHealth = h.status.trim();
    }

    st.hosts = num(minimal.hosts);

    st.monitors = parseMonitors(minimal.mon_status);
    st.osd = parseOsd(minimal.osd_map);
    st.mgr = parseMgr(minimal.mgr_map);
    st.rgwTotal = num(minimal.rgw);
    st.cephFilesystemCount = parseCephFilesystemCount(minimal.fs_map);
    st.iscsi = parseIscsi(minimal.iscsi_daemons);

    const df = minimal.df;
    if (isRecord(df) && isRecord(df.stats)) {
      const s = df.stats;
      const totalB = num(s.total_bytes);
      const usedB = num(s.total_used_raw_bytes);
      const availB = num(s.total_avail_bytes);
      if (totalB != null && totalB > 0 && usedB != null && availB != null) {
        const pct = Math.min(100, Math.max(0, (usedB / totalB) * 100));
        cap.raw = { used: usedB, avail: availB, total: totalB, pctOfTotal: pct };
      }
    }

    cap.poolCount = parsePools(minimal.pools);

    const pgInfo = minimal.pg_info;
    if (isRecord(pgInfo)) {
      const ppo = num(pgInfo.pgs_per_osd);
      cap.pgsPerOsd = ppo != null ? Math.round(ppo * 100) / 100 : null;

      const os = pgInfo.object_stats;
      if (isRecord(os)) {
        const numObjects = num(os.num_objects) ?? 0;
        const replicas = num(os.num_object_copies) ?? 0;
        const misplaced = num(os.num_objects_misplaced) ?? 0;
        const degraded = num(os.num_objects_degraded) ?? 0;
        const unfound = num(os.num_objects_unfound) ?? 0;
        const healthy = Math.max(0, replicas - misplaced - degraded - unfound);
        if (replicas > 0 || numObjects > 0) {
          cap.objects = { numObjects, healthy, misplaced, degraded, unfound, replicas };
        }
      }

      cap.pg = parsePgBuckets(pgInfo.statuses);
    }

    const cp = isRecord(minimal.client_perf) ? minimal.client_perf : null;
    const scrubRaw = minimal.scrub_status;
    const scrubStr = typeof scrubRaw === 'string' && scrubRaw.trim() ? scrubRaw.trim() : '—';
    if (cp || scrubStr !== '—') {
      perf = {
        readIops: cp ? num(cp.read_op_per_sec) ?? 0 : 0,
        writeIops: cp ? num(cp.write_op_per_sec) ?? 0 : 0,
        readBps: cp ? num(cp.read_bytes_sec) ?? 0 : 0,
        writeBps: cp ? num(cp.write_bytes_sec) ?? 0 : 0,
        recoverBps: cp ? num(cp.recovering_bytes_per_sec) ?? 0 : 0,
        scrubStatus: scrubStr,
      };
    }
  }

  return { status: st, capacity: cap, perf };
}
