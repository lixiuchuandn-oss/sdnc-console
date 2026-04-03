/**
 * 与 GET /api/vr-instances/:uuid 返回的合并对象对齐：
 * - 左侧设备回读：仅 vr2_info（见 pickDeviceBlobForLookup）
 * - 右侧下拉：VR2 ∪ VR3 接口名（见 collectIfaceNamesForSelect）
 */

function collectIfaceNamesFromDeviceBlob(dev: any): string[] {
  if (!dev || typeof dev !== 'object') return [];
  const names: string[] = [];
  const collectFromArray = (arr?: any[]) => {
    (arr || []).forEach((it) => {
      if (it && typeof it === 'object' && it.name) names.push(String(it.name));
    });
  };
  collectFromArray(dev.interfaces);
  Object.keys(dev).forEach((key) => {
    if (
      (key.startsWith('interfaces_') || key.startsWith('subinterfaces_')) &&
      Array.isArray((dev as any)[key])
    ) {
      collectFromArray((dev as any)[key]);
    }
  });
  return Array.from(new Set(names)).filter(Boolean);
}

/** 仅 VR2 上的接口名（与历史行为一致，供仅需 VR2 的场景） */
export function collectIfaceNamesFromMerged(merged: Record<string, any>): string[] {
  return collectIfaceNamesFromDeviceBlob(merged?.vr2_info);
}

/** 右侧编辑区网卡下拉：VR2 与 VR3 并集，避免只存在于某一侧的口选不到 */
export function collectIfaceNamesForSelect(merged: Record<string, any>): string[] {
  const a = collectIfaceNamesFromDeviceBlob(merged?.vr2_info);
  const b = collectIfaceNamesFromDeviceBlob(merged?.vr3_info);
  return Array.from(new Set([...a, ...b])).filter(Boolean);
}

/** 仅 VR2：按接口查 IP/BGP；无 vr2_info 时为 null */
export function pickDeviceBlobForLookup(merged: Record<string, any>): Record<string, any> | null {
  const vr2 = merged?.vr2_info;
  if (vr2 && typeof vr2 === 'object') return vr2 as Record<string, any>;
  return null;
}
