import { getVmRootImageIdFromVm } from "./vmImageStatus";

/**
 * 解析「首选引导」对应的块磁盘设备（`domain.devices.disks` 条目）。
 *
 * 若明确存在 `bootOrder === 1` 的条目：必须以该条目为准——光驱引导时不得回落到其它磁盘，
 * 否则会把数据盘误判为系统盘。
 */
export function resolveVmBootDiskDevice(r: any): any | null {
  if (!r) return null;
  const disks = r?.spec?.template?.spec?.domain?.devices?.disks || [];
  const bootFirst = disks.find((d: any) => Number(d?.bootOrder) === 1);
  if (bootFirst) {
    if (bootFirst.cdrom) return null;
    if (bootFirst.disk) return bootFirst;
    return null;
  }

  let bootDisk = disks.find((d: any) => d.name === "disk-0" && !d.cdrom);
  if (!bootDisk) {
    bootDisk = disks.find((d: any) => d.name === "rootdisk" && !d.cdrom);
  }
  if (!bootDisk && disks.length > 0) {
    bootDisk = disks.find((d: any) => !d.cdrom);
  }
  return bootDisk || null;
}

/** 是否允许「更换系统镜像」：须为块磁盘启动且 VM 上能解析到根盘镜像 ID。 */
export function getVmChangeSystemDiskEligibility(vm: any): {
  allowed: boolean;
  message: string;
} {
  const boot = resolveVmBootDiskDevice(vm);
  if (!boot || boot.cdrom || !boot.disk) {
    return {
      allowed: false,
      message:
        "当前启动设备不是块磁盘类型（例如从光驱引导、LUN 或未识别到块设备启动盘），无法更换系统镜像。",
    };
  }
  const img = String(getVmRootImageIdFromVm(vm) || "").trim();
  if (!img) {
    return {
      allowed: false,
      message:
        "当前启动盘未关联系统镜像（例如空白数据盘作启动盘），无法更换系统镜像。",
    };
  }
  return { allowed: true, message: "" };
}
