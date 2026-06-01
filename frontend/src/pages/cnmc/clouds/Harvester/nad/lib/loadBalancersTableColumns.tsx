import React from 'react';
import type { ColumnsType } from 'antd/es/table';
import { Tag } from 'antd';
import { ShareAltOutlined } from '@ant-design/icons';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import { isSystemNamespace } from '../../../../../../utils/harvesterUtils';
import { filterMenuItemsForReadOnly } from '../../../../../../utils/rbacUi';
import type { LoadBalancerListRow } from './loadBalancersSectionUtils';

export type LoadBalancersTableActions = {
  isTenant?: boolean;
  hasLoadBalancersWrite: boolean;
  isPublicNamespace: (ns: string) => boolean;
  onOpenYaml: (record: LoadBalancerListRow) => void;
  onDelete: (record: LoadBalancerListRow) => void;
};

export function buildLoadBalancersTableColumns(
  actions: LoadBalancersTableActions,
): ColumnsType<LoadBalancerListRow> {
  const { isTenant, hasLoadBalancersWrite, isPublicNamespace, onOpenYaml, onDelete } = actions;

  return [
    {
      fixed: 'left',
      title: 'SLB名称',
      dataIndex: 'name',
      key: 'name',
      render: (t: string) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
          <ShareAltOutlined style={{ color: '#1677ff' }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{t}</span>
        </span>
      ),
    },
    { title: '项目', dataIndex: 'namespace', key: 'namespace' },
    { title: '地址', dataIndex: 'address', key: 'address' },
    {
      title: '地址分配模式',
      dataIndex: 'ipam',
      key: 'ipam',
      render: (t: string) => <Tag>{t}</Tag>,
    },
    { title: '监听器', dataIndex: 'listeners', key: 'listeners', ellipsis: true },
    { title: '创建时间', dataIndex: 'creationTimestamp', key: 'creationTimestamp' },
    {
      title: '操作',
      key: 'action',
      align: 'left',
      fixed: 'right',
      render: (_: unknown, record: LoadBalancerListRow) => {
        const isSys = isSystemNamespace(record.namespace);
        const isPublic = isPublicNamespace(record.namespace);
        const deleteDisabled = isSys || (isTenant && isPublic);
        return (
          <ResourceActionsDropdown
            buttonProps={{ className: 'row-actions-trigger' }}
            items={filterMenuItemsForReadOnly([
              {
                key: 'opsinfo',
                label: '查看YAML',
                onClick: () => onOpenYaml(record),
              },
              { type: 'divider' },
              {
                key: 'delete',
                label: '删除',
                danger: true,
                disabled: deleteDisabled,
                onClick: () => onDelete(record),
              },
            ], hasLoadBalancersWrite)}
          />
        );
      },
    },
  ];
}
