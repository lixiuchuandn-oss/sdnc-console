import type { XinferenceClusterSummary } from '../../../../../services/xinferenceApi';

export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}

/** 内存（RAM） */
export function fmtGiB(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${(v / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

/** 显存（GPU VRAM） */
export function fmtMiB(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${(v / 1024 / 1024).toFixed(2)} MiB`;
}

export function fmtVersionRelease(release?: string): string {
  if (!release) return '—';
  return release.startsWith('v') ? release : `v${release}`;
}

export function fmtCommit(commit?: string): string {
  if (!commit) return '—';
  return commit.length > 12 ? `${commit.slice(0, 12)}…` : commit;
}

export function getRiskColor(percent: number): string {
  if (percent >= 90) return '#ef4444';
  if (percent >= 70) return '#f59e0b';
  return '#22C55E';
}

export type XinferenceClusterAggregate = {
  nodeCount: number;
  workerCount: number;
  cpuUsagePercent: number | null;
  cpuCount: number | null;
  memUsedBytes: number | null;
  memTotalBytes: number | null;
  memUsagePercent: number | null;
  gpuCount: number;
  gpuUtilization: number | null;
  gpuVramUsedBytes: number | null;
  gpuVramTotalBytes: number | null;
  gpuVramUsagePercent: number | null;
};

function weightedCpuUsage(cores: number | null, usage: number | null): number {
  if (cores == null || cores <= 0 || usage == null) return 0;
  return usage * cores;
}

/** 主管 + 工作节点汇总为集群级指标（供仪表板卡片使用） */
export function aggregateClusterMetrics(
  supervisor?: XinferenceClusterSummary,
  workersSummary?: XinferenceClusterSummary,
): XinferenceClusterAggregate {
  const sup = supervisor;
  const w = workersSummary;
  const supCores = sup?.cpuCount ?? 0;
  const workerCores = w?.cpuCount ?? 0;
  const totalCores = supCores + workerCores;

  let cpuUsagePercent: number | null = null;
  if (totalCores > 0) {
    const used =
      weightedCpuUsage(sup?.cpuCount ?? null, sup?.cpuUsagePercent ?? null) +
      weightedCpuUsage(w?.cpuCount ?? null, w?.cpuUsagePercent ?? null);
    cpuUsagePercent = used / totalCores;
  }

  const memUsedBytes =
    sup?.memUsedBytes == null && w?.memUsedBytes == null
      ? null
      : (sup?.memUsedBytes ?? 0) + (w?.memUsedBytes ?? 0);
  const memTotalBytes =
    sup?.memTotalBytes == null && w?.memTotalBytes == null
      ? null
      : (sup?.memTotalBytes ?? 0) + (w?.memTotalBytes ?? 0);
  const memUsagePercent =
    memUsedBytes != null && memTotalBytes != null && memTotalBytes > 0
      ? (memUsedBytes / memTotalBytes) * 100
      : null;

  const gpuVramUsedBytes = w?.gpuVramUsedBytes ?? null;
  const gpuVramTotalBytes = w?.gpuVramTotalBytes ?? null;
  const gpuVramUsagePercent =
    gpuVramUsedBytes != null &&
    gpuVramTotalBytes != null &&
    gpuVramTotalBytes > 0
      ? (gpuVramUsedBytes / gpuVramTotalBytes) * 100
      : null;

  return {
    nodeCount: (sup?.count ?? 0) + (w?.count ?? 0),
    workerCount: w?.count ?? 0,
    cpuUsagePercent,
    cpuCount: totalCores > 0 ? totalCores : null,
    memUsedBytes,
    memTotalBytes,
    memUsagePercent,
    gpuCount: w?.gpuCount ?? 0,
    gpuUtilization: w?.gpuUtilization ?? null,
    gpuVramUsedBytes,
    gpuVramTotalBytes,
    gpuVramUsagePercent,
  };
}
