import React from 'react';
import type { ColumnsType } from 'antd/es/table';
import { Badge, Tooltip } from 'antd';
import { CameraTwoTone } from '@ant-design/icons';
import ResourceActionsDropdown from 'components/ResourceActionsDropdown';
import type { SnapshotListRow } from './snapshotsSectionUtils';

export type SnapshotRowActionItem =
  | {
      key: string;
      label: React.ReactNode;
      disabled?: boolean;
      danger?: boolean;
      onClick?: () => void;
    }
  | { type: 'divider'; key?: string };

export type BuildSnapshotsTableColumnsParams = {
  isTenant?: boolean;
  buildRowActionItems: (record: SnapshotListRow) => SnapshotRowActionItem[];
};

export function buildSnapshotsTableColumns({
  isTenant,
  buildRowActionItems,
}: BuildSnapshotsTableColumnsParams): ColumnsType<SnapshotListRow> {
  return [
    {
      title: '快照名称',
      dataIndex: 'alias',
      key: 'alias',
      fixed: 'left',
      ellipsis: true,
      render: (_: unknown, r: SnapshotListRow) => {
        const label = r.alias !== '-' ? r.alias : r.name;
        return (
          <Tooltip title={label}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <CameraTwoTone style={{ flexShrink: 0 }} />
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </span>
            </div>
          </Tooltip>
        );
      },
    },
    {
      title: '快照ID',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (v: string) =>
        !v ? (
          '-'
        ) : (
          <Tooltip title={v}>
            <span
              className="text-secondary"
              style={{
                display: 'block',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {v}
            </span>
          </Tooltip>
        ),
    },
    ...(!isTenant
      ? [{ title: '项目', dataIndex: 'namespace', key: 'namespace', ellipsis: true }]
      : []),
    { title: '源PVC', dataIndex: 'sourcePvc', key: 'sourcePvc', ellipsis: true },
    ...(!isTenant
      ? [{ title: '快照类', dataIndex: 'snapshotClassName', key: 'snapshotClassName', ellipsis: true }]
      : []),
    {
      title: '状态',
      dataIndex: 'readyToUse',
      key: 'readyToUse',
      render: (ready: boolean) => (
        <Badge status={ready ? 'success' : 'warning'} text={ready ? '就绪' : '未就绪'} />
      ),
    },
    { title: '大小', dataIndex: 'restoreSize', key: 'restoreSize' },
    {
      title: '创建时间',
      dataIndex: 'creationTimestamp',
      key: 'creationTimestamp',
      sorter: (a: SnapshotListRow, b: SnapshotListRow) => {
        const ta = a?.creationTimestamp ? new Date(a.creationTimestamp).getTime() : 0;
        const tb = b?.creationTimestamp ? new Date(b.creationTimestamp).getTime() : 0;
        return ta - tb;
      },
      defaultSortOrder: 'descend',
      render: (t: string) => (
        <span style={{ whiteSpace: 'nowrap' }}>{t ? new Date(t).toLocaleString() : '-'}</span>
      ),
    },
    {
      title: '操作',
      key: 'action',
      align: 'left',
      fixed: 'right',
      render: (_: unknown, record: SnapshotListRow) => (
        <ResourceActionsDropdown
          items={buildRowActionItems(record)}
          buttonProps={{ className: 'row-actions-trigger' }}
        />
      ),
    },
  ];
}
