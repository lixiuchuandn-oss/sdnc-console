import React from 'react';
import type { ColumnsType } from 'antd/es/table';
import { Tag, Tooltip } from 'antd';
import ResourceActionsDropdown, {
  type ResourceActionItem,
} from 'components/ResourceActionsDropdown';
import {
  DEPLOYMENT_SET_POD_LABEL,
  type DeploymentSetRow,
} from 'services/harvester/deploymentSets';
import { formatDeploymentSetSchedulingSummary } from 'services/harvester/deploymentSetScheduling';

export type DeploymentSetsTableActions = {
  canWrite: boolean;
  onEdit: (record: DeploymentSetRow) => void;
  onDelete: (record: DeploymentSetRow) => void;
};

function renderLabelsCell(labels: Record<string, string>): React.ReactNode {
  const entries = Object.entries(labels || {}).filter(([k]) => k !== DEPLOYMENT_SET_POD_LABEL);
  if (!entries.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxWidth: 320 }}>
      {entries.map(([k, v]) => (
        <Tag key={k} style={{ margin: 0 }}>
          {v ? `${k}=${v}` : k}
        </Tag>
      ))}
    </div>
  );
}

export function buildDeploymentSetsTableColumns(
  actions: DeploymentSetsTableActions,
): ColumnsType<DeploymentSetRow> {
  const { canWrite, onEdit, onDelete } = actions;

  return [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      fixed: 'left',
      render: (name?: string) => name || null,
    },
    {
      title: '项目',
      dataIndex: 'namespace',
      key: 'namespace',
      render: (ns?: string) => {
        const text = String(ns || '').trim();
        return text || null;
      },
    },
    {
      title: '标签',
      key: 'labels',
      render: (_: unknown, row) => renderLabelsCell(row.labels),
    },
    {
      title: '虚拟机数',
      dataIndex: 'vmCount',
      key: 'vmCount',
      render: (n?: number) => (Number(n) > 0 ? n : '0'),
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      render: (v?: string) => {
        const text = String(v || '').trim();
        if (!text) return null;
        return (
          <Tooltip title={text}>
            <span
              style={{
                display: 'inline-block',
                maxWidth: 240,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                verticalAlign: 'bottom',
              }}
            >
              {text}
            </span>
          </Tooltip>
        );
      },
    },
    {
      title: '置放策略',
      key: 'scheduling',
      render: (_: unknown, row) => {
        const summary = formatDeploymentSetSchedulingSummary(row);
        if (!summary) return null;
        return summary;
      },
    },
    {
      title: '操作',
      key: 'actions',
      align: 'left',
      fixed: 'right',
      render: (_: unknown, row) => {
        const items: ResourceActionItem[] = [];
        if (canWrite) {
          items.push(
            { key: 'edit', label: '编辑', onClick: () => onEdit(row) },
            { key: 'delete', label: '删除', danger: true, onClick: () => onDelete(row) },
          );
        }
        return (
          <ResourceActionsDropdown
            items={items}
            buttonProps={{ className: 'row-actions-trigger' }}
          />
        );
      },
    },
  ];
}
