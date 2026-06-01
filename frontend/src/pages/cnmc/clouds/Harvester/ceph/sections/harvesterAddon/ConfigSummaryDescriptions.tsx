import React from 'react';
import { Descriptions } from 'antd';
import {
  describeSelectedBlockDevices,
  normalizeDeviceNames,
  type CephHarvesterAddonFormValues,
} from '../../lib/cephHarvesterAddon';
import { formatCephStorageNetworkSummary } from '../../lib/cephStorageNetwork';
import type { CephStorageNetworkResponse } from '../../../../../../../services/cephApi';
import {
  formatBindingLabel,
  formatCompressionLabel,
  formatReclaimLabel,
} from './addonUiConstants';

type ConfigSummaryDescriptionsProps = {
  values: CephHarvesterAddonFormValues;
  blockDevicesRaw: unknown;
  storageNetwork?: CephStorageNetworkResponse | null;
  column?: 1 | 2;
  size?: 'small' | 'default' | 'middle';
};

const ConfigSummaryDescriptions: React.FC<ConfigSummaryDescriptionsProps> = ({
  values,
  blockDevicesRaw,
  storageNetwork,
  column = 2,
  size = 'small',
}) => {
  const nodeSummaryLines = (values?.cephCluster?.nodes || [])
    .filter((r) => r?.nodeName && normalizeDeviceNames(r.deviceNames).length > 0)
    .map(
      (r) =>
        `${r.nodeName}：${describeSelectedBlockDevices(blockDevicesRaw, r.nodeName, r.deviceNames)}`,
    );

  return (
    <Descriptions bordered size={size} column={column}>
      <Descriptions.Item label="存储节点" span={column === 1 ? 1 : 2}>
        {nodeSummaryLines.length === 0 ? (
          '未配置'
        ) : (
          nodeSummaryLines.map((line, index) => (
            <div key={index} style={index > 0 ? { marginTop: 6 } : undefined}>
              {line}
            </div>
          ))
        )}
      </Descriptions.Item>
      <Descriptions.Item label="管理 / 调度节点">
        {values?.cephCluster?.monCount ?? '—'} / {values?.cephCluster?.mgrCount ?? '—'}
      </Descriptions.Item>
      <Descriptions.Item label="内置监控面板">
        {values?.cephCluster?.dashboardEnabled ? '启用' : '关闭'}
      </Descriptions.Item>
      <Descriptions.Item label="数据副本数">{values?.replicaSize ?? '—'}</Descriptions.Item>
      <Descriptions.Item label="数据压缩">{formatCompressionLabel(values?.compressionMode)}</Descriptions.Item>
      <Descriptions.Item label="删除云硬盘时">
        {formatReclaimLabel(values?.storageClass?.reclaimPolicy)}
      </Descriptions.Item>
      <Descriptions.Item label="存储空间分配">
        {formatBindingLabel(values?.storageClass?.volumeBindingMode)}
      </Descriptions.Item>
      <Descriptions.Item label="在线扩容">
        {values?.storageClass?.allowVolumeExpansion ? '允许' : '禁止'}
      </Descriptions.Item>
      {storageNetwork !== undefined ? (
        <Descriptions.Item label="专用存储网" span={column === 1 ? 1 : 2}>
          {formatCephStorageNetworkSummary(storageNetwork)}
        </Descriptions.Item>
      ) : null}
    </Descriptions>
  );
};

export default ConfigSummaryDescriptions;
