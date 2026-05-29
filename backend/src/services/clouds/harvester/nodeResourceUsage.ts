import { requestJson } from './utils';
import type { Cloud } from '../../../entities/Cloud';

/**
 * 节点 CPU/内存资源用量服务端聚合。
 *
 * 背景：前端原先并行拉取 metrics、全集群 Pod（allNamespaces）、nodes 三份原始数据，
 * 再在浏览器里逐 Pod 聚合每节点 requests。全量 Pod 列表体量大、传输与解析慢。
 * 本服务把同样的三次读取与聚合放到服务端（更靠近集群、无需把全量 Pod 传回浏览器），
 * 只回一份按节点名聚合的小结果。聚合口径与前端原实现保持一致。
 */

/** 解析 CPU 字符串为核数（m/u/n 与裸核） */
function parseCpuToCores(s?: string): number {
  if (!s) return 0;
  const t = String(s).trim();
  if (/m$/i.test(t)) {
    const v = Number(t.replace(/m$/i, ''));
    return isFinite(v) ? v / 1000 : 0;
  }
  if (/n$/i.test(t)) {
    const v = Number(t.replace(/n$/i, ''));
    return isFinite(v) ? v / 1e9 : 0;
  }
  if (/u$/i.test(t)) {
    const v = Number(t.replace(/u$/i, ''));
    return isFinite(v) ? v / 1e6 : 0;
  }
  const v = Number(t);
  return isFinite(v) ? v : 0;
}

/** 解析内存字符串为字节数（Ki/Mi/Gi/Ti 与 K/M/G/T） */
function parseMemoryToBytes(s?: string): number {
  if (!s) return 0;
  const t = String(s).trim();
  const m = t.match(/^(\d+(?:\.\d+)?)([KMGTP]i?)?$/i);
  if (!m) return 0;
  const val = Number(m[1]);
  const unit = (m[2] || '').toLowerCase();
  let bytes = val;
  if (unit === 'ki') bytes = val * 1024;
  else if (unit === 'mi') bytes = val * 1024 * 1024;
  else if (unit === 'gi') bytes = val * 1024 * 1024 * 1024;
  else if (unit === 'ti') bytes = val * 1024 * 1024 * 1024 * 1024;
  else if (unit === 'k') bytes = val * 1000;
  else if (unit === 'm') bytes = val * 1e6;
  else if (unit === 'g') bytes = val * 1e9;
  else if (unit === 't') bytes = val * 1e12;
  return bytes;
}

/** 与 harvester proxy 一致的 K8s 原生路径目标构建（去除 endpoint 版本后缀） */
function buildK8sTarget(cloud: Cloud, path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  let base = String(cloud.endpoint || '').replace(/\/+$/, '');
  if (
    (cleanPath.startsWith('/api/') || cleanPath.startsWith('/apis/')) &&
    !base.includes('/k8s/clusters/')
  ) {
    base = base.replace(/\/v[0-9]+(\/harvester)?$/, '');
  }
  return `${base}${cleanPath}`;
}

export type NodeMetricUsage = { cpuUsedCores: number; memUsedBytes: number };
export type NodeRequests = { cpuRequestCores: number; memRequestBytes: number };
export type NodeDetailAlloc = {
  allocatableCpu?: string;
  allocatableMemory?: string;
  capacityCpu?: string;
  capacityMemory?: string;
};

/** 各上游调用耗时（ms），用于定位「慢在哪条」——pods 通常是大头 */
export type NodeResourceUsageTimings = {
  metricsMs: number;
  podsMs: number;
  nodesMs: number;
  totalMs: number;
  cached?: boolean;
};

export type NodeResourceUsageResult = {
  metrics: Record<string, NodeMetricUsage>;
  requests: Record<string, NodeRequests>;
  detail: Record<string, NodeDetailAlloc>;
  _timings: NodeResourceUsageTimings;
};

function listItems(payload: unknown): unknown[] {
  const items = (payload as { items?: unknown })?.items;
  return Array.isArray(items) ? items : [];
}

/** 短 TTL 服务端缓存：轮询/重复进入不再每次回源集群；显式 force 绕过并刷新 */
const NODE_USAGE_CACHE_TTL_MS = 12_000;
const nodeUsageCache = new Map<string, { ts: number; data: NodeResourceUsageResult }>();

/** 服务端读取 metrics/nodes/pods 并按节点聚合 used/requests/allocatable/capacity */
export async function getHarvesterNodeResourceUsage(
  cloud: Cloud,
  opts?: { force?: boolean },
): Promise<NodeResourceUsageResult> {
  const cacheKey = String(cloud.id || cloud.endpoint || '');
  if (!opts?.force && cacheKey) {
    const hit = nodeUsageCache.get(cacheKey);
    if (hit && Date.now() - hit.ts < NODE_USAGE_CACHE_TTL_MS) {
      return { ...hit.data, _timings: { ...hit.data._timings, cached: true } };
    }
  }

  const insecure = !!(cloud.config as { ignoreTls?: boolean })?.ignoreTls;
  const secret = cloud.secretKey || '';
  const timed = async (p: string): Promise<{ data: unknown; ms: number }> => {
    const t0 = Date.now();
    const data = await requestJson('GET', buildK8sTarget(cloud, p), secret, insecure, undefined).catch(
      () => null,
    );
    return { data, ms: Date.now() - t0 };
  };

  const startedAt = Date.now();
  const [metricsT, podsT, nodesT] = await Promise.all([
    timed('/apis/metrics.k8s.io/v1beta1/nodes'),
    timed('/api/v1/pods?allNamespaces=true'),
    timed('/api/v1/nodes'),
  ]);
  const metricsRes = metricsT.data;
  const podsRes = podsT.data;
  const nodesRes = nodesT.data;

  const metrics: Record<string, NodeMetricUsage> = {};
  for (const it of listItems(metricsRes)) {
    const row = it as { metadata?: { name?: string }; usage?: { cpu?: string; memory?: string } };
    const name = row?.metadata?.name || '';
    if (!name) continue;
    metrics[name] = {
      cpuUsedCores: parseCpuToCores(row?.usage?.cpu),
      memUsedBytes: parseMemoryToBytes(row?.usage?.memory),
    };
  }

  const detail: Record<string, NodeDetailAlloc> = {};
  for (const node of listItems(nodesRes)) {
    const n = node as {
      metadata?: { name?: string };
      status?: {
        allocatable?: { cpu?: string; memory?: string };
        capacity?: { cpu?: string; memory?: string };
      };
    };
    const name = n?.metadata?.name || '';
    if (!name) continue;
    detail[name] = {
      allocatableCpu: n?.status?.allocatable?.cpu,
      allocatableMemory: n?.status?.allocatable?.memory,
      capacityCpu: n?.status?.capacity?.cpu,
      capacityMemory: n?.status?.capacity?.memory,
    };
  }

  type ContainerRes = {
    resources?: {
      requests?: { cpu?: string; memory?: string };
      limits?: { cpu?: string; memory?: string };
    };
  };
  const requests: Record<string, NodeRequests> = {};
  for (const pod of listItems(podsRes)) {
    const p = pod as {
      spec?: { nodeName?: string; containers?: ContainerRes[]; initContainers?: ContainerRes[] };
    };
    const nodeName = p?.spec?.nodeName || '';
    if (!nodeName) continue;
    if (!requests[nodeName]) {
      requests[nodeName] = { cpuRequestCores: 0, memRequestBytes: 0 };
    }
    const containers = Array.isArray(p?.spec?.containers) ? p.spec!.containers! : [];
    const initContainers = Array.isArray(p?.spec?.initContainers) ? p.spec!.initContainers! : [];
    for (const c of [...containers, ...initContainers]) {
      const req = c?.resources?.requests || {};
      const lim = c?.resources?.limits || {};
      const cpuReq = req?.cpu || lim?.cpu;
      const memReq = req?.memory || lim?.memory;
      requests[nodeName].cpuRequestCores =
        (requests[nodeName].cpuRequestCores || 0) + parseCpuToCores(cpuReq);
      requests[nodeName].memRequestBytes =
        (requests[nodeName].memRequestBytes || 0) + parseMemoryToBytes(memReq);
    }
  }

  const result: NodeResourceUsageResult = {
    metrics,
    requests,
    detail,
    _timings: {
      metricsMs: metricsT.ms,
      podsMs: podsT.ms,
      nodesMs: nodesT.ms,
      totalMs: Date.now() - startedAt,
    },
  };
  if (cacheKey) {
    nodeUsageCache.set(cacheKey, { ts: Date.now(), data: result });
  }
  return result;
}
