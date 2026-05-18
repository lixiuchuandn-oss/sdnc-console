/**
 * ClusterNetwork 聚合行下的 VlanConfig 列表展示（antd Drawer + Table）。
 */
import React from 'react';

import { Drawer, Empty, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';

export type VlanConfigsDrawerProps = {
  open: boolean;
  onClose: () => void;
  /** 通常为 `VlanConfig · {ClusterNetwork.metadata.name}` */
  title: string;
  /** 与列表行聚合的 vlanConfigs（可为空数组） */
  vlanConfigs?: readonly unknown[] | undefined;
};

const VLAN_CONFIG_COLUMNS: ColumnsType<Record<string, unknown>> = [
  {
    title: 'VlanConfig 名称',
    dataIndex: ['metadata', 'name'],
    key: 'name',
  },
  {
    title: 'Node Selector',
    key: 'nodeSelector',
    render: (_cell, r) => {
      const row = r as { spec?: { nodeSelector?: Record<string, string> } };
      const selector = row.spec?.nodeSelector || {};
      const entries = Object.entries(selector);
      if (!entries.length) return '—';
      return (
        <Space direction="vertical" size="small">
          {entries.map(([k, v]) => (
            <Tag key={k}>
              {k}: {String(v)}
            </Tag>
          ))}
        </Space>
      );
    },
  },
  {
    title: 'Uplink Info',
    key: 'uplink',
    render: (_cell, r) => {
      const row = r as {
        spec?: {
          uplink?: { nics?: string[]; bondOptions?: { mode?: string }; linkAttributes?: Record<string, unknown> };
        };
      };
      const uplink = row.spec?.uplink || {};
      return (
        <Space direction="vertical" size="small">
          <Typography.Text type="secondary">
            Nics: {(uplink.nics || []).join(', ') || '—'}
          </Typography.Text>
          <Typography.Text type="secondary">Mode: {uplink.bondOptions?.mode || '—'}</Typography.Text>
          <Typography.Text type="secondary">
            LinkAttrs: {JSON.stringify(uplink.linkAttributes || {})}
          </Typography.Text>
        </Space>
      );
    },
  },
];

const VlanConfigsDrawer: React.FC<VlanConfigsDrawerProps> = ({
  open,
  onClose,
  title,
  vlanConfigs,
}) => {
  const dataSource = (Array.isArray(vlanConfigs) ? vlanConfigs : []) as Record<string, unknown>[];

  return (
    <Drawer title={title} width={800} open={open} onClose={onClose} destroyOnHidden>
      {dataSource.length ? (
        <Table<Record<string, unknown>>
          scroll={{ x: true }}
          bordered={false}
          columns={VLAN_CONFIG_COLUMNS}
          dataSource={dataSource}
          pagination={false}
          rowKey={(r, i) =>
            String((r as { metadata?: { uid?: string; name?: string } }).metadata?.uid || '') ||
            String((r as { metadata?: { name?: string } }).metadata?.name || '') ||
            `vlan-${i}`
          }
          size="small"
        />
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 VlanConfig 配置" />
      )}
    </Drawer>
  );
};

export default VlanConfigsDrawer;
