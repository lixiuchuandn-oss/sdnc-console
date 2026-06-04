export type NumaMode = 'off' | 'auto' | 'manual';

export type ManualNumaNodeSpec = {
  vcpus: string;
  memory: string;
};

/** 均分 vCPU / 内存，生成 KubeVirt domain.cpu.numa.nodes */
export function buildManualNumaNodes(
  totalVcpus: number,
  nodeCount: number,
  totalMemoryGi: number,
): ManualNumaNodeSpec[] {
  const vcpus = Math.floor(totalVcpus);
  const nodes = Math.floor(nodeCount);
  const memGi = totalMemoryGi;
  if (vcpus < 1 || nodes < 1 || memGi <= 0) return [];

  const perCpu = vcpus / nodes;
  const perMemGi = memGi / nodes;
  const out: ManualNumaNodeSpec[] = [];

  for (let i = 0; i < nodes; i += 1) {
    const start = Math.round(i * perCpu);
    const end = Math.round((i + 1) * perCpu) - 1;
    out.push({
      vcpus: start >= end ? String(start) : `${start}-${end}`,
      memory: Number.isInteger(perMemGi)
        ? `${perMemGi}Gi`
        : `${perMemGi.toFixed(3).replace(/\.?0+$/, '')}Gi`,
    });
  }
  return out;
}

export function resolveTotalVcpusFromTopology(
  sockets: number,
  cores: number,
  threads: number,
): number {
  const s = Math.max(1, Math.floor(sockets || 1));
  const c = Math.max(1, Math.floor(cores || 1));
  const t = Math.max(1, Math.floor(threads || 1));
  return s * c * t;
}

export type ManualNumaValidateInput = {
  totalVcpus: number;
  sockets: number;
  nodeCount: number;
  totalMemoryGi: number;
};

/** 返回错误文案；通过则返回 null */
export function validateManualNumaParams(input: ManualNumaValidateInput): string | null {
  const { totalVcpus, sockets, nodeCount, totalMemoryGi } = input;
  const nodes = Math.floor(nodeCount);
  if (nodes < 2 || nodes > 8) {
    return '手动 NUMA 拓扑须配置 2–8 个 NUMA 节点';
  }
  if (totalVcpus < nodes) {
    return 'vCPU 总数须不少于 NUMA 节点数';
  }
  if (totalVcpus % nodes !== 0) {
    return 'vCPU 总数须能被 NUMA 节点数整除';
  }
  if (sockets > 0 && sockets % nodes !== 0) {
    return 'CPU 插槽数须为 NUMA 节点数的整数倍';
  }
  if (totalMemoryGi <= 0) {
    return '须先配置有效的虚拟机内存';
  }
  if (
    Math.abs(totalMemoryGi / nodes - totalMemoryGi / nodes) > 0 ||
    totalMemoryGi / nodes < 0.001
  ) {
    // equal split check: prefer integer Gi per node when using Gi quantities
    const per = totalMemoryGi / nodes;
    if (!Number.isFinite(per) || per <= 0) {
      return '内存无法均分到各 NUMA 节点';
    }
  }
  return null;
}

export function isNumaModeEnabled(mode: NumaMode | string | undefined): boolean {
  return mode === 'auto' || mode === 'manual';
}
