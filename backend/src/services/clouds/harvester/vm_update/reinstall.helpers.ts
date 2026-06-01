import { HarvesterTestParams } from '../types';
import { getJsonOnce, requestJson } from '../utils';
import { deleteHarvesterPVC } from '../storage';

/**
 * 与前端 `vmChangeSystemDiskEligibility.resolveVmBootDiskDevice` 一致：
 * 根盘须为 block disk；存在 bootOrder=1 时不得误选光驱；禁止用 `disks[0]` 误把光驱当系统盘。
 */
export function resolveReinstallRootBootDisk(disks: any[]): any | null {
  if (!Array.isArray(disks)) return null;
  const bootFirst = disks.find((d: any) => Number(d?.bootOrder) === 1);
  if (bootFirst) {
    if (bootFirst.cdrom) return null;
    if (bootFirst.disk) return bootFirst;
    return null;
  }
  let bootDisk = disks.find((d: any) => d?.name === 'disk-0' && !d.cdrom);
  if (!bootDisk) bootDisk = disks.find((d: any) => d?.name === 'rootdisk' && !d.cdrom);
  if (!bootDisk) bootDisk = disks.find((d: any) => !d.cdrom && d.disk);
  return bootDisk || null;
}

/** DataVolume 名 → 实际 PVC claimName（CDI status.claimName） */
export async function resolvePvcClaimNameFromDataVolume(
  params: HarvesterTestParams,
  namespace: string,
  dvName: string,
  origin: string,
): Promise<string | null> {
  const { token, insecure = false } = params;
  const candidates = [
    `${origin}/apis/cdi.kubevirt.io/v1beta1/namespaces/${encodeURIComponent(namespace)}/datavolumes/${encodeURIComponent(dvName)}`,
    `${origin}/apis/cdi.kubevirt.io/v1/namespaces/${encodeURIComponent(namespace)}/datavolumes/${encodeURIComponent(dvName)}`,
  ];
  for (const url of candidates) {
    try {
      const dv = await getJsonOnce(url, token, insecure);
      const claim =
        dv?.status?.claimName ||
        dv?.status?.persistentVolumeClaim?.claimName ||
        dv?.status?.claim?.name;
      const s = String(claim || '').trim();
      if (s) return s;
    } catch {
      /* try next API version */
    }
  }
  return null;
}

/** 更换系统盘后等待 VMI 释放旧盘的最长时长（用户可能稍后才重启） */
const REINSTALL_OLD_CLAIM_WAIT_MS = 30 * 60 * 1000;
const REINSTALL_OLD_CLAIM_POLL_MS = 3000;
/** 释放后若仍删除失败，继续重试删除的总时长 */
const REINSTALL_OLD_CLAIM_DELETE_RETRY_MS = 30 * 60 * 1000;

export async function isClaimReferencedByVmi(
  params: HarvesterTestParams,
  namespace: string,
  vmName: string,
  claimName: string,
  origin: string,
): Promise<boolean> {
  const { token, insecure = false } = params;
  const url = `${origin}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachineinstances/${encodeURIComponent(vmName)}`;
  try {
    const vmi = await getJsonOnce(url, token, insecure);
    const vols: any[] = vmi?.spec?.volumes || [];
    return vols.some(
      (v: any) => String(v?.persistentVolumeClaim?.claimName || '').trim() === claimName,
    );
  } catch (e: any) {
    const st = Number(e?.status || 0);
    const msg = String(e?.message || e || '').toLowerCase();
    if (st === 404 || msg.includes('not found')) return false;
    console.warn(
      `[Reinstall] Failed to read VMI while checking claim ${claimName}, assume not mounted:`,
      e?.message || e,
    );
    return false;
  }
}

/** 从 volumes 列表收集 PVC claimName（不含 DataVolume 名） */
export function collectPvcClaimNamesFromVolumes(volumes: any[]): string[] {
  const out: string[] = [];
  for (const v of volumes || []) {
    const claim = String(v?.persistentVolumeClaim?.claimName || '').trim();
    if (claim && !out.includes(claim)) out.push(claim);
  }
  return out;
}

/** 更换系统盘后须等 VMI 不再挂载旧盘（通常需用户按提示重启 VM） */
export async function waitForOldRootClaimsReleasedFromVmi(
  params: HarvesterTestParams,
  namespace: string,
  vmName: string,
  claimNames: string[],
  origin: string,
): Promise<boolean> {
  const unique = Array.from(new Set(claimNames.map((n) => String(n).trim()).filter(Boolean)));
  if (!unique.length) return true;

  const start = Date.now();
  while (Date.now() - start < REINSTALL_OLD_CLAIM_WAIT_MS) {
    const checks = await Promise.all(
      unique.map((c) => isClaimReferencedByVmi(params, namespace, vmName, c, origin)),
    );
    if (!checks.some(Boolean)) {
      console.log(`[Reinstall] Old root claims released from VMI: ${unique.join(', ')}`);
      return true;
    }
    await new Promise((r) => setTimeout(r, REINSTALL_OLD_CLAIM_POLL_MS));
  }
  console.warn(
    `[Reinstall] Timed out waiting for VMI to release old root claims (restart VM may be required): ${unique.join(', ')}`,
  );
  return false;
}

export async function deleteHarvesterDataVolumeIfExists(
  params: HarvesterTestParams,
  namespace: string,
  name: string,
  origin: string,
): Promise<void> {
  const { token, insecure = false } = params;
  const urls = [
    `${origin}/apis/cdi.kubevirt.io/v1beta1/namespaces/${encodeURIComponent(namespace)}/datavolumes/${encodeURIComponent(name)}`,
    `${origin}/apis/cdi.kubevirt.io/v1/namespaces/${encodeURIComponent(namespace)}/datavolumes/${encodeURIComponent(name)}`,
  ];
  for (const url of urls) {
    try {
      await requestJson('DELETE', url, token, insecure);
      console.log(`[Reinstall] Deleted DataVolume: ${name}`);
      return;
    } catch (e: any) {
      const st = Number(e?.status || 0);
      const msg = String(e?.message || e || '').toLowerCase();
      if (st === 404 || msg.includes('not found')) return;
    }
  }
}

/**
 * 更换系统镜像：VM PATCH 成功后删旧根盘。
 * 运行中 VMI 会占用旧 PVC，须先等待释放（用户重启后）再 DELETE。
 */
export async function deleteReinstallOldRootStorageClaims(
  params: HarvesterTestParams,
  namespace: string,
  vmName: string,
  claimNames: string[],
  dataVolumeNames: string[],
  origin: string,
): Promise<void> {
  const uniqueClaims = Array.from(new Set(claimNames.map((n) => String(n).trim()).filter(Boolean)));
  const uniqueDvs = Array.from(
    new Set(dataVolumeNames.map((n) => String(n).trim()).filter(Boolean)),
  );
  if (!uniqueClaims.length && !uniqueDvs.length) return;

  if (uniqueClaims.length) {
    await waitForOldRootClaimsReleasedFromVmi(params, namespace, vmName, uniqueClaims, origin);
  }

  const deleteOnePvcWithRetries = async (claimName: string, deadlineMs: number) => {
    const baseDelayMs = 3000;
    let attempt = 0;
    while (Date.now() < deadlineMs) {
      attempt += 1;
      const stillMounted = await isClaimReferencedByVmi(
        params,
        namespace,
        vmName,
        claimName,
        origin,
      );
      if (stillMounted) {
        await new Promise((r) => setTimeout(r, REINSTALL_OLD_CLAIM_POLL_MS));
        continue;
      }
      try {
        await deleteHarvesterPVC(params, namespace, claimName);
        console.log(`[Reinstall] Deleted old root PVC: ${claimName} (attempt ${attempt})`);
        return true;
      } catch (e: any) {
        const st = Number(e?.status || 0);
        const msg = String(e?.message || e || '').toLowerCase();
        if (st === 404 || msg.includes('not found')) return true;
        console.warn(
          `[Reinstall] delete old root PVC ${claimName} attempt ${attempt}:`,
          e?.message || e,
        );
        await new Promise((r) => setTimeout(r, baseDelayMs * Math.min(attempt, 8)));
      }
    }
    console.error(`[Reinstall] Giving up deleting old root PVC: ${claimName}`);
    return false;
  };

  const deleteDeadline = Date.now() + REINSTALL_OLD_CLAIM_DELETE_RETRY_MS;
  for (const claim of uniqueClaims) {
    await deleteOnePvcWithRetries(claim, deleteDeadline);
  }
  for (const dv of uniqueDvs) {
    await deleteHarvesterDataVolumeIfExists(params, namespace, dv, origin);
  }
}
