import React, { useState, useEffect } from 'react';
import { Table, Button, Space, Tag, Modal, Form, Input, Select, message } from 'antd';
import { ReloadOutlined, PlusOutlined } from '@ant-design/icons';
import PageContainer from '../../../../components/PageContainer';
import StdFormModal from '../../../../components/StdFormModal';
import { fetchProtectionObjects, createProtectionObject, deleteProtectionObject } from '../../../../services/trafficOrchestration';

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
  const [data, setData] = useState<ProtectedObjectRow[]>([]);
  const [loading, setLoading] = useState(false);

  // Filter State
  const [filterForm] = Form.useForm();
  const [filters, setFilters] = useState<Record<string, any>>({});

  const loadData = async () => {
    setLoading(true);
    try {
      const list = await fetchProtectionObjects(filters);
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

  const columns = [
    { title: '序号', key: 'index', render: (_: any, __: any, index: number) => index + 1 },
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
          <a style={{ color: 'red' }} onClick={async () => {
             try {
               await deleteProtectionObject(record.id);
               message.success('删除成功');
               loadData();
             } catch(e) {
               message.error('删除失败');
             }
          }}>删除</a>
        </Space>
      ),
    },
  ];

  const handleAdd = async (values: any) => {
    try {
      await createProtectionObject(values);
      message.success('创建成功');
      setModalOpen(false);
      form.resetFields();
      loadData();
    } catch (e) {
      console.error(e);
      message.error('创建失败');
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
        { key: 'refresh', label: '刷新', onClick: loadData },
      ]}
      tableProps={{
        columns,
        dataSource: data,
        loading,
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
