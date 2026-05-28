import React from 'react';
import type { ColumnsType } from 'antd/es/table';
import { TagTwoTone } from '@ant-design/icons';

import ResourceActionsDropdown from 'components/ResourceActionsDropdown';
import type { SshKeyTableRow } from './sshKeysSectionUtils';
import { filterMenuItemsForReadOnly } from '../../../../../../utils/rbacUi';

export type SshKeysTableActions = {
  isTenant?: boolean;
  hasSshKeysWrite: boolean;
  onOpenYaml: (record: SshKeyTableRow) => void;
  onDelete: (record: SshKeyTableRow) => void;
};

export function buildSshKeysTableColumns(actions: SshKeysTableActions): ColumnsType<SshKeyTableRow> {
  const { isTenant, hasSshKeysWrite, onOpenYaml, onDelete } = actions;

  return [
    {
      title: '密钥名称',
      dataIndex: 'alias',
      key: 'alias',
      fixed: 'left',
      render: (_text: string, record: SshKeyTableRow) => {
        const content = record.alias || record.name;
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
            <TagTwoTone style={{ color: '#1677ff', fontSize: 16, flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{content}</span>
          </span>
        );
      },
    },
    {
      title: '密钥 ID',
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => <span className="std-code">{text}</span>,
    },
    ...(!isTenant ? [{ title: '项目', dataIndex: 'namespace', key: 'namespace' }] : []),
    {
      title: '创建时间',
      key: 'creationTimestamp',
      render: (_: unknown, record: SshKeyTableRow) => {
        const t = record.creationTimestamp;
        const s = t ? new Date(t).toLocaleString() : '-';
        return <span className="std-time" style={{ whiteSpace: 'nowrap' }}>{s}</span>;
      },
    },
    {
      title: '操作',
      key: 'action',
      align: 'left',
      fixed: 'right',
      render: (_: unknown, record: SshKeyTableRow) => {
        const items: { key: string; label: string; danger?: boolean; disabled?: boolean; onClick?: () => void; type?: 'divider' }[] = [];
        if (!isTenant) {
          items.push({
            key: 'yaml',
            label: '查看YAML',
            onClick: () => onOpenYaml(record),
          });
          items.push({ key: 'div', label: '', type: 'divider' });
        }
        items.push({
          key: 'delete',
          label: '删除',
          danger: true,
          disabled: !hasSshKeysWrite,
          onClick: () => onDelete(record),
        });
        const filteredItems = filterMenuItemsForReadOnly(items as any[], hasSshKeysWrite);
        return (
          <ResourceActionsDropdown
            items={filteredItems}
            buttonProps={{ className: 'row-actions-trigger' }}
          />
        );
      },
    },
  ];
}
