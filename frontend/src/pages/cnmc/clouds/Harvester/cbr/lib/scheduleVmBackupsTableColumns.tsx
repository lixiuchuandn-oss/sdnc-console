import React from 'react';
import type { ColumnsType } from 'antd/es/table';
import { Badge, Button, Dropdown, Tooltip } from 'antd';
import { CalendarOutlined, EllipsisOutlined } from '@ant-design/icons';
import { formatCron } from '../../../../../../utils/cronFormatter';
import type { ScheduleVmBackupListRow } from './scheduleVmBackupsSectionUtils';
import { filterMenuItemsForReadOnly } from '../../../../../../utils/rbacUi';

export type ScheduleVmBackupsTableActions = {
  isTenant?: boolean;
  hasBackupsWrite: boolean;
  onOpenYaml: (record: ScheduleVmBackupListRow) => void;
  onEdit: (record: ScheduleVmBackupListRow) => void;
  onSuspend: (record: ScheduleVmBackupListRow) => void;
  onDelete: (record: ScheduleVmBackupListRow) => void;
};

export function buildScheduleVmBackupsTableColumns(
  actions: ScheduleVmBackupsTableActions,
): ColumnsType<ScheduleVmBackupListRow> {
  const { isTenant, hasBackupsWrite, onOpenYaml, onEdit, onSuspend, onDelete } = actions;

  return [
    {
      title: '策略名称',
      dataIndex: 'name',
      key: 'name',
      fixed: 'left',
      render: (t: string) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
          <CalendarOutlined style={{ color: '#1677ff', fontSize: 16, flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{t}</span>
        </span>
      ),
    },
    {
      title: '策略 ID',
      dataIndex: 'id',
      key: 'id',
      render: (t: string) => <span style={{ color: '#666', fontSize: 13 }}>{t}</span>,
    },
    {
      title: '策略类型',
      dataIndex: 'type',
      key: 'type',
      render: (t: string) => (t === 'snapshot' ? '快照定时策略' : '备份定时策略'),
    },
    {
      title: '状态',
      dataIndex: 'suspended',
      key: 'suspended',
      render: (suspended: boolean) => (
        <Badge status={!suspended ? 'success' : 'warning'} text={!suspended ? '活跃' : '暂停'} />
      ),
    },
    { title: '项目', dataIndex: 'namespace', key: 'namespace' },
    { title: '源虚拟机', dataIndex: 'vmAlias', key: 'vmAlias' },
    {
      title: '计划任务',
      dataIndex: 'cron',
      key: 'cron',
      render: (cron: string) => {
        if (!cron || cron === '-') return '-';
        try {
          const human = formatCron(cron);
          return (
            <Tooltip title={cron}>
              <span>{human}</span>
            </Tooltip>
          );
        } catch {
          return cron;
        }
      },
    },
    { title: '保存数量', dataIndex: 'retention', key: 'retention' },
    { title: '最大故障数', dataIndex: 'maxFailure', key: 'maxFailure' },
    { title: '存活时间', dataIndex: 'age', key: 'age' },
    {
      title: '操作',
      key: 'action',
      align: 'left',
      fixed: 'right',
      render: (_: unknown, r: ScheduleVmBackupListRow) => {
        const items: any[] = [];
        if (!isTenant) {
          items.push({
            key: 'opsinfo',
            label: '查看YAML',
            onClick: () => onOpenYaml(r),
          });
        }
        items.push({
          key: 'edit',
          label: '策略修改',
          disabled: !hasBackupsWrite,
          onClick: () => onEdit(r),
        });
        items.push({
          key: 'suspend',
          label: r.suspended ? '启用' : '停用',
          disabled: !hasBackupsWrite,
          onClick: () => onSuspend(r),
        });
        items.push({ type: 'divider', key: 'divider-1' });
        items.push({
          key: 'delete',
          label: '删除',
          danger: true,
          disabled: !hasBackupsWrite,
          onClick: () => onDelete(r),
        });
        const filteredItems = filterMenuItemsForReadOnly(items as any[], hasBackupsWrite);
        return (
          <Dropdown menu={{ items: filteredItems }} trigger={['click']}>
            <Button icon={<EllipsisOutlined />} className="row-actions-trigger" type="text" />
          </Dropdown>
        );
      },
    },
  ];
}
