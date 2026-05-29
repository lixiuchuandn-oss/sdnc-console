import React, { useMemo, useState } from 'react';
import { App, Button, Input, Select, Space, Table, Tooltip, Typography } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { DeploymentUnitOutlined } from '@ant-design/icons';
import { fetchCloudProviderLoadBalancers } from '../../../../../services/aliyunApi';
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

const LoadBalancerSectionAliyun: React.FC<LoadBalancerSectionAliyunProps> = ({ cloudId, slbs, vpcs, ecs, onSetSlbs, onOpenDetail }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(false);
  const [drawerSlb, setDrawerSlb] = useState<any | null>(null);

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
        ];
        return (
          <RowActionsButton
            items={items}
            onClick={async ({ key }: { key: string }) => {
              if (key === 'manage') { setDrawerSlb(r); return; }
              if (key === 'detail') { const name = r?.LoadBalancerName || r?.name || '-'; const id = r?.LoadBalancerId || r?.id || '-'; onOpenDetail('slb', `负载均衡 ${name}（${id}）`, r); }
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
    </PageDetailSection>
  );
};

export const Icon = <DeploymentUnitOutlined />;
export const Label = '负载均衡';
export default LoadBalancerSectionAliyun;
