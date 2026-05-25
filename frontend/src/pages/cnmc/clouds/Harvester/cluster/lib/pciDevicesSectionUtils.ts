/** PCI 设备列表 Section 纯函数（Harvester cluster） */

export type PciDeviceRow = Record<string, unknown>;

export function pciDeviceRawObj(r: unknown): Record<string, unknown> {
  const row = r as PciDeviceRow;
  return (row?.raw || row?.rawData || row) as Record<string, unknown>;
}

const PCI_VENDOR_NAMES: Record<string, string> = {
  '10de': 'NVIDIA',
  '1002': 'AMD',
  '8086': 'Intel',
  '1a03': 'ASPEED',
};

export function pciVendorName(id?: string): string {
  const v = String(id || '').trim().toLowerCase();
  if (!v) return '-';
  return PCI_VENDOR_NAMES[v] || v;
}

export function pciVendorLabel(id?: string): string {
  const v = String(id || '').trim();
  if (!v) return '-';
  const name = pciVendorName(v);
  if (!name || name === '-' || name === v.toLowerCase()) return v;
  return `${name} (${v})`;
}

export function getPciNodeName(r: unknown): string {
  const row = r as PciDeviceRow;
  const rawObj = pciDeviceRawObj(r);
  const status = rawObj?.status as { nodeName?: string } | undefined;
  const spec = rawObj?.spec as { nodeName?: string } | undefined;
  return String(
    row?.nodeName ||
      (row?.status as { nodeName?: string } | undefined)?.nodeName ||
      status?.nodeName ||
      spec?.nodeName ||
      '',
  ).trim();
}

export function getPciDeviceState(r: unknown): string {
  const row = r as PciDeviceRow;
  const rawObj = pciDeviceRawObj(r);
  const st =
    row?.state ||
    (row?.metadata as { state?: unknown } | undefined)?.state ||
    (row?.status as { state?: unknown; phase?: unknown; conditions?: Array<{ type?: unknown }> } | undefined)
      ?.state ||
    (row?.status as { phase?: unknown } | undefined)?.phase ||
    (row?.status as { conditions?: Array<{ type?: unknown }> } | undefined)?.conditions?.[0]?.type;
  if (st && typeof st === 'object' && (st as { name?: string }).name != null) {
    return String((st as { name?: string }).name).trim();
  }
  if (typeof st === 'string' && st.trim()) return st.trim();
  const driver =
    (rawObj?.status as { kernelDriverInUse?: string } | undefined)?.kernelDriverInUse ||
    rawObj?.kernelDriverInUse;
  if (typeof driver === 'string' && driver.toLowerCase().includes('vfio')) return '可透传';
  if (driver) return '占用中';
  return '-';
}

export type PciDevicesFilterState = {
  keyword: string;
  nodeFilter: string;
  statusFilter: string;
  bindFilter: string;
};

export function filterPciDevices(rows: readonly unknown[], f: PciDevicesFilterState): unknown[] {
  const list = Array.isArray(rows) ? rows : [];
  const kw = String(f.keyword || '').trim().toLowerCase();
  const nf = String(f.nodeFilter || '').trim().toLowerCase();
  const sf = String(f.statusFilter || '').trim().toLowerCase();
  return list.filter((r) => {
    const rawObj = pciDeviceRawObj(r);
    const row = r as PciDeviceRow;
    const node = getPciNodeName(r).toLowerCase();
    const addr = String(
      row?.address ||
        row?.pciAddress ||
        (row?.status as { pciAddress?: string; address?: string } | undefined)?.pciAddress ||
        (row?.status as { address?: string } | undefined)?.address ||
        (rawObj?.status as { pciAddress?: string; address?: string } | undefined)?.pciAddress ||
        '',
    ).toLowerCase();
    const rn = String(row?.resourceName || (row?.status as { resourceName?: string } | undefined)?.resourceName || '').toLowerCase();
    const name = String(row?.name || (row?.status as { deviceName?: string } | undefined)?.deviceName || (row?.metadata as { name?: string } | undefined)?.name || '').toLowerCase();
    const desc = String(row?.description || (row?.status as { description?: string } | undefined)?.description || (rawObj?.status as { description?: string } | undefined)?.description || '').toLowerCase();
    const vendorId = String(row?.vendorId || (row?.status as { vendorId?: string } | undefined)?.vendorId || (rawObj?.status as { vendorId?: string } | undefined)?.vendorId || '').toLowerCase();
    const productId = String(row?.productId || row?.deviceId || (row?.status as { deviceId?: string } | undefined)?.deviceId || (rawObj?.status as { deviceId?: string } | undefined)?.deviceId || '').toLowerCase();
    const classId = String(row?.classId || (row?.status as { classId?: string } | undefined)?.classId || (rawObj?.status as { classId?: string } | undefined)?.classId || '').toLowerCase();
    const state = getPciDeviceState(r).toLowerCase();
    const bindTo = String(row?.bindingTo || row?.claimedBy || row?.claimName || '').toLowerCase();
    if (nf && node !== nf) return false;
    if (sf && state !== sf) return false;
    if (f.bindFilter === 'bound' && !row?.vmInfo) return false;
    if (f.bindFilter === 'unbound' && row?.vmInfo) return false;
    if (!kw) return true;
    return (
      node.includes(kw) ||
      addr.includes(kw) ||
      rn.includes(kw) ||
      name.includes(kw) ||
      desc.includes(kw) ||
      vendorId.includes(kw) ||
      productId.includes(kw) ||
      classId.includes(kw) ||
      state.includes(kw) ||
      bindTo.includes(kw) ||
      pciVendorLabel(
        String(row?.vendorId || (row?.status as { vendorId?: string } | undefined)?.vendorId || (rawObj?.status as { vendorId?: string } | undefined)?.vendorId || ''),
      )
        .toLowerCase()
        .includes(kw)
    );
  });
}

export function pciDeviceRowKey(r: unknown): string {
  const row = r as PciDeviceRow;
  return String(
    row?.uid ||
      (row?.metadata as { uid?: string } | undefined)?.uid ||
      `${getPciNodeName(r)}-${row?.address || row?.pciAddress || ''}-${row?.resourceName || ''}-${row?.name || ''}`,
  );
}

export function distinctSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}
