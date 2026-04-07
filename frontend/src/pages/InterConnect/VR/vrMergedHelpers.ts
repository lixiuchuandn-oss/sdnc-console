/**
 * 与 GET /api/vr-instances/:uuid 聚合接口对齐（含 vr1 元数据、vr2_info、vr3_info 等）：
 *
 * 1）进入 PE/CE 等向导应调用该聚合接口拉全量。
 * 2）左侧「设备回读」仅展示/推断 vr2_info（pickDeviceBlobForLookup）。
 * 3）右侧「配置编辑」默认用 vr2_info 跟接口 IP 等；用户主动改「公网口」Select 时，
 *    该次对齐仅查 vr3_info（接口权威）。网卡下拉选项见 collectIfaceNamesForSelect（vr3）。
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

/** 向导网卡下拉：仅以 vr3_info 为接口数据权威（与 PE/CE 等产品约定一致） */
export function collectIfaceNamesForSelect(merged: Record<string, any>): string[] {
  return collectIfaceNamesFromDeviceBlob(merged?.vr3_info);
}

/** 仅 VR2：按接口查 IP/BGP；无 vr2_info 时为 null */
export function pickDeviceBlobForLookup(merged: Record<string, any>): Record<string, any> | null {
  const vr2 = merged?.vr2_info;
  if (vr2 && typeof vr2 === 'object') return vr2 as Record<string, any>;
  return null;
}
