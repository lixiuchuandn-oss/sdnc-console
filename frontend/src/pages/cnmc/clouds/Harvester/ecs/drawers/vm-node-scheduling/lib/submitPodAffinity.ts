/**
 * 虚拟机间亲和/反亲和（podAffinity / podAntiAffinity）变配提交。
 */
import { message } from 'antd';
import { updateHarvesterVmSpec } from 'services/harvester/vm';
import { buildPodAffinityForK8s } from '../../../lib/podAffinityK8s';
import type { PodAffinityConfig } from '../../../../containers/components/workloadForm/types';
import type { VmReconfigureSubmitCtx } from '../../../lib/vmMutation/vmReconfigureSubmitContext';

export async function submitVmReconfigureChangePodAffinity(
  ctx: VmReconfigureSubmitCtx,
  values: {
    podAffinity?: PodAffinityConfig;
    podAntiAffinity?: PodAffinityConfig;
  },
  vmName: string,
  namespace: string,
): Promise<void> {
  const { cloudId, openRestartConfirm } = ctx;

  const podAffinity = buildPodAffinityForK8s(values.podAffinity);
  const podAntiAffinity = buildPodAffinityForK8s(values.podAntiAffinity);

  await updateHarvesterVmSpec(cloudId, namespace, vmName, {
    affinity: {
      podAffinity: podAffinity ?? null,
      podAntiAffinity: podAntiAffinity ?? null,
    },
  });
  message.success('虚拟机间亲和性配置已更新');
  openRestartConfirm(namespace, vmName, false);
}
