import React, { useMemo } from 'react';
import type { MenuProps } from 'antd';
import { Tag, Typography } from 'antd';
import type { App } from 'antd';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import type { RBACRole } from '../types';
import { isBuiltInRbacRole } from './builtinRolePermissionView';
import { getRolePermissionCount } from './getRolePermissionCount';

const { Text, Link } = Typography;

export type RoleListColumnsOptions = {
  canWrite: boolean;
  canAssignUsers: boolean;
  canConfigurePermissions: boolean;
  modal: ReturnType<typeof App.useApp>['modal'];
  onAuthorize: (role: RBACRole) => void;
  onAssignUser: (role: RBACRole) => void;
  onDelete: (role: RBACRole) => void;
};

export function useRoleListColumns(options: RoleListColumnsOptions) {
  const { canWrite, canAssignUsers, canConfigurePermissions, modal, onAuthorize, onAssignUser, onDelete } = options;

  return useMemo(
    () => [
      {
        title: '角色名称',
        key: 'name',
        dataIndex: 'name',
        align: 'left' as const,
        fixed: 'left' as const,
        render: (_: unknown, row: RBACRole) => <Text>{row.name}</Text>,
      },
      {
        title: '角色类型',
        key: 'type',
        dataIndex: 'type',
        align: 'left' as const,
        render: (_: unknown, row: RBACRole) =>
          row.type === '系统策略' ? (
            <Tag color="blue">内置角色</Tag>
          ) : row.type === '自定义策略' ? (
            <Tag color="green">自定义角色</Tag>
          ) : (
            <Tag>-</Tag>
          ),
      },
      {
        title: '角色范围',
        key: 'scope',
        dataIndex: 'scope',
        align: 'left' as const,
        render: (_: unknown, row: RBACRole) =>
          row.scope === 'system' ? '系统角色' : row.scope === 'tenant' ? '租户角色' : '-',
      },
      {
        title: '权限数量',
        key: 'permissionCount',
        align: 'left' as const,
        render: (_: unknown, row: RBACRole) => {
          const n = getRolePermissionCount(row);
          if (!canConfigurePermissions) return <Text>{n}</Text>;
          return (
            <Link
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onAuthorize(row);
              }}
            >
              {n}
            </Link>
          );
        },
      },
      {
        title: '授予用户数',
        key: 'grantedUserCount',
        dataIndex: 'grantedUserCount',
        align: 'left' as const,
        render: (_: unknown, row: RBACRole) => {
          const n = typeof row.grantedUserCount === 'number' ? row.grantedUserCount : 0;
          if (!canAssignUsers) return <Text>{n}</Text>;
          return (
            <Link
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onAssignUser(row);
              }}
            >
              {n}
            </Link>
          );
        },
      },
      {
        title: '描述',
        key: 'description',
        dataIndex: 'description',
        ellipsis: true,
        align: 'left' as const,
      },
      {
        title: '创建时间',
        key: 'createdAt',
        dataIndex: 'createdAt',
        align: 'left' as const,
        render: (v: string) => (v ? new Date(v).toLocaleString() : '-'),
      },
      {
        title: '操作',
        key: 'action',
        width: 80,
        align: 'left' as const,
        fixed: 'right' as const,
        render: (_: unknown, row: RBACRole) => {
          if (!canWrite && !canAssignUsers && !canConfigurePermissions) return <Text type="secondary">—</Text>;
          const items: MenuProps['items'] = [
            ...(canConfigurePermissions
              ? [
                  {
                    key: 'auth',
                    label: isBuiltInRbacRole(row) ? '查看权限' : '配置权限',
                    onClick: () => onAuthorize(row),
                  },
                ]
              : []),
            ...(canAssignUsers
              ? [
                  {
                    key: 'assign',
                    label: '授予用户',
                    onClick: () => onAssignUser(row),
                  },
                ]
              : []),
          ];
          if (canWrite && row.type !== '系统策略') {
            items.push({ type: 'divider' });
            items.push({
              key: 'delete',
              label: '删除',
              danger: true,
              onClick: () => {
                modal.confirm({
                  title: '确认删除该自定义角色？',
                  content: '若角色已分配给用户或租户用户，将无法删除，请先解除关联。',
                  okText: '删除',
                  okType: 'danger',
                  onOk: () => onDelete(row),
                });
              },
            });
          }
          return (
            <ResourceActionsDropdown
              items={items}
              buttonProps={{ className: 'row-actions-trigger', style: { margin: 0 } }}
            />
          );
        },
      },
    ],
    [canAssignUsers, canConfigurePermissions, canWrite, modal, onAuthorize, onAssignUser, onDelete],
  );
}
