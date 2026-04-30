export function isAuxiliaryVmDisk(d: any): boolean {
  const n = String(d?.name || '').toLowerCase();
  return n === 'cloudinitdisk' || n === 'containerdisk';
}

/**
 * 将指定光驱设为 `bootOrder: 1`。
 * - 多块盘且已有启动序号时：凡非光驱、非辅助盘且 `bootOrder >= 1` 的一律 **+1**，整体后移，再插入光驱为 1。
 * - 仍无 `bootOrder` 的块盘：若其它盘已有序号，则按当前最大序号顺延补上。
 * - 若原先没有任何块盘带序号：按 `disk-0` / `rootdisk` / 首块数据盘给系统盘 `2`，其余块盘依次 `3、4…`。
 */
export function applyBootOrderCdromFirst(disks: any[], cdromVolumeName: string) {
  const vol = String(cdromVolumeName || '').trim();
  if (!vol) return;

  let hadAnyBootOrder = false;
  for (const d of disks) {
    if (!d || d.name === vol || d.cdrom || isAuxiliaryVmDisk(d)) continue;
    const o = Number(d.bootOrder);
    if (Number.isFinite(o) && o >= 1) {
      hadAnyBootOrder = true;
      break;
    }
  }

  for (const d of disks) {
    if (!d || d.name === vol || d.cdrom || isAuxiliaryVmDisk(d)) continue;
    const o = Number(d.bootOrder);
    if (Number.isFinite(o) && o >= 1) {
      d.bootOrder = o + 1;
    }
  }

  const cd = disks.find((d: any) => d?.name === vol);
  if (cd) cd.bootOrder = 1;

  if (hadAnyBootOrder) {
    let maxOrder = 1;
    for (const d of disks) {
      if (!d || d.name === vol || d.cdrom || isAuxiliaryVmDisk(d)) continue;
      const o = Number(d.bootOrder);
      if (Number.isFinite(o)) maxOrder = Math.max(maxOrder, o);
    }
    for (const d of disks) {
      if (!d || d.name === vol || d.cdrom || isAuxiliaryVmDisk(d)) continue;
      const o = Number(d.bootOrder);
      if (!Number.isFinite(o) || o < 1) {
        maxOrder += 1;
        d.bootOrder = maxOrder;
      }
    }
    return;
  }

  const blockDisks = disks.filter((d: any) => d && !d.cdrom && d.name !== vol && !isAuxiliaryVmDisk(d));
  const primary =
    blockDisks.find((d: any) => d.name === 'disk-0') ||
    blockDisks.find((d: any) => d.name === 'rootdisk') ||
    blockDisks[0];
  if (primary) {
    primary.bootOrder = 2;
  }
  let next = 3;
  for (const d of blockDisks) {
    if (d === primary) continue;
    const po = Number(d.bootOrder);
    if (!Number.isFinite(po) || po < 1) {
      d.bootOrder = next;
      next += 1;
    }
  }
}
