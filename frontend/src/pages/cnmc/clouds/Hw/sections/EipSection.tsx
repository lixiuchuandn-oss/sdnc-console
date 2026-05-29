import React, { useMemo, useState } from 'react';
import { App, Button, Input, Select, Space, Table, Tooltip, Typography } from 'antd';
import { GlobalOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { fetchCloudProviderEips } from '../../../../../services/api';
import { statusTag } from '../components/Common';
import PageDetailSection, { RowActionsButton } from '../../../../../components/PageDetailSection';

type EipSectionProps = {
  cloudId: string;
  eips: any[];
  onSetEips: (list: any[]) => void;
  onOpenDetail: (type: string, title: string, data: any) => void;
};

const parseEipList = (json: any): any[] =>
  (json?.data?.publicips) || (json?.publicips) || (json?.data?.publicIps) || (json?.publicIps) || (json?.data?.EipAddresses?.EipAddress) || [];

const EipSection: React.FC<EipSectionProps> = ({ cloudId, eips, onSetEips, onOpenDetail }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(false);

  const refresh = async () => {
    if (!cloudId) return;
    setLoading(true);
    try {
      const json = await fetchCloudProviderEips(cloudId);
      onSetEips(parseEipList(json));
    } catch (e: any) { message.error(e?.message || '刷新失败'); }
    finally { setLoading(false); }
  };

  const filtered = useMemo(() => {
    const list = Array.isArray(eips) ? eips : [];
    const kw = keyword.trim().toLowerCase();
    return list.filter((r: any) => {
      const ip = r?.public_ip_address || r?.publicip_address || r?.ip_address || '';
      const id = r?.id || r?.publicip_id || '';
      const bw = r?.bandwidth; const name = (typeof bw === 'object' ? bw?.name : r?.bandwidth_name) || '';
      const size = (typeof bw === 'object' ? bw?.size : r?.bandwidth_size) || '';
      const text = `${ip} ${id} ${name} ${size}`.toLowerCase();
      const okKw = !kw || text.includes(kw);
      const st = String(r?.status || '').toLowerCase();
      const okSt = !statusFilter || st === statusFilter.toLowerCase();
      return okKw && okSt;
    });
  }, [eips, keyword, statusFilter]);

  const columns = useMemo(() => ([
    {
      title: '公网 IP / ID', key: 'ip_id', fixed: 'left' as const, width: 220,
      sorter: (a: any, b: any) => String(a?.public_ip_address || a?.publicip_address || a?.ip_address || '').localeCompare(String(b?.public_ip_address || b?.publicip_address || b?.ip_address || '')),
      render: (_: any, r: any) => {
        const ip = r?.public_ip_address || r?.publicip_address || r?.ip_address || '-';
        const id = r?.id || r?.publicip_id || '-';
        return (
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            <Typography.Text strong copyable={ip !== '-' ? { text: ip } : false}>{ip}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }} copyable={id !== '-' ? { text: id } : false}>{id}</Typography.Text>
          </Space>
        );
      },
    },
    {
      title: '带宽', key: 'bw', width: 180,
      sorter: (a: any, b: any) => { const sa = (typeof a?.bandwidth === 'object') ? a?.bandwidth?.size : a?.bandwidth_size; const sb = (typeof b?.bandwidth === 'object') ? b?.bandwidth?.size : b?.bandwidth_size; return Number(sa || 0) - Number(sb || 0); },
      render: (_: any, r: any): React.ReactNode => {
        const bw = r?.bandwidth;
        const name = (typeof bw === 'object' ? bw?.name : r?.bandwidth_name) || '-';
        const size = (typeof bw === 'object' ? bw?.size : r?.bandwidth_size);
        const share = (typeof bw === 'object' ? bw?.share_type : r?.share_type);
        const st = String(share || '').toUpperCase() === 'PER' ? '独享' : (share ? '共享' : '');
        const sizeTxt = (size != null && size !== '') ? `${size}Mbps` : '-';
        return (
          <Space direction="vertical" size={0}>
            <Typography.Text>{name}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{sizeTxt}{st ? ` · ${st}` : ''}</Typography.Text>
          </Space>
        );
      },
    },
    {
      title: '绑定资源', key: 'assoc', width: 220,
      render: (_: any, r: any): React.ReactNode => {
        const ai = r?.associate_instance;
        if (ai && typeof ai === 'object') {
          const tp = String(ai?.type || '').toLowerCase();
          const id = ai?.id || ai?.instance_id || '';
          const map: any = { port: '网卡', eni: '网卡', elb: '负载均衡', nat: 'NAT网关' };
          const label = map[tp] || (ai?.type || '资源');
          return id ? <Typography.Text ellipsis={{ tooltip: `${label} ${id}` }}>{label} {id}</Typography.Text> : label;
        }
        const pid = r?.port_id || '';
        return pid ? <Typography.Text ellipsis={{ tooltip: `网卡 ${pid}` }}>网卡 {pid}</Typography.Text> : <Typography.Text type="secondary">未绑定</Typography.Text>;
      },
    },
    { title: '状态', dataIndex: 'status', key: 'status', width: 110, render: (s: string) => statusTag(s) },
    {
      title: '操作', key: 'actions', fixed: 'right' as const, width: 80,
      render: (_: any, r: any) => (
        <RowActionsButton
          items={[{ key: 'detail', label: '详情' }]}
          onClick={async ({ key }) => { if (key === 'detail') { const ip = r?.public_ip_address || r?.publicip_address || r?.ip_address || '-'; const id = r?.id || r?.publicip_id || '-'; onOpenDetail('eip', `EIP ${ip}（${id}）`, r); } }}
        />
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), [onOpenDetail]);

  const statusOptions = useMemo(() => Array.from(new Set((eips || []).map((r: any) => String(r?.status || '').trim()).filter(Boolean))).map(s => ({ label: s, value: s })), [eips]);

  return (
    <PageDetailSection
      title={Label}
      icon={Icon}
      toolbarLeft={(
        <>
          <Input className="toolbar-search" prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />} placeholder="IP / ID / 带宽" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} />
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
        rowKey={(r: any) => r.id || r.AllocationId || r.publicip_id}
        dataSource={filtered}
        columns={columns as any}
        loading={loading}
        scroll={{ x: true }}
        pagination={{ size: 'small', showTotal: (total) => `共 ${total} 条` }}
      />
    </PageDetailSection>
  );
};

export const Icon = <GlobalOutlined />;
export const Label = 'EIP';
export default EipSection;
