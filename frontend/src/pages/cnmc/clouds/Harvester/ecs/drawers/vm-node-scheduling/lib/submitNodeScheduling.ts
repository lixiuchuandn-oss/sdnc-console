/**
 * 节点调度变配提交。
 */
import { message } from 'antd';
import { updateHarvesterVmSpec } from '../../../../../../../../services/harvesterApi';
import type { VmReconfigureSubmitCtx } from '../../../lib/vmMutation/vmReconfigureSubmitContext';
import { VmReconfigureSubmitSkipFinalize } from '../../../lib/vmMutation/vmReconfigureSubmitTypes';

export async function submitVmReconfigureChangeNodeScheduling(
  ctx: VmReconfigureSubmitCtx,
  values: any,
  vmName: string,
  namespace: string,
): Promise<void> {
  const { cloudId, openRestartConfirm } = ctx;
  const mode = values.nodeSchedulingMode;
  const fixedNode = values.fixedNode;
  const nodeSelectorPairs = values.nodeSelectorPairs || [];

  if (mode === 'fixed' && !fixedNode) {
    message.error('请选择要固定的节点');
    throw new VmReconfigureSubmitSkipFinalize();
  }
  if (mode === 'label') {
    const validPairs = nodeSelectorPairs.filter((p: any) => p?.key && p?.value);
    if (validPairs.length === 0) {
      message.error('请至少添加一个标签选择器');
      throw new VmReconfigureSubmitSkipFinalize();
    }
  }

  let updateParams: any = {};

  if (mode === 'auto') {
    updateParams.nodeSelector = null;
  } else if (mode === 'fixed') {
    const nodeName = String(fixedNode || '').trim();
    if (nodeName) {
      updateParams.nodeSelector = {
        'kubernetes.io/hostname': nodeName,
      };
    } else {
      updateParams.nodeSelector = null;
    }
  } else if (mode === 'label') {
    const nodeSelector: Record<string, string> = {};
    nodeSelectorPairs.forEach((p: any) => {
      const key = String(p?.key || '').trim();
      const value = String(p?.value || '').trim();
      if (key && value) {
        nodeSelector[key] = value;
      }
    });
    updateParams.nodeSelector = Object.keys(nodeSelector).length > 0 ? nodeSelector : null;
  }

  await updateHarvesterVmSpec(cloudId, namespace, vmName, updateParams);
  message.success('节点调度配置已更新');
  openRestartConfirm(namespace, vmName, false);
}
