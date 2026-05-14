/**
 * vm-spec-config 域 · lib
 *
 * 【用途】「调整规格」抽屉打开时回填 CPU/内存/拓扑等表单，与变配 change_spec 初始化语义对齐。
 * 【使用方】`VmSpecConfigDrawer.tsx`。
 */

import type { FormInstance } from "antd/es/form";
import { getVmReconfigureCurrentSpec } from "../../../lib/vmMutation/vmReconfigureCurrentSpec";

export type VmSpecConfigInitCtx = {
  form: FormInstance;
  record: any;
  getCurrentSpec: () => ReturnType<typeof getVmReconfigureCurrentSpec>;
  getMemoryInGi: (q: any) => number;
};

/** 调整规格抽屉打开时回填 CPU/内存/拓扑（与原资源变配 change_spec 初始化一致）。 */
export function initVmSpecConfigForm(ctx: VmSpecConfigInitCtx): void {
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
