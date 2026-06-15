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
import { buildVmAutoScheduledAnnotations } from '../../../lib/vmAutoScheduledAnnotation';
import {
  buildClearMetricAutoScheduledTemplateMetadataAnnotations,
  getVmRecordMetricAutoScheduledConflictMessage,
  readVmMetricAutoScheduled,
} from '../../../lib/vmSchedulingExclusion';
import { readVmDeploymentSetId } from '../../../lib/vmDeploymentSet';

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
    if (!hasLabelModeNodeSelector({ failureDomainName })) {
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

  const wantsMetricAutoScheduled = mode === 'auto' && values.metricAutoScheduled === true;
  if (wantsMetricAutoScheduled) {
    const conflictMsg = getVmRecordMetricAutoScheduledConflictMessage(activeRecord, {
      pciDevices: opts?.pciDevices,
      gpuResources: opts?.gpuResources,
    });
    if (conflictMsg) {
      message.error(conflictMsg);
      throw new VmReconfigureSubmitSkipFinalize();
    }
    if (readVmDeploymentSetId(activeRecord)) {
      message.error('已绑定部署集，不能同时参与指标自动调度');
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
    updateParams.nodeSelector =
      buildNodeSelectorFromLabelForm({ failureDomainName }) ?? null;
  }

  if (wantsMetricAutoScheduled) {
    updateParams.templateMetadataAnnotations = buildVmAutoScheduledAnnotations();
  } else if (readVmMetricAutoScheduled(activeRecord)) {
    const clearAnn = buildClearMetricAutoScheduledTemplateMetadataAnnotations();
    updateParams.templateMetadataAnnotations = clearAnn;
    updateParams.vmMetadataAnnotations = clearAnn;
  }

  await updateHarvesterVmSpec(cloudId, namespace, vmName, updateParams);
  message.success('节点调度配置已更新');
  openRestartConfirm(namespace, vmName, false);
}
