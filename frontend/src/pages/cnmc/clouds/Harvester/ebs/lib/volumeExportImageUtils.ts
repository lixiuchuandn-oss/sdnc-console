import { isVmStopped } from '../../ecs/lib/vmInstanceStatus';
import type { VmAttachRecord } from './volumeDetachUtils';

/** 云盘导出镜像前须先关闭已挂载的虚拟机 */
export const VOLUME_EXPORT_REQUIRES_VM_STOPPED_MSG =
  '请先关闭虚拟机再做导出镜像操作';

export function isVolumeExportBlockedByRunningVm(
  attachedVm: VmAttachRecord | undefined | null,
): boolean {
  if (!attachedVm) return false;
  return !isVmStopped(attachedVm);
}

export function getVolumeExportBlockedMessage(
  attachedVm: VmAttachRecord | undefined | null,
): string | undefined {
  if (!isVolumeExportBlockedByRunningVm(attachedVm)) return undefined;
  return VOLUME_EXPORT_REQUIRES_VM_STOPPED_MSG;
}
