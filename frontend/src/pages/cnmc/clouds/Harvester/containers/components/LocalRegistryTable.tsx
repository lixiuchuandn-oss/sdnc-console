/**
 * 本地 Docker Registry 列表组件
 */
import React, { useMemo, useCallback } from 'react';
import { Table, Tag, Space, App, Tooltip, Badge, Empty } from 'antd';
import { DatabaseOutlined, DeleteOutlined, SyncOutlined, LinkOutlined } from '@ant-design/icons';
import { LocalRegistry } from '../../../../../../services/localRegistryApi';
import { deleteLocalRegistry, refreshLocalRegistryStatus } from '../../../../../../services/localRegistryApi';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import { filterMenuItemsForReadOnly } from '../../../../../../utils/rbacUi';

interface Props {
  registries: LocalRegistry[];
  loading: boolean;
  cloudId: string;
  onRefresh: () => void;
  hasWrite: boolean;
}

const LocalRegistryTable: React.FC<Props> = ({
  registries,
  loading,
  cloudId,
  onRefresh,
  hasWrite,
}) => {
  const { message } = App.useApp();

  const formatTime = (timestamp?: string) => {
    if (!timestamp) return '-';
    try {
      return new Date(timestamp).toLocaleString('zh-CN');
    } catch {
      return timestamp;
    }
  };

  const handleDelete = useCallback(async (record: LocalRegistry) => {
    try {
      await deleteLocalRegistry(cloudId, record.id);
      message.success('删除任务已提交');
      onRefresh();
    } catch (e: any) {
      message.error(e?.message || '删除失败');
    }
  }, [cloudId, message, onRefresh]);

  const handleRefreshStatus = useCallback(async (record: LocalRegistry) => {
    try {
      await refreshLocalRegistryStatus(cloudId, record.id);
      message.success('状态已刷新');
      onRefresh();
    } catch (e: any) {
      message.error(e?.message || '刷新失败');
    }
  }, [cloudId, message, onRefresh]);

  const columns = useMemo(() => [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: LocalRegistry) => (
        <Space>
          <DatabaseOutlined style={{ color: '#1890ff' }} />
          <a onClick={() => {
            navigator.clipboard.writeText(record.server);
            message.success('已复制地址');
          }}>{name}</a>
        </Space>
      ),
    },
    {
      title: '仓库地址',
      dataIndex: 'server',
      key: 'server',
      ellipsis: true,
      render: (server: string) => (
        <Tooltip title={server}>
          <code style={{ fontSize: 12 }}>{server}</code>
        </Tooltip>
      ),
    },
    {
      title: '命名空间',
      dataIndex: 'namespace',
      key: 'namespace',
      render: (ns: string) => <Tag>{ns}</Tag>,
    },
    {
      title: '端口',
      dataIndex: 'nodePort',
      key: 'nodePort',
      width: 80,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => {
        const config: Record<string, { color: string; text: string }> = {
          deploying: { color: 'processing', text: '部署中' },
          healthy: { color: 'success', text: '健康' },
          unhealthy: { color: 'error', text: '异常' },
          deleting: { color: 'warning', text: '删除中' },
        };
        const c = config[status] || { color: 'default', text: status };
        return <Badge status={c.color as any} text={c.text} />;
      },
    },
    {
      title: '存储',
      dataIndex: 'storageSize',
      key: 'storageSize',
      render: (size?: string) => size || '-',
    },
    {
      title: '认证',
      dataIndex: 'authEnabled',
      key: 'authEnabled',
      render: (enabled: boolean) => (
        <Tag color={enabled ? 'blue' : 'default'}>
          {enabled ? '已启用' : '无需认证'}
        </Tag>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: formatTime,
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right' as const,
      render: (_: any, record: LocalRegistry) => {
        const items = [
          {
            key: 'copy',
            label: '复制地址',
            icon: <LinkOutlined />,
            onClick: () => {
              navigator.clipboard.writeText(record.server);
              message.success('已复制');
            },
          },
          {
            key: 'refresh',
            label: '刷新状态',
            icon: <SyncOutlined />,
            onClick: () => handleRefreshStatus(record),
          },
          {
            key: 'delete',
            label: '删除',
            icon: <DeleteOutlined />,
            danger: true,
            onClick: () => handleDelete(record),
          },
        ];
        return (
          <ResourceActionsDropdown
            items={filterMenuItemsForReadOnly(items, hasWrite)}
            buttonProps={{ className: 'row-actions-trigger' }}
          />
        );
      },
    },
  ], [handleDelete, handleRefreshStatus, hasWrite, message]);

  if (registries.length === 0 && !loading) {
    return <Empty description="暂无本地仓库" />;
  }

  return (
    <Table
      className="std-table"
      scroll={{ x: true }}
      bordered={false}
      rowKey="id"
      columns={columns}
      dataSource={registries}
      loading={loading}
      pagination={{ showTotal: (total) => `共 ${total} 条` }}
    />
  );
};

export default LocalRegistryTable;
