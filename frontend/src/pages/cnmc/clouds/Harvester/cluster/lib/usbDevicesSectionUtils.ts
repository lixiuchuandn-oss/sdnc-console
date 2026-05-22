/** USB 设备列表 Section 纯函数（Harvester cluster） */

export type UsbDeviceRow = Record<string, unknown>;

export function usbDeviceRawObj(r: unknown): Record<string, unknown> {
  const row = r as UsbDeviceRow;
  return (row?.raw || row?.rawData || row?.data || row) as Record<string, unknown>;
}

const USB_VENDOR_NAMES: Record<string, string> = {
  '10de': 'NVIDIA',
  '1002': 'AMD',
  '8086': 'Intel',
  '1a03': 'ASPEED',
  '0951': 'Kingston',
  '046b': 'Logitech',
  '0bda': 'Realtek',
  '1d6b': 'Linux Foundation',
  '0403': 'FTDI',
  '067b': 'Prolific',
  '2109': 'VIA Labs',
  '05ac': 'Apple',
  '0e8d': 'MediaTek',
  '12d1': 'Huawei',
};

export function usbVendorName(id?: string): string {
  const v = String(id || '').trim().toLowerCase();
  if (!v) return '-';
  return USB_VENDOR_NAMES[v] || v;
}

export function usbVendorLabel(id?: string): string {
  const v = String(id || '').trim();
  if (!v) return '-';
  const name = usbVendorName(v);
  if (!name || name === '-' || name === v.toLowerCase()) return v;
  return `${name} (${v})`;
}

export function getUsbNodeName(r: unknown): string {
  const row = r as UsbDeviceRow;
  const rawObj = usbDeviceRawObj(r);
  return String(
    row?.nodeName ||
      (rawObj?.status as { nodeName?: string } | undefined)?.nodeName ||
      (rawObj?.spec as { nodeName?: string } | undefined)?.nodeName ||
      '',
  ).trim();
}

export function getUsbState(r: unknown): string {
  const row = r as UsbDeviceRow;
  const rawObj = usbDeviceRawObj(r);
  const enabled = row?.enabled ?? (rawObj?.status as { enabled?: boolean } | undefined)?.enabled ?? (rawObj?.spec as { enabled?: boolean } | undefined)?.enabled;
  if (enabled === true) return 'active';
  if (enabled === false) return 'inactive';
  const state = String(
    (rawObj?.status as { state?: string; status?: string; phase?: string } | undefined)?.state ||
      (rawObj?.status as { status?: string } | undefined)?.status ||
      (rawObj?.status as { phase?: string } | undefined)?.phase ||
      '',
  )
    .trim()
    .toLowerCase();
  if (!state) return 'unknown';
  if (['active', 'inactive', 'transitioning', 'error', 'failed'].includes(state)) return state;
  if (state.includes('enable')) return 'active';
  if (state.includes('disable')) return 'inactive';
  if (state.includes('transition')) return 'transitioning';
  if (state.includes('error') || state.includes('fail')) return 'error';
  return state;
}

export function usbStateLabel(state: string): string {
  const s = String(state || '').toLowerCase();
  if (s === 'active' || s === 'enabled') return '活跃';
  if (s === 'inactive' || s === 'disabled') return '非活跃';
  if (s === 'transitioning') return '变更中';
  if (s === 'error' || s === 'failed') return '异常';
  if (s === 'unknown') return '未知';
  return state || '-';
}

export function getUsbDeviceName(r: unknown): string {
  const row = r as UsbDeviceRow;
  return String(
    (row?.raw as { metadata?: { name?: string } } | undefined)?.metadata?.name ||
      (row?.rawData as { metadata?: { name?: string } } | undefined)?.metadata?.name ||
      row?.name ||
      '',
  ).trim();
}

export type UsbDevicesFilterState = {
  keyword: string;
  nodeFilter: string;
  statusFilter: string;
  bindFilter: string;
};

export function filterUsbDevices(rows: readonly unknown[], f: UsbDevicesFilterState): unknown[] {
  const list = Array.isArray(rows) ? rows : [];
  const kw = String(f.keyword || '').trim().toLowerCase();
  const nf = String(f.nodeFilter || '').trim().toLowerCase();
  const sf = String(f.statusFilter || '').trim().toLowerCase();
  return list.filter((r) => {
    const row = r as UsbDeviceRow;
    const rawObj = usbDeviceRawObj(r);
    const rn = String(row?.resourceName || '').toLowerCase();
    const name = String(row?.name || '').toLowerCase();
    const desc = String(row?.description || '').toLowerCase();
    const vendorId = String(
      row?.vendorId ||
        (rawObj?.status as { vendorID?: string; vendorId?: string } | undefined)?.vendorID ||
        (rawObj?.status as { vendorId?: string } | undefined)?.vendorId ||
        (rawObj?.spec as { vendorID?: string; vendorId?: string } | undefined)?.vendorID ||
        (rawObj?.spec as { vendorId?: string } | undefined)?.vendorId ||
        '',
    ).toLowerCase();
    const productId = String(
      row?.productId ||
        (rawObj?.status as { productID?: string; productId?: string } | undefined)?.productID ||
        (rawObj?.status as { productId?: string } | undefined)?.productId ||
        (rawObj?.spec as { productID?: string; productId?: string } | undefined)?.productID ||
        (rawObj?.spec as { productId?: string } | undefined)?.productId ||
        '',
    ).toLowerCase();
    const vendor = usbVendorLabel(vendorId || '').toLowerCase();
    const nodeName = getUsbNodeName(r).toLowerCase();
    const addr = String(
      row?.pciAddress ||
        (rawObj?.status as { pciAddress?: string; address?: string } | undefined)?.pciAddress ||
        (rawObj?.status as { address?: string } | undefined)?.address ||
        (rawObj?.spec as { pciAddress?: string; address?: string } | undefined)?.pciAddress ||
        (rawObj?.spec as { address?: string } | undefined)?.address ||
        '',
    ).toLowerCase();
    const devicePath = String(
      (rawObj?.status as { devicePath?: string } | undefined)?.devicePath ||
        (rawObj?.spec as { devicePath?: string } | undefined)?.devicePath ||
        '',
    ).toLowerCase();
    const state = getUsbState(r).toLowerCase();
    if (nf && nodeName !== nf) return false;
    if (sf && state !== sf) return false;
    if (f.bindFilter === 'bound' && !row?.claimed) return false;
    if (f.bindFilter === 'unbound' && row?.claimed) return false;
    if (!kw) return true;
    return (
      rn.includes(kw) ||
      name.includes(kw) ||
      desc.includes(kw) ||
      vendorId.includes(kw) ||
      vendor.includes(kw) ||
      productId.includes(kw) ||
      nodeName.includes(kw) ||
      addr.includes(kw) ||
      devicePath.includes(kw) ||
      state.includes(kw)
    );
  });
}

export function usbDeviceRowKey(r: unknown): string {
  const row = r as UsbDeviceRow;
  return String(row?.resourceName || `${row?.vendorId || ''}:${row?.productId || ''}:${row?.name || ''}`);
}
