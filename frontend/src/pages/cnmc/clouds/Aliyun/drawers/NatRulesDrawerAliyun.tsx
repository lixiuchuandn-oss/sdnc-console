import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { App, Button, Input, Select, Table, Space, Tabs, Modal, Form, Typography } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import StdSideDrawer from '../../../../../components/StdSideDrawer';
import { statusTag } from '../../Hw/components/Common';
import {
  fetchCloudProviderSnatEntries,
  createCloudProviderSnatEntry,
  deleteCloudProviderSnatEntry,
  fetchCloudProviderForwardEntries,
  createCloudProviderForwardEntry,
  deleteCloudProviderForwardEntry,
} from '../../../../../services/aliyunApi';

type Props = {
  open: boolean;
  cloudId: string;
  nat: any | null;
  eips?: any[];
  vswitches?: any[];
  onClose: () => void;
};

const ensureArr = <T,>(v: T | T[] | undefined | null): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const protocolOptions = [{ label: 'TCP', value: 'tcp' }, { label: 'UDP', value: 'udp' }, { label: 'Any', value: 'any' }];

const NatRulesDrawerAliyun: React.FC<Props> = ({ open, cloudId, nat, eips, vswitches, onClose }) => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [snatEntries, setSnatEntries] = useState<any[]>([]);
  const [forwardEntries, setForwardEntries] = useState<any[]>([]);
  const [snatAddOpen, setSnatAddOpen] = useState(false);
  const [dnatAddOpen, setDnatAddOpen] = useState(false);
  const [snatForm] = Form.useForm();
  const [dnatForm] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const snatTableId = useMemo(() => ensureArr(nat?.SnatTableIds?.SnatTableId)[0], [nat]);
  const forwardTableId = useMemo(() => ensureArr(nat?.ForwardTableIds?.ForwardTableId)[0], [nat]);

  const load = useCallback(async () => {
    if (!cloudId) return;
    setLoading(true);
    try {
      if (snatTableId) {
        const s: any = await fetchCloudProviderSnatEntries(cloudId, snatTableId).catch(() => null);
        setSnatEntries(ensureArr((s?.data?.SnatTableEntries?.SnatTableEntry) || (s?.SnatTableEntries?.SnatTableEntry)));
      }
      if (forwardTableId) {
        const f: any = await fetchCloudProviderForwardEntries(cloudId, forwardTableId).catch(() => null);
        setForwardEntries(ensureArr((f?.data?.ForwardTableEntries?.ForwardTableEntry) || (f?.ForwardTableEntries?.ForwardTableEntry)));
      }
    } catch (e: any) {
      message.error(e?.message || '查询规则失败');
    } finally {
      setLoading(false);
    }
  }, [cloudId, snatTableId, forwardTableId, message]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const eipOptions = useMemo(() => (Array.isArray(eips) ? eips : []).map((e: any) => ({ label: e?.IpAddress || e?.AllocationId, value: e?.IpAddress })).filter((o: any) => o.value), [eips]);
  const vswOptions = useMemo(() => (Array.isArray(vswitches) ? vswitches : []).map((s: any) => ({ label: `${s?.VSwitchName || s?.VSwitchId}（${s?.CidrBlock || ''}）`, value: s?.VSwitchId || s?.id })), [vswitches]);

  const submitSnat = async () => {
    try {
      const v = await snatForm.validateFields();
      if (!snatTableId) { message.error('该 NAT 网关无 SNAT 表'); return; }
      setSubmitting(true);
      await createCloudProviderSnatEntry(cloudId, { snatTableId, snatIp: v.snatIp, sourceVSwitchId: v.sourceVSwitchId, snatEntryName: v.snatEntryName });
      message.success('创建成功');
      setSnatAddOpen(false);
      await load();
    } catch (e: any) { if (e?.errorFields) return; message.error(e?.message || '创建失败'); }
    finally { setSubmitting(false); }
  };

  const submitDnat = async () => {
    try {
      const v = await dnatForm.validateFields();
      if (!forwardTableId) { message.error('该 NAT 网关无 DNAT 表'); return; }
      setSubmitting(true);
      await createCloudProviderForwardEntry(cloudId, { forwardTableId, externalIp: v.externalIp, externalPort: v.externalPort, internalIp: v.internalIp, internalPort: v.internalPort, ipProtocol: v.ipProtocol, forwardEntryName: v.forwardEntryName });
      message.success('创建成功');
      setDnatAddOpen(false);
      await load();
    } catch (e: any) { if (e?.errorFields) return; message.error(e?.message || '创建失败'); }
    finally { setSubmitting(false); }
  };

  const delSnat = (r: any) => {
    Modal.confirm({
      title: '删除 SNAT 规则?', okText: '确认删除', okType: 'danger', cancelText: '取消',
      onOk: async () => { try { await deleteCloudProviderSnatEntry(cloudId, snatTableId, r?.SnatEntryId); message.success('删除成功'); await load(); } catch (e: any) { message.error(e?.message || '删除失败'); } },
    });
  };
  const delDnat = (r: any) => {
    Modal.confirm({
      title: '删除 DNAT 规则?', okText: '确认删除', okType: 'danger', cancelText: '取消',
      onOk: async () => { try { await deleteCloudProviderForwardEntry(cloudId, forwardTableId, r?.ForwardEntryId); message.success('删除成功'); await load(); } catch (e: any) { message.error(e?.message || '删除失败'); } },
    });
  };

  const snatColumns = [
    { title: '名称', dataIndex: 'SnatEntryName', key: 'name', render: (v: any) => v || '-' },
    { title: '公网 IP', dataIndex: 'SnatIp', key: 'ip' },
    { title: '源', key: 'src', render: (_: any, r: any) => r?.SourceVSwitchId || r?.SourceCIDR || '-' },
    { title: '状态', key: 'status', width: 110, render: (_: any, r: any) => statusTag(r?.Status) },
    { title: '操作', key: 'op', width: 80, render: (_: any, r: any) => <Button size="small" type="link" danger onClick={() => delSnat(r)}>删除</Button> },
  ];
  const dnatColumns = [
    { title: '名称', dataIndex: 'ForwardEntryName', key: 'name', render: (v: any) => v || '-' },
    { title: '公网 IP:端口', key: 'ext', render: (_: any, r: any) => `${r?.ExternalIp}:${r?.ExternalPort}` },
    { title: '内网 IP:端口', key: 'int', render: (_: any, r: any) => `${r?.InternalIp}:${r?.InternalPort}` },
    { title: '协议', dataIndex: 'IpProtocol', key: 'proto', width: 90 },
    { title: '状态', key: 'status', width: 110, render: (_: any, r: any) => statusTag(r?.Status) },
    { title: '操作', key: 'op', width: 80, render: (_: any, r: any) => <Button size="small" type="link" danger onClick={() => delDnat(r)}>删除</Button> },
  ];

  return (
    <StdSideDrawer open={open} onClose={onClose} width={920} title={`NAT 规则管理 · ${nat?.Name || nat?.NatGatewayId || ''}`}>
      <Space style={{ marginBottom: 12 }}><Button icon={<ReloadOutlined />} onClick={load} loading={loading}>刷新</Button></Space>
      <Tabs
        items={[
          {
            key: 'snat',
            label: `SNAT（${snatEntries.length}）`,
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size={12}>
                <Space>
                  <Button type="primary" icon={<PlusOutlined />} disabled={!snatTableId} onClick={() => { snatForm.resetFields(); setSnatAddOpen(true); }}>添加 SNAT 规则</Button>
                  {!snatTableId && <Typography.Text type="secondary">该 NAT 网关无 SNAT 表</Typography.Text>}
                </Space>
                <Table size="small" className="std-table" bordered={false} loading={loading} rowKey={(r: any) => r?.SnatEntryId} dataSource={snatEntries} columns={snatColumns as any} pagination={false} scroll={{ x: true }} />
              </Space>
            ),
          },
          {
            key: 'dnat',
            label: `DNAT（${forwardEntries.length}）`,
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size={12}>
                <Space>
                  <Button type="primary" icon={<PlusOutlined />} disabled={!forwardTableId} onClick={() => { dnatForm.resetFields(); dnatForm.setFieldsValue({ ipProtocol: 'tcp' }); setDnatAddOpen(true); }}>添加 DNAT 规则</Button>
                  {!forwardTableId && <Typography.Text type="secondary">该 NAT 网关无 DNAT 表</Typography.Text>}
                </Space>
                <Table size="small" className="std-table" bordered={false} loading={loading} rowKey={(r: any) => r?.ForwardEntryId} dataSource={forwardEntries} columns={dnatColumns as any} pagination={false} scroll={{ x: true }} />
              </Space>
            ),
          },
        ]}
      />

      <Modal title="添加 SNAT 规则" open={snatAddOpen} onCancel={() => setSnatAddOpen(false)} onOk={submitSnat} confirmLoading={submitting} okText="创建" cancelText="取消" destroyOnClose>
        <Form form={snatForm} layout="vertical">
          <Form.Item name="snatEntryName" label="名称"><Input placeholder="选填" allowClear /></Form.Item>
          <Form.Item name="snatIp" label="公网 IP（EIP）" rules={[{ required: true, message: '请选择公网 IP' }]}>
            <Select showSearch optionFilterProp="label" placeholder="请选择 EIP" options={eipOptions} />
          </Form.Item>
          <Form.Item name="sourceVSwitchId" label="源交换机" rules={[{ required: true, message: '请选择源交换机' }]}>
            <Select showSearch optionFilterProp="label" placeholder="请选择交换机" options={vswOptions} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="添加 DNAT 规则" open={dnatAddOpen} onCancel={() => setDnatAddOpen(false)} onOk={submitDnat} confirmLoading={submitting} okText="创建" cancelText="取消" destroyOnClose>
        <Form form={dnatForm} layout="vertical">
          <Form.Item name="forwardEntryName" label="名称"><Input placeholder="选填" allowClear /></Form.Item>
          <Form.Item name="externalIp" label="公网 IP（EIP）" rules={[{ required: true, message: '请选择公网 IP' }]}>
            <Select showSearch optionFilterProp="label" placeholder="请选择 EIP" options={eipOptions} />
          </Form.Item>
          <Form.Item name="ipProtocol" label="协议" rules={[{ required: true }]}><Select options={protocolOptions} /></Form.Item>
          <Form.Item name="externalPort" label="公网端口" rules={[{ required: true, message: '请输入公网端口，如 80 或 any' }]}><Input placeholder="如 80 或 any" /></Form.Item>
          <Form.Item name="internalIp" label="内网 IP" rules={[{ required: true, message: '请输入内网 IP' }]}><Input placeholder="如 192.168.1.5" /></Form.Item>
          <Form.Item name="internalPort" label="内网端口" rules={[{ required: true, message: '请输入内网端口' }]}><Input placeholder="如 80 或 any" /></Form.Item>
        </Form>
      </Modal>
    </StdSideDrawer>
  );
};

export default NatRulesDrawerAliyun;
