import React, { useMemo, useState } from 'react';
import { App, Button, Input, Select, Space, Table, Tooltip, Typography } from 'antd';
import { DeploymentUnitOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { fetchCloudProviderLoadBalancers } from '../../../../../services/api';
import { statusTag, tagsToText } from '../components/Common';
import PageDetailSection, { RowActionsButton } from '../../../../../components/PageDetailSection';

type LoadBalancerSectionProps = {
  cloudId: string;
  slbs: any[];
  vpcs: any[];
  subnets: any[];
  onSetSlbs: (list: any[]) => void;
  onOpenDetail: (type: string, title: string, data: any) => void;
};

const parseSlbList = (json: any): any[] => (json?.data?.loadbalancers) || (json?.loadbalancers) || [];

const LoadBalancerSection: React.FC<LoadBalancerSectionProps> = ({ cloudId, slbs, vpcs, subnets, onSetSlbs, onOpenDetail }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(false);

  const refresh = async () => {
    if (!cloudId) return;
    setLoading(true);
    try {
      const json = await fetchCloudProviderLoadBalancers(cloudId);
      onSetSlbs(parseSlbList(json));
    } catch (e: any) { message.error(e?.message || '刷新失败'); }
    finally { setLoading(false); }
  };

  const filtered = useMemo(() => {
    const list = Array.isArray(slbs) ? slbs : [];
    const kw = keyword.trim().toLowerCase();
    return list.filter((r: any) => {
      const text = `${r?.name || ''} ${r?.id || ''} ${r?.vip_address || r?.vipAddress || r?.virtual_ip || ''}`.toLowerCase();
      const okKw = !kw || text.includes(kw);
      const st = String(r?.status || r?.operating_status || r?.provisioning_status || '').toLowerCase();
      const okSt = !statusFilter || st === statusFilter.toLowerCase();
      return okKw && okSt;
    });
  }, [slbs, keyword, statusFilter]);

  const tagText = (r: any) => tagsToText(r?.tags);

  const columns = useMemo(() => ([
    {
      title: '名称/ID', key: 'name_id', fixed: 'left' as const, width: 240,
      sorter: (a: any, b: any) => String(a?.name || '').localeCompare(String(b?.name || '')),
      render: (_: any, r: any) => {
        const name = r?.name || '-';
        const id = r?.id || '-';
        return (
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            <Typography.Text strong ellipsis={{ tooltip: name }}>{name}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }} copyable={id !== '-' ? { text: id } : false}>{id}</Typography.Text>
          </Space>
        );
      },
    },
    {
      title: '类型 / VIP', key: 'type_vip', width: 200,
      render: (_: any, r: any) => {
        const tp = r?.loadbalancer_type || r?.type || '-';
        const vip = r?.vip_address || r?.vipAddress || r?.virtual_ip || '';
        return (
          <Space direction="vertical" size={0}>
            <Typography.Text>{tp}</Typography.Text>
            {vip && <Typography.Text type="secondary" style={{ fontSize: 12 }} copyable={{ text: vip }}>VIP {vip}</Typography.Text>}
          </Space>
        );
      },
    },
    {
      title: '监听器/后端池', key: 'lp_count', width: 130,
      render: (_: any, r: any) => {
        const l = Array.isArray(r?.listeners) ? r.listeners.length : 0;
        const p = Array.isArray(r?.pools) ? r.pools.length : (Array.isArray(r?.backend_pools) ? r.backend_pools.length : 0);
        return `${l} / ${p}`;
      },
    },
    {
      title: '所属子网/VPC', key: 'subnet_vpc', width: 220, ellipsis: true,
      render: (_: any, r: any) => {
        const sid = r?.subnet_id || r?.vip_subnet_id || '';
        const vid = r?.vpc_id || '';
        const sn = (subnets || []).find((s: any) => String(s?.id || s?.SubnetId || '') === String(sid || ''));
        const vn = (vpcs || []).find((v: any) => String(v?.id || v?.VpcId || '') === String(vid || ''));
        const sl = sn?.name || sid || '-';
        const vl = vn?.name || vid || '-';
        return <Typography.Text type="secondary" ellipsis={{ tooltip: `${sl} / ${vl}` }}>{sl} / {vl}</Typography.Text>;
      },
    },
    { title: '标签', key: 'tags', width: 160, ellipsis: true, render: (_: any, r: any) => tagText(r) || '-' },
    { title: '状态', key: 'status', width: 110, render: (_: any, r: any) => statusTag(r?.provisioning_status || r?.operating_status || r?.status) },
    {
      title: '操作', key: 'actions', fixed: 'right' as const, width: 80,
      render: (_: any, r: any) => (
        <RowActionsButton
          items={[{ key: 'detail', label: '详情' }]}
          onClick={async ({ key }: { key: string }) => { if (key === 'detail') { const name = r?.name || '-'; const id = r?.id || '-'; onOpenDetail('slb', `负载均衡 ${name}（${id}）`, r); } }}
        />
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), [vpcs, subnets, onOpenDetail]);

  const statusOptions = useMemo(() => Array.from(new Set((slbs || []).map((r: any) => String(r?.status || r?.operating_status || r?.provisioning_status || '').trim()).filter(Boolean))).map(s => ({ label: s, value: s })), [slbs]);

  return (
    <PageDetailSection
      title={Label}
      icon={Icon}
      toolbarLeft={(
        <>
          <Input className="toolbar-search" prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />} placeholder="名称 / ID / VIP" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          <Select className="toolbar-filter-sm" placeholder="状态" allowClear value={statusFilter} onChange={setStatusFilter} options={statusOptions} dropdownMatchSelectWidth={false} />
          <button type="button" className="toolbar-reset-btn" onClick={() => { setKeyword(''); setStatusFilter(undefined); }}>重置</button>
        </>
      )}
      toolbarRight={(
        <div className="toolbar-actions">
          <Tooltip title="刷新"><Button icon={<ReloadOutlined />} loading={loading} onClick={refresh} /></Tooltip>
        </div>
      )}
      asCard={false}
    >
      <Table
        className="std-table"
        bordered={false}
        rowKey={(r: any) => r.id || r.LoadBalancerId}
        dataSource={filtered}
        columns={columns as any}
        loading={loading}
        scroll={{ x: true }}
        pagination={{ size: 'small', showTotal: (total) => `共 ${total} 条` }}
      />
    </PageDetailSection>
  );
};

export const Icon = <DeploymentUnitOutlined />;
export const Label = '负载均衡';
export default LoadBalancerSection;
