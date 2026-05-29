import type { Rule } from 'antd/es/form';
import {
  parseDatabaseSizeMB,
  suggestDatabaseSizeMBPerOsd,
  validateNodeMetadataDeviceRows,
  type MetadataDeviceSizeLookup,
} from '../../lib/cephHarvesterAddon';
import { normalizeDeviceNames } from '../../lib/harvesterAddonFormUtils';

type BuildDatabaseSizeRulesParams = {
  rowIndex: number;
  lookupMetadataDeviceSizeMB?: MetadataDeviceSizeLookup;
};

export function buildDatabaseSizeMBFieldRules({
  rowIndex,
  lookupMetadataDeviceSizeMB,
}: BuildDatabaseSizeRulesParams): Rule[] {
  return [
    ({ getFieldValue }) => ({
      validator: async (_, value) => {
        const metadataDevice = String(
          getFieldValue(['cephCluster', 'nodes', rowIndex, 'metadataDevice']) ?? '',
        ).trim();
        if (!metadataDevice) return;

        const databaseSizeMB = parseDatabaseSizeMB(value);
        if (databaseSizeMB == null) {
          throw new Error('已选择元数据盘，须填写每盘缓存区大小');
        }

        const nodeName = String(getFieldValue(['cephCluster', 'nodes', rowIndex, 'nodeName']) ?? '').trim();
        const deviceNames = normalizeDeviceNames(
          getFieldValue(['cephCluster', 'nodes', rowIndex, 'deviceNames']),
        );
        if (!nodeName || deviceNames.length === 0) return;

        const error = validateNodeMetadataDeviceRows(
          [
            {
              nodeName,
              deviceNames,
              metadataDevice,
              databaseSizeMB,
            },
          ],
          lookupMetadataDeviceSizeMB,
        );
        if (error) throw new Error(error);
      },
    }),
  ];
}

export function formatDatabaseSizeMBFieldExtra(
  metadataDevice: string | undefined,
  nodeName: string | undefined,
  deviceNames: string[] | undefined,
  lookupMetadataDeviceSizeMB?: MetadataDeviceSizeLookup,
): string {
  const metaDev = String(metadataDevice ?? '').trim();
  if (!metaDev) {
    return 'BlueStore DB 容量；仅在选择元数据盘后需要填写。';
  }

  const osdCount = normalizeDeviceNames(deviceNames).length;
  const node = String(nodeName ?? '').trim();
  const metadataSizeMB =
    node && lookupMetadataDeviceSizeMB ? lookupMetadataDeviceSizeMB(node, metaDev) : undefined;

  const base =
    '须显式指定，勿留空；未指定时底层可能占满元数据盘，导致同节点无法继续扩容 OSD。请按规划 OSD 总数（含未来扩容）预留。';

  if (metadataSizeMB != null && metadataSizeMB > 0 && osdCount > 0) {
    const suggested = suggestDatabaseSizeMBPerOsd(metadataSizeMB, osdCount);
    return `${base} 元数据盘约 ${metadataSizeMB} MB，当前 ${osdCount} 个 OSD，建议每盘 ≤ ${suggested} MB。`;
  }
  if (metadataSizeMB != null && metadataSizeMB > 0) {
    return `${base} 元数据盘约 ${metadataSizeMB} MB。`;
  }
  return base;
}
