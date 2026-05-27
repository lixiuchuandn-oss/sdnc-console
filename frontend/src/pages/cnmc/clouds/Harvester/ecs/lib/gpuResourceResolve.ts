/**
 * GPU 资源列表解析：同型号卡在不同节点往往共用 KubeVirt `resourceName`，
 * 须用 PCIDevice CR 名或 `name|node|pci` 复合 key 才能唯一定位。
 */

export function gpuResourceCompositeKey(x: any): string {
  const name = (x?.raw?.metadata?.name || x?.name || x?.resourceName) || "-";
  const node = x?.node || x?.nodeName || "";
  const pci = x?.pciAddress || x?.address || x?.pci || "";
  return `${name}|${node}|${pci}`;
}

export function getGpuPcideviceCrName(x: any): string {
  return String(x?.raw?.metadata?.name || x?.name || "").trim();
}

export function getGpuResourceName(x: any): string {
  return String(
    x?.resourceName || x?.raw?.status?.resourceName || x?.raw?.spec?.resourceName || "",
  ).trim();
}

export function getGpuNodeName(x: any): string {
  return String(x?.node || x?.nodeName || "").trim();
}

export type FindGpuResourceCriteria = {
  gpuPickKey?: string | null;
  pcideviceName?: string | null;
  resourceName?: string | null;
  node?: string | null;
};

/** 按复合 key → CR 名 → resourceName+node → resourceName 顺序解析，避免多节点同名 resourceName 误匹配。 */
export function findGpuResource(list: any[], criteria: FindGpuResourceCriteria): any | null {
  const arr = Array.isArray(list) ? list : [];
  const pickKey = String(criteria.gpuPickKey || "").trim();
  if (pickKey) {
    const byKey = arr.find((x) => gpuResourceCompositeKey(x) === pickKey);
    if (byKey) return byKey;
  }

  const crName = String(criteria.pcideviceName || "").trim();
  if (crName) {
    const byCr = arr.filter((x) => getGpuPcideviceCrName(x) === crName);
    const nodeHint = String(criteria.node || "").trim();
    if (nodeHint) {
      const onNode = byCr.find((x) => getGpuNodeName(x) === nodeHint);
      if (onNode) return onNode;
    }
    if (byCr.length === 1) return byCr[0];
    if (byCr.length > 1) {
      const rn = String(criteria.resourceName || "").trim();
      if (rn) {
        const match = byCr.find((x) => getGpuResourceName(x) === rn);
        if (match) return match;
      }
    }
  }

  const rn = String(criteria.resourceName || "").trim();
  const nodeHint = String(criteria.node || "").trim();
  if (rn && nodeHint) {
    const onNode = arr.find((x) => getGpuResourceName(x) === rn && getGpuNodeName(x) === nodeHint);
    if (onNode) return onNode;
  }

  if (rn) {
    return arr.find((x) => getGpuResourceName(x) === rn) || null;
  }

  return null;
}
