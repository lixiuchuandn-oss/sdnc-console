import { formatBytesWithUnit } from './longhornStorage';

export function fmtBytesFromUnknown(n: unknown): string {
  const v = typeof n === 'string' ? parseFloat(n) : Number(n);
  if (!Number.isFinite(v) || v < 0) return '-';
  const { value, unit } = formatBytesWithUnit(v);
  return `${value.toFixed(2)} ${unit}`;
}

function num(v: unknown): number {
  if (typeof v === 'string') {
    const x = parseFloat(v);
    return Number.isFinite(x) ? x : NaN;
  }
  const x = Number(v);
  return Number.isFinite(x) ? x : NaN;
}

/** 从 Rook CephCluster status 取容量（多版本字段兼容） */
export function cephClusterCapacityBytes(c: any): {
  total: number;
  used: number;
  available: number;
} {
  const cap = c?.status?.ceph?.capacity ?? c?.status?.capacity;
  if (!cap || typeof cap !== 'object') return { total: 0, used: 0, available: 0 };
  const total = num(cap.bytesTotal ?? cap.totalBytes);
  const used = num(cap.bytesUsed ?? cap.usedBytes);
  const available = num(cap.bytesAvailable ?? cap.availableBytes);
  return {
    total: Number.isFinite(total) ? Math.max(0, total) : 0,
    used: Number.isFinite(used) ? Math.max(0, used) : 0,
    available: Number.isFinite(available) ? Math.max(0, available) : 0,
  };
}

export function cephClusterHealth(c: any): string {
  const h = c?.status?.ceph?.health ?? c?.status?.ceph?.details?.health?.status;
  if (typeof h === 'string' && h.trim()) return h.trim();
  const s = c?.status?.health?.status;
  if (typeof s === 'string' && s.trim()) return s.trim();
  return '-';
}

export function cephClusterPhase(c: any): string {
  const p = c?.status?.phase ?? c?.status?.state;
  return typeof p === 'string' && p.trim() ? p.trim() : '-';
}

/** Ceph 版本（Rook status 多路径） */
export function cephClusterVersion(c: any): string {
  const v =
    c?.status?.ceph?.version?.full ??
    c?.status?.ceph?.version ??
    c?.status?.version?.image ??
    c?.spec?.cephVersion?.image;
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (v && typeof v === 'object' && typeof (v as any).full === 'string') return String((v as any).full).trim();
  return '-';
}

export function cephClusterFsid(c: any): string {
  const f = c?.status?.ceph?.fsid ?? c?.status?.ceph?.clusterID;
  return typeof f === 'string' && f.trim() ? f.trim() : '-';
}

export type CephHealthLevel = 'ok' | 'warn' | 'err' | 'unknown';

/** 用于总览条：取多集群中最差健康等级（贴近 Ceph Dashboard 总状态） */
export function cephHealthLevel(healthLabel: string): CephHealthLevel {
  const h = String(healthLabel || '').toUpperCase();
  if (!h || h === '-') return 'unknown';
  if (/ERR|CRITICAL|HEALTH_ERR|ERROR/.test(h)) return 'err';
  if (/WARN|HEALTH_WARN|DEGRAD/.test(h)) return 'warn';
  if (/OK|HEALTH_OK|HEALTHY/.test(h)) return 'ok';
  return 'unknown';
}

export function worstCephHealthLevel(clusters: any[]): CephHealthLevel {
  let worst: CephHealthLevel = 'unknown';
  const rank: Record<CephHealthLevel, number> = { ok: 0, unknown: 1, warn: 2, err: 3 };
  for (const c of clusters) {
    const lv = cephHealthLevel(cephClusterHealth(c));
    if (rank[lv] > rank[worst]) worst = lv;
  }
  return worst;
}

export function listCephClustersFromResponse(res: any): any[] {
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?.data)) return res.data;
  if (Array.isArray(res?.items)) return res.items;
  if (Array.isArray(res?.data?.items)) return res.data.items;
  return [];
}

/** `/monitoring/ceph-resources` 聚合体 */
export type CephResourceBundle = {
  clusters: any[];
  blockPools: any[];
  filesystems: any[];
  objectStores: any[];
  /** CephBlockPoolRadosNamespace：spec.blockPoolName 指向父池 metadata.name */
  radosNamespaces: any[];
};

export function normalizeCephBundle(raw: unknown): CephResourceBundle {
  if (!raw || typeof raw !== 'object') {
    return { clusters: [], blockPools: [], filesystems: [], objectStores: [], radosNamespaces: [] };
  }
  const o = raw as Record<string, unknown>;
  return {
    clusters: Array.isArray(o.clusters) ? o.clusters : [],
    blockPools: Array.isArray(o.blockPools) ? o.blockPools : [],
    filesystems: Array.isArray(o.filesystems) ? o.filesystems : [],
    objectStores: Array.isArray(o.objectStores) ? o.objectStores : [],
    radosNamespaces: Array.isArray(o.radosNamespaces) ? o.radosNamespaces : [],
  };
}

export function rookResourceRowKey(r: any, i?: number): string {
  const ns = r?.metadata?.namespace ?? '';
  const n = r?.metadata?.name ?? '';
  if (n || ns) return `${ns}/${n}`;
  return `row-${i ?? 0}`;
}

export function rookPhase(r: any): string {
  const p = r?.status?.phase ?? r?.status?.state;
  return typeof p === 'string' && p.trim() ? p.trim() : '-';
}

export function rookStatusMessage(r: any): string {
  const m = r?.status?.message ?? (r?.status?.info && (r.status.info as any).message);
  return typeof m === 'string' && m.trim() ? m.trim() : '';
}

export function blockPoolMode(spec: any): string {
  if (spec?.erasureCoded && typeof spec.erasureCoded === 'object') return '纠删码';
  if (spec?.replicated && typeof spec.replicated === 'object') return '副本';
  return '-';
}

export function blockPoolReplicasOrEc(spec: any): string {
  const rep = spec?.replicated?.size;
  if (rep != null && Number.isFinite(Number(rep))) return `${Number(rep)} 副本`;
  const ec = spec?.erasureCoded;
  if (ec && typeof ec === 'object') {
    const data = ec.dataChunks;
    const coding = ec.codingChunks;
    if (data != null && coding != null) return `EC ${data}+${coding}`;
  }
  return '-';
}

/** Rook NamedBlockPoolSpec：Ceph 内池名，可与 CR metadata.name 不同 */
export function blockPoolCephPoolName(spec: any): string {
  const n = spec?.name;
  return typeof n === 'string' && n.trim() ? n.trim() : '-';
}

export function blockPoolDeviceClass(spec: any): string {
  const d = spec?.deviceClass;
  if (typeof d === 'string' && d.trim()) return d.trim();
  return '-';
}

export function blockPoolCrushRoot(spec: any): string {
  const c = spec?.crushRoot;
  return typeof c === 'string' && c.trim() ? c.trim() : '-';
}

/** hybridStorage：主次设备类（Rook 较新版本） */
export function blockPoolHybridSummary(spec: any): string {
  const h = spec?.hybridStorage;
  if (!h || typeof h !== 'object') return '-';
  const p = h.primaryDeviceClass;
  const s = h.secondaryDeviceClass;
  if (typeof p === 'string' && p && typeof s === 'string' && s) return `${p}/${s}`;
  return '-';
}

/** spec.parameters 摘要（如 compression_mode） */
export function blockPoolParametersSummary(spec: any, maxLen = 100): string {
  const p = spec?.parameters;
  if (!p || typeof p !== 'object') return '-';
  const parts = Object.entries(p)
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .map(([k, v]) => `${k}=${String(v).trim()}`);
  if (!parts.length) return '-';
  const s = parts.join(', ');
  return s.length <= maxLen ? s : `${s.slice(0, maxLen)}…`;
}

export function blockPoolQuotasSummary(spec: any): string {
  const q = spec?.quotas;
  if (!q || typeof q !== 'object') return '-';
  const bits: string[] = [];
  if (q.maxSize != null && String(q.maxSize).trim()) bits.push(`maxSize=${String(q.maxSize).trim()}`);
  if (q.maxObjects != null && String(q.maxObjects).trim()) bits.push(`maxObjects=${String(q.maxObjects).trim()}`);
  return bits.length ? bits.join(' · ') : '-';
}

export function blockPoolMirroringSummary(spec: any): string {
  const m = spec?.mirroring;
  if (!m || typeof m !== 'object') return '-';
  if (m.enabled === true) return '已启用';
  if (m.enabled === false) return '关闭';
  return '-';
}

/** status 中池 ID 等（字段随 Rook 版本变化，宽松读取） */
export function blockPoolStatusPoolId(status: any): string {
  const v =
    status?.info?.poolID ??
    status?.info?.poolId ??
    status?.ceph?.poolID ??
    status?.ceph?.poolId ??
    status?.poolID;
  if (v == null) return '-';
  const s = String(v).trim();
  return s || '-';
}

/** 同一命名空间下，指向该 CephBlockPool CR 名的 RADOS 命名空间数量 */
export function countRadosNamespacesForBlockPool(pool: any, radosNamespaces: any[]): number {
  const ns = pool?.metadata?.namespace ?? '';
  const poolCrName = String(pool?.metadata?.name || '').trim();
  if (!poolCrName) return 0;
  return radosNamespaces.filter((rn: any) => {
    if (String(rn?.metadata?.namespace ?? '') !== String(ns)) return false;
    const target = String(rn?.spec?.blockPoolName || '').trim();
    return target === poolCrName;
  }).length;
}

export function filesystemMdsSummary(spec: any): string {
  const a = spec?.metadataServer?.activeCount;
  if (a != null && Number.isFinite(Number(a))) return `活跃 MDS ${a}`;
  const count = spec?.metadataServer?.count;
  if (count != null && Number.isFinite(Number(count))) return `MDS ${count}`;
  return '-';
}

export function objectStorePoolsSummary(spec: any): string {
  const d = spec?.dataPool?.name ?? spec?.dataPool;
  const m = spec?.metadataPool?.name ?? spec?.metadataPool;
  const parts: string[] = [];
  if (typeof d === 'string' && d) parts.push(`数据 ${d}`);
  if (typeof m === 'string' && m) parts.push(`元数据 ${m}`);
  return parts.length ? parts.join(' · ') : '-';
}

/** Steve / Harvester 列表响应统一抽出条目（与 diskSummary.getList 对齐） */
export function harvesterSteveItems(res: unknown): any[] {
  if (Array.isArray(res)) return res;
  if (res && typeof res === 'object') {
    const r = res as Record<string, unknown>;
    if (Array.isArray(r.data)) return r.data as any[];
    if (Array.isArray(r.items)) return r.items as any[];
    const d = r.data as Record<string, unknown> | undefined;
    if (d && Array.isArray(d.items)) return d.items as any[];
  }
  return [];
}

export function blockDeviceRowKey(bd: any, i?: number): string {
  const ns = bd?.metadata?.namespace ?? '';
  const n = bd?.metadata?.name ?? '';
  if (n || ns) return `${ns}/${n}`;
  return `bd-${i ?? 0}`;
}

export function blockDeviceNodeName(bd: any): string {
  const n = bd?.spec?.nodeName;
  return typeof n === 'string' && n.trim() ? n.trim() : '-';
}

export function blockDeviceDevPath(bd: any): string {
  const p = bd?.spec?.devPath ?? bd?.status?.deviceStatus?.path;
  return typeof p === 'string' && p.trim() ? p.trim() : '-';
}

/** 容量：可能是字节数或 Kubernetes 量纲字符串（如 500Gi） */
export function blockDeviceCapacityLabel(bd: any): string {
  const c = bd?.status?.deviceStatus?.capacity ?? bd?.status?.capacity?.total ?? bd?.status?.capacity;
  if (c == null || c === '') return '-';
  if (typeof c === 'number' && Number.isFinite(c)) return fmtBytesFromUnknown(c);
  const s = String(c).trim();
  if (!s) return '-';
  if (/^[0-9]+(\.[0-9]+)?$/.test(s)) {
    const n = parseFloat(s);
    return Number.isFinite(n) ? fmtBytesFromUnknown(n) : s;
  }
  return s;
}

export function blockDeviceProvisionPhase(bd: any): string {
  const p = bd?.status?.provisionPhase ?? bd?.status?.phase;
  return typeof p === 'string' && p.trim() ? p.trim() : '-';
}

export function blockDeviceModel(bd: any): string {
  const d = bd?.status?.deviceStatus?.details;
  if (!d || typeof d !== 'object') return '-';
  const m = (d as any).model ?? (d as any).Model;
  return typeof m === 'string' && m.trim() ? m.trim() : '-';
}

export function blockDeviceSerialOrWwn(bd: any): string {
  const d = bd?.status?.deviceStatus?.details;
  if (!d || typeof d !== 'object') return '-';
  const wwn = (d as any).wwn ?? (d as any).WWN ?? (d as any).serialNumber ?? (d as any).SerialNumber;
  return typeof wwn === 'string' && wwn.trim() ? wwn.trim() : '-';
}

export function blockDeviceDiskType(bd: any): string {
  const d = bd?.status?.deviceStatus?.details;
  if (!d || typeof d !== 'object') return '-';
  const t = (d as any).deviceType ?? (d as any).type ?? (d as any).Type;
  return typeof t === 'string' && t.trim() ? t.trim() : '-';
}

/** 是否声明由 Harvester 供应给 Longhorn/Ceph 等 */
export function blockDeviceProvisionIntent(bd: any): string {
  const want = bd?.spec?.provision === true;
  const fsProv = bd?.spec?.fileSystem?.provisioned === true;
  if (want && fsProv) return '供应 · 文件系统';
  if (want) return '供应';
  if (fsProv) return '文件系统';
  return '-';
}

export function blockDeviceHasError(bd: any): boolean {
  return bd?.metadata?.state?.error === true;
}
