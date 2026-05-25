/**
 * 更换系统盘 / 重装系统提交（`updateHarvesterVmSpec`）。
 */
import { message } from 'antd';
import { updateHarvesterVmSpec } from 'services/harvester/vm';
import type { VmReconfigureSubmitCtx } from '../../../lib/vmMutation/vmReconfigureSubmitContext';
import { VmReconfigureSubmitSkipFinalize } from '../../../lib/vmMutation/vmReconfigureSubmitTypes';

export async function submitVmReconfigureChangeOs(
  ctx: VmReconfigureSubmitCtx,
  values: any,
  vmName: string,
  namespace: string,
): Promise<void> {
  const { cloudId, openRestartConfirm } = ctx;
  let rootSize = '40Gi';
  const sizeValue = values.newOsRootSize;
  if (sizeValue !== undefined && sizeValue !== null && sizeValue !== '' && sizeValue !== '自动选择') {
    const numSize = Number(sizeValue);
    if (!isNaN(numSize) && numSize > 0) {
      rootSize = `${numSize}Gi`;
    }
  }

  if (!values.newOsImage) {
    message.error('请选择镜像');
    throw new VmReconfigureSubmitSkipFinalize();
  }

  if (!values.changeOsConfirmed) {
    message.warning('请勾选确认更换系统盘的风险后再提交');
    throw new VmReconfigureSubmitSkipFinalize();
  }

  await updateHarvesterVmSpec(cloudId, namespace, vmName, {
    action: 'reinstall',
    image: values.newOsImage,
    rootSize: rootSize,
    bus: values.newOsBus || 'virtio',
    storageClassName: values.storageClassName || undefined,
    rootDeviceType: values.rootDeviceType || 'disk',
  });
  openRestartConfirm(namespace, vmName, true);
}
