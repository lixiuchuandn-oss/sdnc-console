import { fetchHarvesterVolume } from '../../../../../../../../../services/harvesterApi';
import { parseSizeToGi } from '../../../VmCreateWizard/VmWizardUtils';
import { getVmRootImageIdFromVm } from '../../../../lib/vmImageStatus';
import { resolveVmImageKind } from '../../../../../../../../../utils/harvesterUtils';
import { storageQuantityToGiB } from '../../lib/vmReconfigureQuantity';
import type { VmReconfigureMenuInitCtx } from '../vmReconfigureMenuInitContext';

export function initChangeOsMenu(ctx: VmReconfigureMenuInitCtx): void {
  const { form, activeRecord, record, images, scs, systemDisk, cloudId, reloadImages, reloadScs } = ctx;
  if (!images || images.length === 0) reloadImages();
  if (!scs || scs.length === 0) reloadScs();
  const r = activeRecord || record;
  const disks = r?.spec?.template?.spec?.domain?.devices?.disks || [];
  let bootDisk = disks.find((d: any) => d.bootOrder === 1 && !d.cdrom);
  if (!bootDisk) bootDisk = disks.find((d: any) => d.name === 'disk-0' && !d.cdrom);
  if (!bootDisk) bootDisk = disks.find((d: any) => d.name === 'rootdisk' && !d.cdrom);
  if (!bootDisk && disks.length > 0) bootDisk = disks.find((d: any) => !d.cdrom);

  let rootDeviceType: string = 'disk';
  let newOsBus = 'virtio';
  if (bootDisk) {
    if (bootDisk.cdrom) {
      rootDeviceType = 'cdrom';
      newOsBus = String(bootDisk.cdrom?.bus || 'sata').toLowerCase();
    } else if (bootDisk.disk) {
      rootDeviceType = 'disk';
      newOsBus = String(bootDisk.disk?.bus || 'virtio').toLowerCase();
    }
  }
  if (!['virtio', 'scsi', 'sata', 'ide'].includes(newOsBus)) {
    newOsBus = 'virtio';
  }

  const patch: Record<string, unknown> = {
    rootSourceType: 'image',
    rootDeviceType,
    newOsBus,
  };

  form.setFieldsValue(patch);
}
