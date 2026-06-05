/** Cloudmap 集群 · 统一存储配置：URL pathSeg 与历史书签 remap */

export const STORAGE_CONFIG_INNER_SEG = 'harvester_addon' as const;

export function isStorageConfigInnerSeg(seg: string): boolean {
  return seg === STORAGE_CONFIG_INNER_SEG;
}

/** 已并入 `harvester_addon` 的存储配置相关历史 pathSeg */
export const LEGACY_STORAGE_CONFIG_SEG_MAP: Readonly<Record<string, typeof STORAGE_CONFIG_INNER_SEG>> = {
  overview: STORAGE_CONFIG_INNER_SEG,
  ceph_storage_overview: STORAGE_CONFIG_INNER_SEG,
  rbd_mirror: STORAGE_CONFIG_INNER_SEG,
};

export function remapLegacyStorageConfigInnerSeg(seg: string): string {
  return LEGACY_STORAGE_CONFIG_SEG_MAP[seg] || seg;
}
