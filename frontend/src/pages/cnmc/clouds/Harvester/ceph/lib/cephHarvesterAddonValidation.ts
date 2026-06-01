/**
 * Addon 配置校验。运行态扩容规则须与后端保持同步：
 * `backend/src/services/clouds/harvester/cephHarvesterAddon.ts` · `validateRunningClusterConfigChange`
 */

import { parseDatabaseSizeMB } from './cephHarvesterAddonForm';
import {
  type MetadataDeviceSizeLookup,
  validateMetadataDeviceConfigFromValues,
} from './cephHarvesterAddonMetadataValidation';
import type {
  CephHarvesterAddonNodeDevice,
  CephHarvesterAddonValuesConfig,
} from './cephHarvesterAddonTypes';

export type { MetadataDeviceSizeLookup } from './cephHarvesterAddonMetadataValidation';
export {
  METADATA_DEVICE_HEADROOM_RATIO,
  METADATA_DEVICE_WAL_RESERVE_MB,
  suggestDatabaseSizeMBPerOsd,
  validateNodeMetadataDeviceRows,
} from './cephHarvesterAddonMetadataValidation';

export function listConfiguredNodeDevices(
  config: CephHarvesterAddonValuesConfig | null | undefined,
): CephHarvesterAddonNodeDevice[] {
  const nodes = config?.cephCluster?.nodes || [];
  return nodes
    .map((r) => ({
      nodeName: String(r?.nodeName || '').trim(),
      deviceName: String(r?.deviceName || '').trim(),
      metadataDevice: r?.metadataDevice ?? '',
      databaseSizeMB: parseDatabaseSizeMB(
        r?.databaseSizeMB ?? (r as { blockDbSize?: unknown }).blockDbSize,
      ),
    }))
    .filter((r) => r.nodeName && r.deviceName);
}

function nodeDeviceKey(nodeName: string, deviceName: string): string {
  return `${nodeName}/${deviceName}`;
}

export function baselineNodeDeviceKeySet(
  config: CephHarvesterAddonValuesConfig | null | undefined,
): Set<string> {
  return new Set(
    listConfiguredNodeDevices(config).map((r) => nodeDeviceKey(r.nodeName, r.deviceName)),
  );
}

export function baselineNodeNameSet(
  config: CephHarvesterAddonValuesConfig | null | undefined,
): Set<string> {
  return new Set(listConfiguredNodeDevices(config).map((r) => r.nodeName));
}

function nodeLayoutByNode(
  config: CephHarvesterAddonValuesConfig,
): Map<string, { devices: Set<string>; metadataDevice: string; databaseSizeMB?: number }> {
  const byNode = new Map<
    string,
    { devices: Set<string>; metadataDevice: string; databaseSizeMB?: number }
  >();
  for (const row of listConfiguredNodeDevices(config)) {
    if (!byNode.has(row.nodeName)) {
      byNode.set(row.nodeName, {
        devices: new Set(),
        metadataDevice: String(row.metadataDevice ?? ''),
        databaseSizeMB: parseDatabaseSizeMB(
          row.databaseSizeMB ?? (row as { blockDbSize?: unknown }).blockDbSize,
        ),
      });
    }
    const entry = byNode.get(row.nodeName)!;
    entry.devices.add(row.deviceName);
    if (String(row.metadataDevice ?? '').trim()) {
      entry.metadataDevice = String(row.metadataDevice);
    }
    const dbMb = parseDatabaseSizeMB(
      row.databaseSizeMB ?? (row as { blockDbSize?: unknown }).blockDbSize,
    );
    if (dbMb != null) entry.databaseSizeMB = dbMb;
  }
  return byNode;
}

export function validateAddonConfig(
  config: CephHarvesterAddonValuesConfig,
  options?: { lookupMetadataDeviceSizeMB?: MetadataDeviceSizeLookup },
): string | null {
  const nodes = config.cephCluster.nodes || [];
  if (nodes.length === 0) {
    return '请至少为一台节点指定数据盘';
  }
  const keys = nodes.map((r) => `${r.nodeName}/${r.deviceName}`);
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) return '存在重复的节点与磁盘组合，请调整后再提交';
    seen.add(key);
  }
  const metadataError = validateMetadataDeviceConfigFromValues(
    config,
    options?.lookupMetadataDeviceSizeMB,
  );
  if (metadataError) return metadataError;
  return null;
}

export function validateRunningClusterConfigChange(
  before: CephHarvesterAddonValuesConfig,
  after: CephHarvesterAddonValuesConfig,
): string | null {
  const afterKeys = new Set(
    listConfiguredNodeDevices(after).map((r) => nodeDeviceKey(r.nodeName, r.deviceName)),
  );
  for (const row of listConfiguredNodeDevices(before)) {
    const key = nodeDeviceKey(row.nodeName, row.deviceName);
    if (!afterKeys.has(key)) {
      return `不可移除已有数据盘：${row.nodeName} / ${row.deviceName}。扩容请仅新增节点或数据盘。`;
    }
  }

  const beforeByNode = nodeLayoutByNode(before);
  const afterByNode = nodeLayoutByNode(after);
  for (const [nodeName, prev] of beforeByNode) {
    const next = afterByNode.get(nodeName);
    if (!next) {
      return `不可移除已有存储节点 ${nodeName}。`;
    }
    if (prev.metadataDevice !== next.metadataDevice) {
      return `不可修改节点 ${nodeName} 的元数据盘。`;
    }
    if (prev.databaseSizeMB !== next.databaseSizeMB) {
      return `不可修改节点 ${nodeName} 的每盘缓存区大小。`;
    }
  }

  if (before.replicaSize !== after.replicaSize) {
    return '已运行集群不可在此修改数据副本数。';
  }
  if (before.compressionMode !== after.compressionMode) {
    return '已运行集群不可在此修改数据压缩策略。';
  }
  if (before.requireSafeReplicaSize !== after.requireSafeReplicaSize) {
    return '已运行集群不可在此修改严格副本数校验。';
  }
  if (before.cephCluster.monCount !== after.cephCluster.monCount) {
    return '已运行集群不可在此修改管理节点数量。';
  }
  if (before.cephCluster.mgrCount !== after.cephCluster.mgrCount) {
    return '已运行集群不可在此修改调度服务数量。';
  }
  if (before.cephCluster.dashboardEnabled !== after.cephCluster.dashboardEnabled) {
    return '已运行集群不可在此修改内置监控面板开关。';
  }
  if (before.cephCluster.cephVersionImage !== after.cephCluster.cephVersionImage) {
    return '已运行集群不可在此更换存储引擎版本。';
  }
  if (before.cephCluster.allowUnsupported !== after.cephCluster.allowUnsupported) {
    return '已运行集群不可在此修改「允许非官方支持版本」。';
  }
  if (before.cephCluster.osdsPerDevice !== after.cephCluster.osdsPerDevice) {
    return '已运行集群不可在此修改每盘存储进程数。';
  }
  if (before.cephCluster.osdObjectstore !== after.cephCluster.osdObjectstore) {
    return '已运行集群不可在此修改磁盘存储引擎。';
  }
  if (before.cephCluster.metadataDevice !== after.cephCluster.metadataDevice) {
    return '已运行集群不可在此修改集群级元数据盘。';
  }
  if (before.cephCluster.allowMultipleMonPerNode !== after.cephCluster.allowMultipleMonPerNode) {
    return '已运行集群不可在此修改管理节点部署策略。';
  }
  if (
    before.cephtools.replicas !== after.cephtools.replicas ||
    before.cephtools.image !== after.cephtools.image ||
    before.operator.replicas !== after.operator.replicas ||
    before.operator.image !== after.operator.image
  ) {
    return '已运行集群不可在此更换运维工具或存储控制器配置。';
  }
  if (JSON.stringify(before.storageClass) !== JSON.stringify(after.storageClass)) {
    return '已运行集群不可在此修改云硬盘默认策略。';
  }

  const beforeCount = listConfiguredNodeDevices(before).length;
  const afterCount = listConfiguredNodeDevices(after).length;
  if (afterCount <= beforeCount) {
    return '已运行集群提交时须新增至少一块数据盘，或在新节点上至少勾选一块新盘。';
  }

  return null;
}
