import React, { useMemo, useState } from 'react';
import { App, Button, Input, Modal, Space, Table, Tooltip, Typography } from 'antd';
import { BranchesOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { fetchCloudProviderRouteTables, deleteCloudProviderRouteTable } from '../../../../../services/api';
import PageDetailSection, { RowActionsButton } from '../../../../../components/PageDetailSection';

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

const parseRtList = (json: any): any[] => (json?.data?.route_tables) || (json?.route_tables) || (json?.data?.routetables) || (json?.routetables) || [];

const RouteTableSection: React.FC<RouteTableSectionProps> = ({ cloudId, routeTables, vpcs, subnets, onSetRouteTables, onOpenDetail, onOpenCreate, onOpenAssoc, onManageRoutes, onOpenSubnetsView }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  const refresh = async () => {
    if (!cloudId) return;
    setLoading(true);
    try {
      const json = await fetchCloudProviderRouteTables(cloudId);
      onSetRouteTables(parseRtList(json));
    } catch (e: any) { message.error(e?.message || '刷新失败'); }
    finally { setLoading(false); }
  };

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
    {
      title: '名称/ID', key: 'name_id', fixed: 'left' as const, width: 240,
      sorter: (a: any, b: any) => String(a?.name || '').localeCompare(String(b?.name || '')),
      render: (_: any, r: any) => {
        const name = r?.name || '-';
        const id = r?.id || '-';
        return (
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            <Typography.Text strong ellipsis={{ tooltip: name }}>{name}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }} copyable={id !== '-' ? { text: id } : false}>{id}</Typography.Text>
          </Space>
        );
      },
    },
    { title: '默认', key: 'is_default', width: 80, render: (_: any, r: any) => ((r?.is_default === true || r?._default === true || r?.default === true) ? '是' : '否') },
    {
      title: '关联子网', key: 'assoc_subnets', width: 150,
      render: (_: any, r: any) => {
        const list: any[] = Array.isArray(r?.subnets) ? r?.subnets : [];
        return (<Space size={4}><span>{list.length} 个</span><Button type="link" size="small" style={{ padding: 0 }} onClick={() => onOpenSubnetsView(r)}>查看</Button></Space>);
      },
    },
    {
      title: '所属 VPC', key: 'vpc', width: 220,
      render: (_: any, r: any) => {
        const vid = r?.vpc_id || '';
        const vname = (vpcs || []).find((v: any) => String(v?.id || v?.VpcId || '') === String(vid || ''))?.name || '';
        return (
          <Space direction="vertical" size={0}>
            {vname && <Typography.Text ellipsis={{ tooltip: vname }}>{vname}</Typography.Text>}
            <Typography.Text type="secondary" style={{ fontSize: 12 }} copyable={vid ? { text: vid } : false}>{vid || '-'}</Typography.Text>
          </Space>
        );
      },
    },
    {
      title: '创建时间', key: 'ctime', width: 170,
      render: (_: any, r: any) => {
        const c = r?.created_at || r?.createdAt || '';
        if (!c) return '-';
        try { const d = new Date(c); if (!isNaN(d.getTime())) return d.toLocaleString('zh-CN', { hour12: false }); } catch {}
        return c;
      },
    },
    {
      title: '操作', key: 'actions', fixed: 'right' as const, width: 80,
      render: (_: any, r: any) => (
        <RowActionsButton
          items={[
            { key: 'detail', label: '详情' },
            { key: 'assoc', label: '挂载子网' },
            { key: 'routes', label: '管理路由条目' },
            { key: 'del', label: '删除', danger: true },
          ]}
          onClick={async ({ key }) => {
            if (key === 'detail') { const name = r?.name || '-'; const id = r?.id || r?.RouteTableId || '-'; onOpenDetail('rt', `路由表 ${name}（${id}）`, r); return; }
            if (key === 'assoc') { onOpenAssoc(r); return; }
            if (key === 'routes') { onManageRoutes(r); return; }
            if (key === 'del') {
              const id0 = r?.id || r?.RouteTableId; if (!id0) return;
              Modal.confirm({
                title: '确定删除该路由表?', content: `ID: ${id0}`, okText: '确认删除', okType: 'danger', cancelText: '取消',
                onOk: async () => { try { await deleteCloudProviderRouteTable(cloudId, id0); message.success('删除成功'); await refresh(); } catch (e: any) { message.error(e?.message || '删除失败'); } },
              });
            }
          }}
        />
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), [cloudId, vpcs, subnets, onOpenDetail, onOpenAssoc, onManageRoutes, onOpenSubnetsView]);

  return (
    <PageDetailSection
      title={Label}
      icon={Icon}
      toolbarLeft={(
        <>
          <Input className="toolbar-search" prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />} placeholder="名称 / ID / VPC" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          <button type="button" className="toolbar-reset-btn" onClick={() => setKeyword('')}>重置</button>
        </>
      )}
      toolbarRight={(
        <div className="toolbar-actions">
          <Button type="primary" icon={<PlusOutlined />} onClick={onOpenCreate}>创建路由表</Button>
          <Tooltip title="刷新"><Button icon={<ReloadOutlined />} loading={loading} onClick={refresh} /></Tooltip>
        </div>
      )}
      asCard={false}
    >
      <Table
        className="std-table"
        bordered={false}
        rowKey={(r: any) => r.id || r.RouteTableId}
        dataSource={filteredRouteTables}
        columns={columns as any}
        loading={loading}
        scroll={{ x: true }}
        pagination={{ size: 'small', showTotal: (total) => `共 ${total} 条` }}
      />
    </PageDetailSection>
  );
};

export const Icon = <BranchesOutlined />;
export const Label = '路由表';
export default RouteTableSection;
