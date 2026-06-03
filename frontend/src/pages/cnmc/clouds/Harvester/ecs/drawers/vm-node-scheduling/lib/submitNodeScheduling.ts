/**
 * 节点调度变配提交。
 */
import { message } from 'antd';
import { updateHarvesterVmSpec } from 'services/harvester/vm';
import type { VmReconfigureSubmitCtx } from '../../../lib/vmMutation/vmReconfigureSubmitContext';
import { VmReconfigureSubmitSkipFinalize } from '../../../lib/vmMutation/vmReconfigureSubmitTypes';
import { validateNodeSchedulingPassthroughAffinity } from './validateNodeSchedulingPassthrough';
import {
  buildNodeSelectorFromLabelForm,
  hasLabelModeNodeSelector,
} from '../../../lib/vmFailureDomainNodeSelector';
import { vmFailureDomainRequiredMessage } from '../../../lib/vmAdvancedSchedulingLabels';

export type SubmitNodeSchedulingOptions = {
  pciDevices?: any[];
  gpuResources?: any[];
};

export async function submitVmReconfigureChangeNodeScheduling(
  ctx: VmReconfigureSubmitCtx,
  values: any,
  vmName: string,
  namespace: string,
  opts?: SubmitNodeSchedulingOptions,
): Promise<void> {
  const { cloudId, activeRecord, openRestartConfirm } = ctx;
  const mode = values.nodeSchedulingMode;
  const fixedNode = values.fixedNode;
  const nodeSelectorPairs = values.nodeSelectorPairs || [];
  const failureDomainName = values.failureDomainName;

  if (mode === 'fixed' && !fixedNode) {
    message.error('请选择要固定的节点');
    throw new VmReconfigureSubmitSkipFinalize();
  }
  if (mode === 'label') {
    if (!hasLabelModeNodeSelector({ failureDomainName, nodeSelectorPairs })) {
      message.error(vmFailureDomainRequiredMessage());
      throw new VmReconfigureSubmitSkipFinalize();
    }
  }

  validateNodeSchedulingPassthroughAffinity({
    vm: activeRecord,
    mode,
    fixedNode,
    nodeSelectorPairs,
    pciDevices: opts?.pciDevices,
    gpuResources: opts?.gpuResources,
  });

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
    updateParams.nodeSelector =
      buildNodeSelectorFromLabelForm({ failureDomainName, nodeSelectorPairs }) ?? null;
  }

  await updateHarvesterVmSpec(cloudId, namespace, vmName, updateParams);
  message.success('节点调度配置已更新');
  openRestartConfirm(namespace, vmName, false);
}
