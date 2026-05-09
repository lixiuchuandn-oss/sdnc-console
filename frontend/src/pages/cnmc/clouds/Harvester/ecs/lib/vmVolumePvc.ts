/**
 * VM 卷与 PVC 列表的匹配、阶段与扩容条件解析（列表 SafeRead / 状态列复用）
 */

export function resolveVmNamespace(r: any): string {
  let vmNs = r?.metadata?.namespace || r?.namespace;
  if (!vmNs) {
    const iid = r?.id || r?.metadata?.uid || "";
    if (iid && iid.includes("/")) {
      vmNs = iid.split("/")[0];
    }
  }
  return vmNs || "";
}

export function findPvcForClaim(
  volumes: any[] | undefined | null,
  claimName: string,
  vmNs: string,
): any | undefined {
  if (!volumes?.length || !claimName) return undefined;
  return volumes.find((p: any) => {
    const pName = p?.metadata?.name || p?.name;
    const pNs = p?.metadata?.namespace || p?.namespace;
    if (pName === claimName && pNs === vmNs) return true;
    const pId = p?.id;
    if (pId && pId === `${vmNs}/${claimName}`) return true;
    if (p?.name === claimName && p?.namespace === vmNs) return true;
    return false;
  });
}

export type PvcResizeFlags = {
  isResizing: boolean;
  isFsPending: boolean;
};

export function readPvcResizeFlags(actualPvc: any): PvcResizeFlags {
  const conditions = actualPvc?.status?.conditions || [];
  const fsPendingCond = conditions.find(
    (c: any) =>
      c.type === "FileSystemResizePending" && c.status === "True",
  );
  if (fsPendingCond) {
    return { isResizing: false, isFsPending: true };
  }
  const resizingCond = conditions.find(
    (c: any) => c.type === "Resizing" && c.status === "True",
  );
  if (resizingCond) {
    return { isResizing: true, isFsPending: false };
  }
  return { isResizing: false, isFsPending: false };
}

/** UI 不展示 Bound 阶段 */
export function normalizePvcPhaseForDisplay(
  actualPvc: any,
  pvcWrapper: any,
): string {
  const rawPhase = actualPvc?.status?.phase || pvcWrapper?.state || "";
  if (
    rawPhase &&
    String(rawPhase).trim().toLowerCase() !== "bound"
  ) {
    return String(rawPhase).trim();
  }
  return "";
}

export function getPvcCapacityStorageString(
  actualPvc: any,
  pvcWrapper: any,
): string {
  return (
    actualPvc?.status?.capacity?.storage ||
    actualPvc?.spec?.resources?.requests?.storage ||
    pvcWrapper?.size ||
    ""
  );
}

export function findFirstVmVolumeResizeState(
  r: any,
  volumes: any[] | undefined | null,
): {
  isResizing: boolean;
  isFsPending: boolean;
  pvcName: string;
} {
  if (!volumes?.length) {
    return {
      isResizing: false,
      isFsPending: false,
      pvcName: "",
    };
  }
  const vmNs = resolveVmNamespace(r);
  const vmVolumes = r?.spec?.template?.spec?.volumes || [];
  for (const v of vmVolumes) {
    const claimName = v?.persistentVolumeClaim?.claimName;
    if (!claimName) continue;
    const pvc = findPvcForClaim(volumes, claimName, vmNs);
    if (!pvc) continue;
    const actualPvc = pvc?.rawData || pvc;
    const flags = readPvcResizeFlags(actualPvc);
    if (flags.isFsPending || flags.isResizing) {
      return {
        isResizing: flags.isResizing,
        isFsPending: flags.isFsPending,
        pvcName: claimName,
      };
    }
  }
  return {
    isResizing: false,
    isFsPending: false,
    pvcName: "",
  };
}
