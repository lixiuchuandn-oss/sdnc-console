/** 与 VmCreateWizard/StepDisks DISK_BUS_OPTIONS 一致（块设备） */
export const DISK_BUS_OPTIONS = [
  { label: "VirtIO（推荐）", value: "virtio" },
  { label: "SCSI", value: "scsi" },
  { label: "SATA", value: "sata" },
  { label: "IDE", value: "ide" },
  { label: "NVMe", value: "nvme" },
] as const;

export const CDROM_BUS_FIXED = "sata";

/** Kubernetes PVC status.phase → 中文（未知枚举原样显示） */
export const PVC_PHASE_ZH: Record<string, string> = {
  pending: "等待绑盘",
  bound: "正常",
  lost: "已丢失",
};

/** spec.accessModes 单项 → 中文（与常见云厂商口径一致） */
export const PVC_ACCESS_MODE_ZH: Record<string, string> = {
  readwriteonce: "单节点读写（RWO）",
  readonlymany: "多节点只读（ROX）",
  readwritemany: "多节点读写（RWX）",
  readwriteoncepod: "单 Pod 独占读写",
};
