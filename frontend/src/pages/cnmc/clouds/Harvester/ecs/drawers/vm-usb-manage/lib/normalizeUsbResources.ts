/**
 * 将 Harvester USB 设备列表规范为可展示 / 可下拉的行（与旧 ChangeUsbFormFields 映射一致）。
 */
export type NormalizedUsbRow = {
  resourceName: string;
  description: string;
  name: string;
  nodeName: string;
  pciAddress: string;
  vendor: string;
  vendorId: string;
  productId: string;
  enabled: boolean;
  claimed?: boolean;
  raw: any;
};

export function normalizeUsbResources(usbResources: any[]): NormalizedUsbRow[] {
  const list = Array.isArray(usbResources) ? usbResources : [];
  return list
    .map((x: any) => {
      const rn = String(x?.resourceName || x?.raw?.resourceName || x?.name || "").trim();
      if (!rn) return null;
      const vendorId = String(x?.vendorId || x?.vendor || x?.raw?.vendorId || "");
      const productId = String(x?.productId || x?.product || x?.raw?.productId || "");
      const description = String(
        x?.description ||
          x?.raw?.status?.description ||
          x?.raw?.spec?.description ||
          x?.raw?.description ||
          x?.name ||
          "",
      );
      const name = String(x?.name || x?.raw?.metadata?.name || "");
      const nodeName = String(
        x?.nodeName || x?.raw?.status?.nodeName || x?.raw?.spec?.nodeName || x?.node || "",
      );
      const pciAddress = String(
        x?.pciAddress ||
          x?.address ||
          x?.raw?.status?.pciAddress ||
          x?.raw?.status?.address ||
          x?.raw?.spec?.pciAddress ||
          x?.raw?.spec?.address ||
          "",
      ).trim();
      const vendor = String(
        x?.vendorName ||
          x?.vendor ||
          x?.raw?.status?.vendorName ||
          x?.raw?.status?.vendor ||
          x?.raw?.spec?.vendorName ||
          x?.raw?.spec?.vendor ||
          "",
      );
      const enabled =
        x?.enabled !== undefined
          ? !!x.enabled
          : x?.raw?.status?.enabled !== undefined
            ? !!x.raw.status.enabled
            : x?.raw?.spec?.enabled !== undefined
              ? !!x.raw.spec.enabled
              : false;
      const row: NormalizedUsbRow = {
        resourceName: rn,
        description,
        name,
        nodeName,
        pciAddress,
        vendor,
        vendorId,
        productId,
        enabled,
        claimed: x?.claimed,
        raw: x,
      };
      return row;
    })
    .filter(Boolean) as NormalizedUsbRow[];
}

/** 下拉项标签：描述 · 节点 · VID:PID */
export function buildUsbSelectOptionLabel(r: NormalizedUsbRow): string {
  const display = String(r.description || r.name || "未命名设备").trim() || "-";
  const node = String(r.nodeName || "").trim();
  const code =
    r.vendorId && r.productId ? `${String(r.vendorId)}:${String(r.productId)}` : "";
  const bits: string[] = [display];
  if (node) bits.push(node);
  if (code) bits.push(code);
  return bits.join(" · ");
}

export function rowDisplayForUsbResourceName(
  resourceName: string,
  usbResources: any[],
): { description: string; node: string; pci: string; vendor: string; vidPid: string } {
  const rows = normalizeUsbResources(usbResources);
  const hit = rows.find((r) => r.resourceName === resourceName);
  const code =
    hit?.vendorId && hit?.productId
      ? `${String(hit.vendorId)}:${String(hit.productId)}`
      : "-";
  const pciRaw = hit ? String(hit.pciAddress || "").trim() : "";
  return {
    description: hit ? String(hit.description || hit.name || "-") : "-",
    node: hit ? String(hit.nodeName || "-") || "-" : "-",
    pci: pciRaw || "-",
    vendor: hit ? String(hit.vendor || "-") || "-" : "-",
    vidPid: code,
  };
}
