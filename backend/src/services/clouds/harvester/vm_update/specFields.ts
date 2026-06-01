/** 可走最小 Patch 的 VM 变配字段白名单 */
export const VM_SPEC_SIMPLE_FIELDS = [
  'cpu',
  'memory',
  'enableHotPlug',
  'cpuSockets',
  'cpuCores',
  'cpuThreads',
  'dedicatedCPUPlacement',
  'isolateEmulatorThread',
  'cpuRequest',
  'cpuLimit',
  'memoryRequestGi',
  'memoryLimitGi',
  'memoryLimit',
  'runStrategy',
  'evictionStrategy',
  'maxSockets',
  'maxMemory',
] as const;

export const hasOnlySimpleVmSpecFields = (spec: Record<string, unknown>): boolean =>
  Object.keys(spec).every((k) => (VM_SPEC_SIMPLE_FIELDS as readonly string[]).includes(k));
