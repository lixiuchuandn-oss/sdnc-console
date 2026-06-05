import { deleteHarvesterPVC } from '../../../../services/clouds/harvester/storage';
import { HarvesterTestParams } from '../../../../services/clouds/harvester/types';
import {
  deleteHarvesterDataVolumeIfExists,
  resolvePvcClaimNameFromDataVolume,
} from '../../../../services/clouds/harvester/vm_update/reinstall.helpers';

/** Ceph/CDI 镜像上传：从 VMImage 详情与镜像名收集可能残留的 DataVolume 名 */
export function collectVmImageCdiDataVolumeNames(
  detail: unknown,
  imageName: string,
): string[] {
  const names = new Set<string>();
  const img = String(imageName || '').trim();
  if (img) names.add(img);
  if (detail && typeof detail === 'object') {
    const d = detail as {
      metadata?: { name?: string };
      spec?: { pvcName?: string };
    };
    const metaName = String(d.metadata?.name || '').trim();
    if (metaName) names.add(metaName);
    const pvcName = String(d.spec?.pvcName || '').trim();
    if (pvcName) names.add(pvcName);
  }
  return Array.from(names);
}

function collectOrphanPvcClaimNames(
  detail: unknown,
  dataVolumeNames: string[],
  resolvedFromDv: string[],
): string[] {
  const claims = new Set<string>();
  if (detail && typeof detail === 'object') {
    const pvc = String((detail as { spec?: { pvcName?: string } }).spec?.pvcName || '').trim();
    if (pvc) claims.add(pvc);
  }
  for (const name of [...dataVolumeNames, ...resolvedFromDv]) {
    const n = String(name || '').trim();
    if (n) claims.add(n);
  }
  return Array.from(claims);
}

/** 删除 Ceph/CDI 镜像上传残留的 DataVolume 与关联 PVC（不删 VirtualMachineImage） */
export async function deleteVmImageCdiStorageOrphans(
  params: HarvesterTestParams,
  origin: string,
  namespace: string,
  imageName: string,
  detail?: unknown,
): Promise<void> {
  const ns = String(namespace || '').trim();
  const imgName = String(imageName || '').trim();
  if (!ns || !imgName) return;

  const dvNames = collectVmImageCdiDataVolumeNames(detail, imgName);
  if (!dvNames.length) return;

  const resolvedClaims: string[] = [];
  for (const dv of dvNames) {
    const claim = await resolvePvcClaimNameFromDataVolume(params, ns, dv, origin);
    if (claim) resolvedClaims.push(claim);
  }

  for (const dv of dvNames) {
    try {
      await deleteHarvesterDataVolumeIfExists(params, ns, dv, origin);
      console.log('[image-upload-task] deleted DataVolume before retry', ns, dv);
    } catch (e: any) {
      console.warn(
        '[image-upload-task] delete DataVolume before retry failed',
        ns,
        dv,
        e?.message || e,
      );
    }
  }

  const pvcClaims = collectOrphanPvcClaimNames(detail, dvNames, resolvedClaims);
  for (const claim of pvcClaims) {
    try {
      await deleteHarvesterPVC(params, ns, claim);
      console.log('[image-upload-task] deleted orphaned PVC before retry', ns, claim);
    } catch (e: any) {
      const st = Number(e?.status || 0);
      const msg = String(e?.message || e || '').toLowerCase();
      if (st !== 404 && !msg.includes('not found')) {
        console.warn(
          '[image-upload-task] delete PVC before retry failed',
          ns,
          claim,
          e?.message || e,
        );
      }
    }
  }
}
