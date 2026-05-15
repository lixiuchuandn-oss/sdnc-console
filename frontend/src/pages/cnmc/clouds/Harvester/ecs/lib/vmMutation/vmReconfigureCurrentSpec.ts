/**
 * 从 `record` / `activeRecord` 解析当前 CPU/内存及热插拔相关上限（maxSockets、maxMemory 等），
 * 供「调整规格」「热插拔设置」「CPU 高级」等表单的初始值与提交校验。
 */
export function getVmReconfigureCurrentSpec(record: any, activeRecord: any) {
  let cpu = record?.Extra?.CPU;
  let mem = record?.Extra?.Memory;

  const domain = activeRecord?.spec?.template?.spec?.domain;
  const maxSockets = domain?.cpu?.maxSockets;
  const maxMemory = domain?.memory?.maxGuest;

  if (cpu === undefined || cpu === null) {
    const sockets = domain?.cpu?.sockets || 1;
    const cores = domain?.cpu?.cores || 1;
    const threads = domain?.cpu?.threads || 1;
    cpu = sockets * cores * threads;
  }

  const annotations = activeRecord?.metadata?.annotations || {};
  const isHotPlug = annotations['harvesterhci.io/enableCPUAndMemoryHotplug']?.toLowerCase() === 'true';
  if (mem === undefined || mem === null || isHotPlug) {
    mem = activeRecord?.spec?.template?.spec?.domain?.memory?.guest;
    if (!mem && !isHotPlug) {
      mem = activeRecord?.spec?.template?.spec?.domain?.resources?.requests?.memory;
    }
  }
  return { cpu: Number(cpu || 0), memory: mem, maxSockets, maxMemory };
}
