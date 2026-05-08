import type { VmReconfigureMenuInitCtx } from '../vmReconfigureMenuInitContext';

export function initChangeSpecMenu(ctx: VmReconfigureMenuInitCtx): void {
  const { form, record, getCurrentSpec, getMemoryInGi } = ctx;
  const { cpu, memory } = getCurrentSpec();
  const memGi = getMemoryInGi(memory);

  const cpuSpec = record?.spec?.template?.spec?.domain?.cpu;
  const sockets = cpuSpec?.sockets || 1;
  const cores = cpuSpec?.cores || 1;
  const threads = cpuSpec?.threads || 1;

  const isHotPlug = cpuSpec?.maxSockets && cpuSpec?.maxSockets > sockets;

  let cpuValue: number;
  if (isHotPlug) {
    cpuValue = sockets;
  } else {
    const calculatedCpu = sockets * cores * threads;
    cpuValue = cpu || calculatedCpu;
  }

  cpuValue = cpuValue > 0 ? cpuValue : 1;

  form.setFieldsValue({
    cpu: cpuValue,
    memory: memGi,
    cpuSockets: sockets,
    cpuCores: cores,
    cpuThreads: threads,
  });
}
