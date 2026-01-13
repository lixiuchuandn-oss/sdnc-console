import React, { useState, useEffect } from 'react';
import { Table, Button, Badge, Space, Dropdown, MenuProps, Tag, Descriptions, Card, Input, Form, Select, message } from 'antd';
import { ReloadOutlined, EllipsisOutlined, PlusOutlined, DatabaseOutlined, SafetyCertificateOutlined, NodeIndexOutlined } from '@ant-design/icons';
import PageContainer from '../../../../components/PageContainer';
import ResourceDetailContainer from '../../../../components/ResourceDetailContainer';
import { fetchSecurityZones } from '../../../../services/trafficOrchestration';
import type { ColumnsType } from 'antd/es/table';

// Data Types
interface SecurityZoneRow {
  id: string;
  name: string;
  clusterName: string;
  description: string;
  status: 'active' | 'inactive';
}

const SecurityZones: React.FC = () => {
  const [detailOpen, setDetailOpen] = useState(false);
  const [currentZone, setCurrentZone] = useState<SecurityZoneRow | null>(null);
  const [activeDetailTab, setActiveDetailTab] = useState('devices');
  const [data, setData] = useState<SecurityZoneRow[]>([]);
  const [loading, setLoading] = useState(false);

  // Filter State
  const [filterForm] = Form.useForm();
  const [filters, setFilters] = useState<Record<string, any>>({});

  const loadData = async () => {
    setLoading(true);
    try {
      const list = await fetchSecurityZones(filters);
      setData(list);
    } catch (e) {
      console.error(e);
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [filters]);

  const columns: ColumnsType<SecurityZoneRow> = [
    { title: '序号', key: 'index', render: (_, __, index) => index + 1 },
    { title: '安全域名称', dataIndex: 'name', key: 'name' },
    { title: '所属集群', dataIndex: 'clusterName', key: 'clusterName' },
    { title: '描述', dataIndex: 'description', key: 'description' },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status) => <Badge status={status === 'active' ? 'success' : 'default'} text={status === 'active' ? '已激活' : '未激活'} />,
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record) => (
        <Space size="middle">
          <a onClick={() => handleOpenDetail(record)}>详情</a>
          <a>编辑</a>
          <a style={{ color: 'red' }}>删除</a>
        </Space>
      ),
    },
  ];

  const handleOpenDetail = (record: SecurityZoneRow) => {
    setCurrentZone(record);
    setActiveDetailTab('devices');
    setDetailOpen(true);
  };

  const handleCloseDetail = () => {
    setDetailOpen(false);
    setCurrentZone(null);
  };

  // Detail Content
  const overviewNode = currentZone ? (
    <Card variant="borderless" title="基础信息">
      <Descriptions column={2}>
        <Descriptions.Item label="名称">{currentZone.name}</Descriptions.Item>
        <Descriptions.Item label="所属集群">{currentZone.clusterName}</Descriptions.Item>
        <Descriptions.Item label="描述">{currentZone.description}</Descriptions.Item>
        <Descriptions.Item label="状态">{currentZone.status === 'active' ? '已激活' : '未激活'}</Descriptions.Item>
      </Descriptions>
    </Card>
  ) : null;

  const detailTabs = [
    {
      key: 'devices',
      label: '安全设备',
      meta: { icon: <DatabaseOutlined />, title: '安全设备' },
      children: (
        <Table 
          bordered         dataSource={[
             { id: '1', name: 'WAF-01', type: 'WAF', status: 'running' },
             { id: '2', name: 'IPS-01', type: 'IPS', status: 'running' },
          ]} 
          columns={[
             { title: '设备名称', dataIndex: 'name' }, 
             { title: '类型', dataIndex: 'type' },
             { title: '状态', dataIndex: 'status', render: (s) => <Badge status="success" text="运行中" /> }
          ]} 
          rowKey="id"
        />
      ),
    },
    {
      key: 'protected-objects',
      label: '防护对象',
      meta: { icon: <SafetyCertificateOutlined />, title: '防护对象' },
      children: (
        <Table 
          bordered
          dataSource={[
             { id: '1', name: 'Web Server', type: 'IP', value: '192.168.1.10' },
           ]}
           columns={[
             { title: '对象名称', dataIndex: 'name' }, 
             { title: '类型', dataIndex: 'type' },
             { title: '值', dataIndex: 'value' }
           ]} 
           rowKey="id"
        />
      ),
    },
    {
      key: 'service-chains',
      label: '服务链',
      meta: { icon: <NodeIndexOutlined />, title: '服务链' },
      children: (
        <Table 
          bordered
          dataSource={[
             { id: '1', name: 'Web Protection', type: 'serial' },
           ]}
           columns={[
             { title: '服务链名称', dataIndex: 'name' }, 
             { title: '类型', dataIndex: 'type', render: (t) => t === 'serial' ? '串行' : '旁路' }
           ]} 
           rowKey="id"
        />
      ),
    },
  ];

  return (
    <PageContainer
      toolbarLeft={
        <Form
          form={filterForm}
          layout="vertical"
          style={{ rowGap: 12, columnGap: 12, display: 'flex', alignItems: 'flex-end' }}
          onValuesChange={(_, allValues) => setFilters(allValues)}
        >
          <Form.Item name="keyword" label="名称" style={{ marginBottom: 0 }}>
            <Input placeholder="搜索安全域名称" style={{ width: 200 }} allowClear />
          </Form.Item>
          <Form.Item name="cluster" label="所属集群" style={{ marginBottom: 0 }}>
            <Select placeholder="所属集群" style={{ width: 150 }} allowClear>
              <Select.Option value="Cluster-A">Cluster-A</Select.Option>
              <Select.Option value="Cluster-B">Cluster-B</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="status" label="状态" style={{ marginBottom: 0 }}>
            <Select placeholder="状态" style={{ width: 120 }} allowClear>
              <Select.Option value="active">已激活</Select.Option>
              <Select.Option value="inactive">未激活</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      }
      primaryAction={{
        text: '创建安全域',
        onClick: () => {},
        type: 'primary',
      }}
      moreMenuItems={[
        { key: 'refresh', label: '刷新', onClick: loadData },
      ]}
      tableProps={{
        columns,
        dataSource: data,
        loading,
        rowKey: "id",
      }}
    >
      <ResourceDetailContainer
        open={detailOpen}
        cloudId="" // Not needed for this mock
        vmDetail={currentZone}
        tabKey={activeDetailTab}
        onChangeTab={setActiveDetailTab}
        onRefreshAll={() => {}}
        onCloseModal={handleCloseDetail}
        overviewNode={overviewNode}
        tabsItems={detailTabs}
      />
    </PageContainer>
  );
};

export default SecurityZones;
