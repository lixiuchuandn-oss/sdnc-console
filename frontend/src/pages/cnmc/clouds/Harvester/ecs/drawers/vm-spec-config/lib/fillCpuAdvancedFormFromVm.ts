/**
 * vm-spec-config 域 · lib
 *
 * 【用途】从聚合 VM（activeRecord）解析领域模型并回填「CPU 高级 / 性能」表单字段。
 * 【使用方】`VmSpecPerformanceDrawer.tsx`（打开抽屉时初始化表单）。
 */

import type { FormInstance } from 'antd/es/form';
import { storageQuantityToGiB } from '../../../lib/vmMutation/vmReconfigureQuantity';

/** 从 VM `activeRecord` 回填 CpuAdvanced / 性能设置表单。 */
export function fillCpuAdvancedFormFromVm(form: FormInstance<any>, activeRecord: any): void {
  const domain = activeRecord?.spec?.template?.spec?.domain;
  const cpuSpec = domain?.cpu;
  const resources = domain?.resources;

  const isHotPlug = cpuSpec?.maxSockets && cpuSpec?.maxSockets > (cpuSpec?.sockets || 1);

  const parseCpu = (v: any) => {
    if (!v) return null;
    const s = String(v);
    if (s.endsWith('m')) return parseInt(s, 10) / 1000;
    return parseFloat(s);
  };

  const limit = parseCpu(resources?.limits?.cpu);
  const reqMem = resources?.requests?.memory;
  const limMem = resources?.limits?.memory;
  const reqGi = reqMem ? storageQuantityToGiB(reqMem) : undefined;
  const limGi = limMem ? storageQuantityToGiB(limMem) : undefined;

  const dedicated = !!cpuSpec?.dedicatedCpuPlacement;
  /** KubeVirt：isolateEmulatorThread 仅允许与 dedicatedCpuPlacement 同时存在 */
  const isolate = dedicated && !!cpuSpec?.isolateEmulatorThread;
  form.setFieldsValue({
    cpuSockets: cpuSpec?.sockets || 1,
    cpuCores: cpuSpec?.cores || 1,
    cpuThreads: cpuSpec?.threads || 1,
    cpuModel: cpuSpec?.mode || 'host-passthrough',
    cpuModelCustom: cpuSpec?.mode === 'custom' ? cpuSpec?.model : '',
    dedicatedCPUPlacement: dedicated,
    isolateEmulatorThread: isolate,
    cpuRequest: parseCpu(resources?.requests?.cpu),
    cpuLimit: limit,
    memoryRequestGi: reqGi,
    memoryLimitGi: limGi,
    enableHotPlug: !!isHotPlug,
  });
}
