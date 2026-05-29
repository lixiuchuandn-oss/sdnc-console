import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { App, Button, Input, Table, Space, Tabs, Tag, Modal, Form, Select, Typography } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import StdSideDrawer from '../../../../../components/StdSideDrawer';
import { statusTag } from '../../Hw/components/Common';
import {
  fetchCloudProviderLoadBalancerDetail,
  fetchCloudProviderLoadBalancerHealth,
  addCloudProviderBackendServers,
  removeCloudProviderBackendServers,
  operateCloudProviderListener,
} from '../../../../../services/aliyunApi';

type Props = {
  open: boolean;
  cloudId: string;
  slb: any | null;
  ecs?: any[];
  onClose: () => void;
};

const ensureArr = <T,>(v: T | T[] | undefined | null): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

const LoadBalancerDetailDrawerAliyun: React.FC<Props> = ({ open, cloudId, slb, ecs, onClose }) => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<any | null>(null);
  const [health, setHealth] = useState<any[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const lbId = slb?.LoadBalancerId || slb?.id;

  const load = useCallback(async () => {
    if (!cloudId || !lbId) return;
    setLoading(true);
    try {
      const [d, h]: any[] = await Promise.all([
        fetchCloudProviderLoadBalancerDetail(cloudId, lbId),
        fetchCloudProviderLoadBalancerHealth(cloudId, lbId).catch(() => null),
      ]);
      setDetail(d?.data || d || null);
      const hb = (h?.data?.BackendServers?.BackendServer) || (h?.BackendServers?.BackendServer) || [];
      setHealth(ensureArr(hb));
    } catch (e: any) {
      message.error(e?.message || '查询详情失败');
    } finally {
      setLoading(false);
    }
  }, [cloudId, lbId, message]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const listeners = useMemo(() => ensureArr(detail?.ListenerPortsAndProtocol?.ListenerPortAndProtocol), [detail]);
  const backends = useMemo(() => ensureArr(detail?.BackendServers?.BackendServer), [detail]);

  const healthOf = (serverId: string) => {
    const hit = health.find((h: any) => String(h?.ServerId || '') === String(serverId));
    return hit?.ServerHealthStatus || '-';
  };

  const ecsOptions = useMemo(() => (Array.isArray(ecs) ? ecs : []).map((i: any) => ({ label: `${i?.InstanceName || i?.InstanceId || i?.id}（${i?.InstanceId || i?.id}）`, value: i?.InstanceId || i?.id })), [ecs]);

  const submitAdd = async () => {
    try {
      const values = await addForm.validateFields();
      setSubmitting(true);
      await addCloudProviderBackendServers(cloudId, lbId, [{ serverId: values.serverId, weight: values.weight }]);
      message.success('添加成功');
      setAddOpen(false);
      await load();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '添加失败');
    } finally { setSubmitting(false); }
  };

  const removeBackend = (serverId: string) => {
    Modal.confirm({
      title: '移除后端服务器?', content: serverId, okText: '确认移除', okType: 'danger', cancelText: '取消',
      onOk: async () => {
        try { await removeCloudProviderBackendServers(cloudId, lbId, [serverId]); message.success('移除成功'); await load(); }
        catch (e: any) { message.error(e?.message || '移除失败'); }
      },
    });
  };

  const listenerOp = (port: number, op: 'start' | 'stop' | 'delete', protocol?: string) => {
    const labelMap: any = { start: '启动', stop: '停止', delete: '删除' };
    Modal.confirm({
      title: `${labelMap[op]}监听器 ${port}?`, okText: `确认${labelMap[op]}`, okType: op === 'delete' ? 'danger' : 'primary', cancelText: '取消',
      onOk: async () => {
        try { await operateCloudProviderListener(cloudId, lbId, port, op, protocol); message.success('操作成功'); await load(); }
        catch (e: any) { message.error(e?.message || '操作失败'); }
      },
    });
  };

  const listenerColumns = [
    { title: '端口', dataIndex: 'ListenerPort', key: 'port', width: 100 },
    { title: '协议', dataIndex: 'ListenerProtocol', key: 'protocol', width: 120, render: (v: any) => <Tag>{String(v || '-').toUpperCase()}</Tag> },
    { title: '状态', key: 'status', width: 110, render: (_: any, r: any) => statusTag(r?.Status) },
    {
      title: '操作', key: 'op', width: 180,
      render: (_: any, r: any) => (
        <Space size={4}>
          <Button size="small" type="link" onClick={() => listenerOp(r?.ListenerPort, 'start', r?.ListenerProtocol)}>启动</Button>
          <Button size="small" type="link" onClick={() => listenerOp(r?.ListenerPort, 'stop', r?.ListenerProtocol)}>停止</Button>
          <Button size="small" type="link" danger onClick={() => listenerOp(r?.ListenerPort, 'delete', r?.ListenerProtocol)}>删除</Button>
        </Space>
      ),
    },
  ];

  const backendColumns = [
    { title: '服务器 ID', dataIndex: 'ServerId', key: 'sid', render: (v: any) => <Typography.Text copyable={{ text: v }}>{v}</Typography.Text> },
    { title: '权重', dataIndex: 'Weight', key: 'weight', width: 100 },
    { title: '类型', dataIndex: 'Type', key: 'type', width: 100, render: (v: any) => v || 'ecs' },
    { title: '健康状态', key: 'health', width: 120, render: (_: any, r: any) => { const s = healthOf(r?.ServerId); return <Tag color={s === 'normal' ? 'green' : s === '-' ? 'default' : 'red'}>{s}</Tag>; } },
    { title: '操作', key: 'op', width: 90, render: (_: any, r: any) => <Button size="small" type="link" danger onClick={() => removeBackend(r?.ServerId)}>移除</Button> },
  ];

  return (
    <StdSideDrawer open={open} onClose={onClose} width={960} title={`负载均衡详情 · ${slb?.LoadBalancerName || lbId || ''}`}>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>刷新</Button>
      </Space>
      <Tabs
        items={[
          {
            key: 'listeners',
            label: `监听器（${listeners.length}）`,
            children: (<Table size="small" className="std-table" bordered={false} loading={loading} rowKey={(r: any) => `${r?.ListenerPort}-${r?.ListenerProtocol}`} dataSource={listeners} columns={listenerColumns as any} pagination={false} scroll={{ x: true }} />),
          },
          {
            key: 'backends',
            label: `后端服务器（${backends.length}）`,
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size={12}>
                <Space><Button type="primary" icon={<PlusOutlined />} onClick={() => { addForm.resetFields(); addForm.setFieldsValue({ weight: 100 }); setAddOpen(true); }}>添加后端服务器</Button></Space>
                <Table size="small" className="std-table" bordered={false} loading={loading} rowKey={(r: any) => r?.ServerId} dataSource={backends} columns={backendColumns as any} pagination={false} scroll={{ x: true }} />
              </Space>
            ),
          },
        ]}
      />

      <Modal title="添加后端服务器" open={addOpen} onCancel={() => setAddOpen(false)} onOk={submitAdd} confirmLoading={submitting} okText="添加" cancelText="取消" destroyOnClose>
        <Form form={addForm} layout="vertical">
          <Form.Item name="serverId" label="ECS 实例" rules={[{ required: true, message: '请选择实例' }]}>
            <Select showSearch optionFilterProp="label" placeholder="请选择实例" options={ecsOptions} />
          </Form.Item>
          <Form.Item name="weight" label="权重" rules={[{ required: true }]}>
            <Input type="number" min={0} max={100} />
          </Form.Item>
        </Form>
      </Modal>
    </StdSideDrawer>
  );
};

export default LoadBalancerDetailDrawerAliyun;
