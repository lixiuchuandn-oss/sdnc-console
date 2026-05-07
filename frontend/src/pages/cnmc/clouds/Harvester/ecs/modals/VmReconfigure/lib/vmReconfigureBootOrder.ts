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

  // 清除所有非光盘磁盘的 bootOrder，只保留光盘的启动顺序
  for (const d of disks) {
    if (!d || d.name === vol || d.cdrom || isAuxiliaryVmDisk(d)) continue;
    delete d.bootOrder;
  }

  // 设置光盘为第一个启动设备
  const cd = disks.find((d: any) => d?.name === vol);
  if (cd) cd.bootOrder = 1;

  // 将 cdrom 磁盘移到数组最前面，确保 QEMU/KVM 正确识别启动顺序
  const cdIndex = disks.findIndex((d: any) => d?.name === vol);
  if (cdIndex !== -1 && cdIndex !== 0) {
    const [cdDisk] = disks.splice(cdIndex, 1);
    disks.unshift(cdDisk);
  }
}
