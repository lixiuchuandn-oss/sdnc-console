import React, { useMemo, useState } from 'react';
import { App, Button, Input, Select, Table, Space, Tooltip, Typography, Modal, Form } from 'antd';
import { LockOutlined, ReloadOutlined, SearchOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import PageDetailSection, { RowActionsButton } from '../../../../../components/PageDetailSection';
import { statusTag } from '../../Hw/components/Common';
import {
  fetchCloudProviderVpnGateways,
  fetchCloudProviderVpnConnections,
  deleteCloudProviderVpnGateway,
  createCloudProviderVpnGateway,
  fetchCloudProviderCustomerGateways,
  createCloudProviderCustomerGateway,
  deleteCloudProviderCustomerGateway,
  createCloudProviderVpnConnection,
} from '../../../../../services/aliyunApi';

type Props = {
  cloudId: string;
  vpnGateways: any[];
  vpcs: any[];
  vswitches?: any[];
  onSetVpnGateways: (list: any[]) => void;
  onRefreshAll?: () => Promise<void> | void;
};

const parseVpnList = (json: any): any[] =>
  (json?.data?.VpnGateways?.VpnGateway) || (json?.VpnGateways?.VpnGateway) || (json?.data?.vpn_gateways) || (json?.vpn_gateways) || [];

const VpnGatewaySectionAliyun: React.FC<Props> = ({ cloudId, vpnGateways, vpcs, vswitches, onSetVpnGateways, onRefreshAll }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [connLoading, setConnLoading] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [createOpen, setCreateOpen] = useState<boolean>(false);
  const [createForm] = Form.useForm();
  const [cgwOpen, setCgwOpen] = useState<boolean>(false);
  const [cgws, setCgws] = useState<any[]>([]);
  const [cgwForm] = Form.useForm();
  const [connOpen, setConnOpen] = useState<boolean>(false);
  const [connForm] = Form.useForm();
  const [connGateway, setConnGateway] = useState<any | null>(null);

  const refresh = async () => {
    if (!cloudId) return;
    setLoading(true);
    try {
      const json = await fetchCloudProviderVpnGateways(cloudId);
      onSetVpnGateways(parseVpnList(json));
    } catch (e: any) { message.error(e?.message || '刷新失败'); }
    finally { setLoading(false); }
  };

  const vpcOptions = useMemo(() => (vpcs || []).map((v: any) => ({ label: `${v.VpcName || v.name || v.VpcId || v.id}（${v.VpcId || v.id}）`, value: v.VpcId || v.id })), [vpcs]);
  const selectedVpc = Form.useWatch('vpcId', createForm);
  const vswOptions = useMemo(() => (vswitches || []).filter((s: any) => !selectedVpc || String(s?.VpcId || s?.vpc_id || '') === String(selectedVpc)).map((s: any) => ({ label: `${s?.VSwitchName || s?.VSwitchId}（${s?.ZoneId || ''}）`, value: s?.VSwitchId || s?.id })), [vswitches, selectedVpc]);

  const loadCgws = async () => {
    try {
      const j: any = await fetchCloudProviderCustomerGateways(cloudId);
      setCgws(Array.isArray(j?.data?.CustomerGateways?.CustomerGateway) ? j.data.CustomerGateways.CustomerGateway : (Array.isArray(j?.CustomerGateways?.CustomerGateway) ? j.CustomerGateways.CustomerGateway : []));
    } catch (e: any) { message.error(e?.message || '查询用户网关失败'); }
  };

  const submitCreate = async () => {
    try {
      const v = await createForm.validateFields();
      setSubmitting(true);
      await createCloudProviderVpnGateway(cloudId, { vpcId: v.vpcId, vSwitchId: v.vSwitchId, name: v.name, bandwidth: v.bandwidth });
      message.success('创建指令已下发');
      setCreateOpen(false);
      await refresh();
    } catch (e: any) { if (e?.errorFields) return; message.error(e?.message || '创建失败'); }
    finally { setSubmitting(false); }
  };

  const submitCgw = async () => {
    try {
      const v = await cgwForm.validateFields();
      setSubmitting(true);
      await createCloudProviderCustomerGateway(cloudId, { ipAddress: v.ipAddress, name: v.name, description: v.description });
      message.success('创建成功');
      cgwForm.resetFields();
      await loadCgws();
    } catch (e: any) { if (e?.errorFields) return; message.error(e?.message || '创建失败'); }
    finally { setSubmitting(false); }
  };

  const delCgw = (r: any) => {
    Modal.confirm({
      title: '删除用户网关?', content: r?.Name || r?.CustomerGatewayId, okText: '确认删除', okType: 'danger', cancelText: '取消',
      onOk: async () => { try { await deleteCloudProviderCustomerGateway(cloudId, r?.CustomerGatewayId); message.success('删除成功'); await loadCgws(); } catch (e: any) { message.error(e?.message || '删除失败'); } },
    });
  };

  const submitConn = async () => {
    try {
      const v = await connForm.validateFields();
      setSubmitting(true);
      await createCloudProviderVpnConnection(cloudId, {
        vpnGatewayId: connGateway?.VpnGatewayId || connGateway?.id,
        customerGatewayId: v.customerGatewayId,
        name: v.name,
        localSubnet: v.localSubnet,
        remoteSubnet: v.remoteSubnet,
      });
      message.success('创建成功');
      setConnOpen(false);
    } catch (e: any) { if (e?.errorFields) return; message.error(e?.message || '创建失败'); }
    finally { setSubmitting(false); }
  };

  const reloadAfterWrite = async () => {
    await refresh();
    if (onRefreshAll) await onRefreshAll();
  };

  const filtered = useMemo(() => {
    const list = Array.isArray(vpnGateways) ? vpnGateways : [];
    const kw = keyword.trim().toLowerCase();
    return list.filter((r: any) => {
      const text = `${r?.Name || r?.name || ''} ${r?.VpnGatewayId || r?.id || ''} ${r?.InternetIp || ''}`.toLowerCase();
      return !kw || text.includes(kw);
    });
  }, [vpnGateways, keyword]);

  const viewConnections = async (r: any) => {
    const vid = r?.VpnGatewayId || r?.id;
    setConnLoading(true);
    try {
      const json: any = await fetchCloudProviderVpnConnections(cloudId, vid);
      const list: any[] = (json?.data?.VpnConnections?.VpnConnection) || (json?.VpnConnections?.VpnConnection) || [];
      Modal.info({
        title: `VPN 连接 · ${r?.Name || vid}`,
        width: 760,
        content: (
          <Table
            size="small"
            className="std-table"
            bordered={false}
            rowKey={(c: any) => c?.VpnConnectionId}
            dataSource={Array.isArray(list) ? list : []}
            pagination={false}
            scroll={{ x: true }}
            columns={[
              { title: '名称', dataIndex: 'Name', key: 'name', render: (v: any) => v || '-' },
              { title: '连接 ID', dataIndex: 'VpnConnectionId', key: 'id' },
              { title: '本端网段', dataIndex: 'LocalSubnet', key: 'local' },
              { title: '对端网段', dataIndex: 'RemoteSubnet', key: 'remote' },
              { title: '状态', key: 'status', render: (_: any, c: any) => statusTag(c?.Status) },
            ] as any}
          />
        ),
      });
    } catch (e: any) {
      message.error(e?.message || '查询连接失败');
    } finally {
      setConnLoading(false);
    }
  };

  const handleDelete = (r: any) => {
    const vid = r?.VpnGatewayId || r?.id;
    if (!vid) return;
    Modal.confirm({
      title: '确定删除该 VPN 网关?',
      content: `ID: ${vid}（删除前需先删除其 VPN 连接）`,
      okText: '确认删除', okType: 'danger', cancelText: '取消',
      onOk: async () => {
        try {
          await deleteCloudProviderVpnGateway(cloudId, vid);
          message.success('删除成功');
          await reloadAfterWrite();
        } catch (e: any) { message.error(e?.message || '删除失败'); }
      },
    });
  };

  const columns = useMemo(() => ([
    {
      title: '名称/ID', key: 'name_id', fixed: 'left' as const, width: 240,
      sorter: (a: any, b: any) => String(a?.Name || a?.name || '').localeCompare(String(b?.Name || b?.name || '')),
      render: (_: any, r: any) => {
        const name = r?.Name || r?.name || '-';
        const idv = r?.VpnGatewayId || r?.id || '-';
        return (
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            <Typography.Text strong ellipsis={{ tooltip: name }}>{name}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }} copyable={idv !== '-' ? { text: idv } : false}>{idv}</Typography.Text>
          </Space>
        );
      },
    },
    {
      title: '公网 IP', key: 'ip', width: 150,
      render: (_: any, r: any) => {
        const ip = r?.InternetIp;
        return ip ? <Typography.Text copyable={{ text: ip }}>{ip}</Typography.Text> : '-';
      },
    },
    { title: '规格', key: 'spec', width: 120, render: (_: any, r: any) => r?.Spec || '-' },
    {
      title: '所属 VPC', key: 'vpc', width: 200, ellipsis: true,
      render: (_: any, r: any) => {
        const vid = r?.VpcId || '';
        const hit = (vpcs || []).find((v: any) => String(v?.VpcId || v?.id || '') === String(vid || ''));
        const name = hit?.VpcName || hit?.name || vid;
        return name ? <Typography.Text type="secondary" ellipsis={{ tooltip: name }}>{name}</Typography.Text> : '-';
      },
    },
    { title: '状态', key: 'status', width: 110, render: (_: any, r: any) => statusTag(r?.Status || r?.status) },
    {
      title: '操作', key: 'actions', fixed: 'right' as const, width: 80,
      render: (_: any, r: any) => (
        <RowActionsButton
          items={[
            { key: 'conn', label: '查看连接' },
            { key: 'createConn', label: '创建 IPsec 连接' },
            { key: 'del', label: '删除', danger: true },
          ]}
          onClick={async ({ key }: { key: string }) => {
            if (key === 'conn') { viewConnections(r); return; }
            if (key === 'createConn') { setConnGateway(r); connForm.resetFields(); await loadCgws(); setConnOpen(true); return; }
            if (key === 'del') handleDelete(r);
          }}
        />
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), [vpcs]);

  return (
    <PageDetailSection
      title={Label}
      icon={Icon}
      toolbarLeft={(
        <>
          <Input className="toolbar-search" prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />} placeholder="名称 / ID / IP" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          <button type="button" className="toolbar-reset-btn" onClick={() => setKeyword('')}>重置</button>
        </>
      )}
      toolbarRight={(
        <div className="toolbar-actions">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { createForm.resetFields(); createForm.setFieldsValue({ bandwidth: 10 }); setCreateOpen(true); }}>创建 VPN 网关</Button>
          <Button onClick={async () => { await loadCgws(); setCgwOpen(true); }}>用户网关</Button>
          <Tooltip title="刷新"><Button icon={<ReloadOutlined />} loading={loading || connLoading} onClick={refresh} /></Tooltip>
        </div>
      )}
      asCard={false}
    >
      <Table
        className="std-table"
        bordered={false}
        rowKey={(r: any) => r?.VpnGatewayId || r?.id}
        dataSource={filtered}
        columns={columns as any}
        loading={loading}
        scroll={{ x: true }}
        pagination={{ size: 'small', showTotal: (total) => `共 ${total} 条` }}
      />

      <Modal title="创建 VPN 网关" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={submitCreate} confirmLoading={submitting} okText="创建" cancelText="取消" destroyOnClose>
        <Form form={createForm} layout="vertical">
          <Form.Item name="name" label="名称"><Input placeholder="选填" maxLength={128} allowClear /></Form.Item>
          <Form.Item name="vpcId" label="专有网络 VPC" rules={[{ required: true, message: '请选择 VPC' }]}>
            <Select showSearch optionFilterProp="label" placeholder="请选择 VPC" options={vpcOptions} onChange={() => createForm.setFieldsValue({ vSwitchId: undefined })} />
          </Form.Item>
          <Form.Item name="vSwitchId" label="交换机"><Select showSearch optionFilterProp="label" placeholder="选填" options={vswOptions} allowClear /></Form.Item>
          <Form.Item name="bandwidth" label="带宽 (Mbps)" rules={[{ required: true }]}>
            <Select options={[5, 10, 20, 50, 100, 200].map((b) => ({ label: `${b} Mbps`, value: b }))} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="用户网关管理" open={cgwOpen} onCancel={() => setCgwOpen(false)} footer={null} width={760} destroyOnClose>
        <Form form={cgwForm} layout="inline" style={{ marginBottom: 12, rowGap: 8 }}>
          <Form.Item name="name"><Input placeholder="名称(选填)" allowClear /></Form.Item>
          <Form.Item name="ipAddress" rules={[{ required: true, message: '对端 IP' }]}><Input placeholder="对端网关公网 IP" allowClear /></Form.Item>
          <Form.Item><Button type="primary" icon={<PlusOutlined />} loading={submitting} onClick={submitCgw}>创建</Button></Form.Item>
        </Form>
        <Table
          size="small" className="std-table" bordered={false} rowKey={(r: any) => r?.CustomerGatewayId}
          dataSource={cgws} pagination={false} scroll={{ x: true }}
          columns={[
            { title: '名称', dataIndex: 'Name', key: 'name', render: (v: any) => v || '-' },
            { title: 'ID', dataIndex: 'CustomerGatewayId', key: 'id' },
            { title: '对端 IP', dataIndex: 'IpAddress', key: 'ip' },
            { title: '操作', key: 'op', width: 70, render: (_: any, r: any) => <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => delCgw(r)} /> },
          ] as any}
        />
      </Modal>

      <Modal title="创建 IPsec 连接" open={connOpen} onCancel={() => setConnOpen(false)} onOk={submitConn} confirmLoading={submitting} okText="创建" cancelText="取消" destroyOnClose>
        <Form form={connForm} layout="vertical">
          <Typography.Paragraph type="secondary">VPN 网关：{connGateway?.Name || connGateway?.VpnGatewayId || '-'}</Typography.Paragraph>
          <Form.Item name="name" label="连接名称"><Input placeholder="选填" allowClear /></Form.Item>
          <Form.Item name="customerGatewayId" label="用户网关" rules={[{ required: true, message: '请选择用户网关' }]}>
            <Select showSearch optionFilterProp="label" placeholder={cgws.length ? '请选择' : '暂无用户网关，请先在「用户网关」创建'} options={cgws.map((c: any) => ({ label: `${c?.Name || c?.CustomerGatewayId}（${c?.IpAddress}）`, value: c?.CustomerGatewayId }))} />
          </Form.Item>
          <Form.Item name="localSubnet" label="本端网段" rules={[{ required: true, message: '如 192.168.0.0/16' }]}><Input placeholder="如 192.168.0.0/16" /></Form.Item>
          <Form.Item name="remoteSubnet" label="对端网段" rules={[{ required: true, message: '如 10.0.0.0/8' }]}><Input placeholder="如 10.0.0.0/8" /></Form.Item>
        </Form>
      </Modal>
    </PageDetailSection>
  );
};

export const Icon = <LockOutlined />;
export const Label = 'VPN 网关';
export default VpnGatewaySectionAliyun;
