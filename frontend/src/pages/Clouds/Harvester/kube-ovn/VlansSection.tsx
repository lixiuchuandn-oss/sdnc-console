import React, { useEffect, useState } from 'react';
import { Alert, Button, Form, Input, Modal, Select, Table, Tag, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { createKubeOvnVlan, fetchKubeOvnProviderNetworks, fetchKubeOvnVlans } from '../../../../services/harvesterApi';
import { useAuth } from '../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../utils/accessMapping';

const { Option } = Select;

type Props = {
  cloudId: string;
};

const VlansSection: React.FC<Props> = ({ cloudId }) => {
  const { user } = useAuth();
  const canCreateVlan = hasPermissionForAction(user?.permissions || [], 'clouds.vlans:write');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [form] = Form.useForm();
  const [providers, setProviders] = useState<any[]>([]);
  const [keyword, setKeyword] = useState('');
  const [providerFilter, setProviderFilter] = useState<string | undefined>(undefined);

  const fetchData = async (force = false, skipSync = false) => {
    setLoading(true);
    try {
      const res = await fetchKubeOvnVlans(cloudId, force, skipSync);
      setData(Array.isArray(res?.data?.items) ? res.data.items : []);
    } catch (error: any) {
      message.error(`获取 VLAN 列表失败: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const fetchProviderOptions = async () => {
    try {
      const res = await fetchKubeOvnProviderNetworks(cloudId);
      setProviders(Array.isArray(res?.data?.items) ? res.data.items : []);
    } catch {}
  };

  useEffect(() => {
    if (!cloudId) return;
    fetchData();
    fetchProviderOptions();
  }, [cloudId]);

  const handleCreate = async (values: any) => {
    try {
      await createKubeOvnVlan(cloudId, values);
      message.success('创建 VLAN 成功');
      setIsModalVisible(false);
      form.resetFields();
      fetchData(true, true);
    } catch (error: any) {
      message.error(`创建失败: ${error.message}`);
    }
  };

  const columns = [
    { title: '名称', dataIndex: ['metadata', 'name'], key: 'name', render: (text: string) => <b>{text}</b> },
    { title: 'VLAN ID', dataIndex: ['spec', 'id'], key: 'id', render: (id: number) => <Tag color="purple">{id}</Tag> },
    { title: 'Provider Network', dataIndex: ['spec', 'provider'], key: 'provider', render: (provider: string) => <Tag color="geekblue">{provider}</Tag> },
    { title: '创建时间', dataIndex: ['metadata', 'creationTimestamp'], key: 'created', render: (text: string) => new Date(text).toLocaleString() },
  ];

  return (
    <div>
      <div className="page-toolbar">
        <div className="toolbar-container">
          <Input allowClear placeholder="名称/VLAN ID" value={keyword} onChange={(e) => setKeyword(e.target.value)} className="toolbar-search" />
          <Select allowClear placeholder="筛选 Provider" className="toolbar-filter-sm" value={providerFilter} onChange={setProviderFilter}>
            {providers.map(p => <Option key={p.metadata.name} value={p.metadata.name}>{p.metadata.name}</Option>)}
          </Select>
          <a className="toolbar-reset-btn" onClick={() => { setKeyword(''); setProviderFilter(undefined); fetchData(); }}>重置</a>
        </div>
        <div className="toolbar-actions">
          {canCreateVlan && <Button type="primary" onClick={() => setIsModalVisible(true)}>创建 VLAN</Button>}
          <Button icon={<ReloadOutlined />} onClick={() => fetchData()} loading={loading} />
        </div>
      </div>

      <Table
        className="std-table"
        bordered={false}
        columns={columns}
        dataSource={data.filter(d => {
          const matchKeyword = !keyword || d.metadata.name.includes(keyword) || d.spec.id?.toString().includes(keyword);
          const matchProvider = !providerFilter || d.spec.provider === providerFilter;
          return matchKeyword && matchProvider;
        })}
        rowKey={(r) => r.metadata.name}
        loading={loading}
        pagination={{ size: 'small', showTotal: (total) => `共 ${total} 条` }}
      />

      <Modal title="创建 VLAN" open={isModalVisible} onOk={form.submit} onCancel={() => setIsModalVisible(false)}>
        <Form form={form} layout="vertical" onFinish={handleCreate} className="std-form">
          <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input placeholder="例如: vlan-100" /></Form.Item>
          <Form.Item name="id" label="VLAN ID" rules={[{ required: true }]}><Input type="number" placeholder="0 表示 Flat Network (无 Tag), 1-4095 为 VLAN Tag" /></Form.Item>
          <Form.Item name="provider" label="Provider Network" rules={[{ required: true }]}>
            <Select placeholder="选择物理接口映射">
              {providers.map(p => <Option key={p.metadata.name} value={p.metadata.name}>{p.metadata.name}</Option>)}
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default VlansSection;

