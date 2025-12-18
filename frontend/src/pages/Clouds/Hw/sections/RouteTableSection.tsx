import React, { useMemo, useState } from 'react';
import { App, Button, Dropdown, Input, Space, Table } from 'antd';
import { MoreOutlined, ReloadOutlined, BranchesOutlined } from '@ant-design/icons';
import { fetchCloudProviderRouteTables, deleteCloudProviderRouteTable } from '../../../../services/api';
import SharedToolbar from '../../../../components/SharedToolbar';

type RouteTableSectionProps = {
  cloudId: string;
  routeTables: any[];
  vpcs: any[];
  subnets: any[];
  onSetRouteTables: (list: any[]) => void;
  onOpenDetail: (type: string, title: string, data: any) => void;
  onOpenCreate: () => void;
  onOpenAssoc: (rt: any) => void;
  onManageRoutes: (rt: any) => void;
  onOpenSubnetsView: (rt: any) => void;
};

const RouteTableSection: React.FC<RouteTableSectionProps> = ({ cloudId, routeTables, vpcs, subnets, onSetRouteTables, onOpenDetail, onOpenCreate, onOpenAssoc, onManageRoutes, onOpenSubnetsView }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');

  const filteredRouteTables = useMemo(() => {
    const list = Array.isArray(routeTables) ? routeTables : [];
    const kw = keyword.trim().toLowerCase();
    return list.filter((r: any) => {
      const d = (r?._default === true || r?.default === true || r?.is_default === true) ? 'default' : 'custom';
      const text = `${r?.name || ''} ${r?.id || ''} ${r?.vpc_id || ''} ${d}`.toLowerCase();
      return !kw || text.includes(kw);
    });
  }, [routeTables, keyword]);

  const columns = useMemo(() => ([
    { title: '名称/ID', key: 'name_id', render: (_: any, r: any) => (<span>{r?.name || '-'}<br />{r?.id || '-'}</span>), sorter: (a: any, b: any) => { const an = String(a?.name || ''); const bn = String(b?.name || ''); const cmp = an.localeCompare(bn); if (cmp !== 0) return cmp; return String(a?.id || '').localeCompare(String(b?.id || '')); } },
    { title: '默认路由表', key: 'is_default', render: (_: any, r: any) => ((r?.is_default === true || r?._default === true || r?.default === true) ? '是' : '否'), sorter: (a: any, b: any) => ((a?.is_default === true || a?._default === true || a?.default === true) ? 1 : 0) - ((b?.is_default === true || b?._default === true || b?.default === true) ? 1 : 0) },
    { title: '关联子网', key: 'assoc_subnets', render: (_: any, r: any) => { const list: any[] = Array.isArray(r?.subnets) ? r?.subnets : []; const ids = list.map((x: any) => x?.id || x?.SubnetId || '').filter(Boolean); const cnt = ids.length; return (<Space><span>{`关联 ${cnt} 个`}</span><Button type="link" onClick={() => onOpenSubnetsView(r)}>查看</Button></Space>); }, sorter: (a: any, b: any) => { const f = (x: any) => { const l: Array<any> = Array.isArray(x?.subnets) ? x.subnets : []; return l.length; }; return f(a) - f(b); } },
    { title: '所属VPC', key: 'vpc', render: (_: any, r: any) => { const vid = r?.vpc_id || ''; const vname = (vpcs || []).find((v: any) => String(v?.id || v?.VpcId || '') === String(vid || ''))?.name || 'vpc'; const left = vname || (vid ? '-' : '-'); const right = vid || '-'; return (<span>{left}<br />{right}</span>); }, sorter: (a: any, b: any) => String(a?.vpc_id || '').localeCompare(String(b?.vpc_id || '')) },
    { title: '创建时间', key: 'ctime', render: (_: any, r: any) => { const c = r?.created_at || r?.createdAt || ''; try { if (!c) return '-'; const d = new Date(c); if (!isNaN(d.getTime())) { const txt = d.toLocaleString('zh-CN', { hour12: false }); return txt; } } catch { } return c || '-'; }, sorter: (a: any, b: any) => String(a?.created_at || a?.createdAt || '').localeCompare(String(b?.created_at || b?.createdAt || '')) },
    { title: '操作', key: 'actions', render: (_: any, r: any) => {
      const items = [
        { key: 'detail', label: '详情' },
        { key: 'assoc', label: '挂载子网' },
        { key: 'routes', label: '管理路由条目' },
        { key: 'del', label: '删除' },
      ];
      return (
        <Dropdown
          menu={{ items, onClick: async ({ key }) => {
            if (key === 'detail') { const name = r?.name || '-'; const id = r?.id || r?.RouteTableId || '-'; onOpenDetail('rt', `路由表 ${name}（${id}）`, r); return; }
            if (key === 'assoc') { onOpenAssoc(r); }
            if (key === 'routes') { onManageRoutes(r); }
            if (key === 'del') {
              try {
                const id0 = r?.id || r?.RouteTableId; if (!id0) return;
                await deleteCloudProviderRouteTable(cloudId, id0);
                const json = await fetchCloudProviderRouteTables(cloudId);
                const rtList: any[] = (json?.data?.route_tables) || (json?.route_tables) || [];
                onSetRouteTables(Array.isArray(rtList) ? rtList : []);
              } catch (e: any) { message.error(e?.message || '删除失败'); }
            }
          } }}
        >
          <Button type="link" icon={<MoreOutlined />} />
        </Dropdown>
      );
    } },
  ]), [cloudId, vpcs, subnets, onOpenDetail, onOpenAssoc, onManageRoutes, onOpenSubnetsView]);

  return (
    <>
      <SharedToolbar
        left={(
          <>
            <Button type="primary" onClick={onOpenCreate}>创建路由表</Button>
            <Input placeholder="请输入关键词" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} style={{ width: 220 }} />
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
                      const json = await fetchCloudProviderRouteTables(cloudId);
                      const rtList: any[] = (json?.data?.route_tables) || (json?.route_tables) || (json?.data?.routetables) || (json?.routetables) || [];
                      onSetRouteTables(Array.isArray(rtList) ? rtList : []);
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
      <Table
        bordered
        tableLayout="auto"
        size="middle"
        className="vr-table vr-table--middle"
        rowKey={(r: any) => r.id || r.RouteTableId}
        dataSource={filteredRouteTables}
        columns={columns as any}
        pagination={{ pageSize: 10 }}
      />
    </>
  );
};


export const Icon = <BranchesOutlined />;
export const Label = '路由表';
export default RouteTableSection;
