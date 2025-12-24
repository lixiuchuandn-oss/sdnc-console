import React, { useMemo } from 'react';
import { App, Button, Dropdown, Form, Input, Select, Table } from 'antd';
import { EllipsisOutlined, ReloadOutlined } from '@ant-design/icons';
import StdSideDrawer from '../../../../components/StdSideDrawer';
import { fetchCloudProviderRouteEntries, deleteCloudProviderRouteEntry } from '../../../../services/api';
import { normalizeErr } from '../utils/net';

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

const RouteEntryManageDrawer: React.FC<Props> = ({ open, cloudId, ecs, routeTableTarget, entries, onClose, onUpdated, onOpenCreate, onOpenEdit }) => {
  const { message } = App.useApp();
  const [filterForm] = Form.useForm();

  const extractEntries = (json: any): any[] => {
    const d = (json && (json as any).data) ? (json as any).data : json;
    const arr = Array.isArray(d)
      ? d
      : Array.isArray((d || {}).routes)
      ? (d || {}).routes
      : Array.isArray((d || {}).route_entries)
      ? (d || {}).route_entries
      : Array.isArray((json || {}).routes)
      ? (json || {}).routes
      : Array.isArray((json || {}).route_entries)
      ? (json || {}).route_entries
      : [];
    return Array.isArray(arr) ? arr : [];
  };

  const refresh = async () => {
    try {
      const id0 = routeTableTarget?.id || routeTableTarget?.RouteTableId; if (!id0) return;
      const json = await fetchCloudProviderRouteEntries(cloudId, id0);
      const list = extractEntries(json);
      onUpdated(Array.isArray(list) ? list : []);
    } catch (e:any) { message.error(normalizeErr(e, '刷新失败')); }
  };

  const kw = String(filterForm.getFieldValue('keyword') || '').trim().toLowerCase();
  const tp = String(filterForm.getFieldValue('type') || '').trim().toLowerCase();
  const filtered = useMemo(() => {
    const raw = Array.isArray(entries) ? entries : [];
    return raw.filter((it:any)=> {
      const okType = !tp || String(it?.type||'').toLowerCase()===tp;
      if (!okType) return false;
      if (!kw) return true;
      const d = String(it?.destination||'').toLowerCase();
      const n = String(it?.nexthop||'').toLowerCase();
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
        rowKey={(r:any)=> `${r?.destination || ''}_${r?.nexthop || ''}`}
        dataSource={filtered}
        columns={[
          { title: '目的网段', dataIndex: 'destination', key: 'dest', sorter: (a:any,b:any)=> String(a?.destination||'').localeCompare(String(b?.destination||'')) },
          { title: '下一跳类型', key: 'nhType', sorter: (a:any,b:any)=> {
            const ta = (():string=>{ const t = String(a?.type||'').toLowerCase(); const isLocal = !a?.nexthop || String(a?.nexthop).trim()==='-' || String(a?.nexthop).trim()===''; if (isLocal) return 'Local'; return (t==='ecs'&&'服务器实例')||(t==='vip'&&'虚拟IP')||(t==='nat'&&'NAT网关')||(t==='pcn'&&'云连接')||(a?.type||'-'); })();
            const tb = (():string=>{ const t = String(b?.type||'').toLowerCase(); const isLocal = !b?.nexthop || String(b?.nexthop).trim()==='-' || String(b?.nexthop).trim()===''; if (isLocal) return 'Local'; return (t==='ecs'&&'服务器实例')||(t==='vip'&&'虚拟IP')||(t==='nat'&&'NAT网关')||(t==='pcn'&&'云连接')||(b?.type||'-'); })();
            return String(ta).localeCompare(String(tb));
          }, render: (_:any, r:any)=> { const t = String(r?.type || '').toLowerCase(); const isLocal = !r?.nexthop || String(r?.nexthop).trim() === '-' || String(r?.nexthop).trim() === ''; if (isLocal) return 'Local'; return (t === 'ecs' && '服务器实例') || (t === 'eni' && '扩展网卡') || (t === 'vip' && '虚拟IP') || (t === 'nat' && 'NAT网关') || (t === 'pcn' && '云连接') || (r?.type || '-'); } },
          { title: '下一跳', key: 'nh', sorter: (a:any,b:any)=> {
            const va = (():string=>{ const v = String(a?.nexthop||'').trim(); const isLocal = !v || v==='-'; if (isLocal) return 'Local'; const t = String(a?.type||'').toLowerCase(); if (t==='ecs') { const m = (ecs||[]).find((s:any)=> String(s?.id||'')===v); return m?.name || v; } return v; })();
            const vb = (():string=>{ const v = String(b?.nexthop||'').trim(); const isLocal = !v || v==='-'; if (isLocal) return 'Local'; const t = String(b?.type||'').toLowerCase(); if (t==='ecs') { const m = (ecs||[]).find((s:any)=> String(s?.id||'')===v); return m?.name || v; } return v; })();
            return String(va).localeCompare(String(vb));
          }, render: (_:any, r:any)=> { const v = String(r?.nexthop || '').trim(); const isLocal = !v || v === '-'; if (isLocal) return 'Local'; const t = String(r?.type || '').toLowerCase(); if (t === 'ecs') { const m = (ecs||[]).find((s:any)=> String(s?.id||'') === v); return m?.name || v; } return v; } },
          { title: '类型', key: 'cat', sorter: (a:any,b:any)=> { const la = (!a?.nexthop || String(a?.nexthop).trim()==='-' || String(a?.nexthop).trim()==='') ? '系统' : '自定义'; const lb = (!b?.nexthop || String(b?.nexthop).trim()==='-' || String(b?.nexthop).trim()==='') ? '系统' : '自定义'; return String(la).localeCompare(String(lb)); }, render: (_:any, r:any)=> { const isLocal = !r?.nexthop || String(r?.nexthop).trim() === '-' || String(r?.nexthop).trim() === ''; return isLocal ? '系统' : '自定义'; } },
          { title: '描述', key: 'desc', sorter: (a:any,b:any)=> { const da = (!a?.nexthop || String(a?.nexthop).trim()==='-' || String(a?.nexthop).trim()==='') ? '系统默认，表示VPC内实例互通' : (a?.description || '-'); const db = (!b?.nexthop || String(b?.nexthop).trim()==='-' || String(b?.nexthop).trim()==='') ? '系统默认，表示VPC内实例互通' : (b?.description || '-'); return String(da).localeCompare(String(db)); }, render: (_:any, r:any)=> { const isLocal = !r?.nexthop || String(r?.nexthop).trim() === '-' || String(r?.nexthop).trim() === ''; return isLocal ? '系统默认，表示VPC内实例互通' : (r?.description || '-'); } },
          { title: '操作', key: 'actions', render: (_:any, r:any)=> {
            const v = String(r?.nexthop || '').trim();
            const isLocal = !v || v === '-';
            const items = [ { key: 'edit', label: '编辑', disabled: isLocal }, { key: 'delete', label: '删除', disabled: isLocal, danger: true } ];
            return (
              <Dropdown
                menu={{ items, onClick: async ({ key }) => {
                  if (key === 'edit') {
                    onOpenEdit(r);
                  } else if (key === 'delete') {
                    const id0 = routeTableTarget?.id || routeTableTarget?.RouteTableId; if (!id0) return;
                    try {
                      await deleteCloudProviderRouteEntry(cloudId, id0, { destination: r?.destination, nexthop: r?.nexthop });
                      await refresh();
                      const still = (entries||[]).some((it:any)=> String(it?.destination||'')===String(r?.destination||''));
                      if (!still) { message.success('删除成功'); return; }
                      message.error('删除失败：云端未生效');
                    } catch (e:any) {
                      await refresh();
                      message.error(normalizeErr(e, '删除失败'));
                    }
                  }
                }}}
              >
                <Button type="link" icon={<EllipsisOutlined />} />
              </Dropdown>
            );
          } }
        ]}
        pagination={{ pageSize: 8, size: 'default' }}
      />
    </StdSideDrawer>
  );
};

export default RouteEntryManageDrawer;
