import React, { useMemo, useState } from 'react';
import { App, Button, Input, Space, Table } from 'antd';
import { BranchesOutlined } from '@ant-design/icons';
import { fetchCloudProviderRouteTables, deleteCloudProviderRouteTable } from '../../../../services/api';
import SharedToolbar from '../../../../components/SharedToolbar';
import { RowActionsButton } from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';

type RouteTableSectionAliyunProps = {
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

const RouteTableSectionAliyun: React.FC<RouteTableSectionAliyunProps> = ({ cloudId, routeTables, vpcs, subnets, onSetRouteTables, onOpenDetail, onOpenCreate, onOpenAssoc, onManageRoutes, onOpenSubnetsView }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');

  const filteredRouteTables = useMemo(() => {
    const list = Array.isArray(routeTables) ? routeTables : [];
    const kw = keyword.trim().toLowerCase();
    return list.filter((r: any) => {
      // Aliyun: RouteTableId, RouteTableName, VpcId
      const text = `${r?.RouteTableName || r?.name || ''} ${r?.RouteTableId || r?.id || ''} ${r?.VpcId || r?.vpc_id || ''}`.toLowerCase();
      return !kw || text.includes(kw);
    });
  }, [routeTables, keyword]);

  const columns = useMemo(() => ([
    { title: '名称/ID', key: 'name_id', render: (_: any, r: any) => (<span>{r?.RouteTableName || r?.name || '-'}<br />{r?.RouteTableId || r?.id || '-'}</span>), sorter: (a: any, b: any) => { const an = String(a?.RouteTableName || a?.name || ''); const bn = String(b?.RouteTableName || b?.name || ''); const cmp = an.localeCompare(bn); if (cmp !== 0) return cmp; return String(a?.RouteTableId || a?.id || '').localeCompare(String(b?.RouteTableId || b?.id || '')); } },
    { title: '类型', key: 'type', render: (_: any, r: any) => r?.RouteTableType || r?.type || '-', sorter: (a: any, b: any) => String(a?.RouteTableType || a?.type || '').localeCompare(String(b?.RouteTableType || b?.type || '')) },
    { title: '关联VSwitch', key: 'assoc_subnets', render: (_: any, r: any) => { 
        // Aliyun uses VSwitchIds usually, or we might need to match from subnets list
        const list: any[] = Array.isArray(r?.VSwitchIds?.VSwitchId) ? r?.VSwitchIds?.VSwitchId : (Array.isArray(r?.subnets) ? r?.subnets : []);
        const cnt = list.length; 
        return (<Space><span>{`关联 ${cnt} 个`}</span><Button type="link" onClick={() => onOpenSubnetsView(r)}>查看</Button></Space>); 
      }, 
      sorter: (a: any, b: any) => { 
        const f = (x: any) => { 
          const list: any[] = Array.isArray(x?.VSwitchIds?.VSwitchId) ? x?.VSwitchIds?.VSwitchId : (Array.isArray(x?.subnets) ? x?.subnets : []);
          return list.length; 
        }; 
        return f(a) - f(b); 
      } 
    },
    { title: '所属VPC', key: 'vpc', render: (_: any, r: any) => { const vid = r?.VpcId || r?.vpc_id || ''; const vname = (vpcs || []).find((v: any) => String(v?.VpcId || v?.id || '') === String(vid || ''))?.VpcName || (vpcs || []).find((v: any) => String(v?.VpcId || v?.id || '') === String(vid || ''))?.name || 'vpc'; const left = vname || (vid ? '-' : '-'); const right = vid || '-'; return (<span>{left}<br />{right}</span>); }, sorter: (a: any, b: any) => String(a?.VpcId || a?.vpc_id || '').localeCompare(String(b?.VpcId || b?.vpc_id || '')) },
    { title: '创建时间', key: 'ctime', render: (_: any, r: any) => { const c = r?.CreationTime || r?.created_at || r?.createdAt || ''; try { if (!c) return '-'; const d = new Date(c); if (!isNaN(d.getTime())) { const txt = d.toLocaleString('zh-CN', { hour12: false }); return txt; } } catch { } return c || '-'; }, sorter: (a: any, b: any) => String(a?.CreationTime || a?.created_at || a?.createdAt || '').localeCompare(String(b?.CreationTime || b?.created_at || b?.createdAt || '')) },
    { title: '操作', key: 'actions', render: (_: any, r: any) => {
      const items = [
        { key: 'detail', label: '详情' },
        { key: 'assoc', label: '挂载子网' },
        { key: 'routes', label: '管理路由条目' },
        { key: 'del', label: '删除' },
      ];
      return (
        <RowActionsButton
          items={items}
          onClick={async ({ key }) => {
            if (key === 'detail') { const name = r?.RouteTableName || r?.name || '-'; const id = r?.RouteTableId || r?.id || '-'; onOpenDetail('rt', `路由表 ${name}（${id}）`, r); return; }
            if (key === 'assoc') { onOpenAssoc(r); }
            if (key === 'routes') { onManageRoutes(r); }
            if (key === 'del') {
              try {
                const id0 = r?.RouteTableId || r?.id; if (!id0) return;
                await deleteCloudProviderRouteTable(cloudId, id0);
                const json = await fetchCloudProviderRouteTables(cloudId);
                const rtList: any[] = (json?.RouteTables?.RouteTable) || (json?.data?.route_tables) || (json?.route_tables) || [];
                onSetRouteTables(Array.isArray(rtList) ? rtList : []);
              } catch (e: any) { message.error(e?.message || '删除失败'); }
            }
          }}
        />
      );
    } },
  ]), [cloudId, vpcs, subnets, onOpenDetail, onOpenAssoc, onManageRoutes, onOpenSubnetsView]);

  return (
    <>
      <SharedToolbar
        left={(
          <Space size={8}>
            <Input placeholder="请输入关键词" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} style={{ width: 220 }} />
          </Space>
        )}
        right={(
          <Space size={8}>
            <Button type="primary" onClick={onOpenCreate}>创建路由表</Button>
            <ResourceActionsDropdown
              items={[{ key: 'refresh', label: '刷新' }]}
              onClick={async ({ key }) => {
                if (key === 'refresh') {
                  try {
                    const json = await fetchCloudProviderRouteTables(cloudId);
                    const rtList: any[] =
                      (json?.RouteTables?.RouteTable) ||
                      (json?.data?.route_tables) ||
                      (json?.route_tables) ||
                      (json?.data?.routetables) ||
                      (json?.routetables) ||
                      (Array.isArray(json?.data) ? json?.data : (Array.isArray(json) ? json : []));
                    onSetRouteTables(Array.isArray(rtList) ? rtList : (rtList ? [rtList] : []));
                  } catch (e: any) { message.error(e?.message || '刷新失败'); }
                }
              }}
            />
          </Space>
        )}
      />
      <Table
        bordered
        tableLayout="auto"
        size="middle"
        className="vr-table vr-table--middle"
        rowKey={(r: any) => r.RouteTableId || r.id}
        dataSource={filteredRouteTables}
        columns={columns as any}
        pagination={{ pageSize: 10, size: 'default' }}
      />
    </>
  );
};

export const Icon = <BranchesOutlined />;
export const Label = '路由表';
export default RouteTableSectionAliyun;
