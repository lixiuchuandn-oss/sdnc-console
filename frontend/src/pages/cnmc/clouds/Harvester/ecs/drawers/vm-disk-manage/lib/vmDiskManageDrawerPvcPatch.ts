import { claimNameForPvcResize, volumeKind } from "./vmDiskManageDrawerDiskLogic";
import type {
  PvcAliasDraftByClaim,
  PvcPatchPayload,
  PvcResizeGiDraft,
} from "./vmDiskManageDrawerTypes";

export function collectPvcPatchesForDisks(opts: {
  disks: any[];
  volumes: any[];
  pvcTargetGiByVolName: PvcResizeGiDraft;
  pvcAliasDraftByClaimName: PvcAliasDraftByClaim;
  pvcBaselineGi: Record<string, number>;
  pvcAliasBaselineByClaimName: PvcAliasDraftByClaim;
}):
  | { ok: true; byClaim: Map<string, PvcPatchPayload> }
  | { ok: false; error: string } {
  const {
    disks,
    volumes,
    pvcTargetGiByVolName,
    pvcAliasDraftByClaimName,
    pvcBaselineGi,
    pvcAliasBaselineByClaimName,
  } = opts;

  const byClaim = new Map<string, PvcPatchPayload>();
  for (let i = 0; i < disks.length; i++) {
    const vol = volumes[i];
    const k = volumeKind(vol);
    if (k !== "pvc" && k !== "ephemeralPvc") continue;
    const dn = String(disks[i]?.name || "").trim();
    const rawT = pvcTargetGiByVolName[dn];
    const b = pvcBaselineGi[dn] ?? 0;
    const claim = claimNameForPvcResize(vol, k);
    if (!claim) continue;

    if (rawT != null) {
      const gi = Math.round(Number(rawT));
      if (Number.isFinite(gi) && gi >= 1) {
        if (!(b > 0 && Math.abs(gi - b) < 1e-6)) {
          const prevGi = byClaim.get(claim)?.sizeGi;
          if (prevGi != null && prevGi !== gi) {
            return {
              ok: false,
              error: `PVC「${claim}」对应多条磁盘且目标容量不一致，请核对`,
            };
          }
          const cur = byClaim.get(claim) || {};
          cur.sizeGi = gi;
          byClaim.set(claim, cur);
        }
      }
    }

    const draft = String(pvcAliasDraftByClaimName[claim] ?? "").trim();
    const base = String(
      pvcAliasBaselineByClaimName[claim] ?? "",
    ).trim();
    if (draft !== base) {
      const cur = byClaim.get(claim) || {};
      cur.annotations = { "tower.io/alias": draft };
      byClaim.set(claim, cur);
    }
  }
  return { ok: true, byClaim };
}
