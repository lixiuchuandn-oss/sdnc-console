import React, { useMemo, useState } from 'react';
import { App, Button, Input, Space, Table, Tooltip, Typography } from 'antd';
import { BranchesOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { fetchCloudProviderRouteTables, deleteCloudProviderRouteTable } from '../../../../../services/aliyunApi';
import SharedToolbar from '../../../../../components/SharedToolbar';
import { RowActionsButton } from '../../../../../components/PageDetailSection';

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

const parseRouteTableList = (json: any): any[] => {
  const list =
    (json?.data?.RouteTables?.RouteTable) ||
    (json?.RouteTables?.RouteTable) ||
    (json?.data?.route_tables) ||
    (json?.route_tables) ||
    (json?.data?.routetables) ||
    (json?.routetables) ||
    (Array.isArray(json?.data) ? json?.data : (Array.isArray(json) ? json : []));
  return Array.isArray(list) ? list : (list ? [list] : []);
};

const RouteTableSectionAliyun: React.FC<RouteTableSectionAliyunProps> = ({ cloudId, routeTables, vpcs, subnets, onSetRouteTables, onOpenDetail, onOpenCreate, onOpenAssoc, onManageRoutes, onOpenSubnetsView }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  const refresh = async () => {
    if (!cloudId) return;
    setLoading(true);
    try {
      const json = await fetchCloudProviderRouteTables(cloudId);
      onSetRouteTables(parseRouteTableList(json));
    } catch (e: any) { message.error(e?.message || '刷新失败'); }
    finally { setLoading(false); }
  };

  const filteredRouteTables = useMemo(() => {
    const list = Array.isArray(routeTables) ? routeTables : [];
    const kw = keyword.trim().toLowerCase();
    return list.filter((r: any) => {
      const text = `${r?.RouteTableName || r?.name || ''} ${r?.RouteTableId || r?.id || ''} ${r?.VpcId || r?.vpc_id || ''}`.toLowerCase();
      return !kw || text.includes(kw);
    });
  }, [routeTables, keyword]);

  const columns = useMemo(() => ([
    {
      title: '名称/ID', key: 'name_id', fixed: 'left' as const, width: 240,
      sorter: (a: any, b: any) => String(a?.RouteTableName || a?.name || '').localeCompare(String(b?.RouteTableName || b?.name || '')),
      render: (_: any, r: any) => {
        const name = r?.RouteTableName || r?.name || '-';
        const id = r?.RouteTableId || r?.id || '-';
        return (
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            <Typography.Text strong ellipsis={{ tooltip: name }}>{name}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }} copyable={id !== '-' ? { text: id } : false}>{id}</Typography.Text>
          </Space>
        );
      },
    },
    { title: '类型', key: 'type', width: 120, render: (_: any, r: any) => r?.RouteTableType || r?.type || '-' },
    {
      title: '关联交换机', key: 'assoc_subnets', width: 160,
      render: (_: any, r: any) => {
        const list: any[] = Array.isArray(r?.VSwitchIds?.VSwitchId) ? r?.VSwitchIds?.VSwitchId : (Array.isArray(r?.subnets) ? r?.subnets : []);
        return (<Space size={4}><span>{`${list.length} 个`}</span><Button type="link" size="small" style={{ padding: 0 }} onClick={() => onOpenSubnetsView(r)}>查看</Button></Space>);
      },
      sorter: (a: any, b: any) => {
        const f = (x: any) => (Array.isArray(x?.VSwitchIds?.VSwitchId) ? x?.VSwitchIds?.VSwitchId : (Array.isArray(x?.subnets) ? x?.subnets : [])).length;
        return f(a) - f(b);
      },
    },
    {
      title: '所属 VPC', key: 'vpc', width: 220,
      render: (_: any, r: any) => {
        const vid = r?.VpcId || r?.vpc_id || '';
        const hit = (vpcs || []).find((v: any) => String(v?.VpcId || v?.id || '') === String(vid || ''));
        const vname = hit?.VpcName || hit?.name || '';
        return vid ? (
          <Space direction="vertical" size={0}>
            {vname && <Typography.Text ellipsis={{ tooltip: vname }}>{vname}</Typography.Text>}
            <Typography.Text type="secondary" style={{ fontSize: 12 }} copyable={{ text: vid }} ellipsis={{ tooltip: vid }}>{vid}</Typography.Text>
          </Space>
        ) : '-';
      },
    },
    {
      title: '创建时间', key: 'ctime', width: 170,
      sorter: (a: any, b: any) => String(a?.CreationTime || a?.created_at || a?.createdAt || '').localeCompare(String(b?.CreationTime || b?.created_at || b?.createdAt || '')),
      render: (_: any, r: any) => {
        const c = r?.CreationTime || r?.created_at || r?.createdAt || '';
        if (!c) return '-';
        try { const d = new Date(c); if (!isNaN(d.getTime())) return d.toLocaleString('zh-CN', { hour12: false }); } catch {}
        return c;
      },
    },
    {
      title: '操作', key: 'actions', fixed: 'right' as const, width: 80,
      render: (_: any, r: any) => {
        const items = [
          { key: 'detail', label: '详情' },
          { key: 'assoc', label: '挂载子网' },
          { key: 'routes', label: '管理路由条目' },
          { key: 'del', label: '删除', danger: true },
        ];
        return (
          <RowActionsButton
            items={items}
            onClick={async ({ key }) => {
              if (key === 'detail') { const name = r?.RouteTableName || r?.name || '-'; const id = r?.RouteTableId || r?.id || '-'; onOpenDetail('rt', `路由表 ${name}（${id}）`, r); return; }
              if (key === 'assoc') { onOpenAssoc(r); return; }
              if (key === 'routes') { onManageRoutes(r); return; }
              if (key === 'del') {
                const { Modal } = await import('antd');
                const id0 = r?.RouteTableId || r?.id; if (!id0) return;
                Modal.confirm({
                  title: '确定删除该路由表?',
                  content: `ID: ${id0}`,
                  okText: '确认删除', okType: 'danger', cancelText: '取消',
                  onOk: async () => {
                    try {
                      await deleteCloudProviderRouteTable(cloudId, id0);
                      message.success('删除成功');
                      await refresh();
                    } catch (e: any) { message.error(e?.message || '删除失败'); }
                  },
                });
              }
            }}
          />
        );
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), [cloudId, vpcs, subnets, onOpenDetail, onOpenAssoc, onManageRoutes, onOpenSubnetsView]);

  return (
    <>
      <SharedToolbar
        left={(
          <Input className="toolbar-search" prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />} placeholder="名称 / ID / VPC" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} />
        )}
        right={(
          <div className="toolbar-actions">
            <Button type="primary" icon={<PlusOutlined />} onClick={onOpenCreate}>创建路由表</Button>
            <Tooltip title="刷新"><Button icon={<ReloadOutlined />} loading={loading} onClick={refresh} /></Tooltip>
          </div>
        )}
      />
      <Table
        className="std-table"
        bordered={false}
        rowKey={(r: any) => r.RouteTableId || r.id}
        dataSource={filteredRouteTables}
        columns={columns as any}
        loading={loading}
        scroll={{ x: true }}
        pagination={{
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        }}
      />
    </>
  );
};

export const Icon = <BranchesOutlined />;
export const Label = '路由表';
export default RouteTableSectionAliyun;
