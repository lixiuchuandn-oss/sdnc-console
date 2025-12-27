import React, { useState } from 'react';
import { Button, Space, Tag, Input, Select, message, Modal, Form } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import PageContainer from '../../../../components/PageContainer';

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
  type: 'diversion' | 'blocking';
}

const mockData: PolicyRow[] = [
  {
    id: '1',
    name: 'Web-Diversion-01',
    priority: 100,
    sourceZone: 'Trust',
    destZone: 'Untrust',
    sourceIp: '192.168.1.0/24',
    destIp: 'Any',
    serviceChain: 'Web Protection Chain',
    protocol: 'TCP',
    port: '80,443',
    status: 'active',
    description: 'Divert web traffic to WAF',
    type: 'diversion',
  },
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
    type: 'blocking',
  },
];

const Policies: React.FC = () => {
  const [activeTab, setActiveTab] = useState('diversion');
  const [searchText, setSearchText] = useState('');

  const filteredData = mockData.filter(
    (item) => item.type === activeTab && item.name.toLowerCase().includes(searchText.toLowerCase())
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
      render: (_: any, record: PolicyRow) => (
        <Space size="middle">
          <Button type="link" icon={<EditOutlined />} onClick={() => message.info(`编辑策略: ${record.name}`)}>
            编辑
          </Button>
          <Button type="link" danger icon={<DeleteOutlined />} onClick={() => message.info(`删除策略: ${record.name}`)}>
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <PageContainer
      title="策略管理"
      subtitle="统一配置引流策略与阻断策略，实现对流量的灵活调度、牵引清洗及安全阻断，全方位保障网络安全与业务连续性。"
      tabList={[
        { key: 'diversion', tab: '引流策略' },
        { key: 'blocking', tab: '阻断策略' },
      ]}
      tabActiveKey={activeTab}
      onTabChange={setActiveTab}
      toolbarLeft={
        <Form layout="vertical" style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
          <Form.Item label="关键字" style={{ marginBottom: 0 }}>
            <Input
              placeholder="搜索策略名称"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              style={{ width: 250 }}
              allowClear
            />
          </Form.Item>
        </Form>
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
        pagination: { pageSize: 10 },
      }}
    />
  );
};

export default Policies;
