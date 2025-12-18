import React, { useMemo, useState } from 'react';
import { App, Button, Dropdown, Input, Select, Space, Table } from 'antd';
import { MoreOutlined } from '@ant-design/icons';
import { DeploymentUnitOutlined } from '@ant-design/icons';
import { fetchCloudProviderLoadBalancers } from '../../../../services/api';
import { statusTag, tagsToText } from '../components/Common';
import SharedToolbar from '../../../../components/SharedToolbar';
import { RowActionsButton } from '../../../../components/PageDetailSection';

type LoadBalancerSectionProps = {
  cloudId: string;
  slbs: any[];
  vpcs: any[];
  subnets: any[];
  onSetSlbs: (list: any[]) => void;
  onOpenDetail: (type: string, title: string, data: any) => void;
};

const LoadBalancerSection: React.FC<LoadBalancerSectionProps> = ({ cloudId, slbs, vpcs, subnets, onSetSlbs, onOpenDetail }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');

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

  const lpCount = (r: any) => {
    const l = Array.isArray(r?.listeners) ? r.listeners.length : 0;
    const p = Array.isArray(r?.pools) ? r.pools.length : (Array.isArray(r?.backend_pools) ? r.backend_pools.length : 0);
    return `监听器: ${l}；后端池: ${p}`;
  };

  const columns = useMemo(() => ([
    { title: '名称/ID', key: 'name_id', render: (_: any, r: any) => (<span>{r?.name || '-'}<br />{r?.id || '-'}</span>), sorter: (a: any, b: any) => { const an = String(a?.name || ''); const bn = String(b?.name || ''); const cmp = an.localeCompare(bn); if (cmp !== 0) return cmp; return String(a?.id || '').localeCompare(String(b?.id || '')); } },
    { title: '类型/VIP', key: 'type_vip', render: (_: any, r: any) => { const tp = r?.loadbalancer_type || r?.type || '-'; const vip = r?.vip_address || r?.vipAddress || r?.virtual_ip || ''; return vip ? `${tp}（VIP: ${vip}）` : tp; }, sorter: (a: any, b: any) => String(a?.loadbalancer_type || a?.type || '').localeCompare(String(b?.loadbalancer_type || b?.type || '')) },
    { title: '监听器/后端池数量', key: 'lp_count', render: (_: any, r: any) => lpCount(r), sorter: (a: any, b: any) => { const f = (x: any) => { const l = Array.isArray(x?.listeners) ? x.listeners.length : 0; const p = Array.isArray(x?.pools) ? x.pools.length : (Array.isArray(x?.backend_pools) ? x.backend_pools.length : 0); return l + p; }; return f(a) - f(b); } },
    { title: '所属子网/VPC', key: 'subnet_vpc', ellipsis: true, render: (_: any, r: any) => { const sid = r?.subnet_id || r?.vip_subnet_id || ''; const vid = r?.vpc_id || ''; const sn = (subnets || []).find((s: any) => String(s?.id || s?.SubnetId || '') === String(sid || '')); const vn = (vpcs || []).find((v: any) => String(v?.id || v?.VpcId || '') === String(vid || '')); const sl = sn?.name || sid || '-'; const vl = vn?.name || vid || '-'; return `${sl} / ${vl}`; } },
    { title: '标签', key: 'tags', ellipsis: true, render: (_: any, r: any) => tagText(r), sorter: (a: any, b: any) => tagText(a).localeCompare(tagText(b)) },
    { title: '状态', key: 'status', render: (_: any, r: any) => { const t = r?.provisioning_status || r?.operating_status || r?.status; return statusTag(t); }, sorter: (a: any, b: any) => String(a?.provisioning_status || a?.operating_status || a?.status || '').localeCompare(String(b?.provisioning_status || b?.operating_status || b?.status || '')) },
    { title: '操作', key: 'actions', render: (_: any, r: any) => {
      const items = [{ key: 'detail', label: '详情' }];
      return (
        <RowActionsButton
          items={items}
          onClick={async ({ key }: { key: string }) => {
            if (key === 'detail') { const name = r?.name || '-'; const id = r?.id || '-'; onOpenDetail('slb', `负载均衡 ${name}（${id}）`, r); }
          }}
        />
      );
    } },
  ]), [vpcs, subnets, onOpenDetail]);

  return (
    <>
      <SharedToolbar
        left={(
          <>
            <Input placeholder="请输入关键词" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} style={{ width: 220 }} />
            <Select placeholder="选择状态" allowClear value={statusFilter} onChange={setStatusFilter} style={{ width: 160 }} options={[...Array.from(new Set((slbs || []).map((r: any) => String(r?.status || r?.operating_status || r?.provisioning_status || '').trim()).filter(Boolean))).map(s => ({ label: s, value: s }))]} />
          </>
        )}
        right={(
          <>
            <Dropdown
              menu={{
                items: [{ key: 'refresh', label: '刷新' }],
                onClick: async ({ key }) => {
                  if (key === 'refresh') {
                    try {
                      const json = await fetchCloudProviderLoadBalancers(cloudId).catch(() => null);
                      const slbList: any[] = (json?.data?.loadbalancers) || (json?.loadbalancers) || [];
                      onSetSlbs(Array.isArray(slbList) ? slbList : []);
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
      <Table bordered rowKey={(r: any) => r.id || r.LoadBalancerId} dataSource={filtered} columns={columns as any} pagination={{ pageSize: 10 }} />
    </>
  );
};


export const Icon = <DeploymentUnitOutlined />;
export const Label = '负载均衡';
export default LoadBalancerSection;
