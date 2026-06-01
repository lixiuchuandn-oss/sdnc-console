import React, { useMemo, useState } from 'react';
import { App, Button, Input, Select, Space, Table, Tooltip, Typography, Modal, Form } from 'antd';
import { ReloadOutlined, SearchOutlined, PlusOutlined } from '@ant-design/icons';
import { DeploymentUnitOutlined } from '@ant-design/icons';
import { fetchCloudProviderLoadBalancers, createCloudProviderLoadBalancer, deleteCloudProviderLoadBalancer } from '../../../../../services/aliyunApi';
import { statusTag, tagsToText } from '../../Hw/components/Common';
import PageDetailSection, { RowActionsButton } from '../../../../../components/PageDetailSection';
import LoadBalancerDetailDrawerAliyun from '../drawers/LoadBalancerDetailDrawerAliyun';

type LoadBalancerSectionAliyunProps = {
  cloudId: string;
  slbs: any[];
  vpcs: any[];
  subnets: any[];
  ecs?: any[];
  onSetSlbs: (list: any[]) => void;
  onOpenDetail: (type: string, title: string, data: any) => void;
};

const parseSlbList = (json: any): any[] =>
  (json?.data?.LoadBalancers?.LoadBalancer) || (json?.LoadBalancers?.LoadBalancer) || (json?.data?.loadbalancers) || (json?.loadbalancers) || [];

const slbSpecOptions = [
  { label: '简约型 I (slb.s1.small)', value: 'slb.s1.small' },
  { label: '标准型 I (slb.s2.small)', value: 'slb.s2.small' },
  { label: '标准型 II (slb.s2.medium)', value: 'slb.s2.medium' },
  { label: '高阶型 I (slb.s3.small)', value: 'slb.s3.small' },
];

const LoadBalancerSectionAliyun: React.FC<LoadBalancerSectionAliyunProps> = ({ cloudId, slbs, vpcs, subnets, ecs, onSetSlbs, onOpenDetail }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(false);
  const [drawerSlb, setDrawerSlb] = useState<any | null>(null);
  const [createOpen, setCreateOpen] = useState<boolean>(false);
  const [createForm] = Form.useForm();
  const [submitting, setSubmitting] = useState<boolean>(false);

  const refresh = async () => {
    if (!cloudId) return;
    setLoading(true);
    try {
      const json = await fetchCloudProviderLoadBalancers(cloudId);
      onSetSlbs(parseSlbList(json));
    } catch (e: any) { message.error(e?.message || '刷新失败'); }
    finally { setLoading(false); }
  };

  const addressType = Form.useWatch('addressType', createForm);
  const vpcOptions = useMemo(() => (vpcs || []).map((v: any) => ({ label: `${v.VpcName || v.name || v.VpcId || v.id}（${v.VpcId || v.id}）`, value: v.VpcId || v.id })), [vpcs]);
  const selectedVpc = Form.useWatch('vpcId', createForm);
  const vswOptions = useMemo(() => (subnets || []).filter((s: any) => !selectedVpc || String(s?.VpcId || s?.vpc_id || '') === String(selectedVpc)).map((s: any) => ({ label: `${s?.VSwitchName || s?.VSwitchId}（${s?.ZoneId || ''}）`, value: s?.VSwitchId || s?.id })), [subnets, selectedVpc]);

  const submitCreate = async () => {
    try {
      const v = await createForm.validateFields();
      setSubmitting(true);
      await createCloudProviderLoadBalancer(cloudId, {
        loadBalancerName: v.loadBalancerName,
        addressType: v.addressType,
        loadBalancerSpec: v.loadBalancerSpec,
        payType: 'PayOnDemand',
        vpcId: v.addressType === 'intranet' ? v.vpcId : undefined,
        vSwitchId: v.addressType === 'intranet' ? v.vSwitchId : undefined,
      });
      message.success('创建成功');
      setCreateOpen(false);
      await refresh();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '创建失败');
    } finally { setSubmitting(false); }
  };

  const handleDelete = (r: any) => {
    const lbId = r?.LoadBalancerId || r?.id;
    if (!lbId) return;
    Modal.confirm({
      title: '确定删除该负载均衡?', content: `${r?.LoadBalancerName || lbId} 删除后不可恢复`,
      okText: '确认删除', okType: 'danger', cancelText: '取消',
      onOk: async () => { try { await deleteCloudProviderLoadBalancer(cloudId, lbId); message.success('删除成功'); await refresh(); } catch (e: any) { message.error(e?.message || '删除失败'); } },
    });
  };

  const filtered = useMemo(() => {
    const list = Array.isArray(slbs) ? slbs : [];
    const kw = keyword.trim().toLowerCase();
    return list.filter((r: any) => {
      const text = `${r?.LoadBalancerName || r?.name || ''} ${r?.LoadBalancerId || r?.id || ''} ${r?.Address || r?.vip_address || ''}`.toLowerCase();
      const okKw = !kw || text.includes(kw);
      const st = String(r?.LoadBalancerStatus || r?.status || '').toLowerCase();
      const okSt = !statusFilter || st === statusFilter.toLowerCase();
      return okKw && okSt;
    });
  }, [slbs, keyword, statusFilter]);

  const tagText = (r: any) => tagsToText(r?.Tags?.Tag || r?.tags);

  const columns = useMemo(() => ([
    {
      title: '名称/ID', key: 'name_id', fixed: 'left' as const, width: 240,
      sorter: (a: any, b: any) => String(a?.LoadBalancerName || a?.name || '').localeCompare(String(b?.LoadBalancerName || b?.name || '')),
      render: (_: any, r: any) => {
        const name = r?.LoadBalancerName || r?.name || '-';
        const id = r?.LoadBalancerId || r?.id || '-';
        return (
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            <Typography.Text strong ellipsis={{ tooltip: name }}>{name}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }} copyable={id !== '-' ? { text: id } : false}>{id}</Typography.Text>
          </Space>
        );
      },
    },
    {
      title: '服务地址', key: 'address', width: 180,
      render: (_: any, r: any) => {
        const addr = r?.Address || r?.vip_address || '';
        const type = r?.AddressType || r?.address_type;
        if (!addr) return '-';
        return (
          <Space direction="vertical" size={0}>
            <Typography.Text copyable={{ text: addr }}>{addr}</Typography.Text>
            {type && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{type === 'internet' ? '公网' : type === 'intranet' ? '私网' : type}</Typography.Text>}
          </Space>
        );
      },
    },
    {
      title: '所属 VPC', key: 'vpc', width: 200, ellipsis: true,
      render: (_: any, r: any) => {
        const vid = r?.VpcId || r?.vpc_id || '';
        const vn = (vpcs || []).find((v: any) => String(v?.VpcId || v?.id || '') === String(vid || ''));
        const name = vn?.VpcName || vn?.name || vid;
        return name ? <Typography.Text type="secondary" ellipsis={{ tooltip: name }}>{name}</Typography.Text> : '-';
      },
    },
    { title: '标签', key: 'tags', width: 160, ellipsis: true, render: (_: any, r: any) => tagText(r) || '-' },
    { title: '状态', key: 'status', width: 110, render: (_: any, r: any) => statusTag(r?.LoadBalancerStatus || r?.status) },
    {
      title: '操作', key: 'actions', fixed: 'right' as const, width: 80,
      render: (_: any, r: any) => {
        const items = [
          { key: 'manage', label: '监听器/后端管理' },
          { key: 'detail', label: '详情(JSON)' },
          { key: 'del', label: '删除', danger: true },
        ];
        return (
          <RowActionsButton
            items={items}
            onClick={async ({ key }: { key: string }) => {
              if (key === 'manage') { setDrawerSlb(r); return; }
              if (key === 'detail') { const name = r?.LoadBalancerName || r?.name || '-'; const id = r?.LoadBalancerId || r?.id || '-'; onOpenDetail('slb', `负载均衡 ${name}（${id}）`, r); return; }
              if (key === 'del') { handleDelete(r); }
            }}
          />
        );
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), [vpcs, onOpenDetail]);

  const statusOptions = useMemo(() => Array.from(new Set((slbs || []).map((r: any) => String(r?.LoadBalancerStatus || r?.status || '').trim()).filter(Boolean))).map(s => ({ label: s, value: s })), [slbs]);

  return (
    <PageDetailSection
      title={Label}
      icon={Icon}
      toolbarLeft={(
        <>
          <Input className="toolbar-search" prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />} placeholder="名称 / ID / 地址" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          <Select className="toolbar-filter-sm" placeholder="状态" allowClear value={statusFilter} onChange={setStatusFilter} options={statusOptions} dropdownMatchSelectWidth={false} />
          <button type="button" className="toolbar-reset-btn" onClick={() => { setKeyword(''); setStatusFilter(undefined); }}>重置</button>
        </>
      )}
      toolbarRight={(
        <div className="toolbar-actions">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { createForm.resetFields(); createForm.setFieldsValue({ addressType: 'intranet', loadBalancerSpec: 'slb.s1.small' }); setCreateOpen(true); }}>创建负载均衡</Button>
          <Tooltip title="刷新"><Button icon={<ReloadOutlined />} loading={loading} onClick={refresh} /></Tooltip>
        </div>
      )}
      asCard={false}
    >
      <Table
        className="std-table"
        bordered={false}
        rowKey={(r: any) => r?.LoadBalancerId || r?.id}
        dataSource={filtered}
        columns={columns as any}
        loading={loading}
        scroll={{ x: true }}
        pagination={{
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        }}
      />
      <LoadBalancerDetailDrawerAliyun
        open={!!drawerSlb}
        cloudId={cloudId}
        slb={drawerSlb}
        ecs={ecs}
        onClose={() => setDrawerSlb(null)}
      />

      <Modal title="创建负载均衡" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={submitCreate} confirmLoading={submitting} okText="创建" cancelText="取消" destroyOnClose>
        <Form form={createForm} layout="vertical">
          <Form.Item name="loadBalancerName" label="名称"><Input placeholder="选填" maxLength={80} allowClear /></Form.Item>
          <Form.Item name="addressType" label="网络类型" rules={[{ required: true }]}>
            <Select options={[{ label: '私网', value: 'intranet' }, { label: '公网', value: 'internet' }]} />
          </Form.Item>
          <Form.Item name="loadBalancerSpec" label="实例规格" rules={[{ required: true }]}>
            <Select options={slbSpecOptions} />
          </Form.Item>
          {addressType === 'intranet' && (
            <>
              <Form.Item name="vpcId" label="专有网络 VPC" rules={[{ required: true, message: '私网类型需选择 VPC' }]}>
                <Select showSearch optionFilterProp="label" placeholder="请选择 VPC" options={vpcOptions} onChange={() => createForm.setFieldsValue({ vSwitchId: undefined })} />
              </Form.Item>
              <Form.Item name="vSwitchId" label="交换机" rules={[{ required: true, message: '请选择交换机' }]}>
                <Select showSearch optionFilterProp="label" placeholder="请选择交换机" options={vswOptions} />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </PageDetailSection>
  );
};

export const Icon = <DeploymentUnitOutlined />;
export const Label = '负载均衡';
export default LoadBalancerSectionAliyun;
