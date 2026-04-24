import React, { useState } from 'react';
import { Tag, Input, message, Modal } from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import PageContainer from '../../../../components/PageContainer';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';

interface PolicyRow {
  id: string;
  name: string;
  priority: number;
  sourceZone: string;
  destZone: string;
  sourceIp: string;
  destIp: string;
  serviceChain: string;
  protocol: string;
  port: string;
  status: 'active' | 'inactive';
  description: string;
}

const mockData: PolicyRow[] = [
  {
    id: '2',
    name: 'Block-Malicious',
    priority: 10,
    sourceZone: 'Untrust',
    destZone: 'Trust',
    sourceIp: '10.0.0.5',
    destIp: 'Any',
    serviceChain: '-',
    protocol: 'Any',
    port: 'Any',
    status: 'active',
    description: 'Block known malicious IP',
  },
];

const Policies: React.FC = () => {
  const [searchText, setSearchText] = useState('');

  const filteredData = mockData.filter((item) =>
    item.name.toLowerCase().includes(searchText.toLowerCase()),
  );

  const columns: any = [
    { title: '策略名称', dataIndex: 'name', key: 'name' },
    { title: '优先级', dataIndex: 'priority', key: 'priority', sorter: (a: PolicyRow, b: PolicyRow) => a.priority - b.priority },
    { title: '源安全域', dataIndex: 'sourceZone', key: 'sourceZone' },
    { title: '目的安全域', dataIndex: 'destZone', key: 'destZone' },
    { title: '源IP', dataIndex: 'sourceIp', key: 'sourceIp' },
    { title: '目的IP', dataIndex: 'destIp', key: 'destIp' },
    { title: '服务链', dataIndex: 'serviceChain', key: 'serviceChain' },
    { title: '协议', dataIndex: 'protocol', key: 'protocol' },
    { title: '端口', dataIndex: 'port', key: 'port' },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Tag color={status === 'active' ? 'success' : 'default'}>
          {status === 'active' ? '已激活' : '未激活'}
        </Tag>
      ),
    },
    { title: '描述', dataIndex: 'description', key: 'description' },
    {
      title: '操作',
      key: 'action',
      fixed: 'right',
      render: (_: any, record: PolicyRow) => (
        <ResourceActionsDropdown
          items={[
            { key: 'edit', label: '编辑' },
            { type: 'divider' },
            { key: 'delete', label: '删除', danger: true },
          ]}
          onClick={({ key }) => {
            if (key === 'edit') message.info(`编辑策略: ${record.name}`);
            if (key === 'delete') {
              Modal.confirm({
                title: '删除策略',
                content: `确定删除「${record.name}」吗？`,
                okText: '删除',
                okType: 'danger',
                cancelText: '取消',
                onOk: () => message.info('删除流程待接入后端'),
              });
            }
          }}
          buttonProps={{ className: 'row-actions-trigger', style: { margin: 0 } }}
        />
      ),
    },
  ];

  return (
    <PageContainer
      onRefresh={() => message.info('刷新待接入后端')}
      toolbarLeft={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Input
            allowClear
            placeholder="策略名称"
            className="toolbar-search"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => setSearchText('')}
          >
            重置
          </button>
        </div>
      }
      primaryAction={{
        text: '新建策略',
        onClick: () => message.info('新建策略功能待开发'),
        icon: <PlusOutlined />,
      }}
      tableProps={{
        columns,
        dataSource: filteredData,
        rowKey: 'id',
        className: 'vr-table std-table',
        pagination: { pageSize: 10, showTotal: (total) => `共 ${total} 条` },
      }}
    />
  );
};

export default Policies;
