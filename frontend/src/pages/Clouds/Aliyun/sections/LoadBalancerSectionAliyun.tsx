import React, { useMemo, useState } from 'react';
import { App, Button, Dropdown, Input, Select, Space, Table } from 'antd';
import { MoreOutlined, ReloadOutlined } from '@ant-design/icons';
import { DeploymentUnitOutlined } from '@ant-design/icons';
import { fetchCloudProviderLoadBalancers } from '../../../../services/api';
import { statusTag, tagsToText } from '../../Hw/components/Common';
import PageDetailSection from '../../../../components/PageDetailSection';

type LoadBalancerSectionAliyunProps = {
  cloudId: string;
  slbs: any[];
  vpcs: any[];
  subnets: any[];
  onSetSlbs: (list: any[]) => void;
  onOpenDetail: (type: string, title: string, data: any) => void;
};

const LoadBalancerSectionAliyun: React.FC<LoadBalancerSectionAliyunProps> = ({ cloudId, slbs, vpcs, subnets, onSetSlbs, onOpenDetail }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');

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
    { title: '名称/ID', key: 'name_id', render: (_: any, r: any) => (<span>{r?.LoadBalancerName || r?.name || '-'}<br />{r?.LoadBalancerId || r?.id || '-'}</span>), sorter: (a: any, b: any) => { const an = String(a?.LoadBalancerName || a?.name || ''); const bn = String(b?.LoadBalancerName || b?.name || ''); const cmp = an.localeCompare(bn); if (cmp !== 0) return cmp; return String(a?.LoadBalancerId || a?.id || '').localeCompare(String(b?.LoadBalancerId || b?.id || '')); } },
    { title: '地址', key: 'address', render: (_: any, r: any) => r?.Address || r?.vip_address || '-', sorter: (a: any, b: any) => String(a?.Address || a?.vip_address || '').localeCompare(String(b?.Address || b?.vip_address || '')) },
    { title: '所属VPC', key: 'vpc', ellipsis: true, render: (_: any, r: any) => { const vid = r?.VpcId || r?.vpc_id || ''; const vn = (vpcs || []).find((v: any) => String(v?.VpcId || v?.id || '') === String(vid || '')); return vn?.VpcName || vn?.name || vid || '-'; } },
    { title: '标签', key: 'tags', ellipsis: true, render: (_: any, r: any) => tagText(r) },
    { title: '状态', key: 'status', render: (_: any, r: any) => { const t = r?.LoadBalancerStatus || r?.status; return statusTag(t); }, sorter: (a: any, b: any) => String(a?.LoadBalancerStatus || a?.status || '').localeCompare(String(b?.LoadBalancerStatus || b?.status || '')) },
    { title: '操作', key: 'actions', render: (_: any, r: any) => {
      const items = [{ key: 'detail', label: '详情' }];
      return (
        <Dropdown
          menu={{ items, onClick: async ({ key }) => {
            if (key === 'detail') { const name = r?.LoadBalancerName || r?.name || '-'; const id = r?.LoadBalancerId || r?.id || '-'; onOpenDetail('slb', `负载均衡 ${name}（${id}）`, r); }
          } }}
        >
          <Button type="link" icon={<MoreOutlined />} />
        </Dropdown>
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
          <Select placeholder="选择状态" allowClear value={statusFilter} onChange={setStatusFilter} style={{ width: 160 }} options={[...Array.from(new Set((slbs || []).map((r: any) => String(r?.LoadBalancerStatus || r?.status || '').trim()).filter(Boolean))).map(s => ({ label: s, value: s }))]} />
        </Space>
      )}
      toolbarRight={(
        <Dropdown
          menu={{
            items: [{ key: 'refresh', label: '刷新' }],
            onClick: async ({ key }) => {
              if (key === 'refresh') {
                try {
                  const json = await fetchCloudProviderLoadBalancers(cloudId).catch(() => null);
                  const slbList: any[] = (json?.LoadBalancers?.LoadBalancer) || (json?.data?.loadbalancers) || (json?.loadbalancers) || [];
                  onSetSlbs(Array.isArray(slbList) ? slbList : []);
                } catch (e: any) { message.error(e?.message || '刷新失败'); }
              }
            }
          }}
        >
          <Button icon={<MoreOutlined style={{ transform: 'rotate(90deg)' }} />}>更多</Button>
        </Dropdown>
      )}
      asCard={false}
    >
      <Table rowKey={(r: any) => r?.LoadBalancerId || r?.id} dataSource={filtered} columns={columns as any} pagination={{ pageSize: 10 }} />
    </PageDetailSection>
  );
};

export const Icon = <DeploymentUnitOutlined />;
export const Label = '负载均衡';
export default LoadBalancerSectionAliyun;
