/** KubeVirt / Harvester VM 规格中的 Cloud-Init 卷识别与展示字段（与磁盘域解耦）。 */

export function isCloudInitVolume(v: any): boolean {
  return !!(v?.cloudInitNoCloud || v?.cloudInitConfigDrive);
}

export function cloudInitSecretRefName(vol: any): string {
  const n =
    vol?.cloudInitNoCloud?.secretRef?.name ||
    vol?.cloudInitConfigDrive?.secretRef?.name;
  return String(n ?? "").trim();
}

/** 将 domain.disks 与 volumes 按磁盘名对齐（与磁盘管理抽屉一致） */
export function zipVmDiskVolumePairs(vmData: any): { disk: any; vol: any }[] {
  const disks = vmData?.spec?.template?.spec?.domain?.devices?.disks || [];
  const volumes = vmData?.spec?.template?.spec?.volumes || [];
  return (Array.isArray(disks) ? disks : []).map((d: any) => {
    const name = d?.name;
    const v = volumes.find((x: any) => x?.name === name);
    return { disk: d, vol: v || { name } };
  });
}

export function listCloudInitDiskVolumePairs(
  vmData: any,
): { disk: any; vol: any }[] {
  return zipVmDiskVolumePairs(vmData).filter((x) => isCloudInitVolume(x.vol));
}

/** 详情页「其他选项」摘要：Secret 引用 + 模板内联字段（与抽屉逻辑一致） */
export type CloudInitDetailSummary = {
  volumeName: string;
  secretName: string;
  userDataInline: string;
  hasUserDataBase64: boolean;
  networkDataInline: string;
  hasNetworkDataBase64: boolean;
};

export function cloudInitDetailSummaries(vmData: any): CloudInitDetailSummary[] {
  return listCloudInitDiskVolumePairs(vmData).map(({ disk, vol }) => {
    const volumeName = String(vol?.name || disk?.name || "").trim() || "—";
    const secretName = cloudInitSecretRefName(vol);
    const src: any = vol.cloudInitConfigDrive || vol.cloudInitNoCloud || {};
    const ud = typeof src.userData === "string" ? src.userData : "";
    const nd = typeof src.networkData === "string" ? src.networkData : "";
    return {
      volumeName,
      secretName,
      userDataInline: ud,
      hasUserDataBase64: !!(
        src.userDataBase64 && String(src.userDataBase64).trim()
      ),
      networkDataInline: nd,
      hasNetworkDataBase64: !!(
        src.networkDataBase64 && String(src.networkDataBase64).trim()
      ),
    };
  });
}
