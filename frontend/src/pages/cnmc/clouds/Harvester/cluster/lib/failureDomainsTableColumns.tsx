import React from 'react';
import type { ColumnsType } from 'antd/es/table';
import { Tag, Tooltip } from 'antd';
import ResourceActionsDropdown, {
  type ResourceActionItem,
} from 'components/ResourceActionsDropdown';
import {
  FAILURE_DOMAIN_TYPE_LABELS,
  type FailureDomainRow,
} from 'services/harvester/failureDomains';

export type FailureDomainsTableActions = {
  canWrite: boolean;
  onAssignNodes: (record: FailureDomainRow) => void;
  onEdit: (record: FailureDomainRow) => void;
  onDelete: (record: FailureDomainRow) => void;
};

function renderNodeNamesCell(row: FailureDomainRow): React.ReactNode {
  const names = row.nodeNames || [];
  if (!names.length) return '—';
  const text = names.join(', ');
  return (
    <Tooltip title={text}>
      <span
        style={{
          display: 'inline-block',
          maxWidth: 280,
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
}

export function buildFailureDomainsTableColumns(
  actions: FailureDomainsTableActions,
): ColumnsType<FailureDomainRow> {
  const { canWrite, onAssignNodes, onEdit, onDelete } = actions;

  return [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      fixed: 'left',
      render: (name?: string) => name || '—',
    },
    {
      title: '类型',
      dataIndex: 'domainType',
      key: 'domainType',
      render: (t: FailureDomainRow['domainType']) => (
        <Tag>{FAILURE_DOMAIN_TYPE_LABELS[t] || t || '—'}</Tag>
      ),
    },
    {
      title: '节点数',
      key: 'nodeCount',
      render: (_: unknown, row) => row.nodeNames?.length ?? 0,
    },
    {
      title: '节点',
      key: 'nodeNames',
      render: (_: unknown, row) => renderNodeNamesCell(row),
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      render: (v?: string) => {
        const text = String(v || '').trim();
        if (!text) return '—';
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
      title: '操作',
      key: 'actions',
      align: 'left',
      fixed: 'right',
      render: (_: unknown, row) => {
        const items: ResourceActionItem[] = [];
        if (canWrite) {
          items.push(
            { key: 'assign', label: '分配节点', onClick: () => onAssignNodes(row) },
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
