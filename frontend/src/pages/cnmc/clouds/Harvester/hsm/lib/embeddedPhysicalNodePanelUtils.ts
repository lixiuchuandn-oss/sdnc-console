/**
 * 机架内嵌物理节点前面板：磁盘/网口槽位纯函数（无 React 依赖）。
 */
import { isHmsNbdOrRbdDiskEntry } from '../../cluster/lib/physicalNodeDetail/hmsDiskList';
import type { PortStatusKind } from '../../cluster/lib/parseAswCtlInterfaceStdout';

const NON_PHYSICAL_DISK_TYPES = new Set([
  'part',
  'partition',
  'lvm',
  'crypt',
  'loop',
  'rom',
  'dm',
  'md',
  'mdmember',
  'mpath',
]);

/** 超过 `maxChars` 时截为 `maxChars-1` 字符 +「…」 */
export function ellip(maxChars: number, text: string): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1)}…`;
}

export function isPhysicalRootDisk(d: any): boolean {
  if (!d || typeof d !== 'object') return false;
  const t = String(d.type ?? d.Type ?? '')
    .toLowerCase()
    .trim();
  return !t || !NON_PHYSICAL_DISK_TYPES.has(t);
}

export function isHmsVirtualDiskEntry(d: any): boolean {
  const model = String(d?.model ?? d?.Model ?? '').trim();
  const modelLower = model.toLowerCase();

  // HMS 物理扫描：前面板只展示带型号的物理硬盘；无型号视为虚拟化/非物理盘
  if (!model) return true;

  if (
    modelLower.includes('virtual-disk') ||
    modelLower.includes('virtual disk') ||
    modelLower.includes('virtio') ||
    modelLower.includes('qemu') ||
    (modelLower.includes('vmware') && modelLower.includes('virtual'))
  ) {
    return true;
  }
  const name = String(d?.name ?? d?.Name ?? '')
    .trim()
    .toLowerCase();
  return /^vd[a-z]+$/.test(name);
}

export function physicalHardDisksOnly(hardware: any): any[] {
  const list = hardware && Array.isArray(hardware.disk) ? hardware.disk : [];
  return list.filter(
    (d: any) => isPhysicalRootDisk(d) && !isHmsVirtualDiskEntry(d) && !isHmsNbdOrRbdDiskEntry(d),
  );
}

export function nicStateToPortKind(n: any): PortStatusKind {
  if (n?.placeholder) return 'unknown';
  const s = String(n?.state || '').toLowerCase();
  if (s === 'up') return 'up';
  if (s === 'down') return 'down';
  if (s.includes('admin')) return 'admin';
  return 'unknown';
}

/** 前面板类型角标（TYPE=disk 不能单独判 HDD，见 lsblk/HMS 约定） */
export function diskTypeChip(d: any): string {
  const name = String(d?.name ?? d?.Name ?? '')
    .trim()
    .toLowerCase();
  const model = String(d?.model ?? d?.Model ?? '')
    .trim()
    .toLowerCase();
  const typ = String(d?.type ?? d?.Type ?? '')
    .trim()
    .toLowerCase();

  if (name.startsWith('nvme')) return 'SSD';

  const rota = d?.rota ?? d?.rotational ?? d?.Rota ?? d?.ROTATIONAL;
  if (rota === 0 || rota === '0' || rota === false) return 'SSD';
  if (rota === 1 || rota === '1' || rota === true) return 'HDD';

  const tran = String(d?.tran ?? d?.Tran ?? d?.transport ?? '')
    .trim()
    .toLowerCase();
  if (tran === 'nvme') return 'SSD';

  if (
    model.includes('ssd') ||
    model.includes('nvme') ||
    model.includes('nvm express') ||
    model.includes('solid state') ||
    model.includes('solid-state')
  ) {
    return 'SSD';
  }
  if (model.includes('hdd') || model.includes('hard disk') || /\b\d{4,5}\s*rpm\b/.test(model)) {
    return 'HDD';
  }

  if (typ.includes('ssd') || typ.includes('nvme')) return 'SSD';
  if (typ.includes('hdd') || typ === 'rot' || typ === 'rom') return 'HDD';

  return 'DISK';
}

export function diskCapacityDisplay(d: any): string {
  return String(d?.size ?? d?.Size ?? '').trim();
}
