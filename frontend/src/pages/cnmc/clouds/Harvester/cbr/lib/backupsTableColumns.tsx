import React from 'react';
import type { ColumnsType } from 'antd/es/table';
import { Badge, Button, Dropdown } from 'antd';
import { CameraTwoTone, EllipsisOutlined } from '@ant-design/icons';
import type { BackupListRow } from './backupsSectionUtils';
import { filterMenuItemsForReadOnly } from '../../../../../../utils/rbacUi';

export type BackupsTableActions = {
  isTenant?: boolean;
  hasBackupsWrite: boolean;
  onOpenYaml: (record: BackupListRow) => void;
  onRestore: (record: BackupListRow) => void;
  onDelete: (record: BackupListRow) => void;
};

export function buildBackupsTableColumns(
  actions: BackupsTableActions,
): ColumnsType<BackupListRow> {
  const { isTenant, hasBackupsWrite, onOpenYaml, onRestore, onDelete } = actions;

  return [
    {
      title: '名称',
      dataIndex: 'alias',
      key: 'alias',
      fixed: 'left',
      render: (t: string, r: BackupListRow) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
          <CameraTwoTone />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
            {t !== '-' ? t : r.name}
          </span>
        </span>
      ),
    },
    {
      title: '类型',
      dataIndex: 'itemType',
      key: 'itemType',
      render: (t: string) => (
        <span>{t === 'snapshot' ? '虚拟机快照' : '虚拟机备份'}</span>
      ),
    },
    {
      title: 'ID',
      dataIndex: 'name',
      key: 'name',
      render: (t: string) => <span>{t}</span>,
    },
    { title: '项目', dataIndex: 'namespace', key: 'namespace' },
    { title: '目标虚拟机', dataIndex: 'targetVmAlias', key: 'targetVmAlias' },
    {
      title: '状态',
      dataIndex: 'readyToUse',
      key: 'readyToUse',
      render: (ready: boolean) => (
        <Badge status={ready ? 'success' : 'warning'} text={ready ? '就绪' : '未就绪'} />
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'creationTimestamp',
      key: 'creationTimestamp',
      render: (t: string) => (
        <span className="text-secondary">{t ? new Date(t).toLocaleString() : '-'}</span>
      ),
      sorter: (a: BackupListRow, b: BackupListRow) => {
        const ta = Date.parse(String(a.creationTimestamp || ''));
        const tb = Date.parse(String(b.creationTimestamp || ''));
        const na = Number.isFinite(ta) ? ta : 0;
        const nb = Number.isFinite(tb) ? tb : 0;
        return na - nb;
      },
      defaultSortOrder: 'descend',
    },
    {
      title: '操作',
      key: 'action',
      align: 'left',
      fixed: 'right',
      render: (_: unknown, record: BackupListRow) => {
        const items: any[] = [];

        if (!isTenant) {
          items.push({
            key: 'opsinfo',
            label: '查看YAML',
            onClick: () => onOpenYaml(record),
          });
          items.push({ type: 'divider' });
        }

        items.push({
          key: 'restore',
          label: '恢复',
          disabled: !record.readyToUse || !hasBackupsWrite,
          onClick: () => onRestore(record),
        });
        items.push({ type: 'divider' });
        items.push({
          key: 'delete',
          label: '删除',
          danger: true,
          disabled: !hasBackupsWrite,
          onClick: () => onDelete(record),
        });

        const filteredItems = filterMenuItemsForReadOnly(items as any[], hasBackupsWrite);
        return (
          <Dropdown menu={{ items: filteredItems }} trigger={['click']}>
            <Button
              icon={<EllipsisOutlined />}
              className="row-actions-trigger"
              type="text"
              disabled={filteredItems.length === 0}
            />
          </Dropdown>
        );
      },
    },
  ];
}
