import React from 'react';
import type { ColumnsType } from 'antd/es/table';
import { Badge, Space } from 'antd';
import { LayoutTwoTone } from '@ant-design/icons';
import dayjs from 'dayjs';

import ResourceActionsDropdown from 'components/ResourceActionsDropdown';
import type { ClusterNetworkRow } from './networksSectionUtils';
import { isClusterNetworkReady } from './networksSectionUtils';

export type NetworksTableActions = {
  isTenant?: boolean;
  onOpenVlanConfigs: (record: ClusterNetworkRow) => void;
  onOpenYaml: (record: ClusterNetworkRow) => void;
};

export function buildNetworksTableColumns(
  actions: NetworksTableActions,
): ColumnsType<ClusterNetworkRow> {
  const { isTenant, onOpenVlanConfigs, onOpenYaml } = actions;

  return [
    {
      title: '名称',
      dataIndex: ['metadata', 'name'],
      key: 'name',
      fixed: 'left',
      render: (text: string | undefined) => (
        <Space align="center" size={6}>
          <LayoutTwoTone />
          <span>{text}</span>
        </Space>
      ),
      sorter: (a, b) =>
        String(a.metadata?.name || '').localeCompare(String(b.metadata?.name || '')),
    },
    {
      title: '状态',
      key: 'status',
      render: (_cell, record) => {
        const ok = isClusterNetworkReady(record);
        return ok ? <Badge status="success" text="Active" /> : <Badge status="default" text="Unknown" />;
      },
    },
    {
      title: 'MTU',
      key: 'mtu',
      render: (_cell, record) =>
        record.metadata?.annotations?.['network.harvesterhci.io/uplink-mtu'] || '—',
    },
    {
      title: '描述',
      key: 'description',
      render: (_cell, record) =>
        record.metadata?.annotations?.['field.cattle.io/description'] || '—',
    },
    {
      title: '创建时间',
      dataIndex: ['metadata', 'creationTimestamp'],
      key: 'age',
      render: (t: string | undefined) => (t ? dayjs(t).format('YYYY-MM-DD HH:mm:ss') : '—'),
      sorter: (a, b) =>
        new Date(a.metadata?.creationTimestamp || 0).getTime() -
        new Date(b.metadata?.creationTimestamp || 0).getTime(),
    },
    {
      title: '操作',
      key: 'action',
      align: 'left',
      fixed: 'right',
      render: (_cell, record) => {
        const items: { key: string; label: string; onClick: () => void }[] = [
          {
            key: 'vlanConfigs',
            label: '查看VLAN配置',
            onClick: () => onOpenVlanConfigs(record),
          },
        ];
        if (!isTenant) {
          items.push({
            key: 'opsinfo',
            label: '查看YAML',
            onClick: () => onOpenYaml(record),
          });
        }
        return <ResourceActionsDropdown items={items} />;
      },
    },
  ];
}
