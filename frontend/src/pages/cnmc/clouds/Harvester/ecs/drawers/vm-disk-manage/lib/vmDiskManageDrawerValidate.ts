import {
  claimNameForPvcResize,
  pvcAliasValidationError,
  volumeKind,
} from "./vmDiskManageDrawerDiskLogic";
import type { PvcAliasDraftByClaim, PvcResizeGiDraft } from "./vmDiskManageDrawerTypes";

export function validateVmDiskManageBeforeSave(ctx: {
  disks: any[];
  volumes: any[];
  rootVolName: string | null;
  pvcTargetGiByVolName: PvcResizeGiDraft;
  pvcAliasDraftByClaimName: PvcAliasDraftByClaim;
  pvcBaselineGi: Record<string, number>;
}): string | null {
  const {
    disks,
    volumes,
    rootVolName,
    pvcTargetGiByVolName,
    pvcAliasDraftByClaimName,
    pvcBaselineGi,
  } = ctx;

  const names = new Set<string>();
  for (const d of disks) {
    const n = String(d?.name || "").trim();
    if (!n) return "存在无名称的磁盘设备";
    if (names.has(n)) return `磁盘名重复：${n}`;
    names.add(n);
  }
  const volNames = new Set(volumes.map((v: any) => String(v?.name || "")));
  for (const n of names) {
    if (!volNames.has(n)) return `卷定义缺失：${n}`;
  }
  if (rootVolName && !names.has(rootVolName)) {
    return "不可移除启动盘";
  }

  for (let i = 0; i < volumes.length; i++) {
    const vol = volumes[i];
    const k = volumeKind(vol);
    if (k === "pvc") {
      const cn = String(vol?.persistentVolumeClaim?.claimName || "").trim();
      if (!cn) return `磁盘 #${i + 1}：PVC 名称不能为空`;
    }
    if (k === "containerDisk") {
      const img = String(vol?.containerDisk?.image || "").trim();
      if (!img) return `磁盘 #${i + 1}：容器镜像地址不能为空`;
    }
    if (k === "emptyDisk") {
      const cap = String(vol?.emptyDisk?.capacity || "").trim();
      if (!cap) return `磁盘 #${i + 1}：空盘容量不能为空（如 2Gi）`;
    }
    if (k === "dataVolume") {
      const dn = String(vol?.dataVolume?.name || "").trim();
      if (!dn) return `磁盘 #${i + 1}：DataVolume 名称不能为空`;
    }
    if (k === "ephemeralPvc") {
      const cn = String(
        vol?.ephemeral?.persistentVolumeClaim?.claimName || "",
      ).trim();
      if (!cn) return `磁盘 #${i + 1}：临时卷 PVC 名不能为空`;
    }
    if (k === "ephemeralContainer") {
      const img = String(vol?.ephemeral?.containerDisk?.image || "").trim();
      if (!img) return `磁盘 #${i + 1}：临时容器盘镜像不能为空`;
    }
    if (k === "pvc" || k === "ephemeralPvc") {
      const dn = String(disks[i]?.name || "").trim();
      const t = pvcTargetGiByVolName[dn];
      const b = pvcBaselineGi[dn] ?? 0;
      if (t == null) continue;
      if (!Number.isFinite(t) || t < 1) {
        return `磁盘 #${i + 1}：目标容量须为不小于 1 的整数 GiB，或留空表示不改容量`;
      }
      if (b > 0 && t + 1e-9 < b) {
        return `磁盘 #${i + 1}：PVC 仅支持扩容，不能小于当前约 ${b.toFixed(1)} GiB`;
      }
      const claim = claimNameForPvcResize(vol, k);
      if (claim) {
        const aliasErr = pvcAliasValidationError(
          pvcAliasDraftByClaimName[claim] ?? "",
        );
        if (aliasErr) return `磁盘 #${i + 1}：${aliasErr}`;
      }
    }
  }
  return null;
}
