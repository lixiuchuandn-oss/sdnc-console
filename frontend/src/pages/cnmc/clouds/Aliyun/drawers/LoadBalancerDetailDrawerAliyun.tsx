import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { App, Button, Input, InputNumber, Table, Space, Tabs, Tag, Modal, Form, Select, Typography } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import StdSideDrawer from '../../../../../components/StdSideDrawer';
import { statusTag } from '../../Hw/components/Common';
import {
  fetchCloudProviderLoadBalancerDetail,
  fetchCloudProviderLoadBalancerHealth,
  addCloudProviderBackendServers,
  removeCloudProviderBackendServers,
  operateCloudProviderListener,
  createCloudProviderListener,
  fetchCloudProviderServerCertificates,
  uploadCloudProviderServerCertificate,
  deleteCloudProviderServerCertificate,
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
  const [listenerOpen, setListenerOpen] = useState(false);
  const [listenerForm] = Form.useForm();
  const [certs, setCerts] = useState<any[]>([]);
  const [certOpen, setCertOpen] = useState(false);
  const [certForm] = Form.useForm();

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

  const loadCerts = useCallback(async () => {
    if (!cloudId) return;
    try {
      const c: any = await fetchCloudProviderServerCertificates(cloudId);
      setCerts(ensureArr((c?.data?.ServerCertificates?.ServerCertificate) || (c?.ServerCertificates?.ServerCertificate)));
    } catch { /* ignore */ }
  }, [cloudId]);

  useEffect(() => { if (open) { load(); loadCerts(); } }, [open, load, loadCerts]);

  const listenerProtocol = Form.useWatch('protocol', listenerForm);

  const submitListener = async () => {
    try {
      const v = await listenerForm.validateFields();
      setSubmitting(true);
      await createCloudProviderListener(cloudId, lbId, {
        protocol: v.protocol,
        listenerPort: v.listenerPort,
        backendServerPort: v.backendServerPort,
        bandwidth: v.bandwidth ?? -1,
        serverCertificateId: v.serverCertificateId,
      });
      message.success('创建监听器成功');
      setListenerOpen(false);
      await load();
    } catch (e: any) { if (e?.errorFields) return; message.error(e?.message || '创建监听器失败'); }
    finally { setSubmitting(false); }
  };

  const submitCert = async () => {
    try {
      const v = await certForm.validateFields();
      setSubmitting(true);
      await uploadCloudProviderServerCertificate(cloudId, { name: v.name, serverCertificate: v.serverCertificate, privateKey: v.privateKey });
      message.success('上传成功');
      setCertOpen(false);
      await loadCerts();
    } catch (e: any) { if (e?.errorFields) return; message.error(e?.message || '上传失败'); }
    finally { setSubmitting(false); }
  };

  const delCert = (r: any) => {
    const certId = r?.ServerCertificateId;
    Modal.confirm({
      title: '删除服务器证书?', content: r?.ServerCertificateName || certId, okText: '确认删除', okType: 'danger', cancelText: '取消',
      onOk: async () => { try { await deleteCloudProviderServerCertificate(cloudId, certId); message.success('删除成功'); await loadCerts(); } catch (e: any) { message.error(e?.message || '删除失败'); } },
    });
  };

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
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size={12}>
                <Space><Button type="primary" icon={<PlusOutlined />} onClick={() => { listenerForm.resetFields(); listenerForm.setFieldsValue({ protocol: 'tcp', bandwidth: -1 }); setListenerOpen(true); }}>创建监听器</Button></Space>
                <Table size="small" className="std-table" bordered={false} loading={loading} rowKey={(r: any) => `${r?.ListenerPort}-${r?.ListenerProtocol}`} dataSource={listeners} columns={listenerColumns as any} pagination={false} scroll={{ x: true }} />
              </Space>
            ),
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
          {
            key: 'certs',
            label: `服务器证书（${certs.length}）`,
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size={12}>
                <Space><Button type="primary" icon={<PlusOutlined />} onClick={() => { certForm.resetFields(); setCertOpen(true); }}>上传证书</Button></Space>
                <Table
                  size="small" className="std-table" bordered={false} rowKey={(r: any) => r?.ServerCertificateId}
                  dataSource={certs} pagination={false} scroll={{ x: true }}
                  columns={[
                    { title: '名称', dataIndex: 'ServerCertificateName', key: 'name', render: (v: any) => v || '-' },
                    { title: '证书 ID', dataIndex: 'ServerCertificateId', key: 'id', render: (v: any) => <Typography.Text copyable={{ text: v }}>{v}</Typography.Text> },
                    { title: '指纹', dataIndex: 'Fingerprint', key: 'fp', render: (v: any) => v || '-' },
                    { title: '到期时间', dataIndex: 'ExpireTime', key: 'exp', render: (v: any) => v || '-' },
                    { title: '操作', key: 'op', width: 80, render: (_: any, r: any) => <Button size="small" type="link" danger onClick={() => delCert(r)}>删除</Button> },
                  ] as any}
                />
              </Space>
            ),
          },
        ]}
      />

      <Modal title="创建监听器" open={listenerOpen} onCancel={() => setListenerOpen(false)} onOk={submitListener} confirmLoading={submitting} okText="创建" cancelText="取消" destroyOnClose>
        <Form form={listenerForm} layout="vertical">
          <Form.Item name="protocol" label="协议" rules={[{ required: true }]}>
            <Select options={[{ label: 'TCP', value: 'tcp' }, { label: 'UDP', value: 'udp' }, { label: 'HTTP', value: 'http' }, { label: 'HTTPS', value: 'https' }]} />
          </Form.Item>
          <Form.Item name="listenerPort" label="监听端口" rules={[{ required: true, message: '请输入监听端口' }]}>
            <InputNumber min={1} max={65535} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="backendServerPort" label="后端端口" rules={[{ required: true, message: '请输入后端端口' }]}>
            <InputNumber min={1} max={65535} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="bandwidth" label="带宽峰值 (Mbps，-1 不限制)">
            <InputNumber min={-1} max={5120} style={{ width: '100%' }} />
          </Form.Item>
          {listenerProtocol === 'https' && (
            <Form.Item name="serverCertificateId" label="服务器证书" rules={[{ required: true, message: 'HTTPS 需选择证书' }]}>
              <Select showSearch optionFilterProp="label" placeholder={certs.length ? '请选择证书' : '暂无证书，请先在「服务器证书」上传'} options={certs.map((c: any) => ({ label: c?.ServerCertificateName || c?.ServerCertificateId, value: c?.ServerCertificateId }))} />
            </Form.Item>
          )}
        </Form>
      </Modal>

      <Modal title="上传服务器证书" open={certOpen} onCancel={() => setCertOpen(false)} onOk={submitCert} confirmLoading={submitting} okText="上传" cancelText="取消" width={620} destroyOnClose>
        <Form form={certForm} layout="vertical">
          <Form.Item name="name" label="证书名称"><Input placeholder="选填" allowClear /></Form.Item>
          <Form.Item name="serverCertificate" label="证书内容 (PEM)" rules={[{ required: true, message: '请粘贴证书内容' }]}>
            <Input.TextArea rows={5} placeholder="-----BEGIN CERTIFICATE-----" />
          </Form.Item>
          <Form.Item name="privateKey" label="私钥 (PEM)" rules={[{ required: true, message: '请粘贴私钥' }]}>
            <Input.TextArea rows={5} placeholder="-----BEGIN RSA PRIVATE KEY-----" />
          </Form.Item>
        </Form>
      </Modal>

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
