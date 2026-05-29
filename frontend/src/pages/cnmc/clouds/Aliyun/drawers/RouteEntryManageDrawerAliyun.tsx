import React, { useMemo, useEffect, useState } from 'react';
import { App, Button, Form, Input, Select, Table, Modal, Tag } from 'antd';
import { ReloadOutlined, PlusOutlined, DeleteOutlined, ImportOutlined } from '@ant-design/icons';
import StdSideDrawer from '../../../../../components/StdSideDrawer';
import { RowActionsButton } from '../../../../../components/PageDetailSection';
import { fetchCloudProviderRouteEntries, deleteCloudProviderRouteEntry } from '../../../../../services/aliyunApi';
import RouteEntryBatchAddModalAliyun from '../modals/RouteEntryBatchAddModalAliyun';

type Props = {
  open: boolean;
  cloudId: string;
  ecs: any[];
  routeTableTarget: any | null;
  entries: any[];
  onClose: () => void;
  onUpdated: (entries: any[]) => void;
  onOpenCreate: () => void;
  onOpenEdit: (entry: any) => void;
};

const RouteEntryManageDrawerAliyun: React.FC<Props> = ({ open, cloudId, ecs, routeTableTarget, entries, onClose, onUpdated, onOpenCreate, onOpenEdit }) => {
  const { message } = App.useApp();
  const [filterForm] = Form.useForm();
  const [openBatchAdd, setOpenBatchAdd] = useState(false);

  const extractEntries = (json: any): any[] => {
    const d = (json && (json as any).data) ? (json as any).data : json;
    const arr = Array.isArray(d)
      ? d
      : Array.isArray((d || {}).RouteEntries?.RouteEntry)
      ? (d || {}).RouteEntries.RouteEntry
      : Array.isArray((d || {}).route_entries)
      ? (d || {}).route_entries
      : Array.isArray((json || {}).RouteEntries?.RouteEntry)
      ? (json || {}).RouteEntries.RouteEntry
      : Array.isArray((json || {}).route_entries)
      ? (json || {}).route_entries
      : [];
    return Array.isArray(arr) ? arr : [];
  };

  const [selectedRowKeys, setSelectedRowKeys] = React.useState<React.Key[]>([]);

  const refresh = async () => {
    try {
      setSelectedRowKeys([]);
      const id0 = routeTableTarget?.RouteTableId || routeTableTarget?.id; if (!id0) return;
      const json = await fetchCloudProviderRouteEntries(cloudId, id0);
      const list = extractEntries(json);
      onUpdated(Array.isArray(list) ? list : []);
    } catch (e:any) { message.error(e?.message || '刷新失败'); }
  };

  useEffect(() => {
    if (open && routeTableTarget) {
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, routeTableTarget]);

  const kw = String(filterForm.getFieldValue('keyword') || '').trim().toLowerCase();
  const tp = String(filterForm.getFieldValue('type') || '').trim().toLowerCase();
  const filtered = useMemo(() => {
    const raw = Array.isArray(entries) ? entries : [];
    return raw.filter((it:any)=> {
      const okType = !tp || String(it?.NextHopType||it?.type||'').toLowerCase()===tp;
      if (!okType) return false;
      if (!kw) return true;
      const d = String(it?.DestinationCidrBlock||it?.destination||'').toLowerCase();
      const n = String(it?.NextHopId||it?.nexthop||'').toLowerCase();
      return d.includes(kw) || n.includes(kw);
    });
  }, [entries, kw, tp]);

  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) return;
    Modal.confirm({
      title: `确认删除选中的 ${selectedRowKeys.length} 条路由？`,
      content: '删除后不可恢复。',
      okText: '删除', okType: 'danger', cancelText: '取消',
      onOk: async () => {
        const id0 = routeTableTarget?.RouteTableId || routeTableTarget?.id; if (!id0) return;
        let successCount = 0;
        let failCount = 0;
        try {
          const tasks = selectedRowKeys.map(async (key) => {
            const [dest, nh] = String(key).split('_');
            // nh might be empty for system/local routes, but we disable selection for them
            try {
               await deleteCloudProviderRouteEntry(cloudId, id0, { destination: dest, nexthop: nh });
               return true;
            } catch (e) {
               return false;
            }
          });
          
          const results = await Promise.all(tasks);
          successCount = results.filter(r => r).length;
          failCount = results.filter(r => !r).length;

          if (failCount > 0) {
            message.warning(`删除完成：成功 ${successCount} 条，失败 ${failCount} 条`);
          } else {
            message.success(`成功删除 ${successCount} 条路由`);
          }
          await refresh();
        } catch (e:any) {
          message.error(e?.message || '操作失败');
          await refresh();
        }
      }
    });
  };

  return (
    <StdSideDrawer
      title="路由条目"
      open={open}
      width={1100}
      styles={{ body: { padding: 16 } }}
      onClose={onClose}
    >
      <div className="page-toolbar">
        <Form
          form={filterForm}
          className="toolbar-container"
          layout="vertical"
          onValuesChange={(cv:any)=>{ if (cv.keyword !== undefined) filterForm.setFieldsValue({ keyword: cv.keyword || '' }); if (cv.type !== undefined) filterForm.setFieldsValue({ type: cv.type || '' }); }}
          style={{ rowGap: 12, columnGap: 12 }}
        >
          <Form.Item name="keyword" label="关键字">
            <Input allowClear placeholder="搜索目的网段/下一跳" className="toolbar-search" />
          </Form.Item>
          <Form.Item name="type" label="类型">
            <Select
              allowClear
              placeholder="选择类型"
              className="toolbar-filter-sm"
              options={[
                { label:'ECS实例', value:'instance' },
                { label:'弹性网卡', value:'networkinterface' },
                { label:'NAT网关', value:'natgateway' },
                { label:'VPN网关', value:'vpngateway' },
                { label:'虚拟IP', value:'havip' },
                { label:'云连接', value:'routerinterface' },
                { label:'IPv6网关', value:'ipv6gateway' },
              ]}
            />
          </Form.Item>
        </Form>
        <div className="toolbar-actions">
          {selectedRowKeys.length > 0 && (
            <Button danger icon={<DeleteOutlined />} onClick={handleBatchDelete}>批量删除 ({selectedRowKeys.length})</Button>
          )}
          <Button icon={<ImportOutlined />} onClick={() => setOpenBatchAdd(true)}>批量添加</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={onOpenCreate}>添加路由</Button>
          <Button icon={<ReloadOutlined />} onClick={refresh}>刷新</Button>
        </div>
      </div>

      <Table
        bordered
        size="middle"
        rowKey={(r:any)=> `${r?.DestinationCidrBlock || r?.destination || ''}_${r?.NextHopId || r?.nexthop || ''}`}
        rowSelection={{
          selectedRowKeys,
          onChange: setSelectedRowKeys,
          getCheckboxProps: (r: any) => ({
            disabled: (!r?.NextHopId || String(r?.NextHopId).trim() === '-' || String(r?.NextHopId).trim() === '' || r?.Type === 'System'), // Disable system routes
          }),
        }}
        dataSource={filtered}
        columns={[
          { title: '目的网段', key: 'dest', sorter: (a:any,b:any)=> String(a?.DestinationCidrBlock||a?.destination||'').localeCompare(String(b?.DestinationCidrBlock||b?.destination||'')), render: (_:any,r:any)=> r?.DestinationCidrBlock || r?.destination || '-' },
          { title: '下一跳类型', key: 'nhType', sorter: (a:any,b:any)=> String(a?.NextHopType||a?.type||'-').localeCompare(String(b?.NextHopType||b?.type||'-')), render: (_:any,r:any)=> {
            const t = String(r?.NextHopType || r?.type || '').toLowerCase();
            if (t === 'instance') return '服务器实例';
            if (t === 'networkinterface') return '扩展网卡';
            if (t === 'havip') return '虚拟IP';
            if (t === 'natgateway') return 'NAT网关';
            if (t === 'routerinterface') return '云连接';
            return r?.NextHopType || r?.type || '-';
          } },
          { title: '下一跳', key: 'nh', sorter: (a:any,b:any)=> {
            const va = (():string=>{ const v = String(a?.NextHopId||a?.nexthop||'').trim(); const isLocal = !v || v==='-'; if (isLocal) return 'Local'; const t = String(a?.NextHopType||a?.type||'').toLowerCase(); if (t==='instance') { const m = (ecs||[]).find((s:any)=> String(s?.InstanceId||s?.id||'')===v); return m?.InstanceName || m?.name || v; } return v; })();
            const vb = (():string=>{ const v = String(b?.NextHopId||b?.nexthop||'').trim(); const isLocal = !v || v==='-'; if (isLocal) return 'Local'; const t = String(b?.NextHopType||b?.type||'').toLowerCase(); if (t==='instance') { const m = (ecs||[]).find((s:any)=> String(s?.InstanceId||s?.id||'')===v); return m?.InstanceName || m?.name || v; } return v; })();
            return String(va).localeCompare(String(vb));
          }, render: (_:any,r:any)=> { const v = String(r?.NextHopId || r?.nexthop || '').trim(); const isLocal = !v || v==='-'; if (isLocal) return 'Local'; const t = String(r?.NextHopType || r?.type || '').toLowerCase(); if (t==='instance') { const m = (ecs||[]).find((s:any)=> String(s?.InstanceId||s?.id||'')===v); return m?.InstanceName || m?.name || v; } return v; } },
          { title: '类型', key: 'cat', sorter: (a:any,b:any)=> { const la = (a?.Type === 'System' || (!a?.NextHopId || String(a?.NextHopId).trim()==='-' || String(a?.NextHopId).trim()==='')) ? '系统' : '自定义'; const lb = (b?.Type === 'System' || (!b?.NextHopId || String(b?.NextHopId).trim()==='-' || String(b?.NextHopId).trim()==='')) ? '系统' : '自定义'; return String(la).localeCompare(String(lb)); }, render: (_:any, r:any)=> { const isSystem = r?.Type === 'System' || (!r?.NextHopId || String(r?.NextHopId).trim() === '-' || String(r?.NextHopId).trim() === ''); return isSystem ? <Tag>系统</Tag> : <Tag color="blue">自定义</Tag>; } },
          { title: '操作', key: 'actions', render: (_:any, r:any)=> {
            const v = String(r?.NextHopId || r?.nexthop || '').trim();
            const isSystem = r?.Type === 'System' || (!v || v === '-' || v === '');
            const items = [ { key: 'edit', label: '编辑', disabled: isSystem }, { key: 'delete', label: '删除', disabled: isSystem, danger: true } ];
            return (
              <RowActionsButton
                items={items}
                onClick={async ({ key }) => {
                  if (key === 'edit') {
                    onOpenEdit({ destination: r?.DestinationCidrBlock, nexthop: r?.NextHopId, type: (String(r?.NextHopType||'').toLowerCase()==='instance'?'ecs':String(r?.NextHopType||'')) });
                  } else if (key === 'delete') {
                    const id0 = routeTableTarget?.RouteTableId || routeTableTarget?.id; if (!id0) return;
                    try {
                      await deleteCloudProviderRouteEntry(cloudId, id0, { destination: r?.DestinationCidrBlock, nexthop: r?.NextHopId });
                      await refresh();
                      const still = (entries||[]).some((it:any)=> String(it?.DestinationCidrBlock||'')===String(r?.DestinationCidrBlock||''));
                      if (!still) { message.success('删除成功'); return; }
                      message.error('删除失败：云端未生效');
                    } catch (e:any) {
                      await refresh();
                      message.error(e?.message || '删除失败');
                    }
                  }
                }}
              />
            );
          } }
        ]}
        pagination={{ pageSize: 8, size: 'default' }}
      />
      
      <RouteEntryBatchAddModalAliyun
        open={openBatchAdd}
        cloudId={cloudId}
        routeTableId={routeTableTarget?.RouteTableId || routeTableTarget?.id || ''}
        onClose={() => setOpenBatchAdd(false)}
        onSuccess={refresh}
      />
    </StdSideDrawer>
  );
};

export default RouteEntryManageDrawerAliyun;
