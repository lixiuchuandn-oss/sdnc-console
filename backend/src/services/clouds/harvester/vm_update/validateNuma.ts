import { supportCPUAndMemoryHotplug } from './hotplug';
import {
  buildManualNumaNodes,
  resolveTotalVcpusFromTopology,
  validateManualNumaParams,
} from './numaManual';

function parseMemoryGi(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
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
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function resolveTargetMemoryGi(spec: Record<string, unknown>, current: any): number | undefined {
  if (typeof spec.memoryRequestGi === 'number' && spec.memoryRequestGi > 0) {
    return spec.memoryRequestGi;
  }
  if (typeof spec.memoryLimitGi === 'number' && spec.memoryLimitGi > 0) {
    return spec.memoryLimitGi;
  }
  if (spec.memory !== undefined) {
    return parseMemoryGi(spec.memory);
  }
  const guest = current?.spec?.template?.spec?.domain?.memory?.guest;
  const req = current?.spec?.template?.spec?.domain?.resources?.requests?.memory;
  return parseMemoryGi(guest) ?? parseMemoryGi(req);
}

function resolveNumaMode(spec: Record<string, unknown>): 'off' | 'auto' | 'manual' | undefined {
  const mode = spec.numaMode;
  if (mode === 'off' || mode === 'auto' || mode === 'manual') return mode;
  if (spec.numaGuestMappingPassthrough === true) return 'auto';
  if (spec.numaGuestMappingPassthrough === false && spec.numaManualNodeCount === undefined) {
    return 'off';
  }
  return undefined;
}

function assertNotHotPlug(spec: Record<string, unknown>, current: any): void {
  const isHotPlug =
    spec.enableHotPlug === true ||
    (spec.enableHotPlug !== false && supportCPUAndMemoryHotplug(current));
  if (isHotPlug) {
    throw new Error('NUMA 亲和暂不支持与 CPU/内存热扩容同时启用');
  }
}

/** 变配请求中 NUMA 字段校验 */
export function validateNumaSpec(spec: Record<string, unknown>, current: any): void {
  const mode = resolveNumaMode(spec);
  const touchesLegacy = spec.numaGuestMappingPassthrough !== undefined;
  const touchesManual = spec.numaManualNodeCount !== undefined;
  if (!mode && !touchesLegacy && !touchesManual) return;

  const effectiveMode =
    mode ??
    (spec.numaManualNodeCount ? 'manual' : spec.numaGuestMappingPassthrough ? 'auto' : 'off');

  if (effectiveMode === 'off') return;

  assertNotHotPlug(spec, current);

  const willDedicated =
    spec.dedicatedCPUPlacement === true ||
    effectiveMode === 'auto' ||
    effectiveMode === 'manual' ||
    current?.spec?.template?.spec?.domain?.cpu?.dedicatedCpuPlacement === true;

  if (!willDedicated) {
    throw new Error('NUMA 亲和须与 CPU 绑定同时启用');
  }

  if (effectiveMode === 'manual') {
    const cpu = current?.spec?.template?.spec?.domain?.cpu || {};
    const sockets = Number(spec.cpuSockets ?? cpu.sockets ?? 1);
    const cores = Number(spec.cpuCores ?? cpu.cores ?? 1);
    const threads = Number(spec.cpuThreads ?? cpu.threads ?? 1);
    const totalVcpus = resolveTotalVcpusFromTopology(sockets, cores, threads);
    const nodeCount = Number(
      spec.numaManualNodeCount ??
        current?.spec?.template?.spec?.domain?.cpu?.numa?.nodes?.length ??
        0,
    );
    const memGi = resolveTargetMemoryGi(spec, current);
    if (!memGi) {
      throw new Error('手动 NUMA 拓扑须已知虚拟机内存规格');
    }
    const err = validateManualNumaParams({
      totalVcpus,
      sockets,
      nodeCount,
      totalMemoryGi: memGi,
    });
    if (err) throw new Error(err);
  }
}

export function resolveManualNumaNodesForPatch(
  spec: Record<string, unknown>,
  current: any,
): { vcpus: string; memory: string }[] {
  const cpu = current?.spec?.template?.spec?.domain?.cpu || {};
  const sockets = Number(spec.cpuSockets ?? cpu.sockets ?? 1);
  const cores = Number(spec.cpuCores ?? cpu.cores ?? 1);
  const threads = Number(spec.cpuThreads ?? cpu.threads ?? 1);
  const totalVcpus = resolveTotalVcpusFromTopology(sockets, cores, threads);
  const nodeCount = Number(spec.numaManualNodeCount ?? cpu.numa?.nodes?.length ?? 2);
  const memGi = resolveTargetMemoryGi(spec, current) ?? 1;
  return buildManualNumaNodes(totalVcpus, nodeCount, memGi);
}
