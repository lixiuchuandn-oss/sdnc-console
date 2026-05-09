/** 磁盘扩容候选；`isSystemDisk` 用于 UI（如仅系统盘展示扩容指南）。与 `systemDisk` 解析规则对齐 */
export type ExpandDiskCandidate = {
  pvcName: string;
  diskName: string;
  label: string;
  /** 根盘/系统盘 PVC；非系统盘不展示「系统盘扩容指南」 */
  isSystemDisk: boolean;
};

export function buildExpandDiskCandidates(activeRecord: any, record: any): ExpandDiskCandidate[] {
  const disks = activeRecord?.spec?.template?.spec?.domain?.devices?.disks || [];
  const volumes = activeRecord?.spec?.template?.spec?.volumes || [];

  let bootDisk = disks.find((d: any) => d.bootOrder === 1 && !d.cdrom);
  if (!bootDisk) bootDisk = disks.find((d: any) => d.name === 'disk-0' && !d.cdrom);
  if (!bootDisk) bootDisk = disks.find((d: any) => d.name === 'rootdisk' && !d.cdrom);
  if (!bootDisk && disks.length > 0) bootDisk = disks.find((d: any) => !d.cdrom);

  let sysPvc = '';
  if (bootDisk) {
    const volume = volumes.find((v: any) => v.name === bootDisk.name);
    if (volume?.persistentVolumeClaim?.claimName) {
      sysPvc = String(volume.persistentVolumeClaim.claimName).trim();
    }
  }
  if (!sysPvc) sysPvc = String(record?.volumeClaims?.[0] || '').trim();

  if (!sysPvc) return [];
  return [
    {
      pvcName: sysPvc,
      diskName: String(bootDisk?.name || 'disk-0'),
      label: `系统盘（${sysPvc}）`,
      isSystemDisk: true,
    },
  ];
}
