export type VmDiskEditorSlice = {
  bus: string;
};

export type VolumeKind =
  | "pvc"
  | "containerDisk"
  | "emptyDisk"
  | "cloudInit"
  | "dataVolume"
  | "ephemeralPvc"
  | "ephemeralContainer"
  | "hostDisk"
  | "secret"
  | "configMap"
  | "other";

/** PVC / 临时 PVC 目标容量（GiB，二进制）；null 表示不调整（含当前容量未知） */
export type PvcResizeGiDraft = Record<string, number | null>;

/** 按 PVC claimName 索引的卷别名草稿（与 tower.io/alias 一致） */
export type PvcAliasDraftByClaim = Record<string, string>;

export type PvcPatchPayload = {
  sizeGi?: number;
  annotations?: Record<string, string>;
};

/** 保存时把 Cloud-Init 槽位按 VM 原顺序插回（本抽屉仅编辑块设备行）。 */
export type DiskMergeTemplateSlot =
  | { kind: "cloudInit"; disk: any; vol: any }
  | { kind: "block" };

/** 详情抽屉工具栏「磁盘管理」直通子向导（打开主抽屉后立即弹出对应子抽屉）。 */
export type VmDiskManageToolbarQuickAction =
  | "change_os"
  | "add_blank_disk"
  | "attach_existing_disk"
  | "attach_cdrom";

export interface VmDiskManageDrawerProps {
  open: boolean;
  onClose: () => void;
  vmData: any;
  cloudId: string;
  diskDisplayRows?: any[];
  hasEcsWrite: boolean;
  onApplied: () => void | Promise<void>;
  toolbarQuickAction?: VmDiskManageToolbarQuickAction | null;
  onToolbarQuickActionConsumed?: () => void;
}
