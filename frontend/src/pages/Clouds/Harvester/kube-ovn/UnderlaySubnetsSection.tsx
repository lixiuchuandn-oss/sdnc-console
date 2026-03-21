import React, { useEffect, useState } from 'react';
import { Alert, Button, Form, Input, Modal, Popconfirm, Select, Table, Tag, message } from 'antd';
import { DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import { createKubeOvnSubnet, deleteKubeOvnSubnet, fetchKubeOvnProviderNetworks, fetchKubeOvnSubnets, fetchKubeOvnVlans } from '../../../../services/harvesterApi';

const { Option } = Select;

type Props = {
  cloudId: string;
  mode?: 'flat' | 'public';
};

const SUBNET_TYPE_ANNOTATION_KEY = 'tower.io/subnet-type';
const SUBNET_FINALIZER = 'tower.io/managed';

const UnderlaySubnetsSection: React.FC<Props> = ({ cloudId, mode = 'flat' }) => {
  const isFlatMode = mode === 'flat';
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [form] = Form.useForm();
  const [vlans, setVlans] = useState<any[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [keyword, setKeyword] = useState('');
  const [vlanFilter, setVlanFilter] = useState<string | undefined>(undefined);

  const fetchData = async (force = false, skipSync = false) => {
    setLoading(true);
    try {
      const res = await fetchKubeOvnSubnets(cloudId, force, skipSync);
      const items = Array.isArray(res?.data?.items) ? res.data.items : [];
      const expectType = isFlatMode ? 'flat' : 'public';
      const typed = items.filter((item: any) => {
        const t = String(item?.metadata?.annotations?.[SUBNET_TYPE_ANNOTATION_KEY] || '').trim().toLowerCase();
        return t === expectType;
      });
      setData(typed);
    } catch (error: any) {
      message.error(`获取子网列表失败: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const fetchVlanOptions = async () => {
    try {
      const res = await fetchKubeOvnVlans(cloudId);
      setVlans(Array.isArray(res?.data?.items) ? res.data.items : []);
    } catch {}
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
    fetchVlanOptions();
    fetchProviderOptions();
  }, [cloudId]);

  const handleForceRefresh = async () => {
    await Promise.all([
      fetchData(true, false),
      fetchVlanOptions(),
      fetchProviderOptions(),
    ]);
  };

  const handleCreate = async (values: any) => {
    try {
      const excludeIps = values.excludeIps
        ? values.excludeIps.split('\n').map((s: string) => s.trim()).filter((s: string) => s)
        : [];
      const payload = {
        ...values,
        excludeIps,
        protocol: 'IPv4',
        vpc: values.vpc || 'ovn-cluster',
        gatewayType: values.gatewayType || 'distributed',
        private: values.private ?? false,
        natOutgoing: isFlatMode ? false : true,
        annotations: {
          ...(values?.annotations || {}),
          [SUBNET_TYPE_ANNOTATION_KEY]: isFlatMode ? 'flat' : 'public',
        },
        finalizers: Array.from(new Set([...(Array.isArray(values?.finalizers) ? values.finalizers : []), SUBNET_FINALIZER])),
      };
      const createRes = await createKubeOvnSubnet(cloudId, payload);
      const createdSubnet = createRes?.data || createRes;
      const createdType = String(createdSubnet?.metadata?.annotations?.[SUBNET_TYPE_ANNOTATION_KEY] || '').trim().toLowerCase();
      const expectType = isFlatMode ? 'flat' : 'public';
      if (createdSubnet?.metadata?.name && createdType === expectType) {
        setData((prev) => {
          const next = prev.filter((i: any) => i?.metadata?.name !== createdSubnet.metadata.name);
          return [createdSubnet, ...next];
        });
      }
      message.success('创建子网成功');
      setIsModalVisible(false);
      form.resetFields();
      fetchData(false, true);
    } catch (error: any) {
      message.error(`创建失败: ${error.message}`);
    }
  };

  const handleDelete = async (name: string) => {
    try {
      await deleteKubeOvnSubnet(cloudId, name);
      message.success('删除成功');
      fetchData();
    } catch (error: any) {
      const raw =
        error?.response?.data?.message ??
        error?.response?.data?.error ??
        error?.response?.data ??
        error?.data?.message ??
        error?.data ??
        error?.message ??
        '未知错误';
      const detail = typeof raw === 'string' ? raw : JSON.stringify(raw);
      message.error(`删除失败: ${detail}`);
    }
  };

  const columns = [
    { title: '名称', dataIndex: ['metadata', 'name'], key: 'name' },
    { title: 'VPC', dataIndex: ['spec', 'vpc'], key: 'vpc', render: (v: string) => v || 'ovn-cluster' },
    { title: 'CIDR', dataIndex: ['spec', 'cidrBlock'], key: 'cidr' },
    { title: '网关', dataIndex: ['spec', 'gateway'], key: 'gateway' },
    { title: 'VLAN', dataIndex: ['spec', 'vlan'], key: 'vlan', render: (v: string) => (v ? <Tag color="blue">{v}</Tag> : <Tag>未打标签 (Untagged)</Tag>) },
    { title: 'Provider', dataIndex: ['spec', 'provider'], key: 'provider', render: (v: string) => (v ? <Tag color="geekblue">{v}</Tag> : '-') },
    {
      title: '可用 IP',
      key: 'usage',
      render: (_: any, record: any) => {
        const available = record.status?.availableIPs || 0;
        const using = record.status?.usingIPs || 0;
        return <span>{using} / {available + using}</span>;
      },
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => (
        <Popconfirm title="确定删除该子网吗？这将同时删除关联的网络附加定义（NAD）。" onConfirm={() => handleDelete(record.metadata.name)}>
          <Button type="link" danger icon={<DeleteOutlined />}>删除</Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div className="toolbar-container">
          <Input allowClear placeholder="名称/ID" value={keyword} onChange={(e) => setKeyword(e.target.value)} className="toolbar-search" />
          <Select allowClear placeholder="筛选 VLAN" className="toolbar-filter-sm" style={{ width: 180, marginRight: 8 }} value={vlanFilter} onChange={setVlanFilter}>
            {vlans.map(v => <Option key={v.metadata.name} value={v.metadata.name}>{v.metadata.name}</Option>)}
          </Select>
          <a className="toolbar-reset-btn" onClick={() => { setKeyword(''); setVlanFilter(undefined); handleForceRefresh(); }}>重置</a>
        </div>
        <div className="toolbar-actions">
          <Button type="primary" onClick={() => setIsModalVisible(true)}>
            {isFlatMode ? '创建扁平网络' : '创建公共网络'}
          </Button>
          <Button icon={<ReloadOutlined />} onClick={handleForceRefresh} loading={loading} />
        </div>
      </div>

      <Table
        className="std-table"
        bordered={false}
        columns={columns}
        dataSource={data}
        rowKey={(r) => r.metadata.name}
        loading={loading}
        pagination={{ size: 'small', showTotal: (total) => `共 ${total} 条` }}
      />

      <Modal title={isFlatMode ? '创建扁平网络' : '创建公共网络'} open={isModalVisible} onOk={form.submit} onCancel={() => setIsModalVisible(false)} width={600}>
        <Form form={form} layout="vertical" onFinish={handleCreate} className="std-form">
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message={isFlatMode ? '这里创建的是 Kube-OVN 新扁平网络（非旧版 NAD 网络）。' : '这里创建的是 Kube-OVN 公共网络（用于 EIP/NAT 相关场景）。'}
          />
          <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input placeholder={isFlatMode ? '例如: flat-net-1' : '例如: public-net-1'} /></Form.Item>
          <Form.Item name="cidrBlock" label="CIDR" rules={[{ required: true }]}><Input placeholder="192.168.1.0/24" /></Form.Item>
          <Form.Item name="gateway" label="网关" rules={[{ required: true }]}><Input placeholder="192.168.1.1" /></Form.Item>
          <Form.Item name="vlan" label="绑定 VLAN" tooltip="选择一个已存在的 VLAN 资源。这将决定该子网使用哪个物理接口。">
            <Select placeholder={isFlatMode ? '可选：选择 VLAN（不选表示未打标签）' : '可选：选择 VLAN'} allowClear>
              {vlans.map(v => <Option key={v.metadata.name} value={v.metadata.name}>{v.metadata.name} (ID: {v.spec.id}, Provider: {v.spec.provider})</Option>)}
            </Select>
          </Form.Item>
          <Form.Item
            name="provider"
            label="Provider Network"
            tooltip="扁平网络可仅选择 Provider（不选择 VLAN），用于未打标签的物理网络。"
            rules={[
              {
                validator: async (_, value) => {
                  if (!isFlatMode) return Promise.resolve();
                  const vlan = form.getFieldValue('vlan');
                  if (!vlan && !value) {
                    return Promise.reject(new Error('创建扁平网络时，请至少选择 VLAN 或 Provider Network'));
                  }
                  return Promise.resolve();
                },
              },
            ]}
          >
            <Select placeholder={isFlatMode ? '可选：不选 VLAN 时请选择 Provider' : '可选'} allowClear>
              {providers.map((p) => (
                <Option key={p.metadata.name} value={p.metadata.name}>{p.metadata.name}</Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="excludeIps" label="排除 IP (可选)">
            <Input.TextArea rows={3} placeholder="每行一个 IP 或 IP 范围 (e.g. 192.168.1.1..192.168.1.10)" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default UnderlaySubnetsSection;

