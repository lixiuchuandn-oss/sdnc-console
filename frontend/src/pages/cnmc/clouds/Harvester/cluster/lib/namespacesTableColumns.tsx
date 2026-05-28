import React from 'react';
import type { ColumnsType } from 'antd/es/table';
import { Tag } from 'antd';
import { FolderOpenTwoTone } from '@ant-design/icons';
import ResourceActionsDropdown from 'components/ResourceActionsDropdown';
import { isSystemNamespace, isTenantScenarioNamespace, namespaceSectionType } from 'utils/harvesterUtils';
import type { NamespaceListRow } from './namespacesSectionUtils';
import { filterMenuItemsForReadOnly } from '../../../../../../utils/rbacUi';

export type NamespacesTableActions = {
  isTenant?: boolean;
  hasNamespacesWrite: boolean;
  onOpenYaml: (record: NamespaceListRow) => void;
  onEdit: (record: NamespaceListRow) => void;
  onDelete: (record: NamespaceListRow) => void;
};

export function buildNamespacesTableColumns(
  actions: NamespacesTableActions,
): ColumnsType<NamespaceListRow> {
  const { isTenant, hasNamespacesWrite, onOpenYaml, onEdit, onDelete } = actions;

  return [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      fixed: 'left',
      render: (_cell, row) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <FolderOpenTwoTone />
          <span>{row.metadata?.name || row.name}</span>
        </span>
      ),
    },
    {
      title: '状态',
      key: 'status',
      render: (_cell, row) => {
        const phase = row.status?.phase;
        const k = String(phase || '').toLowerCase();
        const color = k === 'active' ? 'success' : k === 'terminating' ? 'warning' : undefined;
        return <Tag color={color}>{phase || '-'}</Tag>;
      },
    },
    {
      title: 'UID',
      dataIndex: ['metadata', 'uid'],
      key: 'uid',
      render: (v?: string) => v || '-',
    },
    {
      title: '项目类型',
      key: 'type',
      render: (_cell, row) => {
        const t = namespaceSectionType(row);
        if (t === 'public') return <span className="std-badge std-badge-info">公共</span>;
        if (t === 'admin') return <span className="std-badge std-badge-warning">管理员</span>;
        if (t === 'tenant') return <span className="std-badge std-badge-success">租户</span>;
        return <span className="std-badge std-badge-default">未标注场景</span>;
      },
    },
    {
      title: '标签',
      key: 'labels',
      render: (_cell, row) => Object.keys(row.metadata?.labels || {}).length,
    },
    {
      title: '注解',
      key: 'annotations',
      render: (_cell, row) => Object.keys(row.metadata?.annotations || {}).length,
    },
    {
      title: 'Finalizers',
      key: 'finalizers',
      render: (_cell, row) => row.metadata?.finalizers?.length ?? 0,
    },
    {
      title: '创建时间',
      dataIndex: ['metadata', 'creationTimestamp'],
      key: 'creationTimestamp',
      render: (v?: string) => v || '-',
    },
    {
      title: '操作',
      key: 'actions',
      align: 'left',
      fixed: 'right',
      render: (_cell, row) => {
        const name = row.metadata?.name || row.name;
        const nameStr = String(name ?? '');
        const isSys = isSystemNamespace(nameStr);
        const items: {
          key: string;
          label: string;
          onClick: () => void;
          danger?: boolean;
        }[] = [];

        if (!isTenant) {
          items.push({
            key: 'yaml',
            label: '查看YAML',
            onClick: () => onOpenYaml(row),
          });
        }
        if (!isSys) {
          items.push({ key: 'edit', label: '编辑项目', onClick: () => onEdit(row) });
        }
        if (hasNamespacesWrite && !isSys && isTenantScenarioNamespace(row)) {
          items.push({
            key: 'delete',
            label: '删除项目',
            danger: true,
            onClick: () => onDelete(row),
          });
        }

        const filteredItems = filterMenuItemsForReadOnly(items as any[], hasNamespacesWrite);
        return (
          <ResourceActionsDropdown items={filteredItems} buttonProps={{ className: 'row-actions-trigger' }} />
        );
      },
    },
  ];
}
