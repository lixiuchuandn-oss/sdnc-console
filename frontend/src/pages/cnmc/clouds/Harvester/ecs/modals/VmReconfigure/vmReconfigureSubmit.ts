/**
 * 变配表单统一提交入口：NAD 预检 + 按 `selectedKey` 分发至 `submit/` 各分支。
 */
import { message } from 'antd';
import { getMissingNadsFromNetworks } from './lib/vmReconfigureNetwork';
import { buildVmReconfigureSubmitCtx } from './submit/vmReconfigureSubmitContext';
import type { VmReconfigureSubmitDeps } from './submit/vmReconfigureSubmitTypes';
import { VmReconfigureSubmitSkipFinalize } from './submit/vmReconfigureSubmitTypes';
import {
  submitVmReconfigureAddDisk,
  submitVmReconfigureChangeOs,
  submitVmReconfigureChangeSpec,
  submitVmReconfigureCpuAdvanced,
  submitVmReconfigureExpandDisk,
  submitVmReconfigureHotplugSettings,
} from './submit/vmReconfigureSubmitStorage';
import {
  submitVmReconfigureChangeGpu,
  submitVmReconfigureChangeNodeAffinity,
  submitVmReconfigureChangeNodeScheduling,
  submitVmReconfigureChangeUsb,
  submitVmReconfigureVmPolicy,
} from './submit/vmReconfigureSubmitDevices';
import {
  submitVmReconfigureChangePrimaryNic,
  submitVmReconfigureChangeSecondaryNic,
} from './submit/vmReconfigureSubmitNetwork';

export type { VmReconfigureSubmitDeps } from './submit/vmReconfigureSubmitTypes';

export async function runVmReconfigureSubmit(d: VmReconfigureSubmitDeps): Promise<void> {
  const {
    form,
    record,
    activeRecord,
    selectedKey,
    ensureNadsLoaded,
    onOk,
    onClose,
  } = d;

  const ctx = buildVmReconfigureSubmitCtx(d);

  try {
    const values = await form.validateFields();
    const vmName = record?.metadata?.name;
    const namespace = record?.metadata?.namespace;

    if (selectedKey !== 'change_primary_nic' && selectedKey !== 'change_secondary_nic') {
      const currentNetworks =
        activeRecord?.spec?.template?.spec?.networks || record?.spec?.template?.spec?.networks || [];
      const nadList = await ensureNadsLoaded();
      const missing = getMissingNadsFromNetworks(currentNetworks, String(namespace || 'default'), nadList);
      if (missing.length > 0) {
        message.error(
          `更新失败：虚拟机网卡引用的 NAD 不存在：${missing.join(', ')}。请先在【变更网卡】中修复后再进行该操作。`,
        );
        return;
      }
    }

    switch (selectedKey) {
      case 'expand_disk':
        await submitVmReconfigureExpandDisk(ctx, values, vmName, namespace);
        break;
      case 'change_spec':
        await submitVmReconfigureChangeSpec(ctx, values, vmName, namespace);
        break;
      case 'hotplug_settings':
        await submitVmReconfigureHotplugSettings(ctx, values, vmName, namespace);
        break;
      case 'cpu_advanced':
        await submitVmReconfigureCpuAdvanced(ctx, values, vmName, namespace);
        break;
      case 'change_os':
        await submitVmReconfigureChangeOs(ctx, values, vmName, namespace);
        break;
      case 'add_disk':
        await submitVmReconfigureAddDisk(ctx, values, vmName, namespace);
        break;
      case 'change_gpu':
        await submitVmReconfigureChangeGpu(ctx, values, vmName, namespace);
        break;
      case 'change_node_scheduling':
        await submitVmReconfigureChangeNodeScheduling(ctx, values, vmName, namespace);
        break;
      case 'change_node_affinity':
        await submitVmReconfigureChangeNodeAffinity(ctx, values, vmName, namespace);
        break;
      case 'change_usb':
        await submitVmReconfigureChangeUsb(ctx, values, vmName, namespace);
        break;
      case 'vm_policy':
        await submitVmReconfigureVmPolicy(ctx, values, vmName, namespace);
        break;
      case 'change_primary_nic':
        await submitVmReconfigureChangePrimaryNic(ctx, values, vmName, namespace);
        break;
      case 'change_secondary_nic':
        await submitVmReconfigureChangeSecondaryNic(ctx, values, vmName, namespace);
        break;
      default:
        break;
    }
    onOk?.();
    onClose?.();
  } catch (e: any) {
    if (e instanceof VmReconfigureSubmitSkipFinalize || e?.name === 'VmReconfigureSubmitSkipFinalize') {
      return;
    }
    console.error(e);
    if (!e?.errorFields) {
      let errorMsg = e?.message || '操作失败';

      if (typeof errorMsg === 'string') {
        if (errorMsg.includes('Guest memory is greater than the configured maxGuest memory')) {
          errorMsg = '调整后的内存超过了配置的最大限制（热扩容上限），请求被拒绝。';
        }
        const nadNotFound = errorMsg.match(
          /network-attachment-definitions\.k8s\.cni\.cncf\.io\s+"([^"]+)"\s+not\s+found/i,
        );
        if (nadNotFound?.[1]) {
          errorMsg = `更新失败：引用的网络附件（NAD）不存在：${nadNotFound[1]}。请在虚拟机网卡配置中更换为存在的网络，或在对应命名空间创建该 NAD。`;
        }
      }

      message.error(errorMsg);
    }
  }
}
