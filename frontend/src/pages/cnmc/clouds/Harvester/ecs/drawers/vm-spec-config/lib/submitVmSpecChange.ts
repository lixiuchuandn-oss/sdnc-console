/**
 * vm-spec-config 域 · lib
 *
 * 【用途】虚拟机「调整规格」（CPU/内存）提交流程：`updateHarvesterVmSpec`、热扩/冷扩与拓扑修复、成功提示与重启引导。
 * 【使用方】`VmSpecConfigDrawer.tsx`（`submitVmSpecChange`）。
 *
 * 虚拟机「调整规格」提交（CPU/内存），与详情抽屉 VmSpecConfigDrawer 配套；原在 vmReconfigureSubmitStorage。
 */
import { message } from 'antd';
import {
  updateHarvesterVmSpec,
  fetchHarvesterVmDetail,
} from '../../../../../../../../services/harvesterApi';
import { getVmReconfigureCurrentSpec } from '../../../lib/vmMutation/vmReconfigureCurrentSpec';
import { parseQuantity } from '../../../lib/vmMutation/vmReconfigureQuantity';
import { isVmStopped } from '../../../lib/vmInstanceStatus';
import { VmReconfigureSubmitSkipFinalize } from '../../../lib/vmMutation/vmReconfigureSubmitTypes';

/** 仅规格变更提交所需依赖（不绑 NAD / 整包变配上下文）。 */
export type VmSpecChangeSubmitCtx = {
  cloudId: string;
  activeRecord: any;
  setLatestVm: (vm: any) => void;
  fetchAggregatedVm: (namespace: string, vmName: string) => Promise<any>;
  openRestartConfirm: (
    namespace: string,
    vmName: string,
    force?: boolean,
  ) => void;
  getCurrentSpec: () => ReturnType<typeof getVmReconfigureCurrentSpec>;
  getMemoryInGi: (q: any) => number;
};

export async function submitVmSpecChange(
  ctx: VmSpecChangeSubmitCtx,
  values: any,
  vmName: string,
  namespace: string,
): Promise<void> {
  const {
    cloudId,
    activeRecord,
    setLatestVm,
    fetchAggregatedVm,
    openRestartConfirm,
    getCurrentSpec,
    getMemoryInGi,
  } = ctx;
  const conditions = activeRecord?.status?.conditions || [];
  const isHotPlugInProgress = conditions.some(
    (c: any) =>
      (c.type === 'HotVCPUChange' || c.type === 'HotMemoryChange') &&
      c.status === 'True',
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
  const isHotPlugConfiguredByAnnotation =
    hotPlugAnnotation?.toLowerCase() === 'true';
  const hasMaxSockets =
    currentDomain?.cpu?.maxSockets && currentDomain.cpu.maxSockets > currentSockets;
  const isCurrentlyHotPlug = isHotPlugConfiguredByAnnotation && hasMaxSockets;

  const { memory: currentMemRaw } = getCurrentSpec();
  const currentMemGi = getMemoryInGi(currentMemRaw);
  const cpuChanged = values.cpu !== undefined && values.cpu !== currentTotalCpu;

  const formMemory =
    values.memory !== undefined ? Number(values.memory) : undefined;
  const memoryChanged =
    formMemory !== undefined && Math.abs(formMemory - currentMemGi) > 0.01;

  if (isCurrentlyHotPlug) {
    if (cpuChanged && values.cpu < currentTotalCpu) {
      message.warning('热扩容模式下不允许减少CPU，请先关闭热扩容后再修改');
      throw new VmReconfigureSubmitSkipFinalize();
    }
    if (
      memoryChanged &&
      formMemory !== undefined &&
      formMemory < currentMemGi - 0.01
    ) {
      message.warning('热扩容模式下不允许减少内存，请先关闭热扩容后再修改');
      throw new VmReconfigureSubmitSkipFinalize();
    }
    const maxSockets = currentDomain?.cpu?.maxSockets;
    const maxMemory = currentDomain?.memory?.maxGuest;
    if (cpuChanged && maxSockets && values.cpu > maxSockets) {
      message.warning(`CPU数量不能超过热扩容上限 ${maxSockets} 核`);
      throw new VmReconfigureSubmitSkipFinalize();
    }
    if (memoryChanged && maxMemory) {
      const maxMemGi = parseQuantity(maxMemory) / 1024 ** 3;
      if (Number(values.memory) > maxMemGi) {
        message.warning(`内存数量不能超过热扩容上限 ${maxMemGi} GiB`);
        throw new VmReconfigureSubmitSkipFinalize();
      }
    }
  }

  const needTopologyFix =
    isCurrentlyHotPlug && (currentCores !== 1 || currentThreads !== 1);

  if (needTopologyFix) {
    const topologyPayload: any = {
      cpu: currentTotalCpu,
      cpuSockets: currentTotalCpu,
      cpuCores: 1,
      cpuThreads: 1,
      enableHotPlug: false,
    };

    await updateHarvesterVmSpec(cloudId, namespace, vmName, topologyPayload);
    message.info('已先设置CPU拓扑为cores=1, threads=1，正在开启热扩容...');

    try {
      const refreshedVm = await fetchHarvesterVmDetail(
        cloudId,
        namespace,
        vmName,
      );
      setLatestVm(refreshedVm?.data || refreshedVm);
      await new Promise((resolve) => setTimeout(resolve, 300));
    } catch (e) {
      console.warn('刷新VM状态失败，继续执行', e);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  let payload: any = {};

  if (isCurrentlyHotPlug) {
    if (values.cpu !== undefined) {
      payload.cpu = values.cpu;
    }
    if (values.memory !== undefined) {
      payload.memory = `${values.memory}Gi`;
    }
  } else {
    payload = {
      cpu: values.cpu,
      cpuSockets: values.cpuSockets,
      cpuCores: values.cpuCores,
      cpuThreads: values.cpuThreads,
      memory: `${values.memory}Gi`,
    };
  }

  if (needTopologyFix) {
    const topologyPayload: any = {
      cpu: currentTotalCpu,
      cpuSockets: currentTotalCpu,
      cpuCores: 1,
      cpuThreads: 1,
    };
    await updateHarvesterVmSpec(cloudId, namespace, vmName, topologyPayload);
    message.info('已修复CPU拓扑为cores=1, threads=1');

    try {
      const refreshedVm = await fetchHarvesterVmDetail(
        cloudId,
        namespace,
        vmName,
      );
      setLatestVm(refreshedVm?.data || refreshedVm);
      await new Promise((resolve) => setTimeout(resolve, 300));
    } catch (e) {
      console.warn('刷新VM状态失败，继续执行', e);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  await updateHarvesterVmSpec(cloudId, namespace, vmName, payload);

  let finalDomain = currentDomain;
  if (needTopologyFix) {
    try {
      const refreshedVm = await fetchHarvesterVmDetail(
        cloudId,
        namespace,
        vmName,
      );
      const refreshedData = refreshedVm?.data || refreshedVm;
      finalDomain = refreshedData?.spec?.template?.spec?.domain;
      setLatestVm(refreshedData);
    } catch (e) {
      console.warn('刷新VM状态失败，使用原始状态', e);
    }
  }

  const isHotPlugActive = !!isCurrentlyHotPlug;

  const finalSockets = finalDomain?.cpu?.sockets || currentSockets;
  const finalCores = finalDomain?.cpu?.cores || currentCores;
  const finalThreads = finalDomain?.cpu?.threads || currentThreads;
  const finalTotalCpu = finalSockets * finalCores * finalThreads;

  const newCpu =
    values.cpu !== undefined ? Number(values.cpu) : finalTotalCpu;
  const newMemGi =
    values.memory !== undefined ? Number(values.memory) : currentMemGi;

  const arch = activeRecord?.spec?.template?.spec?.architecture;
  const isArm = arch === 'arm64' || arch === 'aarch64';

  const finalCpuChanged = cpuChanged;
  const finalMemChanged = memoryChanged;

  const isCpuHotAdd = !finalCpuChanged || newCpu >= finalTotalCpu - 0.01;
  const isMemHotAdd = !finalMemChanged || newMemGi >= currentMemGi - 0.01;

  const isCpuHotPlugAllowed = !isArm || !finalCpuChanged;

  const vmi = activeRecord?.vmi || activeRecord?.vmiRaw;
  const vmiConditions = vmi?.status?.conditions || [];
  const isMigratable = vmiConditions.some(
    (c: any) =>
      (c.type === 'LiveMigratable' ||
        c.type === 'VirtualMachineInstanceIsMigratable') &&
      c.status === 'True',
  );

  const canUseCpuHotPlug =
    isHotPlugActive && isCpuHotAdd && isCpuHotPlugAllowed;
  const canUseMemHotPlug =
    isHotPlugActive && isMemHotAdd && (isMigratable || !finalMemChanged);

  const canUseHotPlug =
    (finalCpuChanged && !finalMemChanged && canUseCpuHotPlug) ||
    (!finalCpuChanged && finalMemChanged && canUseMemHotPlug) ||
    (finalCpuChanged && finalMemChanged && canUseCpuHotPlug && canUseMemHotPlug) ||
    (!finalCpuChanged && !finalMemChanged);

  if (canUseHotPlug) {
    message.success('规格变更已提交（热扩容生效），无需重启实例');
  } else {
    if (finalMemChanged && !isMigratable && isHotPlugActive) {
      message.warning(
        '内存热扩容需要 VM 可迁移，当前 VM 不可迁移，将需要重启生效',
      );
    }
    try {
      const updatedVm = await fetchAggregatedVm(namespace, vmName);
      if (isVmStopped(updatedVm)) {
        message.success('设置已保存，下次启动时将自动应用新配置');
      } else {
        openRestartConfirm(namespace, vmName, false);
      }
    } catch {
      openRestartConfirm(namespace, vmName, false);
    }
  }
}
