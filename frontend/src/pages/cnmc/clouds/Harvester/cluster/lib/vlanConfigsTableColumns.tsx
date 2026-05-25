import React from 'react';
import type { ColumnsType } from 'antd/es/table';
import { Space, Tag, Typography } from 'antd';

export type VlanConfigRow = Record<string, unknown>;

export function buildVlanConfigsTableColumns(): ColumnsType<VlanConfigRow> {
  return [
    {
      title: 'VlanConfig 名称',
      dataIndex: ['metadata', 'name'],
      key: 'name',
      fixed: 'left',
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
            uplink?: {
              nics?: string[];
              bondOptions?: { mode?: string };
              linkAttributes?: Record<string, unknown>;
            };
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
}
