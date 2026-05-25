/**
 * vm-spec-config 域 · lib
 *
 * 【用途】CPU 型号/独占/requests、内存 request/limit 等性能项提交；成功后会引导重启确认。
 * 【使用方】`VmSpecPerformanceDrawer.tsx`。若相对 baseline **仅 QoS** 变动，或 **无任何有效变更**，则不弹重启确认。
 *
 * CPU 高级 / 性能设置提交（`updateHarvesterVmSpec`）。
 */
import { message } from 'antd';
import { updateHarvesterVmSpec } from 'services/harvester/vm';
import type { VmReconfigureSubmitCtx } from '../../../lib/vmMutation/vmReconfigureSubmitContext';
import { shouldSkipCpuAdvancedRestartConfirm } from './cpuAdvancedQosOnlyChange';

export async function submitVmReconfigureCpuAdvanced(
  ctx: VmReconfigureSubmitCtx,
  values: any,
  vmName: string,
  namespace: string,
  baselineValues?: Record<string, unknown> | null,
): Promise<void> {
  const { cloudId, openRestartConfirm } = ctx;
  if (values.isolateEmulatorThread && !values.dedicatedCPUPlacement) {
    message.warning(
      "CPU 隔离须与「CPU 绑定」同时启用（独占物理 CPU）。请先启用 CPU 绑定后再提交。",
    );
    return;
  }
  const advancedPayload: any = {
    cpuSockets: values.cpuSockets,
    cpuCores: values.cpuCores,
    cpuThreads: values.cpuThreads,
    cpuModel: values.cpuModel,
    cpuModelCustom: values.cpuModelCustom,
    dedicatedCPUPlacement: values.dedicatedCPUPlacement,
    isolateEmulatorThread: values.isolateEmulatorThread,
  };

  if (values.dedicatedCPUPlacement) {
    advancedPayload.cpuRequest = null;
    advancedPayload.cpuLimit = null;
  } else {
    if (values.cpuRequest !== undefined && values.cpuRequest !== null && values.cpuRequest !== '') {
      advancedPayload.cpuRequest = Number(values.cpuRequest);
    }

    if (values.cpuLimit !== undefined && values.cpuLimit !== null && values.cpuLimit !== '') {
      advancedPayload.cpuLimit = Number(values.cpuLimit);
    }
  }

  if (typeof values.memoryRequestGi === 'number') {
    advancedPayload.memoryRequestGi = values.memoryRequestGi > 0 ? values.memoryRequestGi : null;
  }
  if (typeof values.memoryLimitGi === 'number') {
    advancedPayload.memoryLimitGi = values.memoryLimitGi > 0 ? values.memoryLimitGi : null;
  }

  await updateHarvesterVmSpec(cloudId, namespace, vmName, advancedPayload);
  message.success('性能设置已更新');
  if (!shouldSkipCpuAdvancedRestartConfirm(baselineValues, values as Record<string, unknown>)) {
    openRestartConfirm(namespace, vmName, false);
  }
}
