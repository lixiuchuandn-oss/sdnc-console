import React, { useMemo, useEffect } from 'react';
import { App, Button, Dropdown, Form, Input, Select, Table } from 'antd';
import { EllipsisOutlined, ReloadOutlined } from '@ant-design/icons';
import StdSideDrawer from '../../../../components/StdSideDrawer';
import { RowActionsButton } from '../../../../components/PageDetailSection';
import { fetchCloudProviderRouteEntries, deleteCloudProviderRouteEntry } from '../../../../services/api';

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

  const refresh = async () => {
    try {
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
      const okType = !tp || String(it?.NextHopType||it?.type||'').toLowerCase()===tp || (tp==='ecs' && String(it?.NextHopType||'').toLowerCase()==='instance');
      if (!okType) return false;
      if (!kw) return true;
      const d = String(it?.DestinationCidrBlock||it?.destination||'').toLowerCase();
      const n = String(it?.NextHopId||it?.nexthop||'').toLowerCase();
      return d.includes(kw) || n.includes(kw);
    });
  }, [entries, kw, tp]);

  return (
    <StdSideDrawer
      title="路由条目"
      open={open}
      width={1100}
      styles={{ body: { padding: 16 } }}
      onClose={onClose}
    >
      <div className="filters-row">
        <Form form={filterForm} className="filter-tools filter-tools--center" layout="vertical" onValuesChange={(cv:any)=>{ if (cv.keyword !== undefined) filterForm.setFieldsValue({ keyword: cv.keyword || '' }); if (cv.type !== undefined) filterForm.setFieldsValue({ type: cv.type || '' }); }} style={{ rowGap: 12, columnGap: 12 }}>
          <Form.Item name="keyword" label="关键字"> <Input allowClear placeholder="搜索目的网段/下一跳" style={{ width: 240 }} /> </Form.Item>
          <Form.Item name="type" label="类型"> <Select allowClear placeholder="选择类型" options={[{ label:'ecs', value:'ecs' },{ label:'eni', value:'eni' },{ label:'nat', value:'nat' },{ label:'vip', value:'vip' },{ label:'pcn', value:'pcn' }]} style={{ width: 160 }} /> </Form.Item>
        </Form>
        <div className="filter-actions">
          <Button type="primary" onClick={onOpenCreate}>添加路由</Button>
          <Button icon={<ReloadOutlined />} onClick={refresh}>刷新</Button>
        </div>
      </div>

      <Table
        bordered
        size="middle"
        rowKey={(r:any)=> `${r?.DestinationCidrBlock || r?.destination || ''}_${r?.NextHopId || r?.nexthop || ''}`}
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
          { title: '类型', key: 'cat', sorter: (a:any,b:any)=> { const la = (!a?.NextHopId || String(a?.NextHopId).trim()==='-' || String(a?.NextHopId).trim()==='') ? '系统' : '自定义'; const lb = (!b?.NextHopId || String(b?.NextHopId).trim()==='-' || String(b?.NextHopId).trim()==='') ? '系统' : '自定义'; return String(la).localeCompare(String(lb)); }, render: (_:any, r:any)=> { const isLocal = !r?.NextHopId || String(r?.NextHopId).trim() === '-' || String(r?.NextHopId).trim() === ''; return isLocal ? '系统' : '自定义'; } },
          { title: '操作', key: 'actions', render: (_:any, r:any)=> {
            const v = String(r?.NextHopId || r?.nexthop || '').trim();
            const isLocal = !v || v === '-';
            const items = [ { key: 'edit', label: '编辑', disabled: isLocal }, { key: 'delete', label: '删除', disabled: isLocal, danger: true } ];
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
    </StdSideDrawer>
  );
};

export default RouteEntryManageDrawerAliyun;
