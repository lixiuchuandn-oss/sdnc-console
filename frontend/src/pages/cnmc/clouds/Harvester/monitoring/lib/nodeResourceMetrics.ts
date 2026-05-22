/**
 * 节点资源/指标解析与汇总（node-resources、node-metrics）
 * 与参考项目 Compute.Tower-Monitoring 一致。
 */
export interface NodeResourcesData {
  data?: Array<{
    status?: {
      allocatable?: { cpu?: string; memory?: string; [k: string]: unknown };
      capacity?: { cpu?: string; memory?: string; [k: string]: unknown };
      [k: string]: unknown;
    };
    [k: string]: unknown;
  }>;
  [k: string]: unknown;
}

export interface NodeMetricsData {
  data?: Array<{
    usage?: { cpu?: string; memory?: string; [k: string]: unknown };
    [k: string]: unknown;
  }>;
  [k: string]: unknown;
}

const CORES_PER_M = 1 / 1000;
const CORES_PER_N = 1 / 1e9;

export function parseCpuToCores(s: string | undefined): number {
  if (s == null || typeof s !== 'string') return 0;
  const t = s.trim();
  const m = t.match(/^(\d+(?:\.\d+)?)\s*([mun])?$/i);
  if (!m) return 0;
  const num = parseFloat(m[1]);
  if (Number.isNaN(num)) return 0;
  const suffix = (m[2] || '').toLowerCase();
  if (suffix === 'm') return num * CORES_PER_M;
  if (suffix === 'u') return num * (1 / 1e6);
  if (suffix === 'n') return num * CORES_PER_N;
  return num;
}

const KI = 1024;
const MI = 1024 ** 2;
const GI = 1024 ** 3;
const TI = 1024 ** 4;

export function parseMemoryToBytes(s: string | undefined): number {
  if (s == null || typeof s !== 'string') return 0;
  const t = s.trim();
  const m = t.match(/^(\d+)\s*([KMGTP]i?)?$/i);
  if (!m) return 0;
  const num = parseInt(m[1], 10);
  if (Number.isNaN(num)) return 0;
  const suffix = (m[2] || '').toLowerCase();
  if (suffix === 'ki') return num * KI;
  if (suffix === 'mi') return num * MI;
  if (suffix === 'gi') return num * GI;
  if (suffix === 'ti') return num * TI;
  if (suffix === 'k') return num * 1000;
  if (suffix === 'm') return num * 1e6;
  if (suffix === 'g') return num * 1e9;
  if (suffix === 't') return num * 1e12;
  return num;
}

export interface NodeResourcesSummary {
  totalCpuCores: number;
  totalMemoryBytes: number;
  totalCapacityMemoryBytes: number;
  reservedMemoryBytes: number;
}

export function aggregateNodeResources(res: NodeResourcesData | null): NodeResourcesSummary {
  const out: NodeResourcesSummary = {
    totalCpuCores: 0,
    totalMemoryBytes: 0,
    totalCapacityMemoryBytes: 0,
    reservedMemoryBytes: 0,
  };
  const list = res?.data;
  if (!Array.isArray(list)) return out;

  for (const node of list) {
    const status = node?.status;
    const alloc = status?.allocatable;
    const cap = status?.capacity;
    if (alloc) {
      out.totalCpuCores += parseCpuToCores(alloc.cpu as string);
      out.totalMemoryBytes += parseMemoryToBytes(alloc.memory as string);
    }
    if (cap) {
      const capBytes = parseMemoryToBytes(cap.memory as string);
      out.totalCapacityMemoryBytes += capBytes;
      if (alloc) {
        const allocBytes = parseMemoryToBytes(alloc.memory as string);
        out.reservedMemoryBytes += Math.max(0, capBytes - allocBytes);
      }
    }
  }
  return out;
}

export interface NodeMetricsSummary {
  usedCpuCores: number;
  usedMemoryBytes: number;
}

export function aggregateNodeMetrics(res: NodeMetricsData | null): NodeMetricsSummary {
  const out: NodeMetricsSummary = { usedCpuCores: 0, usedMemoryBytes: 0 };
  const list = res?.data;
  if (!Array.isArray(list)) return out;

  for (const node of list) {
    const usage = node?.usage;
    if (usage) {
      out.usedCpuCores += parseCpuToCores(usage.cpu as string);
      out.usedMemoryBytes += parseMemoryToBytes(usage.memory as string);
    }
  }
  return out;
}

const BYTES_PER_GIB = 1024 ** 3;
const BYTES_PER_TIB = 1024 ** 4;

export function formatMemoryForDisplay(bytes: number): { value: number; unit: 'GiB' | 'TiB'; text: string } {
  const tib = bytes / BYTES_PER_TIB;
  if (tib >= 1) {
    const value = Math.round(tib * 100) / 100;
    return { value, unit: 'TiB', text: `${value} TiB` };
  }
  const gib = bytes / BYTES_PER_GIB;
  const value = Math.round(gib * 100) / 100;
  return { value, unit: 'GiB', text: `${value} GiB` };
}
