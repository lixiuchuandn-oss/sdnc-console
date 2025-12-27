import React, { useState } from 'react';
import { Space, Tag, Modal, Form, Input, Select, Card, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import ReactFlow, {
  Controls,
  Background,
} from 'react-flow-renderer';
import 'react-flow-renderer/dist/style.css';
import PageContainer from '../../../../components/PageContainer';

interface ServiceChainRow {
  id: string;
  name: string;
  clusterName: string;
  type: 'serial' | 'bypass';
  status: 'active' | 'inactive';
  description: string;
}

const data: ServiceChainRow[] = [
  { id: '1', name: 'Web Protection Chain', clusterName: 'Cluster-A', type: 'serial', status: 'active', description: 'WAF -> IPS' },
  { id: '2', name: 'Monitor Chain', clusterName: 'Cluster-B', type: 'bypass', status: 'active', description: 'IDS' },
];

const ServiceChains: React.FC = () => {
  const navigate = useNavigate();
  
  // Detail Modal
  const [detailOpen, setDetailOpen] = useState(false);
  const [currentChain, setCurrentChain] = useState<ServiceChainRow | null>(null);

  // Filter State
  const [filterForm] = Form.useForm();
  const [filters, setFilters] = useState<Record<string, any>>({});

  const filteredData = React.useMemo(() => {
    return data.filter(item => {
      if (filters.keyword && !item.name.toLowerCase().includes(filters.keyword.toLowerCase())) return false;
      if (filters.cluster && item.clusterName !== filters.cluster) return false;
      if (filters.type && item.type !== filters.type) return false;
      if (filters.status && item.status !== filters.status) return false;
      return true;
    });
  }, [filters, data]);

  const columns = [
    { title: '服务链名称', dataIndex: 'name', key: 'name' },
    { title: '所属集群', dataIndex: 'clusterName', key: 'clusterName' },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      render: (type: string) => <Tag color={type === 'serial' ? 'blue' : 'cyan'}>{type === 'serial' ? '串行' : '旁路'}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => <Tag color={status === 'active' ? 'success' : 'default'}>{status === 'active' ? '已激活' : '未激活'}</Tag>,
    },
    { title: '描述', dataIndex: 'description', key: 'description' },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => (
        <Space size="middle">
          <a onClick={() => { setCurrentChain(record); setDetailOpen(true); }}>详情</a>
          <a>编辑</a>
          <a style={{ color: 'red' }}>删除</a>
        </Space>
      ),
    },
  ];

  // Detail Topology (Read-only view for now, using static nodes)
  const detailNodes = [
      { id: 'd-in', type: 'input', data: { label: 'Traffic In' }, position: { x: 50, y: 100 } },
      { id: 'd-1', data: { label: 'WAF' }, position: { x: 200, y: 100 } },
      { id: 'd-2', data: { label: 'IPS' }, position: { x: 350, y: 100 } },
      { id: 'd-out', type: 'output', data: { label: 'Traffic Out' }, position: { x: 500, y: 100 } },
  ];
  const detailEdges = [
      { id: 'e1', source: 'd-in', target: 'd-1' },
      { id: 'e2', source: 'd-1', target: 'd-2' },
      { id: 'e3', source: 'd-2', target: 'd-out' },
  ];

  return (
    <PageContainer
      title="服务链管理"
      subtitle="服务链（Service Chain）通过灵活编排网络流量经过防火墙、IPS、WAF 等安全组件，实现业务流量的按需清洗与防护，支持串行阻断与旁路检测模式。"
      toolbarLeft={
        <Form
          form={filterForm}
          layout="vertical"
          style={{ rowGap: 12, columnGap: 12, display: 'flex', alignItems: 'flex-end' }}
          onValuesChange={(_, allValues) => setFilters(allValues)}
        >
          <Form.Item name="keyword" label="关键字" style={{ marginBottom: 0 }}>
            <Input placeholder="搜索服务链名称" style={{ width: 200 }} allowClear />
          </Form.Item>
          <Form.Item name="cluster" label="所属集群" style={{ marginBottom: 0 }}>
            <Select placeholder="所属集群" style={{ width: 150 }} allowClear>
              <Select.Option value="Cluster-A">Cluster-A</Select.Option>
              <Select.Option value="Cluster-B">Cluster-B</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="type" label="类型" style={{ marginBottom: 0 }}>
            <Select placeholder="类型" style={{ width: 120 }} allowClear>
              <Select.Option value="serial">串行</Select.Option>
              <Select.Option value="bypass">旁路</Select.Option>
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
        text: '创建服务链',
        onClick: () => navigate('/admin/security/traffic/service-chains/create'),
        type: 'primary',
      }}
      moreMenuItems={[
        { key: 'refresh', label: '刷新', onClick: () => message.success('已刷新') },
      ]}
      defaultHiddenColumns={[]}
      tableProps={{
        columns,
        dataSource: filteredData,
        rowKey: "id",
      }}
    >
      {/* Detail Modal with Topology */}
      <Modal
        open={detailOpen}
        title={`服务链详情: ${currentChain?.name}`}
        width={900}
        onCancel={() => setDetailOpen(false)}
        footer={null}
      >
        <Card title="拓扑视图" bordered={false}>
          <div style={{ height: 400, border: '1px solid #f0f0f0', background: '#f5f5f5' }}>
             <ReactFlow
                nodes={detailNodes}
                edges={detailEdges}
                fitView
                elementsSelectable={false}
             >
                 <Background color="#aaa" gap={16} />
                 <Controls showInteractive={false} />
             </ReactFlow>
          </div>
        </Card>
      </Modal>
    </PageContainer>
  );
};

export default ServiceChains;
