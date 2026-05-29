import React, { useMemo, useState } from 'react';
import { App, Input, Select, Space, Table } from 'antd';
import { SwapOutlined } from '@ant-design/icons';
import { fetchCloudProviderNatGateways } from '../../../../../services/aliyunApi';
import { statusTag, tagsToText } from '../../Hw/components/Common';
import PageDetailSection, { RowActionsButton } from '../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../components/ResourceActionsDropdown';

type NatGatewaySectionAliyunProps = {
  cloudId: string;
  natGateways: any[];
  eips: any[];
  vpcs: any[];
  subnets: any[];
  onSetNatGateways: (list: any[]) => void;
  onOpenDetail: (type: string, title: string, data: any) => void;
};

const NatGatewaySectionAliyun: React.FC<NatGatewaySectionAliyunProps> = ({ cloudId, natGateways, vpcs, onSetNatGateways, onOpenDetail }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');

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
    { title: '名称/ID', key: 'name_id', render: (_: any, r: any) => (<span>{r?.Name || r?.name || '-'}<br />{r?.NatGatewayId || r?.id || '-'}</span>), sorter: (a: any, b: any) => { const an = String(a?.Name || a?.name || ''); const bn = String(b?.Name || b?.name || ''); const cmp = an.localeCompare(bn); if (cmp !== 0) return cmp; return String(a?.NatGatewayId || a?.id || '').localeCompare(String(b?.NatGatewayId || b?.id || '')); } },
    { title: '规格', key: 'spec', render: (_: any, r: any) => r?.Spec || r?.spec || '-', sorter: (a: any, b: any) => String(a?.Spec || a?.spec || '').localeCompare(String(b?.Spec || b?.spec || '')) },
    { title: '所属VPC', key: 'vpc', ellipsis: true, render: (_: any, r: any) => { const vid = r?.VpcId || r?.vpc_id || ''; const vn = (vpcs || []).find((v: any) => String(v?.VpcId || v?.id || '') === String(vid || '')); return vn?.VpcName || vn?.name || vid || '-'; } },
    { title: '标签', key: 'tags', ellipsis: true, render: (_: any, r: any) => tagText(r) },
    { title: '状态', key: 'status', render: (_: any, r: any) => { const s = r?.Status || r?.status; return statusTag(s); }, sorter: (a: any, b: any) => String(a?.Status || a?.status || '').localeCompare(String(b?.Status || b?.status || '')) },
    { title: '操作', key: 'actions', render: (_: any, r: any) => {
      const items = [{ key: 'detail', label: '详情' }];
      return (
        <RowActionsButton
          items={items}
          onClick={async ({ key }: { key: string }) => {
            if (key === 'detail') { const name = r?.Name || r?.name || '-'; const id = r?.NatGatewayId || r?.id || '-'; onOpenDetail('nat', `NAT网关 ${name}（${id}）`, r); }
          }}
        />
      );
    } },
  ]), [vpcs, onOpenDetail]);

  return (
    <PageDetailSection
      title={Label}
      icon={Icon}
      toolbarLeft={(
        <Space size={8}>
          <Input placeholder="请输入关键词" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} style={{ width: 220 }} />
          <Select placeholder="选择状态" allowClear value={statusFilter} onChange={setStatusFilter} style={{ width: 160 }} options={[...Array.from(new Set((natGateways || []).map((r: any) => String(r?.Status || r?.status || '').trim()).filter(Boolean))).map(s => ({ label: s, value: s }))]} />
        </Space>
      )}
      toolbarRight={(
        <ResourceActionsDropdown
          items={[{ key: 'refresh', label: '刷新' }]}
          onClick={async ({ key }) => {
            if (key === 'refresh') {
              try {
                const json = await fetchCloudProviderNatGateways(cloudId).catch(() => null);
                const natList: any[] = (json?.NatGateways?.NatGateway) || (json?.data?.nat_gateways) || (json?.nat_gateways) || [];
                onSetNatGateways(Array.isArray(natList) ? natList : []);
              } catch (e: any) { message.error(e?.message || '刷新失败'); }
            }
          }}
        />
      )}
      asCard={false}
    >
      <Table rowKey={(r: any) => r?.NatGatewayId || r?.id} dataSource={filtered} columns={columns as any} pagination={{
        size: 'small',
        showTotal: (total) => `共 ${total} 条`,
      }} />
    </PageDetailSection>
  );
};

export const Icon = <SwapOutlined />;
export const Label = 'NAT 网关';
export default NatGatewaySectionAliyun;
