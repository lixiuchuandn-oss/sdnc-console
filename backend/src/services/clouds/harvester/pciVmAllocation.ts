/**
 * 从 KubeVirt VM 规格中收集「已占用」的 PCIDevice CR 名（用于网卡直通下拉过滤）。
 * 排除 GPU / USB 类 hostDevices，与 vm_update 中 hostDevices 拆分逻辑一致。
 */

export function isHarvesterUsbHostDevice(d: any): boolean {
  const dn = String(d?.deviceName || '').toLowerCase();
  const n = String(d?.name || '').toLowerCase();
  return n.startsWith('usb') || dn.includes('usb');
}

export function isHarvesterGpuLikeHostDevice(d: any): boolean {
  if (isHarvesterUsbHostDevice(d)) return false;
  const dn = String(d?.deviceName || '').toLowerCase();
  const n = String(d?.name || '').toLowerCase();
  if (n.startsWith('gpu')) return true;
  if (dn.startsWith('nvidia.com/')) return true;
  return false;
}

function pushCrName(out: Set<string>, s: unknown) {
  const t = String(s ?? '').trim();
  if (t) out.add(t);
}

/** 单台 VM 已声明占用的 PCIDevice CR 名（hostDevices + deviceAllocationDetails.hostdevices） */
export function collectAllocatedPciDeviceCrNamesFromVm(vm: any, into: Set<string>) {
  try {
    const raw = vm?.metadata?.annotations?.['harvesterhci.io/deviceAllocationDetails'];
    if (raw) {
      const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const hd = p?.hostdevices;
      if (hd && typeof hd === 'object') {
        for (const v of Object.values(hd)) {
          if (Array.isArray(v)) (v as unknown[]).forEach((x) => pushCrName(into, x));
        }
      }
    }
  } catch {
    /* ignore */
  }
  const hostDevices = vm?.spec?.template?.spec?.domain?.devices?.hostDevices;
  if (!Array.isArray(hostDevices)) return;
  for (const h of hostDevices) {
    if (isHarvesterGpuLikeHostDevice(h) || isHarvesterUsbHostDevice(h)) continue;
    pushCrName(into, h?.name);
  }
}

export function collectAllocatedPciDeviceCrNamesFromVms(vms: any[]): Set<string> {
  const out = new Set<string>();
  for (const vm of vms || []) collectAllocatedPciDeviceCrNamesFromVm(vm, out);
  return out;
}
