/**
 * 虚拟机部署集变配提交（Pod 标签 + 由部署集策略生成的亲和/反亲和）。
 */
import { message } from 'antd';
import { updateHarvesterVmSpec } from 'services/harvester/vm';
import { buildPodAffinityForK8s } from '../../../lib/podAffinityK8s';
import { buildDeploymentSetPodAffinityConfig } from 'services/harvester/deploymentSetScheduling';
import type { VmReconfigureSubmitCtx } from '../../../lib/vmMutation/vmReconfigureSubmitContext';
import { VmReconfigureSubmitSkipFinalize } from '../../../lib/vmMutation/vmReconfigureSubmitTypes';
import type { DeploymentSetRow } from 'services/harvester/deploymentSets';
import {
  buildDeploymentSetTemplateLabelsPatch,
  findDeploymentSetById,
  isVmFixedHostScheduling,
  readVmDeploymentSetId,
} from '../../../lib/vmDeploymentSet';
import {
  buildClearMetricAutoScheduledVmMetadataAnnotations,
  readVmMetricAutoScheduled,
} from '../../../lib/vmSchedulingExclusion';

export async function submitVmReconfigureChangePodAffinity(
  ctx: VmReconfigureSubmitCtx,
  values: {
    deploymentSetId?: string;
  },
  vmName: string,
  namespace: string,
  options?: {
    activeRecord?: any;
    deploymentSets?: DeploymentSetRow[];
  },
): Promise<void> {
  const { cloudId, openRestartConfirm } = ctx;
  const activeRecord = options?.activeRecord;
  const deploymentSets = options?.deploymentSets || [];

  if (isVmFixedHostScheduling(activeRecord)) {
    message.warning('指定主机模式下不支持部署集');
    throw new VmReconfigureSubmitSkipFinalize();
  }

  const previousSetId = readVmDeploymentSetId(activeRecord);
  const previousSet = findDeploymentSetById(deploymentSets, previousSetId);
  const nextSet = findDeploymentSetById(deploymentSets, values.deploymentSetId);
  const currentLabels = activeRecord?.spec?.template?.metadata?.labels;
  const labelPatch = buildDeploymentSetTemplateLabelsPatch(currentLabels, previousSet, nextSet);

  let podAffinity: Record<string, unknown> | null = null;
  let podAntiAffinity: Record<string, unknown> | null = null;
  if (nextSet && nextSet.schedulingPolicy !== 'none') {
    const cfg = buildDeploymentSetPodAffinityConfig(nextSet);
    podAffinity = buildPodAffinityForK8s(cfg?.podAffinity) ?? null;
    podAntiAffinity = buildPodAffinityForK8s(cfg?.podAntiAffinity) ?? null;
  }

  const payload: Record<string, unknown> = {
    affinity: {
      podAffinity,
      podAntiAffinity,
    },
  };
  if (Object.keys(labelPatch).length > 0) {
    payload.templateMetadataLabels = labelPatch;
  }
  if (nextSet && readVmMetricAutoScheduled(activeRecord)) {
    payload.vmMetadataAnnotations = buildClearMetricAutoScheduledVmMetadataAnnotations();
  }

  await updateHarvesterVmSpec(cloudId, namespace, vmName, payload);
  message.success('部署集配置已更新');
  openRestartConfirm(namespace, vmName, false);
}
