import { fetchHarvesterVolume } from '../../../../../../../../services/harvesterApi';
import { parseSizeToGi } from '../../../modals/VmCreateWizard/VmWizardUtils';
import { getVmRootImageIdFromVm } from '../../../lib/vmImageStatus';
import { resolveVmBootDiskDevice } from '../../../lib/vmChangeSystemDiskEligibility';
import {
  isHarvesterVmImageReady,
  resolveVmImageKind,
} from '../../../../../../../../utils/harvesterUtils';
import { storageQuantityToGiB } from '../../../lib/vmMutation/vmReconfigureQuantity';
import type { VmReconfigureMenuInitCtx } from '../../../lib/vmMutation/vmReconfigureMenuInitContext';

/** 与 ChangeOs 下拉一致：磁盘类、已就绪、排除 ISO / unknown */
function pickFirstEligibleChangeOsImage(images: any[]): any | null {
  const list = (images || []).filter((x: any) => {
    const k = resolveVmImageKind(x);
    return k !== 'unknown' && k !== 'iso' && isHarvesterVmImageReady(x);
  });
  return list[0] || null;
}

function changeOsImageSelectValue(x: any): string {
  const name = x?.metadata?.name || x?.name;
  const ns = x?.metadata?.namespace || x?.namespace;
  return ns && name ? `${ns}/${name}` : String(name || '');
}

function applyChangeOsImageHitToPatch(hit: any, r: any, patch: Record<string, unknown>): void {
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
    const ann = (hit as any)?.metadata?.annotations || {};
    const labels = (hit as any)?.metadata?.labels || {};
    const dispName = String(
      (hit as any)?.spec?.displayName ||
        labels['harvesterhci.io/imageDisplayName'] ||
        ann['harvesterhci.io/image-name'] ||
        ann['field.cattle.io/displayName'] ||
        '',
    ).toLowerCase();
    const isWindows = /windows|win/.test(dispName);
    patch.newOsBus = isWindows ? 'sata' : 'virtio';
  }
}

export function initChangeOsMenu(ctx: VmReconfigureMenuInitCtx): void {
  const { form, activeRecord, record, images, scs, systemDisk, cloudId, reloadImages, reloadScs } = ctx;
  if (!images || images.length === 0) void reloadImages?.();
  if (!scs || scs.length === 0) void reloadScs?.();
  const r = activeRecord || record;
  const bootDisk = resolveVmBootDiskDevice(r);

  let rootDeviceType: string = 'disk';
  let newOsBus = 'virtio';
  if (bootDisk?.disk) {
    rootDeviceType = 'disk';
    newOsBus = String(bootDisk.disk?.bus || 'virtio').toLowerCase();
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

  const firstEligible = pickFirstEligibleChangeOsImage(images ?? []);
  if (firstEligible) {
    patch.newOsImage = changeOsImageSelectValue(firstEligible);
    applyChangeOsImageHitToPatch(firstEligible, r, patch);
  } else if (imgId) {
    patch.newOsImage = imgId;
    const hit = (images || []).find((x: any) => {
      const name = x?.metadata?.name || x?.name;
      const ns = x?.metadata?.namespace || x?.namespace;
      const v = ns && name ? `${ns}/${name}` : name;
      return v === imgId;
    });
    if (hit) applyChangeOsImageHitToPatch(hit, r, patch);
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
          if (gi > 0) {
            const fromForm = Number(form.getFieldValue('newOsRootSize'));
            if (!Number.isFinite(fromForm) || fromForm <= 0) {
              pvcPatch.newOsRootSize = gi;
            }
          }
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
