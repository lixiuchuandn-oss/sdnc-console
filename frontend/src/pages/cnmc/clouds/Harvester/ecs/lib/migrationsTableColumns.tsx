import React from 'react';
import type { ColumnsType } from 'antd/es/table';
import { Badge, Button, Space, Popconfirm } from 'antd';
import { ClockCircleTwoTone, CloudServerOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';

import {
  isMigrationRunning,
  migrationRowFields,
  resolveVmDisplayName,
  translateMigrationPhase,
  type MigrationTableRow,
} from './migrationsSectionUtils';

export type MigrationsTableActions = {
  isTenant?: boolean;
  vms?: readonly unknown[];
  canWrite: boolean;
  onOpenDrawer: (record: MigrationTableRow, tab?: string) => void;
  onAbort: (record: MigrationTableRow) => void;
};

export function buildMigrationsTableColumns(
  actions: MigrationsTableActions,
): ColumnsType<MigrationTableRow> {
  const { isTenant, vms, canWrite, onOpenDrawer, onAbort } = actions;

  return [
    {
      title: '任务ID',
      key: 'taskId',
      fixed: 'left',
      render: (_: unknown, r: MigrationTableRow) => {
        const text = migrationRowFields.taskId(r);
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <ClockCircleTwoTone twoToneColor={['#1890ff', '#91caff']} style={{ fontSize: 16, flexShrink: 0 }} />
            <span style={{ wordBreak: 'break-all' }}>{text}</span>
          </span>
        );
      },
    },
    {
      title: '状态',
      key: 'status',
      render: (_: unknown, r: MigrationTableRow) => {
        const phase = migrationRowFields.phase(r);
        const running = isMigrationRunning(phase);
        let status: 'success' | 'error' | 'processing' | 'default' = 'default';
        if (phase === 'Succeeded') status = 'success';
        else if (phase === 'Failed') status = 'error';
        else if (running) status = 'processing';
        return <Badge status={status} text={translateMigrationPhase(phase)} />;
      },
    },
    {
      title: '虚拟机',
      key: 'vmName',
      render: (_: unknown, r: MigrationTableRow) => {
        const displayName = resolveVmDisplayName(r, vms);
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
            <CloudServerOutlined style={{ color: '#1677ff', fontSize: 16, flexShrink: 0 }} />
            <span
              className="cell-link"
              style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, fontWeight: 600 }}
              onClick={() => onOpenDrawer(r, 'detail')}
            >
              {displayName}
            </span>
          </span>
        );
      },
    },
    {
      title: '源节点',
      key: 'sourceNode',
      render: (_: unknown, r: MigrationTableRow) => migrationRowFields.sourceNode(r),
    },
    {
      title: '目标节点',
      key: 'targetNode',
      render: (_: unknown, r: MigrationTableRow) => migrationRowFields.targetNode(r),
    },
    ...(!isTenant
      ? [
          {
            title: '命名空间',
            key: 'namespace',
            render: (_: unknown, r: MigrationTableRow) => migrationRowFields.namespace(r),
          },
        ]
      : []),
    {
      title: '创建时间',
      key: 'createdAt',
      className: 'std-time',
      render: (_: unknown, r: MigrationTableRow) => {
        const t = migrationRowFields.createdAt(r);
        return t ? dayjs(t).format('YYYY-MM-DD HH:mm:ss') : '-';
      },
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      render: (_: unknown, r: MigrationTableRow) => {
        const row = r as { status?: { phase?: string } };
        const phase = row.status?.phase || migrationRowFields.phase(r);
        const running = isMigrationRunning(String(phase));
        const actionNodes: React.ReactNode[] = [
          <Button key="detail" type="link" size="small" onClick={() => onOpenDrawer(r, 'detail')}>
            详情
          </Button>,
        ];
        if (running && canWrite) {
          actionNodes.push(
            <Popconfirm key="abort" title="确定要取消此迁移任务吗？" onConfirm={() => onAbort(r)}>
              <Button type="link" danger size="small">
                取消
              </Button>
            </Popconfirm>,
          );
        }
        return <Space size="small">{actionNodes}</Space>;
      },
    },
  ];
}
