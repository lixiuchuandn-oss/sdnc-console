/**
 * vm-spec-config 域 · lib
 *
 * 【用途】热扩容设置抽屉打开时，根据当前 VM 规格与注解回填「开启热扩、上限」等表单初值。
 * 【使用方】`VmHotplugSettingsDrawer.tsx`。
 */

import type { VmReconfigureMenuInitCtx } from '../../../lib/vmMutation/vmReconfigureMenuInitContext';

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
