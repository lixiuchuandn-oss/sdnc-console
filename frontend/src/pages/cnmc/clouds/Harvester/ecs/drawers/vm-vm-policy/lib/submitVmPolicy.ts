/**
 * 运行策略 / 驱逐策略提交。
 */
import { message } from 'antd';
import { updateHarvesterVmSpec } from '../../../../../../../../services/harvesterApi';
import type { VmReconfigureSubmitCtx } from '../../../lib/vmMutation/vmReconfigureSubmitContext';

export async function submitVmReconfigureVmPolicy(
  ctx: VmReconfigureSubmitCtx,
  values: any,
  vmName: string,
  namespace: string,
): Promise<void> {
  const { cloudId, openRestartConfirm } = ctx;
  const rs = values.runStrategy || 'Manual';
  const es = values.evictionStrategy ? String(values.evictionStrategy) : null;
  await updateHarvesterVmSpec(cloudId, namespace, vmName, { runStrategy: rs, evictionStrategy: es });
  message.success('策略配置已更新');
  openRestartConfirm(namespace, vmName, false);
}
