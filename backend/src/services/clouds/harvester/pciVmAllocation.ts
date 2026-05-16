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

/** 与集群 PCI 列表「绑定到」展示一致：PCIDevice CR metadata.name → 占用中的 VM（别名优先） */
export type PciDeviceBoundVm = {
  vmName: string;
  vmNamespace: string;
  vmDisplayName: string;
};

/**
 * 各 PCIDevice CR 名 → 当前占用的虚拟机信息。
 * 占用判定与 collectAllocatedPciDeviceCrNamesFromVm 同源（hostDevices 非 GPU/USB + deviceAllocationDetails）。
 */
export function buildPciDeviceVmUsageMapFromVms(vms: any[]): Map<string, PciDeviceBoundVm> {
  const map = new Map<string, PciDeviceBoundVm>();
  for (const vm of vms || []) {
    const vmName = String(vm?.metadata?.name || '').trim();
    const vmNamespace = String(vm?.metadata?.namespace || '').trim();
    if (!vmName || !vmNamespace) continue;
    const alias = String(vm?.metadata?.annotations?.['tower.io/alias'] || '').trim();
    const vmDisplayName = alias || vmName;
    const names = new Set<string>();
    collectAllocatedPciDeviceCrNamesFromVm(vm, names);
    for (const cr of names) {
      const key = String(cr || '').trim();
      if (key) map.set(key, { vmName, vmNamespace, vmDisplayName });
    }
  }
  return map;
}

/** Claim 的 ownerReferences 指向 VirtualMachine 时，从 VM 列表解析别名等信息 */
export function tryResolveVmFromPciDeviceClaim(claim: any, vms: any[]): PciDeviceBoundVm | undefined {
  if (!claim || !Array.isArray(vms)) return undefined;
  const owners = Array.isArray(claim?.metadata?.ownerReferences) ? claim.metadata.ownerReferences : [];
  const claimNs = String(claim?.metadata?.namespace || '').trim();
  for (const o of owners) {
    const kind = String(o?.kind || '').toLowerCase();
    if (kind !== 'virtualmachine' && kind !== 'vm') continue;
    const on = String(o?.name || '').trim();
    if (!on) continue;
    const vm =
      (claimNs
        ? vms.find((v: any) => {
            const vn = String(v?.metadata?.name || '').trim();
            const vns = String(v?.metadata?.namespace || '').trim();
            return vn === on && vns === claimNs;
          })
        : undefined) || vms.find((v: any) => String(v?.metadata?.name || '').trim() === on);
    if (!vm) continue;
    const vmName = String(vm?.metadata?.name || '').trim();
    const vmNamespace = String(vm?.metadata?.namespace || '').trim();
    if (!vmName || !vmNamespace) continue;
    const alias = String(vm?.metadata?.annotations?.['tower.io/alias'] || '').trim();
    return { vmName, vmNamespace, vmDisplayName: alias || vmName };
  }
  return undefined;
}
