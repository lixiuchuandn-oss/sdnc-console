import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { App, Button, Input, Select, Table, Space, Tabs, Modal, Form } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import StdSideDrawer from '../../../../../components/StdSideDrawer';
import { statusTag } from '../components/Common';
import {
  fetchHuaweiSnatRules, createHuaweiSnatRule, deleteHuaweiSnatRule,
  fetchHuaweiDnatRules, createHuaweiDnatRule, deleteHuaweiDnatRule,
} from '../../../../../services/huaweiApi';

type Props = {
  open: boolean;
  cloudId: string;
  nat: any | null;
  eips?: any[];
  subnets?: any[];
  onClose: () => void;
};

const ensureArr = <T,>(v: T | T[] | undefined | null): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const protocolOptions = [{ label: 'TCP', value: 'tcp' }, { label: 'UDP', value: 'udp' }, { label: 'Any', value: 'any' }];

const NatRulesDrawer: React.FC<Props> = ({ open, cloudId, nat, eips, subnets, onClose }) => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [snatRules, setSnatRules] = useState<any[]>([]);
  const [dnatRules, setDnatRules] = useState<any[]>([]);
  const [snatOpen, setSnatOpen] = useState(false);
  const [dnatOpen, setDnatOpen] = useState(false);
  const [snatForm] = Form.useForm();
  const [dnatForm] = Form.useForm();

  const natId = nat?.id || nat?.NatGatewayId;

  const load = useCallback(async () => {
    if (!cloudId || !natId) return;
    setLoading(true);
    try {
      const [s, d]: any[] = await Promise.all([
        fetchHuaweiSnatRules(cloudId, natId).catch(() => null),
        fetchHuaweiDnatRules(cloudId, natId).catch(() => null),
      ]);
      setSnatRules(ensureArr((s?.data?.snat_rules) || (s?.snat_rules)));
      setDnatRules(ensureArr((d?.data?.dnat_rules) || (d?.dnat_rules)));
    } catch (e: any) { message.error(e?.message || '查询规则失败'); }
    finally { setLoading(false); }
  }, [cloudId, natId, message]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const eipOptions = useMemo(() => (Array.isArray(eips) ? eips : []).map((e: any) => ({ label: `${e?.public_ip_address || e?.publicip_address || e?.id}`, value: e?.id || e?.publicip_id })).filter((o: any) => o.value), [eips]);
  const subnetOptions = useMemo(() => (Array.isArray(subnets) ? subnets : []).map((s: any) => ({ label: `${s?.name || s?.id}（${s?.cidr || ''}）`, value: s?.id })), [subnets]);

  const submitSnat = async () => {
    try {
      const v = await snatForm.validateFields();
      if (!natId) return;
      setSubmitting(true);
      await createHuaweiSnatRule(cloudId, { natGatewayId: natId, floatingIpId: v.floatingIpId, subnetId: v.sourceType === 'subnet' ? v.subnetId : undefined, cidr: v.sourceType === 'cidr' ? v.cidr : undefined });
      message.success('创建成功'); setSnatOpen(false); await load();
    } catch (e: any) { if (e?.errorFields) return; message.error(e?.message || '创建失败'); }
    finally { setSubmitting(false); }
  };
  const submitDnat = async () => {
    try {
      const v = await dnatForm.validateFields();
      if (!natId) return;
      setSubmitting(true);
      await createHuaweiDnatRule(cloudId, { natGatewayId: natId, floatingIpId: v.floatingIpId, protocol: v.protocol, externalServicePort: v.externalServicePort, internalServicePort: v.internalServicePort, privateIp: v.privateIp });
      message.success('创建成功'); setDnatOpen(false); await load();
    } catch (e: any) { if (e?.errorFields) return; message.error(e?.message || '创建失败'); }
    finally { setSubmitting(false); }
  };
  const delSnat = (r: any) => Modal.confirm({ title: '删除 SNAT 规则?', okText: '确认删除', okType: 'danger', cancelText: '取消', onOk: async () => { try { await deleteHuaweiSnatRule(cloudId, natId, r?.id); message.success('删除成功'); await load(); } catch (e: any) { message.error(e?.message || '删除失败'); } } });
  const delDnat = (r: any) => Modal.confirm({ title: '删除 DNAT 规则?', okText: '确认删除', okType: 'danger', cancelText: '取消', onOk: async () => { try { await deleteHuaweiDnatRule(cloudId, natId, r?.id); message.success('删除成功'); await load(); } catch (e: any) { message.error(e?.message || '删除失败'); } } });

  const snatColumns = [
    { title: '公网 IP', key: 'fip', render: (_: any, r: any) => r?.floating_ip_address || r?.floating_ip_id || '-' },
    { title: '源', key: 'src', render: (_: any, r: any) => r?.cidr || r?.network_id || '-' },
    { title: '状态', key: 'status', width: 110, render: (_: any, r: any) => statusTag(r?.status) },
    { title: '操作', key: 'op', width: 80, render: (_: any, r: any) => <Button size="small" type="link" danger onClick={() => delSnat(r)}>删除</Button> },
  ];
  const dnatColumns = [
    { title: '公网 IP:端口', key: 'ext', render: (_: any, r: any) => `${r?.floating_ip_address || r?.floating_ip_id || '-'}:${r?.external_service_port ?? '-'}` },
    { title: '内网 IP:端口', key: 'int', render: (_: any, r: any) => `${r?.private_ip || '-'}:${r?.internal_service_port ?? '-'}` },
    { title: '协议', dataIndex: 'protocol', key: 'proto', width: 90 },
    { title: '状态', key: 'status', width: 110, render: (_: any, r: any) => statusTag(r?.status) },
    { title: '操作', key: 'op', width: 80, render: (_: any, r: any) => <Button size="small" type="link" danger onClick={() => delDnat(r)}>删除</Button> },
  ];

  const sourceType = Form.useWatch('sourceType', snatForm);

  return (
    <StdSideDrawer open={open} onClose={onClose} width={920} title={`NAT 规则管理 · ${nat?.name || natId || ''}`}>
      <Space style={{ marginBottom: 12 }}><Button icon={<ReloadOutlined />} onClick={load} loading={loading}>刷新</Button></Space>
      <Tabs
        items={[
          {
            key: 'snat', label: `SNAT（${snatRules.length}）`,
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size={12}>
                <Space><Button type="primary" icon={<PlusOutlined />} onClick={() => { snatForm.resetFields(); snatForm.setFieldsValue({ sourceType: 'subnet' }); setSnatOpen(true); }}>添加 SNAT 规则</Button></Space>
                <Table size="small" className="std-table" bordered={false} loading={loading} rowKey={(r: any) => r?.id} dataSource={snatRules} columns={snatColumns as any} pagination={false} scroll={{ x: true }} />
              </Space>
            ),
          },
          {
            key: 'dnat', label: `DNAT（${dnatRules.length}）`,
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size={12}>
                <Space><Button type="primary" icon={<PlusOutlined />} onClick={() => { dnatForm.resetFields(); dnatForm.setFieldsValue({ protocol: 'tcp' }); setDnatOpen(true); }}>添加 DNAT 规则</Button></Space>
                <Table size="small" className="std-table" bordered={false} loading={loading} rowKey={(r: any) => r?.id} dataSource={dnatRules} columns={dnatColumns as any} pagination={false} scroll={{ x: true }} />
              </Space>
            ),
          },
        ]}
      />

      <Modal title="添加 SNAT 规则" open={snatOpen} onCancel={() => setSnatOpen(false)} onOk={submitSnat} confirmLoading={submitting} okText="创建" cancelText="取消" destroyOnHidden>
        <Form form={snatForm} layout="vertical">
          <Form.Item name="floatingIpId" label="公网 IP（EIP）" rules={[{ required: true, message: '请选择 EIP' }]}><Select showSearch optionFilterProp="label" options={eipOptions} placeholder="请选择 EIP" /></Form.Item>
          <Form.Item name="sourceType" label="源类型" rules={[{ required: true }]}><Select options={[{ label: '子网', value: 'subnet' }, { label: '自定义网段', value: 'cidr' }]} /></Form.Item>
          {sourceType === 'cidr' ? (
            <Form.Item name="cidr" label="源网段" rules={[{ required: true, message: '如 192.168.1.0/24' }]}><Input placeholder="如 192.168.1.0/24" /></Form.Item>
          ) : (
            <Form.Item name="subnetId" label="源子网" rules={[{ required: true, message: '请选择子网' }]}><Select showSearch optionFilterProp="label" options={subnetOptions} placeholder="请选择子网" /></Form.Item>
          )}
        </Form>
      </Modal>

      <Modal title="添加 DNAT 规则" open={dnatOpen} onCancel={() => setDnatOpen(false)} onOk={submitDnat} confirmLoading={submitting} okText="创建" cancelText="取消" destroyOnHidden>
        <Form form={dnatForm} layout="vertical">
          <Form.Item name="floatingIpId" label="公网 IP（EIP）" rules={[{ required: true, message: '请选择 EIP' }]}><Select showSearch optionFilterProp="label" options={eipOptions} placeholder="请选择 EIP" /></Form.Item>
          <Form.Item name="protocol" label="协议" rules={[{ required: true }]}><Select options={protocolOptions} /></Form.Item>
          <Form.Item name="externalServicePort" label="公网端口" rules={[{ required: true, message: '请输入公网端口' }]}><Input type="number" placeholder="如 80" /></Form.Item>
          <Form.Item name="privateIp" label="内网 IP" rules={[{ required: true, message: '请输入内网 IP' }]}><Input placeholder="如 192.168.1.5" /></Form.Item>
          <Form.Item name="internalServicePort" label="内网端口" rules={[{ required: true, message: '请输入内网端口' }]}><Input type="number" placeholder="如 80" /></Form.Item>
        </Form>
      </Modal>
    </StdSideDrawer>
  );
};

export default NatRulesDrawer;
