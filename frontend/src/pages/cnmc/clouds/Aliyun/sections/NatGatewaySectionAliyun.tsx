import React, { useMemo, useState } from 'react';
import { App, Button, Input, Select, Space, Table, Tooltip, Typography, Modal, Form } from 'antd';
import { SwapOutlined, ReloadOutlined, SearchOutlined, PlusOutlined } from '@ant-design/icons';
import { fetchCloudProviderNatGateways, createCloudProviderNatGateway, deleteCloudProviderNatGateway } from '../../../../../services/aliyunApi';
import { statusTag, tagsToText } from '../../Hw/components/Common';
import PageDetailSection, { RowActionsButton } from '../../../../../components/PageDetailSection';
import NatRulesDrawerAliyun from '../drawers/NatRulesDrawerAliyun';

type NatGatewaySectionAliyunProps = {
  cloudId: string;
  natGateways: any[];
  eips: any[];
  vpcs: any[];
  subnets: any[];
  onSetNatGateways: (list: any[]) => void;
  onOpenDetail: (type: string, title: string, data: any) => void;
};

const parseNatList = (json: any): any[] =>
  (json?.data?.NatGateways?.NatGateway) || (json?.NatGateways?.NatGateway) || (json?.data?.nat_gateways) || (json?.nat_gateways) || [];

const NatGatewaySectionAliyun: React.FC<NatGatewaySectionAliyunProps> = ({ cloudId, natGateways, eips, vpcs, subnets, onSetNatGateways, onOpenDetail }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(false);
  const [drawerNat, setDrawerNat] = useState<any | null>(null);
  const [createOpen, setCreateOpen] = useState<boolean>(false);
  const [createForm] = Form.useForm();
  const [submitting, setSubmitting] = useState<boolean>(false);

  const refresh = async () => {
    if (!cloudId) return;
    setLoading(true);
    try {
      const json = await fetchCloudProviderNatGateways(cloudId);
      onSetNatGateways(parseNatList(json));
    } catch (e: any) { message.error(e?.message || '刷新失败'); }
    finally { setLoading(false); }
  };

  const vpcOptions = useMemo(() => (vpcs || []).map((v: any) => ({ label: `${v.VpcName || v.name || v.VpcId || v.id}（${v.VpcId || v.id}）`, value: v.VpcId || v.id })), [vpcs]);
  const selectedVpc = Form.useWatch('vpcId', createForm);
  const vswOptions = useMemo(() => (subnets || []).filter((s: any) => !selectedVpc || String(s?.VpcId || s?.vpc_id || '') === String(selectedVpc)).map((s: any) => ({ label: `${s?.VSwitchName || s?.VSwitchId}（${s?.ZoneId || ''}）`, value: s?.VSwitchId || s?.id })), [subnets, selectedVpc]);

  const submitCreate = async () => {
    try {
      const v = await createForm.validateFields();
      setSubmitting(true);
      await createCloudProviderNatGateway(cloudId, { vpcId: v.vpcId, vSwitchId: v.vSwitchId, name: v.name });
      message.success('创建指令已下发');
      setCreateOpen(false);
      await refresh();
    } catch (e: any) { if (e?.errorFields) return; message.error(e?.message || '创建失败'); }
    finally { setSubmitting(false); }
  };

  const handleDelete = (r: any) => {
    const natId = r?.NatGatewayId || r?.id;
    if (!natId) return;
    Modal.confirm({
      title: '确定删除该 NAT 网关?', content: `${r?.Name || natId} 删除后不可恢复`,
      okText: '确认删除', okType: 'danger', cancelText: '取消',
      onOk: async () => { try { await deleteCloudProviderNatGateway(cloudId, natId, true); message.success('删除成功'); await refresh(); } catch (e: any) { message.error(e?.message || '删除失败'); } },
    });
  };

  const filtered = useMemo(() => {
    const list = Array.isArray(natGateways) ? natGateways : [];
    const kw = keyword.trim().toLowerCase();
    return list.filter((r: any) => {
      const text = `${r?.Name || r?.name || ''} ${r?.NatGatewayId || r?.id || ''}`.toLowerCase();
      const okKw = !kw || text.includes(kw);
      const st = String(r?.Status || r?.status || '').toLowerCase();
      const okSt = !statusFilter || st === statusFilter.toLowerCase();
      return okKw && okSt;
    });
  }, [natGateways, keyword, statusFilter]);

  const tagText = (r: any) => tagsToText(r?.Tags?.Tag || r?.tags);

  const columns = useMemo(() => ([
    {
      title: '名称/ID', key: 'name_id', fixed: 'left' as const, width: 240,
      sorter: (a: any, b: any) => String(a?.Name || a?.name || '').localeCompare(String(b?.Name || b?.name || '')),
      render: (_: any, r: any) => {
        const name = r?.Name || r?.name || '-';
        const id = r?.NatGatewayId || r?.id || '-';
        return (
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            <Typography.Text strong ellipsis={{ tooltip: name }}>{name}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }} copyable={id !== '-' ? { text: id } : false}>{id}</Typography.Text>
          </Space>
        );
      },
    },
    { title: '规格', key: 'spec', width: 140, render: (_: any, r: any) => r?.Spec || r?.spec || '-' },
    {
      title: '所属 VPC', key: 'vpc', width: 220, ellipsis: true,
      render: (_: any, r: any) => {
        const vid = r?.VpcId || r?.vpc_id || '';
        const vn = (vpcs || []).find((v: any) => String(v?.VpcId || v?.id || '') === String(vid || ''));
        const name = vn?.VpcName || vn?.name || vid;
        return name ? <Typography.Text type="secondary" ellipsis={{ tooltip: name }}>{name}</Typography.Text> : '-';
      },
    },
    { title: '标签', key: 'tags', width: 160, ellipsis: true, render: (_: any, r: any) => tagText(r) || '-' },
    { title: '状态', key: 'status', width: 110, render: (_: any, r: any) => statusTag(r?.Status || r?.status) },
    {
      title: '操作', key: 'actions', fixed: 'right' as const, width: 80,
      render: (_: any, r: any) => {
        const items = [
          { key: 'rules', label: 'SNAT/DNAT 规则' },
          { key: 'detail', label: '详情(JSON)' },
          { key: 'del', label: '删除', danger: true },
        ];
        return (
          <RowActionsButton
            items={items}
            onClick={async ({ key }: { key: string }) => {
              if (key === 'rules') { setDrawerNat(r); return; }
              if (key === 'detail') { const name = r?.Name || r?.name || '-'; const id = r?.NatGatewayId || r?.id || '-'; onOpenDetail('nat', `NAT网关 ${name}（${id}）`, r); return; }
              if (key === 'del') { handleDelete(r); }
            }}
          />
        );
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), [vpcs, onOpenDetail]);

  const statusOptions = useMemo(() => Array.from(new Set((natGateways || []).map((r: any) => String(r?.Status || r?.status || '').trim()).filter(Boolean))).map(s => ({ label: s, value: s })), [natGateways]);

  return (
    <PageDetailSection
      title={Label}
      icon={Icon}
      toolbarLeft={(
        <>
          <Input className="toolbar-search" prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />} placeholder="名称 / ID" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          <Select className="toolbar-filter-sm" placeholder="状态" allowClear value={statusFilter} onChange={setStatusFilter} options={statusOptions} dropdownMatchSelectWidth={false} />
          <button type="button" className="toolbar-reset-btn" onClick={() => { setKeyword(''); setStatusFilter(undefined); }}>重置</button>
        </>
      )}
      toolbarRight={(
        <div className="toolbar-actions">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { createForm.resetFields(); setCreateOpen(true); }}>创建 NAT 网关</Button>
          <Tooltip title="刷新"><Button icon={<ReloadOutlined />} loading={loading} onClick={refresh} /></Tooltip>
        </div>
      )}
      asCard={false}
    >
      <Table
        className="std-table"
        bordered={false}
        rowKey={(r: any) => r?.NatGatewayId || r?.id}
        dataSource={filtered}
        columns={columns as any}
        loading={loading}
        scroll={{ x: true }}
        pagination={{
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        }}
      />
      <NatRulesDrawerAliyun
        open={!!drawerNat}
        cloudId={cloudId}
        nat={drawerNat}
        eips={eips}
        vswitches={subnets}
        onClose={() => setDrawerNat(null)}
      />

      <Modal title="创建 NAT 网关" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={submitCreate} confirmLoading={submitting} okText="创建" cancelText="取消" destroyOnClose>
        <Form form={createForm} layout="vertical">
          <Form.Item name="name" label="名称"><Input placeholder="选填" maxLength={128} allowClear /></Form.Item>
          <Form.Item name="vpcId" label="专有网络 VPC" rules={[{ required: true, message: '请选择 VPC' }]}>
            <Select showSearch optionFilterProp="label" placeholder="请选择 VPC" options={vpcOptions} onChange={() => createForm.setFieldsValue({ vSwitchId: undefined })} />
          </Form.Item>
          <Form.Item name="vSwitchId" label="交换机" rules={[{ required: true, message: '增强型 NAT 需指定交换机' }]}>
            <Select showSearch optionFilterProp="label" placeholder="请选择交换机" options={vswOptions} />
          </Form.Item>
        </Form>
      </Modal>
    </PageDetailSection>
  );
};

export const Icon = <SwapOutlined />;
export const Label = 'NAT 网关';
export default NatGatewaySectionAliyun;
