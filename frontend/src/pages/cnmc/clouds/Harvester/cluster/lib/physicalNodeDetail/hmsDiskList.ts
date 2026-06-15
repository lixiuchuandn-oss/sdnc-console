/** HMS lsblk 磁盘：过滤 Ceph/虚拟块设备（NBD、RBD），仅用于展示列表。 */

const HMS_NBD_RBD_DEVICE_NAME = /^(?:nbd\d+|rbd\d+)$/i;

export function hmsDiskDeviceBasename(name: string): string {
  const trimmed = String(name || '').trim();
  if (!trimmed) return '';
  const stripped = trimmed.replace(/^\/dev\//, '');
  const parts = stripped.split('/').filter(Boolean);
  return parts[parts.length - 1] || stripped;
}

export function isHmsNbdOrRbdDiskEntry(d: unknown): boolean {
  if (!d || typeof d !== 'object') return false;
  const rec = d as { name?: string; Name?: string; type?: string; Type?: string };
  const base = hmsDiskDeviceBasename(String(rec.name ?? rec.Name ?? ''));
  if (base && HMS_NBD_RBD_DEVICE_NAME.test(base)) return true;
  const typ = String(rec.type ?? rec.Type ?? '')
    .toLowerCase()
    .trim();
  return typ === 'nbd' || typ === 'rbd';
}

/** 顶层与子项 children 均剔除 NBD/RBD 设备行 */
export function filterHmsDisksForDisplay(list: unknown[]): unknown[] {
  return list
    .filter((d) => !isHmsNbdOrRbdDiskEntry(d))
    .map((d) => {
      if (!d || typeof d !== 'object') return d;
      const children = (d as { children?: unknown[] }).children;
      if (!Array.isArray(children) || !children.length) return d;
      const filtered = filterHmsDisksForDisplay(children);
      if (filtered.length === children.length) return d;
      return { ...(d as object), children: filtered };
    });
}
