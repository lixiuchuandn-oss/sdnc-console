import React, { useState } from 'react';
import { Table, Button, Space, Tag, Modal, Form, Input, Select, message } from 'antd';
import { ReloadOutlined, PlusOutlined } from '@ant-design/icons';
import PageContainer from '../../../../components/PageContainer';
import StdFormModal from '../../../../components/StdFormModal';

interface ProtectedObjectRow {
  id: string;
  name: string;
  type: 'ip' | 'subnet' | 'vpc' | 'line';
  value: string;
  description: string;
}

const ProtectedObjects: React.FC = () => {
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();

  // Filter State
  const [filterForm] = Form.useForm();
  const [filters, setFilters] = useState<Record<string, any>>({});

  const data: ProtectedObjectRow[] = [
    { id: '1', name: 'Web Server IP', type: 'ip', value: '192.168.1.10', description: 'Main Web Server' },
    { id: '2', name: 'Office Subnet', type: 'subnet', value: '10.0.0.0/24', description: 'Office Network' },
    { id: '3', name: 'Prod VPC', type: 'vpc', value: 'vpc-123456', description: 'Production VPC' },
  ];

  const filteredData = React.useMemo(() => {
    return data.filter(item => {
      if (filters.keyword && !item.name.toLowerCase().includes(filters.keyword.toLowerCase())) return false;
      if (filters.type && item.type !== filters.type) return false;
      return true;
    });
  }, [filters]);

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      render: (type: string) => {
        const map = { ip: 'IP', subnet: 'IP段', vpc: 'VPC子网', line: '专线' };
        return <Tag>{map[type as keyof typeof map] || type}</Tag>;
      },
    },
    { title: '值', dataIndex: 'value', key: 'value' },
    { title: '描述', dataIndex: 'description', key: 'description' },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => (
        <Space size="middle">
          <a>编辑</a>
          <a style={{ color: 'red' }}>删除</a>
        </Space>
      ),
    },
  ];

  const handleAdd = async (values: any) => {
    try {
      console.log('Add Object:', values);
      setModalOpen(false);
      form.resetFields();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <PageContainer
      title="防护对象管理"
      subtitle="防护对象（Protected Object）是安全策略生效的实体集合，全面支持 IP 地址、CIDR 网段、VPC 子网及专线连接等多种网络资产类型。通过对防护对象的统一抽象与管理，实现安全策略与具体网络架构的解耦，提升策略复用性与运维效率。"
      toolbarLeft={
        <Form
          form={filterForm}
          layout="vertical"
          style={{ rowGap: 12, columnGap: 12, display: 'flex', alignItems: 'flex-end' }}
          onValuesChange={(_, allValues) => setFilters(allValues)}
        >
          <Form.Item name="keyword" label="名称" style={{ marginBottom: 0 }}>
            <Input placeholder="搜索防护对象名称" style={{ width: 200 }} allowClear />
          </Form.Item>
          <Form.Item name="type" label="类型" style={{ marginBottom: 0 }}>
            <Select placeholder="类型" style={{ width: 150 }} allowClear>
              <Select.Option value="ip">IP</Select.Option>
              <Select.Option value="subnet">IP段</Select.Option>
              <Select.Option value="vpc">VPC子网</Select.Option>
              <Select.Option value="line">专线</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      }
      primaryAction={{
        text: '添加防护对象',
        onClick: () => setModalOpen(true),
        type: 'primary',
      }}
      moreMenuItems={[
        { key: 'refresh', label: '刷新', onClick: () => message.success('已刷新') },
      ]}
      tableProps={{
        columns,
        dataSource: filteredData,
        rowKey: "id",
      }}
    >
      <StdFormModal
        open={modalOpen}
        title="添加防护对象"
        onFinish={handleAdd}
        onCancel={() => setModalOpen(false)}
        form={form}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="type" label="类型" rules={[{ required: true }]}>
            <Select>
              <Select.Option value="ip">IP</Select.Option>
              <Select.Option value="subnet">IP段</Select.Option>
              <Select.Option value="vpc">VPC子网</Select.Option>
              <Select.Option value="line">专线</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="value" label="值 (IP/CIDR/ID)" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea />
          </Form.Item>
        </Form>
      </StdFormModal>
    </PageContainer>
  );
};

export default ProtectedObjects;
