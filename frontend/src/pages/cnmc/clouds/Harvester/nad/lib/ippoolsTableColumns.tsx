import React from 'react';
import type { ColumnsType } from 'antd/es/table';
import { Tag } from 'antd';
import { EnvironmentTwoTone } from '@ant-design/icons';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import { isSystemNamespace } from '../../../../../../utils/harvesterUtils';
import { filterMenuItemsForReadOnly } from '../../../../../../utils/rbacUi';
import type { IPPoolListRow } from './ippoolsSectionUtils';

export type IPPoolsTableActions = {
  isTenant?: boolean;
  hasIpPoolsWrite: boolean;
  isPublicNamespace: (ns: string) => boolean;
  onOpenYaml: (record: IPPoolListRow) => void;
  onDelete: (record: IPPoolListRow) => void;
};

export function buildIpPoolsTableColumns(
  actions: IPPoolsTableActions,
): ColumnsType<IPPoolListRow> {
  const { isTenant, hasIpPoolsWrite, isPublicNamespace, onOpenYaml, onDelete } = actions;

  return [
    {
      fixed: 'left',
      title: '地址池名称',
      dataIndex: 'name',
      key: 'name',
      render: (t: string) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
          <EnvironmentTwoTone style={{ color: '#1677ff' }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{t}</span>
        </span>
      ),
    },
    { title: '项目', dataIndex: 'namespace', key: 'namespace' },
    { title: 'IP 范围/CIDR', dataIndex: 'ranges', key: 'ranges', ellipsis: true },
    {
      title: '网络',
      dataIndex: 'network',
      key: 'network',
      render: (network: string) => {
        if (!network || network === '-') {
          return <span className="text-secondary">-</span>;
        }
        return <Tag color="blue">{network}</Tag>;
      },
    },
    { title: '创建时间', dataIndex: 'creationTimestamp', key: 'creationTimestamp' },
    {
      title: '操作',
      key: 'action',
      align: 'left',
      fixed: 'right',
      render: (_: unknown, record: IPPoolListRow) => {
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
            ], hasIpPoolsWrite)}
          />
        );
      },
    },
  ];
}
