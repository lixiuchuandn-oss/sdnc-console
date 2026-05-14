/**
 * vm-spec-config 域 · lib
 *
 * 【用途】热扩容设置提交编排：表单校验、NAD 存在性预检、调用 `submitVmReconfigureHotplugSettings`、统一错误提示。
 * 【使用方】`VmHotplugSettingsDrawer.tsx`（依赖 `ecs/lib/vmMutation` 构建提交上下文）。
 *
 * CPU/内存热扩容设置：NAD 预检 + 提交（归属规格域，与 `VmHotplugSettingsDrawer` 配套）。
 */
import { message } from 'antd';
import { getMissingNadsFromNetworks } from '../../../lib/harvesterVmNetwork';
import { buildVmReconfigureSubmitCtx } from '../../../lib/vmMutation/vmReconfigureSubmitContext';
import type { VmReconfigureSubmitDeps } from '../../../lib/vmMutation/vmReconfigureSubmitTypes';
import { VmReconfigureSubmitSkipFinalize } from '../../../lib/vmMutation/vmReconfigureSubmitTypes';
import { submitVmReconfigureHotplugSettings } from './submitHotplugSettings';

export async function runHotplugSettingsSubmit(d: VmReconfigureSubmitDeps): Promise<void> {
  const { form, record, activeRecord, ensureNadsLoaded, onOk, onClose } = d;

  const ctx = buildVmReconfigureSubmitCtx(d);

  try {
    const values = await form.validateFields();
    const vmName = record?.metadata?.name;
    const namespace = record?.metadata?.namespace;

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

    await submitVmReconfigureHotplugSettings(ctx, values, vmName, namespace);
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
