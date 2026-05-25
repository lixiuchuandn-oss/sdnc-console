import React from 'react';
import type { ColumnsType } from 'antd/es/table';
import { TagTwoTone } from '@ant-design/icons';
import { message } from 'antd';

import ResourceActionsDropdown from 'components/ResourceActionsDropdown';
import type { CloudInitTableRow } from './cloudInitsSectionUtils';

export type CloudInitsTableActions = {
  isTenant?: boolean;
  hasCloudInitsWrite: boolean;
};

export function buildCloudInitsTableColumns(
  actions: CloudInitsTableActions,
): ColumnsType<CloudInitTableRow> {
  const { isTenant, hasCloudInitsWrite } = actions;

  return [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      fixed: 'left',
      render: (text: string) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
          <TagTwoTone twoToneColor={['#1890ff', '#91caff']} style={{ fontSize: 16, flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{text}</span>
        </span>
      ),
    },
    ...(!isTenant
      ? [{ title: '命名空间', dataIndex: 'namespace', key: 'namespace' }]
      : []),
    { title: '描述', dataIndex: 'description', key: 'description', ellipsis: true },
    {
      title: '创建时间',
      dataIndex: 'creationTimestamp',
      key: 'creationTimestamp',
      className: 'std-time',
    },
    {
      title: '操作',
      key: 'action',
      fixed: 'right',
      render: () => {
        const items: { key: string; label: string; danger?: boolean; disabled?: boolean; onClick: () => void }[] = [];
        if (!isTenant) {
          items.push({
            key: 'opsinfo',
            label: '查看YAML',
            onClick: () => message.info('详情功能开发中'),
          });
        }
        items.push({
          key: 'delete',
          label: '删除',
          danger: true,
          disabled: !hasCloudInitsWrite,
          onClick: () => {
            if (!hasCloudInitsWrite) {
              message.error('无权限执行该操作');
              return;
            }
            message.info('暂不支持删除');
          },
        });
        return (
          <ResourceActionsDropdown
            buttonProps={{ className: 'row-actions-trigger', disabled: !hasCloudInitsWrite }}
            items={items}
          />
        );
      },
    },
  ];
}
