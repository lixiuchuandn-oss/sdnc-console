import React, { useMemo, useState } from 'react';
import { App, Button, Dropdown, Input, Select, Space, Table } from 'antd';
import { MoreOutlined, NodeIndexOutlined } from '@ant-design/icons';
import { fetchCloudProviderSubnets, deleteCloudProviderSubnet } from '../../../../services/api';
import SharedToolbar from '../../../../components/SharedToolbar';
import { RowActionsButton } from '../../../../components/PageDetailSection';

type SubnetSectionProps = {
  cloudId: string;
  subnets: any[];
  vpcs: any[];
  onSetSubnets: (list: any[]) => void;
  onOpenDetail: (type: string, title: string, data: any) => void;
  onOpenCreate: () => void;
};

const SubnetSection: React.FC<SubnetSectionProps> = ({ cloudId, subnets, vpcs, onSetSubnets, onOpenDetail, onOpenCreate }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  const filteredSubnets = useMemo(() => {
    const list = Array.isArray(subnets) ? subnets : [];
    const kw = keyword.trim().toLowerCase();
    return list.filter((r: any) => {
      const text = `${r?.name || ''} ${r?.id || ''} ${r?.cidr || ''} ${r?.vpc_id || ''}`.toLowerCase();
      const okKw = !kw || text.includes(kw);
      const st = String(r?.status || r?.Status || '').toLowerCase();
      const okSt = !statusFilter || st === statusFilter.toLowerCase();
      return okKw && okSt;
    });
  }, [subnets, keyword, statusFilter]);

  const columns = useMemo(() => ([
    { title: '名称/ID', key: 'name_id', render: (_: any, r: any) => (<span>{r?.name || '-'}<br />{r?.id || r?.VSwitchId || r?.SubnetId || '-'}</span>), sorter: (a: any, b: any) => { const an = String(a?.name || ''); const bn = String(b?.name || ''); const cmp = an.localeCompare(bn); if (cmp !== 0) return cmp; return String(a?.id || a?.VSwitchId || a?.SubnetId || '').localeCompare(String(b?.id || b?.VSwitchId || b?.SubnetId || '')); } },
    { title: 'CIDR/网关', key: 'cidr_gw', render: (_: any, r: any) => { const cidr = r?.cidr || '-'; const gw = r?.gateway_ip || r?.GatewayIp || ''; const txt = gw ? `${cidr}（网关: ${gw}）` : String(cidr || '-'); return txt; }, sorter: (a: any, b: any) => String(a?.cidr || '').localeCompare(String(b?.cidr || '')) },
    { title: '所属VPC', key: 'vpc', render: (_: any, r: any) => { const vid = r?.vpc_id || ''; const vname = (vpcs || []).find((v: any) => String(v?.id || v?.VpcId || '') === String(vid || ''))?.name || 'vpc'; const left = vname || (vid ? '-' : '-'); const right = vid || '-'; return (<span>{left}<br />{right}</span>); }, sorter: (a: any, b: any) => String(a?.vpc_id || '').localeCompare(String(b?.vpc_id || '')) },
    { title: '状态', dataIndex: 'status', key: 'status', render: (s: string) => s ? String(s) : '-', sorter: (a: any, b: any) => String(a?.status || '').localeCompare(String(b?.status || '')) },
    { title: '可用IP数', dataIndex: 'available_ip_address_count', key: 'avail_ips', render: (t: any) => (t != null ? `可用 ${t} 个` : '-'), sorter: (a: any, b: any) => Number(a?.available_ip_address_count || 0) - Number(b?.available_ip_address_count || 0) },
    { title: '创建时间', key: 'ctime', render: (_: any, r: any) => { const c = r?.created_at || r?.createdAt || ''; try { if (!c) return '-'; const d = new Date(c); if (!isNaN(d.getTime())) { const txt = d.toLocaleString('zh-CN', { hour12: false }); return txt; } } catch { } return c || '-'; }, sorter: (a: any, b: any) => String(a?.created_at || a?.createdAt || '').localeCompare(String(b?.created_at || b?.createdAt || '')) },
    { title: '操作', key: 'actions', render: (_: any, r: any) => {
        const items = [
          { key: 'detail', label: '详情' },
          { key: 'del', label: '删除' },
        ];
        return (
          <RowActionsButton
            items={items}
            onClick={async ({ key }: { key: string }) => {
              if (key === 'detail') { const name = r?.name || '-'; const id = r?.id || r?.SubnetId || '-'; onOpenDetail('subnet', `子网 ${name}（${id}）`, r); return; }
              if (key === 'del') {
                try {
                  const id0 = r?.id || r?.SubnetId; if (!id0) return;
                  await deleteCloudProviderSubnet(cloudId, id0);
                  const json = await fetchCloudProviderSubnets(cloudId);
                  const subnetList: any[] = (json?.data?.subnets) || (json?.subnets) || [];
                  onSetSubnets(Array.isArray(subnetList) ? subnetList : []);
                } catch (e: any) { message.error(e?.message || '删除失败'); }
              }
            }}
          />
        );
      } },
  ]), [cloudId, vpcs, onOpenDetail]);

  return (
    <>
      <SharedToolbar
        left={(
          <>
            <Input placeholder="请输入关键词" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} style={{ width: 220 }} />
            <Select placeholder="选择状态" allowClear value={statusFilter} onChange={setStatusFilter} style={{ width: 160 }} options={[...Array.from(new Set((subnets || []).map((r: any) => String(r?.status || r?.Status || '').trim()).filter(Boolean))).map(s => ({ label: s, value: s }))]} />
          </>
        )}
        right={(
          <>
            <Button type="primary" onClick={onOpenCreate}>创建子网</Button>
            <Dropdown
              menu={{
                items: [{ key: 'refresh', label: '刷新' }],
                onClick: async ({ key }) => {
                  if (key === 'refresh') {
                    try {
                      const json = await fetchCloudProviderSubnets(cloudId);
                      const subnetList: any[] = (json?.data?.subnets) || (json?.subnets) || [];
                      onSetSubnets(Array.isArray(subnetList) ? subnetList : []);
                    } catch (e: any) { message.error(e?.message || '刷新失败'); }
                  }
                }
              }}
            >
              <Button icon={<MoreOutlined style={{ transform: 'rotate(90deg)' }} />}>更多</Button>
            </Dropdown>
          </>
        )}
      />
      <Table bordered rowKey={(r: any) => r.id || r.VSwitchId} dataSource={filteredSubnets} columns={columns as any} pagination={{ pageSize: 10 }} />
    </>
  );
};


export const Icon = <NodeIndexOutlined />;
export const Label = '子网';
export default SubnetSection;
