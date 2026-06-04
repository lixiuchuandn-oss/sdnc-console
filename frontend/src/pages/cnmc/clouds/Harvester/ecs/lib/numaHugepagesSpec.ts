export type HugepagesPageSize = '2Mi' | '1Gi';
export type NumaMode = 'off' | 'auto' | 'manual';

export const HUGEpages_PAGE_SIZE_OPTIONS: { label: string; value: HugepagesPageSize }[] = [
  { label: '2 MiB', value: '2Mi' },
  { label: '1 GiB', value: '1Gi' },
];

export const NUMA_MODE_OPTIONS: { label: string; value: NumaMode }[] = [
  { label: '未启用', value: 'off' },
  { label: 'Guest NUMA 自动映射', value: 'auto' },
  { label: '手动 NUMA 拓扑', value: 'manual' },
];

export const HUGEpages_HINT =
  '使用宿主机大页分配虚拟机内存，降低 TLB 开销；须集群节点已预留对应 hugepages 资源';

export const HUGEpages_RECONFIG_HINT = '变更大页配置通常须重启虚拟机后生效';

export function parseHugepagesFromVm(domain: unknown): {
  hugepagesEnabled: boolean;
  hugepagesPageSize: HugepagesPageSize | undefined;
} {
  const d = domain as { memory?: { hugepages?: { pageSize?: string } } } | null | undefined;
  const pageSize = String(d?.memory?.hugepages?.pageSize || '').trim();
  if (!pageSize) {
    return { hugepagesEnabled: false, hugepagesPageSize: undefined };
  }
  if (pageSize === '2Mi' || pageSize === '1Gi') {
    return { hugepagesEnabled: true, hugepagesPageSize: pageSize };
  }
  return { hugepagesEnabled: true, hugepagesPageSize: '2Mi' };
}

export function parseMemoryGiFromQuantity(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 ? raw : undefined;
  }
  const s = String(raw).trim();
  if (!s) return undefined;
  if (s.endsWith('Gi')) {
    const n = parseFloat(s.slice(0, -2));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  if (s.endsWith('Mi')) {
    const n = parseFloat(s.slice(0, -2));
    return Number.isFinite(n) && n > 0 ? n / 1024 : undefined;
  }
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export type HugepagesFormValues = {
  hugepagesEnabled?: boolean;
  hugepagesPageSize?: string;
  hotExpandEnabled?: boolean;
  memory?: string;
  memoryLimitGi?: number;
};

/** 返回错误文案；通过则返回 null */
export function validateHugepagesForm(values: HugepagesFormValues): string | null {
  if (!values.hugepagesEnabled) return null;
  if (values.hotExpandEnabled) {
    return '大页内存暂不支持与 CPU/内存热扩容同时启用';
  }
  const pageSize = String(values.hugepagesPageSize || '2Mi').trim();
  if (pageSize !== '2Mi' && pageSize !== '1Gi') {
    return '大页页大小须为 2Mi 或 1Gi';
  }
  if (pageSize === '1Gi') {
    const memGi =
      parseMemoryGiFromQuantity(values.memory) ??
      (typeof values.memoryLimitGi === 'number' ? values.memoryLimitGi : undefined);
    if (memGi !== undefined && !Number.isInteger(memGi)) {
      return '1Gi 大页要求虚拟机内存为整数 GiB';
    }
  }
  return null;
}

export function formatHugepagesSummary(
  enabled: boolean | undefined,
  pageSize: string | undefined,
): string {
  if (!enabled) return '未启用';
  return pageSize === '1Gi' ? '1 GiB 大页' : '2 MiB 大页';
}

export function parseNumaFromVm(domain: unknown): {
  numaMode: NumaMode;
  numaManualNodeCount: number;
} {
  const d = domain as {
    cpu?: { numa?: { guestMappingPassthrough?: unknown; nodes?: unknown[] } };
  } | null | undefined;
  const numa = d?.cpu?.numa;
  if (numa?.guestMappingPassthrough) {
    return { numaMode: 'auto', numaManualNodeCount: 2 };
  }
  const nodes = numa?.nodes;
  if (Array.isArray(nodes) && nodes.length > 0) {
    return { numaMode: 'manual', numaManualNodeCount: nodes.length };
  }
  return { numaMode: 'off', numaManualNodeCount: 2 };
}

export function isNumaModeEnabled(mode: NumaMode | string | undefined): boolean {
  return mode === 'auto' || mode === 'manual';
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

export function buildManualNumaNodes(
  totalVcpus: number,
  nodeCount: number,
  totalMemoryGi: number,
): { vcpus: string; memory: string }[] {
  const vcpus = Math.floor(totalVcpus);
  const nodes = Math.floor(nodeCount);
  const memGi = totalMemoryGi;
  if (vcpus < 1 || nodes < 1 || memGi <= 0) return [];

  const perCpu = vcpus / nodes;
  const perMemGi = memGi / nodes;
  const out: { vcpus: string; memory: string }[] = [];

  for (let i = 0; i < nodes; i += 1) {
    const start = Math.round(i * perCpu);
    const end = Math.round((i + 1) * perCpu) - 1;
    out.push({
      vcpus: start >= end ? String(start) : `${start}-${end}`,
      memory: Number.isInteger(perMemGi) ? `${perMemGi}Gi` : `${perMemGi.toFixed(3).replace(/\.?0+$/, '')}Gi`,
    });
  }
  return out;
}

export function validateManualNumaParams(input: {
  totalVcpus: number;
  sockets: number;
  nodeCount: number;
  totalMemoryGi: number;
}): string | null {
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
  return null;
}

export type NumaFormValues = {
  numaMode?: NumaMode | string;
  numaManualNodeCount?: number;
  /** @deprecated 兼容旧表单 */
  numaGuestMappingPassthrough?: boolean;
  dedicatedCPUPlacement?: boolean;
  hotExpandEnabled?: boolean;
  enableHotPlug?: boolean;
  cpuSockets?: number;
  cpuCores?: number;
  cpuThreads?: number;
  cpu?: number;
  memory?: string;
  memoryLimitGi?: number;
};

export function normalizeNumaMode(values: NumaFormValues): NumaMode {
  if (values.numaMode === 'auto' || values.numaMode === 'manual' || values.numaMode === 'off') {
    return values.numaMode;
  }
  if (values.numaGuestMappingPassthrough) return 'auto';
  return 'off';
}

/** 返回错误文案；通过则返回 null */
export function validateNumaForm(values: NumaFormValues): string | null {
  const mode = normalizeNumaMode(values);
  if (!isNumaModeEnabled(mode)) return null;
  if (values.hotExpandEnabled || values.enableHotPlug) {
    return 'NUMA 亲和暂不支持与 CPU/内存热扩容同时启用';
  }
  if (!values.dedicatedCPUPlacement) {
    return 'NUMA 亲和须与 CPU 绑定同时启用';
  }

  if (mode === 'manual') {
    const sockets = Number(values.cpuSockets ?? 1);
    const cores = Number(values.cpuCores ?? values.cpu ?? 1);
    const threads = Number(values.cpuThreads ?? 1);
    const totalVcpus =
      values.cpuSockets || values.cpuCores || values.cpuThreads
        ? resolveTotalVcpusFromTopology(sockets, cores, threads)
        : Number(values.cpu ?? 0);
    const memGi =
      parseMemoryGiFromQuantity(values.memory) ??
      (typeof values.memoryLimitGi === 'number' ? values.memoryLimitGi : undefined) ??
      0;
    return validateManualNumaParams({
      totalVcpus,
      sockets,
      nodeCount: Number(values.numaManualNodeCount ?? 2),
      totalMemoryGi: memGi,
    });
  }
  return null;
}

export function formatNumaSummary(
  mode: NumaMode | string | undefined,
  nodeCount?: number,
): string {
  if (mode === 'auto') return 'Guest NUMA 自动映射';
  if (mode === 'manual') return `手动拓扑 · ${nodeCount ?? 2} 节点`;
  return '未启用';
}

export function describeManualNumaPreview(values: NumaFormValues): string {
  const mode = normalizeNumaMode(values);
  if (mode !== 'manual') return '';
  const sockets = Number(values.cpuSockets ?? 1);
  const cores = Number(values.cpuCores ?? values.cpu ?? 1);
  const threads = Number(values.cpuThreads ?? 1);
  const totalVcpus = resolveTotalVcpusFromTopology(sockets, cores, threads);
  const memGi =
    parseMemoryGiFromQuantity(values.memory) ??
    (typeof values.memoryLimitGi === 'number' ? values.memoryLimitGi : 0);
  const nodes = buildManualNumaNodes(
    totalVcpus,
    Number(values.numaManualNodeCount ?? 2),
    memGi,
  );
  return nodes.map((n, i) => `节点${i + 1}: vCPU ${n.vcpus}，内存 ${n.memory}`).join('；');
}

export function validateVmPerformanceAdvancedForm(
  values: HugepagesFormValues & NumaFormValues,
): string | null {
  return validateHugepagesForm(values) || validateNumaForm(values);
}

export type NumaModeSideEffectPatch = Partial<
  NumaFormValues & {
    cpuRequest?: number | string | undefined;
    cpuLimit?: number | string | undefined;
  }
>;

export function applyNumaModeSideEffects(values: NumaFormValues): NumaModeSideEffectPatch {
  const mode = normalizeNumaMode(values);
  if (!isNumaModeEnabled(mode)) {
    return { numaMode: 'off', numaGuestMappingPassthrough: false };
  }
  return {
    numaMode: mode,
    numaGuestMappingPassthrough: mode === 'auto',
    dedicatedCPUPlacement: true,
    cpuRequest: undefined,
    cpuLimit: undefined,
  };
}
