import React, { useState, useEffect } from 'react';
import { Table, Button, Space, Tag, Modal, Form, Input, Select, message } from 'antd';
import { ReloadOutlined, PlusOutlined } from '@ant-design/icons';
import PageContainer from '../../../../components/PageContainer';
import StdFormModal from '../../../../components/StdFormModal';
import { fetchClouds, fetchCsmAssets, createCsmAsset, deleteCsmAsset } from '../../../../services/api';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';

interface ProtectedObjectRow {
  id: string;
  name: string;
  type: 'ip' | 'subnet' | 'vpc' | 'line';
  value: string;
  description: string;
  status?: 'active' | 'inactive' | 'deprecated';
  metadata?: any;
}

const ProtectedObjects: React.FC = () => {
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [csmClouds, setCsmClouds] = useState<any[]>([]);
  const [csmData, setCsmData] = useState<any[]>([]);
  const [selectedCloudId, setSelectedCloudId] = useState<string | undefined>(undefined);
  const [editAssetOpen, setEditAssetOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<any | null>(null);
  const [editAssetForm] = Form.useForm();

  // Filter State
  const [filterForm] = Form.useForm();
  const [filters, setFilters] = useState<Record<string, any>>({});

  const loadCsmAggregate = async (targetCloudId?: string) => {
    setLoading(true);
    try {
      const clouds = await fetchClouds();
      const onlyCsm = (Array.isArray(clouds) ? clouds : []).filter((c: any) => {
        const pv = String((c?.config?.provider || c?.type || '')).toLowerCase();
        return pv.includes('csm') || pv.includes('security');
      });
      const filtered = targetCloudId ? onlyCsm.filter((c:any)=> String(c.id)===String(targetCloudId)) : onlyCsm;
      const tasks = filtered.map((c:any) => fetchCsmAssets(c.id).then(json => ({ cloudId: c.id, cloudName: c.name, json })).catch(()=>({ cloudId: c.id, cloudName: c.name, json: null })));
      const results = await Promise.all(tasks);
      const merged: any[] = [];
      results.forEach(({ cloudId, cloudName, json }) => {
        const list = (json?.data?.items || json?.items || json?.data || []);
        (Array.isArray(list) ? list : []).forEach((a: any) => {
          merged.push({ ...a, cloudId, cloudName });
        });
      });
      setCsmData(merged);
    } catch (e) {
      message.error('加载CSM资产失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCsmAggregate(selectedCloudId);
  }, [filters, selectedCloudId]);

  useEffect(() => {
    const loadClouds = async () => {
      try {
        const clouds = await fetchClouds();
        const onlyCsm = (Array.isArray(clouds) ? clouds : []).filter((c: any) => {
          const pv = String((c?.config?.provider || c?.type || '')).toLowerCase();
          return pv.includes('csm') || pv.includes('security');
        });
        setCsmClouds(onlyCsm);
      } catch (e) {
        // ignore
      }
    };
    loadClouds();
  }, []);

  const loadAssets = async (cloudId?: string) => {
    setSelectedCloudId(cloudId);
    await loadCsmAggregate(cloudId);
  };

  const columns = [];

  const columnsCsm = [
    { title: '序号', key: 'index', render: (_: any, __: any, index: number) => index + 1 },
    { title: '资产ID', dataIndex: 'network_id', key: 'id', render: (t:any, r:any) => t || r?.id || r?.uuid || '-' },
    { title: '类型', dataIndex: 'type', key: 'type', render: (t:any) => {
        const map: any = { subnet: '子网', ip: 'IP', vpc: 'VPC' };
        return <Tag color="blue">{map[t] || t}</Tag>;
      } 
    },
    { title: 'IP类型', dataIndex: 'ip_type', key: 'ip_type' },
    { title: '值', dataIndex: 'value', key: 'value' },
    { title: '端口', dataIndex: 'port', key: 'port', render: (t:any) => t ?? '-' },
    { title: '来源', key: 'src', render: (_: any, r: any) => <span>{r.cloudName || r.cloudId || '-'}</span> },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => (
        <ResourceActionsDropdown
          items={[
            { key: 'edit', label: '编辑' },
            { type: 'divider' as any },
            { key: 'delete', label: '删除', danger: true },
          ]}
          onClick={({ key }) => {
            if (key === 'edit') {
              setEditingAsset(record);
              editAssetForm.setFieldsValue({
                type: record.type,
                ip_type: record.ip_type || 'ipv4',
                value: record.value,
              });
              setEditAssetOpen(true);
            } else if (key === 'delete') {
              Modal.confirm({
                title: '删除云端资产',
                content: `确定删除资产 ${record.network_id || record.id || record.uuid || ''} 吗？`,
                okText: '删除',
                okType: 'danger',
                cancelText: '取消',
                onOk: async () => {
                  try {
                    const assetId = record.network_id || record.id || record.uuid;
                    if (!record.cloudId || !assetId) { message.warning('缺少必要信息'); return; }
                    await deleteCsmAsset(record.cloudId, assetId);
                    message.success('已删除云端资产');
                    await loadCsmAggregate(selectedCloudId);
                  } catch (e:any) {
                    message.error(e.message || '云端删除失败');
                  }
                }
              });
            }
          }}
          size="small"
        />
      ),
    },
  ];

  const handleEdit = async (_values: any) => {};

  const handleAdd = async (values: any) => {
    try {
      const cloudId = values?.sourceCloudId;
      if (!cloudId) throw new Error('请选择安全资源池');
      let csmType = 'subnet';
      if (values.type === 'ip') csmType = 'ip';
      else csmType = 'subnet';
      const csmPayload: any = { type: csmType, ip_type: (values.ip_type || 'ipv4'), value: values.value };
      if (typeof values.port === 'string' && values.port.trim().length > 0) {
        csmPayload.port = values.port.trim();
      }
      await createCsmAsset(cloudId, csmPayload);
      message.success('云端资产创建成功');
      setModalOpen(false);
      form.resetFields();
      await loadCsmAggregate(selectedCloudId);
    } catch (e: any) {
      console.error(e);
      message.error(e.message || '创建失败');
    }
  };

  return (
    <PageContainer
      toolbarLeft={
        <Form
          form={filterForm}
          layout="vertical"
          style={{ rowGap: 12, columnGap: 12, display: 'flex', alignItems: 'flex-end' }}
          onValuesChange={(_, allValues) => setFilters(allValues)}
        >
          <Form.Item name="cloudId" label="资源池" style={{ marginBottom: 0 }}>
            <Select placeholder="全部资源池" style={{ width: 200 }} allowClear value={selectedCloudId} onChange={(v)=> setSelectedCloudId(v)}>
              {csmClouds.map((c:any)=> (<Select.Option key={c.id} value={c.id}>{c.name}</Select.Option>))}
            </Select>
          </Form.Item>
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
        text: '新增资产',
        onClick: () => setModalOpen(true),
        type: 'primary',
      }}
      moreMenuItems={[
        { key: 'refresh', label: '刷新', onClick: () => loadCsmAggregate(selectedCloudId) },
      ]}
      tableProps={{
        columns: columnsCsm,
        dataSource: csmData,
        loading,
        rowKey: ((r:any) => `${r.cloudId || 'x'}::${r.network_id || r.id || r.uuid || Math.random().toString(36).slice(2)}`),
      }}
    >
      <StdFormModal
        open={editAssetOpen}
        title="编辑云端资产"
        onFinish={async (values) => {
          try {
            if (!editingAsset) return;
            const cloudId = editingAsset.cloudId;
            const assetId = editingAsset.network_id || editingAsset.id || editingAsset.uuid;
            if (!cloudId || !assetId) throw new Error('缺少必要信息');
            await deleteCsmAsset(cloudId, assetId);
            await createCsmAsset(cloudId, { type: editingAsset.type, ip_type: values.ip_type, value: values.value });
            message.success('更新成功');
            setEditAssetOpen(false);
            setEditingAsset(null);
            await loadCsmAggregate(selectedCloudId);
          } catch (e:any) {
            message.error(e.message || '更新失败');
          }
        }}
        onCancel={() => setEditAssetOpen(false)}
        form={editAssetForm}
      >
        <Form.Item name="type" label="类型" rules={[{ required: true }]}>
          <Select disabled>
            <Select.Option value="ip">IP</Select.Option>
            <Select.Option value="subnet">IP段</Select.Option>
          </Select>
        </Form.Item>
        <Form.Item name="ip_type" label="IP类型" rules={[{ required: true }]}>
          <Select>
            <Select.Option value="ipv4">IPv4</Select.Option>
            <Select.Option value="ipv6">IPv6</Select.Option>
          </Select>
        </Form.Item>
        <Form.Item name="value" label="值 (IP/CIDR)" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
      </StdFormModal>
      <StdFormModal
        open={modalOpen}
        title="新增云端资产"
        onFinish={handleAdd}
        onCancel={() => setModalOpen(false)}
        form={form}
      >
        <Form.Item name="type" label="类型" rules={[{ required: true }]}>
          <Select>
            <Select.Option value="ip">IP</Select.Option>
            <Select.Option value="subnet">IP段</Select.Option>
            <Select.Option value="vpc">VPC子网</Select.Option>
            <Select.Option value="line">专线</Select.Option>
          </Select>
        </Form.Item>
        <Form.Item name="ip_type" label="IP类型" initialValue="ipv4" rules={[{ required: true }]}>
          <Select>
            <Select.Option value="ipv4">IPv4</Select.Option>
            <Select.Option value="ipv6">IPv6</Select.Option>
          </Select>
        </Form.Item>
        <Form.Item name="value" label="值 (IP/CIDR/ID)" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="port" label="端口">
          <Input placeholder="例如 80,443 或 1-65535；留空表示全部" />
        </Form.Item>
        <Form.Item name="sourceCloudId" label="安全资源池（CSM）">
          <Select placeholder="选择资源池" allowClear>
            {csmClouds.map((c:any) => (<Select.Option key={c.id} value={c.id}>{c.name}</Select.Option>))}
          </Select>
        </Form.Item>
      </StdFormModal>
    </PageContainer>
  );
};

export default ProtectedObjects;
