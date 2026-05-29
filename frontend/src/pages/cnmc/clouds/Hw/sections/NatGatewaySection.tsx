import React, { useMemo, useState } from 'react';
import { App, Button, Input, Select, Space, Table, Tooltip, Typography } from 'antd';
import { SwapOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { fetchCloudProviderNatGateways } from '../../../../../services/api';
import { statusTag, tagsToText } from '../components/Common';
import PageDetailSection, { RowActionsButton } from '../../../../../components/PageDetailSection';

type NatGatewaySectionProps = {
  cloudId: string;
  natGateways: any[];
  eips: any[];
  vpcs: any[];
  subnets: any[];
  onSetNatGateways: (list: any[]) => void;
  onOpenDetail: (type: string, title: string, data: any) => void;
};

const parseNatList = (json: any): any[] => (json?.data?.nat_gateways) || (json?.nat_gateways) || [];

const NatGatewaySection: React.FC<NatGatewaySectionProps> = ({ cloudId, natGateways, eips, vpcs, subnets, onSetNatGateways, onOpenDetail }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(false);

  const refresh = async () => {
    if (!cloudId) return;
    setLoading(true);
    try {
      const json = await fetchCloudProviderNatGateways(cloudId);
      onSetNatGateways(parseNatList(json));
    } catch (e: any) { message.error(e?.message || '刷新失败'); }
    finally { setLoading(false); }
  };

  const filtered = useMemo(() => {
    const list = Array.isArray(natGateways) ? natGateways : [];
    const kw = keyword.trim().toLowerCase();
    return list.filter((r: any) => {
      const text = `${r?.name || ''} ${r?.id || ''} ${r?.spec || r?.Spec || ''}`.toLowerCase();
      const okKw = !kw || text.includes(kw);
      const st = String(r?.status || r?.Status || '').toLowerCase();
      const okSt = !statusFilter || st === statusFilter.toLowerCase();
      return okKw && okSt;
    });
  }, [natGateways, keyword, statusFilter]);

  const tagText = (r: any) => tagsToText(r?.tags);
  const eipCount = (r: any) => {
    let cnt = 0; const nid = String(r?.id || '');
    for (const e of (eips || [])) {
      const ai = (e as any)?.associate_instance;
      if (ai && typeof ai === 'object') {
        const tp = String(ai?.type || '').toLowerCase(); const id = String(ai?.id || ai?.instance_id || '');
        if ((tp === 'nat' || tp === 'nat_gateway') && id === nid) cnt++;
      }
    }
    return cnt;
  };

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
    { title: '规格', key: 'spec', width: 120, render: (_: any, r: any) => r?.spec || r?.Spec || '-' },
    { title: '绑定 EIP', key: 'eip_count', width: 110, render: (_: any, r: any) => `${eipCount(r)} 个` },
    {
      title: '所属子网/VPC', key: 'subnet_vpc', width: 220, ellipsis: true,
      render: (_: any, r: any) => {
        const sid = r?.subnet_id || ''; const vid = r?.vpc_id || '';
        const sn = (subnets || []).find((s: any) => String(s?.id || s?.SubnetId || '') === String(sid || ''));
        const vn = (vpcs || []).find((v: any) => String(v?.id || v?.VpcId || '') === String(vid || ''));
        const sl = sn?.name || sid || '-'; const vl = vn?.name || vid || '-';
        return <Typography.Text type="secondary" ellipsis={{ tooltip: `${sl} / ${vl}` }}>{sl} / {vl}</Typography.Text>;
      },
    },
    { title: '标签', key: 'tags', width: 160, ellipsis: true, render: (_: any, r: any) => tagText(r) || '-' },
    { title: '状态', dataIndex: 'status', key: 'status', width: 110, render: (s: string) => statusTag(s) },
    {
      title: '操作', key: 'actions', fixed: 'right' as const, width: 80,
      render: (_: any, r: any) => (
        <RowActionsButton
          items={[{ key: 'detail', label: '详情' }]}
          onClick={async ({ key }: { key: string }) => { if (key === 'detail') { const name = r?.name || '-'; const id = r?.id || '-'; onOpenDetail('nat', `NAT网关 ${name}（${id}）`, r); } }}
        />
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), [eips, vpcs, subnets, onOpenDetail]);

  const statusOptions = useMemo(() => Array.from(new Set((natGateways || []).map((r: any) => String(r?.status || '').trim()).filter(Boolean))).map(s => ({ label: s, value: s })), [natGateways]);

  return (
    <PageDetailSection
      title={Label}
      icon={Icon}
      toolbarLeft={(
        <>
          <Input className="toolbar-search" prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />} placeholder="名称 / ID / 规格" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} />
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
        rowKey={(r: any) => r.id || r.NatGatewayId}
        dataSource={filtered}
        columns={columns as any}
        loading={loading}
        scroll={{ x: true }}
        pagination={{ size: 'small', showTotal: (total) => `共 ${total} 条` }}
      />
    </PageDetailSection>
  );
};

export const Icon = <SwapOutlined />;
export const Label = 'NAT 网关';
export default NatGatewaySection;
