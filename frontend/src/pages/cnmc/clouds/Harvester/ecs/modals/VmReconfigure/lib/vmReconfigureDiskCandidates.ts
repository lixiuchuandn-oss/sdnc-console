/** 磁盘扩容：仅系统盘 PVC（光盘不纳入扩容）。与 `systemDisk` 解析规则对齐 */
export type ExpandDiskCandidate = {
  pvcName: string;
  diskName: string;
  label: string;
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
    },
  ];
}
