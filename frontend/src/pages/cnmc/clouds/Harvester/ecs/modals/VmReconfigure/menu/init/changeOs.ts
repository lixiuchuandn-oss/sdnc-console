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

  const imgId = getVmRootImageIdFromVm(r);
  const patch: Record<string, unknown> = {
    rootSourceType: 'image',
    rootDeviceType,
    newOsBus,
  };
  if (imgId) {
    patch.newOsImage = imgId;
    const hit = (images || []).find((x: any) => {
      const name = x?.metadata?.name || x?.name;
      const ns = x?.metadata?.namespace || x?.namespace;
      const v = ns && name ? `${ns}/${name}` : name;
      return v === imgId;
    });
    if (hit) {
      const sc =
        (hit as any)?.storageClassName ||
        (hit as any)?.spec?.storageClassName ||
        (hit as any)?.status?.storageClassName;
      if (sc) patch.storageClassName = sc;
      const raw = (hit as any)?.spec?.virtualSize ?? (hit as any)?.virtualSize ?? (hit as any)?.size;
      const gi = parseSizeToGi(raw);
      if (gi > 0) patch.newOsRootSize = gi;
      const kind = resolveVmImageKind(hit);
      if (kind === 'iso') {
        patch.rootDeviceType = 'cdrom';
        const arch = String(r?.spec?.template?.spec?.architecture || r?.spec?.architecture || '').toLowerCase();
        const arm = arch.includes('arm64') || arch.includes('aarch');
        patch.newOsBus = arm ? 'scsi' : 'sata';
      } else if (kind === 'disk') {
        patch.rootDeviceType = 'disk';
      }
    }
  }

  form.setFieldsValue(patch);

  if (systemDisk && cloudId && record?.metadata?.namespace) {
    void (async () => {
      try {
        const res = await fetchHarvesterVolume(cloudId, record.metadata.namespace, systemDisk);
        const data = (res as any)?.data || res;
        const cap = data?.spec?.resources?.requests?.storage || data?.status?.capacity?.storage;
        const scFromPvc = data?.spec?.storageClassName;
        const pvcPatch: Record<string, unknown> = {};
        if (cap) {
          const gi = storageQuantityToGiB(cap);
          if (gi > 0) pvcPatch.newOsRootSize = gi;
        }
        if (scFromPvc) pvcPatch.storageClassName = scFromPvc;
        if (Object.keys(pvcPatch).length > 0) {
          form.setFieldsValue(pvcPatch);
        }
      } catch {
        /* PVC 回填失败不影响镜像注解路径 */
      }
    })();
  }
}
