import type { VmReconfigureMenuInitCtx } from '../vmReconfigureMenuInitContext';

export function initHotplugSettingsMenu(ctx: VmReconfigureMenuInitCtx): void {
  const { form, record, getCurrentSpec, getMemoryInGi } = ctx;
  const { cpu, memory, maxSockets, maxMemory } = getCurrentSpec();
  const maxMemGi = maxMemory ? getMemoryInGi(maxMemory) : undefined;
  const currentMemGi = getMemoryInGi(memory);
  const cpuN = Number(cpu ?? 0);

  const annotations = record?.metadata?.annotations || {};
  const isHotPlug = annotations['harvesterhci.io/enableCPUAndMemoryHotplug']?.toLowerCase() === 'true';

  form.setFieldsValue({
    enableHotPlug: !!isHotPlug,
    maxSockets: maxSockets || cpuN * 4,
    maxMemory: maxMemGi || currentMemGi * 4,
  });
}
