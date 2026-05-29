/**
 * 节点级元数据盘与每盘 BlueStore DB（databaseSizeMB）校验。
 * 运行态扩容规则见 `cephHarvesterAddonValidation.ts`；后端须同步 `validateMetadataDeviceConfig`。
 */

import { normalizeDeviceNames } from './harvesterAddonFormUtils';
import { groupNodeDevicesForForm, parseDatabaseSizeMB } from './cephHarvesterAddonForm';
import type {
  CephHarvesterAddonNodeFormRow,
  CephHarvesterAddonValuesConfig,
} from './cephHarvesterAddonTypes';

/** 每 OSD 在元数据盘上预留 WAL 等（MB） */
export const METADATA_DEVICE_WAL_RESERVE_MB = 2048;

/** 元数据盘可用容量比例（留 LVM/分区余量） */
export const METADATA_DEVICE_HEADROOM_RATIO = 0.95;

export type MetadataDeviceSizeLookup = (
  nodeName: string,
  metadataDevice: string,
) => number | undefined;

export function suggestDatabaseSizeMBPerOsd(metadataSizeMB: number, osdCount: number): number {
  const count = Math.max(1, Math.trunc(osdCount) || 1);
  const budget = Math.floor(metadataSizeMB * METADATA_DEVICE_HEADROOM_RATIO);
  const remaining = budget - count * METADATA_DEVICE_WAL_RESERVE_MB;
  if (remaining <= 0) return 1;
  return Math.max(1, Math.floor(remaining / count));
}

export function validateNodeMetadataDeviceRows(
  rows: CephHarvesterAddonNodeFormRow[] | undefined,
  lookupMetadataDeviceSizeMB?: MetadataDeviceSizeLookup,
): string | null {
  for (const row of rows || []) {
    const nodeName = String(row?.nodeName ?? '').trim();
    if (!nodeName) continue;

    const metadataDevice = String(row?.metadataDevice ?? '').trim();
    if (!metadataDevice) continue;

    const osdCount = normalizeDeviceNames(row.deviceNames).length;
    if (osdCount === 0) continue;

    const databaseSizeMB = parseDatabaseSizeMB(row.databaseSizeMB);
    if (databaseSizeMB == null) {
      return `节点 ${nodeName} 已选择元数据盘，须填写每盘缓存区大小；留空可能导致元数据盘被占满，后续无法扩容 OSD。`;
    }

    if (!lookupMetadataDeviceSizeMB) continue;

    const metadataSizeMB = lookupMetadataDeviceSizeMB(nodeName, metadataDevice);
    if (metadataSizeMB == null || metadataSizeMB <= 0) continue;

    const totalNeededMB = osdCount * (databaseSizeMB + METADATA_DEVICE_WAL_RESERVE_MB);
    const budgetMB = Math.floor(metadataSizeMB * METADATA_DEVICE_HEADROOM_RATIO);
    if (totalNeededMB > budgetMB) {
      const suggested = suggestDatabaseSizeMBPerOsd(metadataSizeMB, osdCount);
      return (
        `节点 ${nodeName}：${osdCount} 个 OSD × ${databaseSizeMB} MB 超出元数据盘可用容量` +
        `（约 ${metadataSizeMB} MB），建议每盘 ≤ ${suggested} MB，并按规划 OSD 总数（含未来扩容）预留。`
      );
    }
  }
  return null;
}

export function validateMetadataDeviceConfigFromValues(
  config: CephHarvesterAddonValuesConfig,
  lookupMetadataDeviceSizeMB?: MetadataDeviceSizeLookup,
): string | null {
  const rows = groupNodeDevicesForForm(config.cephCluster.nodes || []);
  return validateNodeMetadataDeviceRows(rows, lookupMetadataDeviceSizeMB);
}
