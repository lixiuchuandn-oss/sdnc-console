import { isCloudInitVolume } from "../../../lib/vmCloudInitSpec";
import { PVC_ACCESS_MODE_ZH, PVC_PHASE_ZH } from "./vmDiskManageDrawerConstants";
import type {
  DiskMergeTemplateSlot,
  PvcAliasDraftByClaim,
  PvcResizeGiDraft,
  VmDiskEditorSlice,
  VolumeKind,
} from "./vmDiskManageDrawerTypes";

export function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

export function snapshot(
  disks: any[],
  volumes: any[],
  ui: VmDiskEditorSlice[],
  pvcTargetGi: PvcResizeGiDraft,
  pvcAliasByClaim: PvcAliasDraftByClaim,
) {
  return JSON.stringify({
    disks,
    volumes,
    ui,
    pvcTargetGi,
    pvcAliasByClaim,
  });
}

export function pvcPhaseToZh(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s) return "—";
  const hit = PVC_PHASE_ZH[s.toLowerCase()];
  return hit ?? s;
}

export function pvcAccessModesToZh(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s) return "—";
  const parts = s
    .split(/[、,，]\s*/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (parts.length === 0) return "—";
  return parts
    .map((p) => {
      const k = p.replace(/\s+/g, "").toLowerCase();
      return PVC_ACCESS_MODE_ZH[k] ?? p;
    })
    .join("、");
}

export function pvcAliasValidationError(raw: string): string | null {
  const s = String(raw ?? "");
  if (s.includes("\n") || s.includes("\r")) return "别名不允许换行";
  if (s.trim().length > 64) return "别名最长 64 个字符";
  return null;
}

export function claimNameForPvcResize(vol: any, k: VolumeKind): string {
  if (k === "pvc") {
    return String(vol?.persistentVolumeClaim?.claimName || "").trim();
  }
  if (k === "ephemeralPvc") {
    return String(
      vol?.ephemeral?.persistentVolumeClaim?.claimName || "",
    ).trim();
  }
  return "";
}

/** 启动盘卷名：优先 domain 上 bootOrder=1 的非 Cloud-Init 盘，否则取规格顺序中第一块非 Cloud-Init 盘。 */
export function rootBootDiskVolumeNameFromVm(vmData: any): string | null {
  const dFull =
    vmData?.spec?.template?.spec?.domain?.devices?.disks || [];
  if (!Array.isArray(dFull) || dFull.length === 0) return null;
  const volRaw = vmData?.spec?.template?.spec?.volumes || [];
  const volsFull = orderVolumesForDisks(dFull, volRaw);
  const byBoot = dFull.findIndex(
    (d: any, i: number) =>
      Number(d?.bootOrder) === 1 && !isCloudInitVolume(volsFull[i]),
  );
  if (byBoot >= 0) {
    const n = dFull[byBoot]?.name;
    if (n != null && String(n).trim()) return String(n).trim();
  }
  for (let i = 0; i < dFull.length; i++) {
    if (isCloudInitVolume(volsFull[i])) continue;
    const n = dFull[i]?.name;
    if (n != null && String(n).trim()) return String(n).trim();
  }
  return null;
}

export function isVolumeStructurallyLocked(v: any): boolean {
  return isCloudInitVolume(v) || !!(v?.containerDisk);
}

export function volumeKind(vol: any): VolumeKind {
  if (!vol) return "other";
  if (vol.persistentVolumeClaim) return "pvc";
  if (vol.containerDisk) return "containerDisk";
  if (vol.emptyDisk) return "emptyDisk";
  if (isCloudInitVolume(vol)) return "cloudInit";
  if (vol.dataVolume) return "dataVolume";
  if (vol.ephemeral?.persistentVolumeClaim) return "ephemeralPvc";
  if (vol.ephemeral?.containerDisk) return "ephemeralContainer";
  if (vol.hostDisk) return "hostDisk";
  if (vol.secret) return "secret";
  if (vol.configMap) return "configMap";
  return "other";
}

export function volumeKindLabel(kind: VolumeKind): string {
  const m: Record<VolumeKind, string> = {
    pvc: "PVC",
    containerDisk: "容器盘",
    emptyDisk: "空盘",
    cloudInit: "CloudInit",
    dataVolume: "DataVolume",
    ephemeralPvc: "临时卷(PVC)",
    ephemeralContainer: "临时容器盘",
    hostDisk: "HostDisk",
    secret: "Secret",
    configMap: "ConfigMap",
    other: "其他",
  };
  return m[kind] || "其他";
}

export function diskImageMetaText(vol: any, row: any): string {
  const fromRow = String(row?.imageDisplayName || "").trim();
  if (fromRow) return fromRow;
  const k = volumeKind(vol);
  if (k === "containerDisk") {
    return String(vol?.containerDisk?.image || "").trim() || "—";
  }
  if (k === "ephemeralContainer") {
    return String(vol?.ephemeral?.containerDisk?.image || "").trim() || "—";
  }
  return "—";
}

export function initDiskSlice(disk: any): VmDiskEditorSlice {
  const bus = String(disk?.disk?.bus || disk?.cdrom?.bus || "virtio");
  return { bus };
}

export function orderVolumesForDisks(disks: any[], volumes: any[]): any[] {
  return disks.map((d) => {
    const name = d?.name;
    const v = volumes.find((x: any) => x?.name === name);
    return v ? deepClone(v) : { name };
  });
}

/** 合并后的 devices.disks：bootOrder=1 写在「第一个块设备槽位」，避免 Cloud-Init 排在首位时抢 bootOrder。 */
export function applyBootOrderForFirstBlockSlot(
  mergedDisksInOrder: any[],
  template: DiskMergeTemplateSlot[],
): any[] {
  let firstBlockIdx = -1;
  template.forEach((slot, i) => {
    if (slot.kind === "block" && firstBlockIdx < 0) firstBlockIdx = i;
  });
  return mergedDisksInOrder.map((d, i) => {
    const x = deepClone(d);
    if (firstBlockIdx >= 0 && i === firstBlockIdx) x.bootOrder = 1;
    else delete x.bootOrder;
    return x;
  });
}

export function applySliceToDisk(disk: any, slice: VmDiskEditorSlice): any {
  const d = deepClone(disk);
  const bus = slice.bus || "virtio";
  if (d.cdrom) {
    d.cdrom = { ...(d.cdrom || {}), bus };
  } else {
    d.disk = { ...(d.disk || {}), bus };
  }
  return d;
}

export function isCdromDisk(disk: any): boolean {
  return !!disk?.cdrom;
}

export function isVolumeKindWithoutExtraFields(kind: VolumeKind): boolean {
  return kind === "pvc" || kind === "emptyDisk" || kind === "ephemeralPvc";
}

export function mergeTemplateDisksAndVolumes(
  tpl: DiskMergeTemplateSlot[],
  editedBlocks: any[],
  blockVolumes: any[],
): { nextDisks: any[]; nextVolumes: any[] } {
  const mergedDisksPreBoot: any[] = [];
  const mergedVolsScratch: any[] = [];
  let bi = 0;
  for (const slot of tpl) {
    if (slot.kind === "cloudInit") {
      mergedDisksPreBoot.push(deepClone(slot.disk));
      mergedVolsScratch.push(deepClone(slot.vol));
    } else {
      mergedDisksPreBoot.push(deepClone(editedBlocks[bi]));
      mergedVolsScratch.push(deepClone(blockVolumes[bi]));
      bi++;
    }
  }
  const nextDisks = applyBootOrderForFirstBlockSlot(
    mergedDisksPreBoot,
    tpl,
  );
  const nextVolumes = orderVolumesForDisks(nextDisks, mergedVolsScratch);
  return { nextDisks, nextVolumes };
}

export function extractBlockDisksAndVolumes(
  tpl: DiskMergeTemplateSlot[],
  nextDisks: any[],
  nextVolumes: any[],
): { blockDisks: any[]; blockVols: any[] } {
  const blockDisks: any[] = [];
  const blockVols: any[] = [];
  for (let i = 0; i < tpl.length; i++) {
    if (tpl[i].kind !== "block") continue;
    blockDisks.push(deepClone(nextDisks[i]));
    blockVols.push(deepClone(nextVolumes[i]));
  }
  return { blockDisks, blockVols };
}
