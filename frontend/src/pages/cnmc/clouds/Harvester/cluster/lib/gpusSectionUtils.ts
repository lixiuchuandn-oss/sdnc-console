/** GPU 设备列表 Section 纯函数（Harvester cluster） */

import type { GpuDeviceState, GpuRow } from 'services/harvester/types/inventoryRows';

const GPU_VENDOR_NAMES: Record<string, string> = {
  '10de': 'NVIDIA',
  '1002': 'AMD',
  '8086': 'Intel',
  '1a03': 'ASPEED',
};

export function gpuVendorName(id?: string): string {
  const v = String(id || '').trim().toLowerCase();
  if (!v) return '-';
  return GPU_VENDOR_NAMES[v] || v;
}

export function getGpuNodeName(r: GpuRow): string {
  return String(
    r?.node ||
      (r?.status as { nodeName?: string } | undefined)?.nodeName ||
      (r?.spec as { nodeName?: string } | undefined)?.nodeName ||
      (r?.raw as { status?: { nodeName?: string } } | undefined)?.status?.nodeName ||
      '',
  ).trim();
}

export function getGpuDeviceState(r: GpuRow): GpuDeviceState {
  const s =
    r?.state ||
    r?.metadata?.state ||
    (r?.status as { state?: GpuDeviceState } | undefined)?.state ||
    (r?.raw as { metadata?: { state?: GpuDeviceState } } | undefined)?.metadata?.state ||
    {};
  return typeof s === 'object' && s ? s : {};
}

export function deriveGpuType(x: GpuRow): string {
  const t = String(x?.type || '').toLowerCase();
  if (t) return t;
  const kind = String(x?.kind || '').toLowerCase();
  if (kind === 'pcidevice') return 'passthrough';
  const hasMdev = !!(x?.mdevName || (x?.raw as { mdevName?: string } | undefined)?.mdevName);
  if (hasMdev) return 'vgpu';
  return '';
}

export function gpuPciAddress(r: GpuRow): string {
  const fieldsArr = r?.metadata?.fields || r?.fields;
  const fieldsAddr = Array.isArray(fieldsArr) && fieldsArr.length > 1 ? String(fieldsArr[1]) : '';
  return String(
    r?.pciAddress ||
      (r?.status as { pciAddress?: string; address?: string } | undefined)?.pciAddress ||
      (r?.status as { address?: string } | undefined)?.address ||
      (r?.spec as { pciAddress?: string } | undefined)?.pciAddress ||
      r?.address ||
      (r?.raw as { status?: { address?: string } } | undefined)?.status?.address ||
      fieldsAddr ||
      '',
  ).trim();
}

export type GpusFilterState = {
  typeFilter: string;
  nodeFilter: string;
  statusFilter: string;
  bindFilter: string;
  keyword: string;
};

export function filterGpuDevices(rows: readonly GpuRow[], f: GpusFilterState): GpuRow[] {
  const arr = Array.isArray(rows) ? rows : [];
  const byType = !f.typeFilter ? arr : arr.filter((x) => String(x?.type) === f.typeFilter);
  const byNode = byType.filter((r) => {
    if (!f.nodeFilter) return true;
    return getGpuNodeName(r).toLowerCase() === String(f.nodeFilter).toLowerCase();
  });
  const byStatus = byNode.filter((r) => {
    if (!f.statusFilter) return true;
    const s = getGpuDeviceState(r);
    const name = String(s?.name || '').toLowerCase();
    const error = !!s?.error;
    const transitioning = !!s?.transitioning;
    if (f.statusFilter === 'active') return name === 'active' && !error && !transitioning;
    if (f.statusFilter === 'inactive') return name === 'inactive';
    if (f.statusFilter === 'error') return error || name === 'error';
    if (f.statusFilter === 'transitioning') return transitioning;
    return true;
  });
  const byBind = byStatus.filter((r) => {
    if (!f.bindFilter) return true;
    if (f.bindFilter === 'bound') return !!r?.claimed;
    if (f.bindFilter === 'unbound') return !r?.claimed;
    return true;
  });
  const kw = String(f.keyword || '').trim().toLowerCase();
  if (!kw) return byBind;
  return byBind.filter((r) => {
    const rid = String(r?.resourceName || (r?.status as { resourceName?: string } | undefined)?.resourceName || '').toLowerCase();
    const nm = String(
      r?.name ||
        (r?.status as { deviceName?: string } | undefined)?.deviceName ||
        (r?.raw as { status?: { deviceName?: string } } | undefined)?.status?.deviceName ||
        '',
    ).toLowerCase();
    const node = getGpuNodeName(r).toLowerCase();
    const desc = String(
      (r?.raw as { status?: { description?: string } } | undefined)?.status?.description ||
        (r?.status as { description?: string } | undefined)?.description ||
        '',
    ).toLowerCase();
    const bindTo = String(r?.bindingTo || '').toLowerCase();
    const claimName = String(r?.claimName || '').toLowerCase();
    const claimedBy = String(r?.claimedBy || '').toLowerCase();
    const addr = gpuPciAddress(r).toLowerCase();
    const vendorId = String(
      (r?.raw as { status?: { vendorId?: string } } | undefined)?.status?.vendorId ||
        (r?.status as { vendorId?: string } | undefined)?.vendorId ||
        '',
    ).toLowerCase();
    return (
      rid.includes(kw) ||
      nm.includes(kw) ||
      node.includes(kw) ||
      addr.includes(kw) ||
      desc.includes(kw) ||
      vendorId.includes(kw) ||
      bindTo.includes(kw) ||
      claimName.includes(kw) ||
      claimedBy.includes(kw)
    );
  });
}

export function gpuDeviceRowKey(r: GpuRow): string {
  const rid = String(
    r?.resourceName ||
      (r?.status as { resourceName?: string } | undefined)?.resourceName ||
      (r?.spec as { resourceName?: string } | undefined)?.resourceName ||
      r?.metadata?.name ||
      '',
  );
  const addr = gpuPciAddress(r);
  const node = getGpuNodeName(r);
  return `${rid}-${addr}-${node}`;
}

export function buildGpuNodeFilterOptions(rows: readonly GpuRow[]): string[] {
  return Array.from(new Set(rows.map((r) => getGpuNodeName(r)).filter(Boolean))).sort();
}
