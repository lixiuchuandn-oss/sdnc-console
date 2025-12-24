import React, { useMemo, useState } from 'react';
import { App, Button, Input, Select, Space, Table } from 'antd';
import { GlobalOutlined } from '@ant-design/icons';
import { fetchCloudProviderEips } from '../../../../services/api';
import { statusTag } from '../components/Common';
import SharedToolbar from '../../../../components/SharedToolbar';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { RowActionsButton } from '../../../../components/PageDetailSection';

type EipSectionProps = {
  cloudId: string;
  eips: any[];
  onSetEips: (list: any[]) => void;
  onOpenDetail: (type: string, title: string, data: any) => void;
};

const EipSection: React.FC<EipSectionProps> = ({ cloudId, eips, onSetEips, onOpenDetail }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');

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
    { title: '公网IP/ID', key: 'ip_id', render: (_: any, r: any) => { const ip = r?.public_ip_address || r?.publicip_address || r?.ip_address || '-'; const id = r?.id || r?.publicip_id || '-'; return (<span>{ip}<br />{id}</span>); }, sorter: (a: any, b: any) => String(a?.public_ip_address || a?.publicip_address || a?.ip_address || '').localeCompare(String(b?.public_ip_address || b?.publicip_address || b?.ip_address || '')) },
    { title: '带宽', key: 'bw', render: (_: any, r: any): React.ReactNode => { const bw = r?.bandwidth; const name = (typeof bw === 'object' ? bw?.name : r?.bandwidth_name) || '-'; const size = (typeof bw === 'object' ? bw?.size : r?.bandwidth_size); const share = (typeof bw === 'object' ? bw?.share_type : r?.share_type); const st = String(share || '').toUpperCase() === 'PER' ? '独享' : (share ? '共享' : ''); const sizeTxt = (size != null && size !== '') ? `${size}Mbps` : '-'; return `${name}（${sizeTxt}${st ? ` / ${st}` : ''}）`; }, sorter: (a: any, b: any) => { const sa = (typeof a?.bandwidth === 'object') ? a?.bandwidth?.size : a?.bandwidth_size; const sb = (typeof b?.bandwidth === 'object') ? b?.bandwidth?.size : b?.bandwidth_size; return Number(sa || 0) - Number(sb || 0); } },
    { title: '绑定资源', key: 'assoc', render: (_: any, r: any): React.ReactNode => { const ai = r?.associate_instance; if (ai && typeof ai === 'object') { const tp = String(ai?.type || '').toLowerCase(); const id = ai?.id || ai?.instance_id || ''; const map: any = { port: '网卡', eni: '网卡', elb: '负载均衡', nat: 'NAT网关' }; const label = map[tp] || (ai?.type || '资源'); return id ? `绑定: ${label} ${id}` : `绑定: ${label}`; } const pid = r?.port_id || ''; return pid ? `绑定: 网卡 ${pid}` : '-'; } },
    { title: '状态', dataIndex: 'status', key: 'status', render: (s: string) => statusTag(s), sorter: (a: any, b: any) => String(a?.status || '').localeCompare(String(b?.status || '')) },
    { title: '操作', key: 'actions', render: (_: any, r: any) => {
      const items = [{ key: 'detail', label: '详情' }];
      return (
        <RowActionsButton
          items={items}
          onClick={async ({ key }) => {
            if (key === 'detail') { const ip = r?.public_ip_address || r?.publicip_address || r?.ip_address || '-'; const id = r?.id || r?.publicip_id || '-'; onOpenDetail('eip', `EIP ${ip}（${id}）`, r); }
          }}
        />
      );
    } },
  ]), [onOpenDetail]);

  return (
    <>
      <SharedToolbar
        left={(
          <>
            <Input placeholder="请输入关键词" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} style={{ width: 220 }} />
            <Select placeholder="选择状态" allowClear value={statusFilter} onChange={setStatusFilter} style={{ width: 160 }} options={[...Array.from(new Set((eips || []).map((r: any) => String(r?.status || '').trim()).filter(Boolean))).map(s => ({ label: s, value: s }))]} />
          </>
        )}
        right={(
          <>
            <ResourceActionsDropdown
              items={[{ key: 'refresh', label: '刷新' }]}
              onClick={async ({ key }) => {
                if (key === 'refresh') {
                  try {
                    const json = await fetchCloudProviderEips(cloudId).catch(() => null);
                    const eipList: any[] = (json?.data?.publicips) || (json?.publicips) || (json?.data?.publicIps) || (json?.publicIps) || [];
                    onSetEips(Array.isArray(eipList) ? eipList : []);
                  } catch (e: any) { message.error(e?.message || '刷新失败'); }
                }
              }}
            />
          </>
        )}
      />
      <Table bordered rowKey={(r: any) => r.id || r.AllocationId || r.publicip_id} dataSource={filtered} columns={columns as any} pagination={{ pageSize: 10 }} />
    </>
  );
};


export const Icon = <GlobalOutlined />;
export const Label = 'EIP';
export default EipSection;
