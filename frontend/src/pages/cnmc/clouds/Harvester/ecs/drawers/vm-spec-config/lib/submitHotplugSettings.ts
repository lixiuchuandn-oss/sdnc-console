/**
 * vm-spec-config 域 · lib
 *
 * 【用途】将热扩容开关与上限写入集群（`updateHarvesterVmSpec`），含拓扑修复与刷新 VM 快照。
 * 【使用方】`runHotplugSettingsSubmit.ts`（由 `VmHotplugSettingsDrawer` 间接调用）。
 *
 * 热扩容设置提交（Harvester VM API）。
 */
import { message } from 'antd';
import {
  updateHarvesterVmSpec,
  fetchHarvesterVmDetail,
} from '../../../../../../../../services/harvesterApi';
import type { VmReconfigureSubmitCtx } from '../../../lib/vmMutation/vmReconfigureSubmitContext';
import { VmReconfigureSubmitSkipFinalize } from '../../../lib/vmMutation/vmReconfigureSubmitTypes';

export async function submitVmReconfigureHotplugSettings(
  ctx: VmReconfigureSubmitCtx,
  values: any,
  vmName: string,
  namespace: string,
): Promise<void> {
  const { cloudId, activeRecord, setLatestVm, openRestartConfirm, fetchAggregatedVm } = ctx;
  const conditions = activeRecord?.status?.conditions || [];
  const isHotPlugInProgress = conditions.some(
    (c: any) => (c.type === 'HotVCPUChange' || c.type === 'HotMemoryChange') && c.status === 'True',
  );

  if (isHotPlugInProgress) {
    message.warning('热扩容操作正在进行中，请等待操作完成后再进行变更');
    throw new VmReconfigureSubmitSkipFinalize();
  }

  const currentDomain = activeRecord?.spec?.template?.spec?.domain;
  const currentCores = currentDomain?.cpu?.cores || 1;
  const currentThreads = currentDomain?.cpu?.threads || 1;
  const currentSockets = currentDomain?.cpu?.sockets || 1;
  const currentTotalCpu = currentSockets * currentCores * currentThreads;

  const hotPlugAnnotation =
    activeRecord?.metadata?.annotations?.['harvesterhci.io/enableCPUAndMemoryHotplug'];
  const isHotPlugConfiguredByAnnotation = hotPlugAnnotation?.toLowerCase() === 'true';
  const isFirstTimeEnable = values.enableHotPlug && !isHotPlugConfiguredByAnnotation;
  const needTopologyFix =
    isFirstTimeEnable && (currentCores !== 1 || currentThreads !== 1);

  if (needTopologyFix) {
    const topologyPayload: any = {
      cpu: currentTotalCpu,
      cpuSockets: currentTotalCpu,
      cpuCores: 1,
      cpuThreads: 1,
    };

    await updateHarvesterVmSpec(cloudId, namespace, vmName, topologyPayload);

    try {
      const refreshedVm = await fetchHarvesterVmDetail(cloudId, namespace, vmName);
      setLatestVm(refreshedVm?.data || refreshedVm);
      await new Promise((resolve) => setTimeout(resolve, 300));
    } catch (e) {
      console.warn('刷新VM状态失败，继续执行', e);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  let payload: any;

  if (values.enableHotPlug) {
    payload = {
      enableHotPlug: true,
      maxSockets: values.maxSockets,
      maxMemory: `${values.maxMemory}Gi`,
    };

    if (needTopologyFix || (currentCores === 1 && currentThreads === 1)) {
      const finalSockets = needTopologyFix ? currentTotalCpu : currentSockets;
      payload.cpuSockets = finalSockets;
      payload.cpuCores = 1;
      payload.cpuThreads = 1;
    }
  } else {
    payload = {
      enableHotPlug: false,
    };
  }

  await updateHarvesterVmSpec(cloudId, namespace, vmName, payload);
  message.success('热扩容设置已提交');
  try {
    await fetchAggregatedVm(namespace, vmName);
  } catch {
    /* 忽略：重启提示不依赖聚合刷新成功 */
  }
  openRestartConfirm(namespace, vmName, false);
}
