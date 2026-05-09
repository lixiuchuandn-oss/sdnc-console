import { storageQuantityToGiB } from '../../lib/vmReconfigureQuantity';
import type { VmReconfigureMenuInitCtx } from '../vmReconfigureMenuInitContext';

export function initCpuAdvancedMenu(ctx: VmReconfigureMenuInitCtx): void {
  const { form, activeRecord } = ctx;
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

  form.setFieldsValue({
    cpuSockets: cpuSpec?.sockets || 1,
    cpuCores: cpuSpec?.cores || 1,
    cpuThreads: cpuSpec?.threads || 1,
    cpuModel: cpuSpec?.mode || 'host-passthrough',
    cpuModelCustom: cpuSpec?.mode === 'custom' ? cpuSpec?.model : '',
    dedicatedCPUPlacement: !!cpuSpec?.dedicatedCpuPlacement,
    isolateEmulatorThread: !!cpuSpec?.isolateEmulatorThread,
    cpuRequest: parseCpu(resources?.requests?.cpu),
    cpuLimit: limit,
    memoryRequestGi: reqGi,
    memoryLimitGi: limGi,
    enableHotPlug: !!isHotPlug,
  });
}
