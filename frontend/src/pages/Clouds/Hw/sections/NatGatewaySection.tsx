import React, { useMemo, useState } from 'react';
import { App, Button, Input, Select, Space, Table } from 'antd';
import { MoreOutlined, SwapOutlined } from '@ant-design/icons';
import { fetchCloudProviderNatGateways } from '../../../../services/api';
import { statusTag, tagsToText } from '../components/Common';
import SharedToolbar from '../../../../components/SharedToolbar';
import { RowActionsButton } from '../../../../components/PageDetailSection';

type NatGatewaySectionProps = {
  cloudId: string;
  natGateways: any[];
  eips: any[];
  vpcs: any[];
  subnets: any[];
  onSetNatGateways: (list: any[]) => void;
  onOpenDetail: (type: string, title: string, data: any) => void;
};

const NatGatewaySection: React.FC<NatGatewaySectionProps> = ({ cloudId, natGateways, eips, vpcs, subnets, onSetNatGateways, onOpenDetail }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');

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
      const ai = (e as any)?.associate_instance; if (ai && typeof ai === 'object') {
        const tp = String(ai?.type || '').toLowerCase(); const id = String(ai?.id || ai?.instance_id || '');
        if ((tp === 'nat' || tp === 'nat_gateway') && id === nid) cnt++;
      }
    }
    return cnt;
  };

  const columns = useMemo(() => ([
    { title: '名称/ID', key: 'name_id', render: (_: any, r: any) => (<span>{r?.name || '-'}<br />{r?.id || '-'}</span>), sorter: (a: any, b: any) => { const an = String(a?.name || ''); const bn = String(b?.name || ''); const cmp = an.localeCompare(bn); if (cmp !== 0) return cmp; return String(a?.id || '').localeCompare(String(b?.id || '')); } },
    { title: '规格/状态', key: 'spec_status', render: (_: any, r: any) => { const s = r?.spec || r?.Spec || '-'; const st = r?.status || r?.Status || '-'; return `${s}（${st}）`; }, sorter: (a: any, b: any) => String(a?.spec || '').localeCompare(String(b?.spec || '')) },
    { title: '绑定EIP数量', key: 'eip_count', render: (_: any, r: any) => { const n = eipCount(r); return n > 0 ? `绑定 ${n} 个` : '绑定 0 个'; }, sorter: (a: any, b: any) => eipCount(a) - eipCount(b) },
    { title: '所属子网/VPC', key: 'subnet_vpc', ellipsis: true, render: (_: any, r: any) => { const sid = r?.subnet_id || ''; const vid = r?.vpc_id || ''; const sn = (subnets || []).find((s: any) => String(s?.id || s?.SubnetId || '') === String(sid || '')); const vn = (vpcs || []).find((v: any) => String(v?.id || v?.VpcId || '') === String(vid || '')); const sl = sn?.name || sid || '-'; const vl = vn?.name || vid || '-'; return `${sl} / ${vl}`; }, sorter: (a: any, b: any) => String(a?.subnet_id || '').localeCompare(String(b?.subnet_id || '')) },
    { title: '标签', key: 'tags', ellipsis: true, render: (_: any, r: any) => tagText(r), sorter: (a: any, b: any) => tagText(a).localeCompare(tagText(b)) },
    { title: '状态', dataIndex: 'status', key: 'status', render: (s: string) => statusTag(s), sorter: (a: any, b: any) => String(a?.status || '').localeCompare(String(b?.status || '')) },
    { title: '操作', key: 'actions', render: (_: any, r: any) => {
      const items = [{ key: 'detail', label: '详情' }];
      return (
        <RowActionsButton
          items={items}
          onClick={async ({ key }: { key: string }) => {
            if (key === 'detail') { const name = r?.name || '-'; const id = r?.id || '-'; onOpenDetail('nat', `NAT网关 ${name}（${id}）`, r); }
          }}
        />
      );
    } },
  ]), [eips, vpcs, subnets, onOpenDetail]);

  return (
    <>
      <SharedToolbar
        left={(
          <>
            <Input placeholder="请输入关键词" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} style={{ width: 220 }} />
            <Select placeholder="选择状态" allowClear value={statusFilter} onChange={setStatusFilter} style={{ width: 160 }} options={[...Array.from(new Set((natGateways || []).map((r: any) => String(r?.status || '').trim()).filter(Boolean))).map(s => ({ label: s, value: s }))]} />
          </>
        )}
        right={(
          <>
            <RowActionsButton
              items={[{ key: 'refresh', label: '刷新' }]}
              onClick={async ({ key }: { key: string }) => {
                if (key === 'refresh') {
                  try {
                    const json = await fetchCloudProviderNatGateways(cloudId).catch(() => null);
                    const natList: any[] = (json?.data?.nat_gateways) || (json?.nat_gateways) || [];
                    onSetNatGateways(Array.isArray(natList) ? natList : []);
                  } catch (e: any) { message.error(e?.message || '刷新失败'); }
                }
              }}
              buttonProps={{
                type: 'default',
                icon: <MoreOutlined style={{ transform: 'rotate(90deg)' }} />,
                children: '更多'
              }}
            />
          </>
        )}
      />
      <Table bordered rowKey={(r: any) => r.id || r.NatGatewayId} dataSource={filtered} columns={columns as any} pagination={{ pageSize: 10 }} />
    </>
  );
};


export const Icon = <SwapOutlined />;
export const Label = 'NAT 网关';
export default NatGatewaySection;
