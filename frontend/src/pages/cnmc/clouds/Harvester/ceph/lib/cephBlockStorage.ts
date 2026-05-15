/**
 * 块存储 Tab：RBD Mirror、COSI 等列表行映射（数据来自 Rook bundle / Steve GET）。
 */

import { rookResourceRowKey } from './cephStorage';
import { suggestedRgwHttpsEndpoints } from './rgwRookHints';

export type CephRbdMirrorRow = {
  key: string;
  name: string;
  namespace: string;
  phase: string;
  raw: unknown;
};

export type CephCosiDriverRow = {
  key: string;
  name: string;
  namespace: string;
  phase: string;
  raw: unknown;
};

/** Rook `CephObjectStore` 列表行（bundle 列表 + Steve 字段推导） */
export type CephObjectStoreRow = {
  key: string;
  name: string;
  namespace: string;
  /** status.phase */
  phase: string;
  /** status.message */
  message: string;
  metadataPool: string;
  dataPool: string;
  /** 摘要：实例数、明文/TLS 端口等 */
  gatewaySummary: string;
  /** 从集群推导的候选 Endpoint 中的首条（列表主展示） */
  primaryEndpointHint: string;
  suggestedEndpoints: string[];
  multisiteZone: string;
  /** spec.preservePoolsOnDelete */
  preservePoolsOnDelete: string;
  observedGeneration: string;
  creationTime: string;
  raw: unknown;
};

function str(v: unknown): string {
  return typeof v === 'string' && v.trim() ? v.trim() : '—';
}

function poolRefLabel(pool: unknown): string {
  if (typeof pool === 'string' && pool.trim()) return pool.trim();
  if (pool && typeof pool === 'object') {
    const n = (pool as { name?: unknown }).name;
    if (typeof n === 'string' && n.trim()) return n.trim();
  }
  return '—';
}

function multisiteZoneLabel(spec: Record<string, unknown>): string {
  const z = spec.zone;
  if (typeof z === 'string' && z.trim()) return z.trim();
  if (z && typeof z === 'object') {
    const n = (z as { name?: unknown }).name;
    if (typeof n === 'string' && n.trim()) return n.trim();
  }
  return '—';
}

export function rbdMirrorCrToRow(r: any, i: number): CephRbdMirrorRow {
  return {
    key: rookResourceRowKey(r, i),
    name: str(r?.metadata?.name),
    namespace: str(r?.metadata?.namespace),
    phase: str(r?.status?.phase ?? r?.status?.info),
    raw: r,
  };
}

export function cosiDriverCrToRow(r: any, i: number): CephCosiDriverRow {
  return {
    key: rookResourceRowKey(r, i),
    name: str(r?.metadata?.name),
    namespace: str(r?.metadata?.namespace),
    phase: str(r?.status?.phase),
    raw: r,
  };
}

export function objectStoreCrToRow(r: any, i: number): CephObjectStoreRow {
  const spec = r?.spec && typeof r.spec === 'object' ? (r.spec as Record<string, unknown>) : {};
  const status = r?.status && typeof r.status === 'object' ? (r.status as Record<string, unknown>) : {};
  const gw = spec.gateway && typeof spec.gateway === 'object' ? (spec.gateway as Record<string, unknown>) : null;
  const instances = gw?.instances;
  const port = gw?.port;
  const securePort = gw?.securePort;
  const gwParts: string[] = [];
  if (instances != null && instances !== '') gwParts.push(`${String(instances)} 实例`);
  if (port != null && port !== '') gwParts.push(`明文 ${String(port)}`);
  if (securePort != null && securePort !== '') gwParts.push(`TLS ${String(securePort)}`);
  const gatewaySummary = gwParts.length ? gwParts.join(' · ') : '—';

  const suggested = suggestedRgwHttpsEndpoints(r);
  const primaryEndpointHint = suggested[0] || '—';

  const md = r?.metadata && typeof r.metadata === 'object' ? (r.metadata as Record<string, unknown>) : {};
  const created = typeof md.creationTimestamp === 'string' ? md.creationTimestamp : '';
  let creationTime = '—';
  if (created) {
    try {
      creationTime = new Date(created).toLocaleString('zh-CN', { hour12: false });
    } catch {
      creationTime = created.length >= 16 ? created.slice(0, 16).replace('T', ' ') : created;
    }
  }

  const msg = status.message;
  const phaseRaw = status.phase;

  const pp = spec.preservePoolsOnDelete;
  let preservePoolsOnDelete = '—';
  if (pp === true) preservePoolsOnDelete = '是';
  else if (pp === false) preservePoolsOnDelete = '否';

  return {
    key: rookResourceRowKey(r, i),
    name: str(r?.metadata?.name),
    namespace: str(r?.metadata?.namespace),
    phase: typeof phaseRaw === 'string' && phaseRaw.trim() ? phaseRaw.trim() : '—',
    message: typeof msg === 'string' && msg.trim() ? msg.trim() : '—',
    metadataPool: poolRefLabel(spec.metadataPool),
    dataPool: poolRefLabel(spec.dataPool),
    gatewaySummary,
    primaryEndpointHint,
    suggestedEndpoints: suggested,
    multisiteZone: multisiteZoneLabel(spec),
    preservePoolsOnDelete,
    observedGeneration:
      status.observedGeneration != null && String(status.observedGeneration).trim() !== ''
        ? String(status.observedGeneration)
        : '—',
    creationTime,
    raw: r,
  };
}
