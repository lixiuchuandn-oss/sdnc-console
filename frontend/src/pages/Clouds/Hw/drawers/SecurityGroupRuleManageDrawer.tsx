import React, { useMemo, useState } from 'react';
import { App, Button, Dropdown, Input, Space, Table, Tabs } from 'antd';
import { MoreOutlined } from '@ant-design/icons';
import StdSideDrawer from '../../../../components/StdSideDrawer';
import { showCloudProviderSecurityGroup, createHuaweiCloudSecurityGroupRule, deleteHuaweiCloudSecurityGroupRule } from '../../../../services/api';
import { normalizeErr } from '../utils/net';
import SecurityGroupRuleDrawer from './SecurityGroupRuleDrawer';

type Props = {
  open: boolean;
  cloudId: string;
  secGroups: any[];
  target: any | null;
  onClose: () => void;
  onUpdated: (group: any) => void;
};

const SecurityGroupRuleManageDrawer: React.FC<Props> = ({ open, cloudId, secGroups, target, onClose, onUpdated }) => {
  const { message } = App.useApp();
  const [tab, setTab] = useState<string>('ingress');
  const [keyword, setKeyword] = useState<string>('');
  const [selKeys, setSelKeys] = useState<any[]>([]);
  const [formOpen, setFormOpen] = useState<boolean>(false);
  const [editTarget, setEditTarget] = useState<any | null>(null);

  const listRaw = useMemo(() => {
    const raw: any[] = Array.isArray(target?.security_group_rules) ? target.security_group_rules : [];
    return raw.map((x:any)=> ({
      id: x?.id,
      direction: x?.direction,
      protocol: x?.protocol,
      ethertype: x?.ethertype,
      port_min: x?.port_range_min ?? x?.port_min,
      port_max: x?.port_range_max ?? x?.port_max,
      remote_group_id: x?.remote_group_id,
      remote_ip_prefix: x?.remote_ip_prefix ?? x?.remote_ip_cidr,
      description: x?.description,
      created_at: x?.created_at ?? x?.createdAt ?? x?.create_time,
    }));
  }, [target]);

  const listByTab = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const tabKey = String(tab || '').toLowerCase();
    return (listRaw || []).filter((r:any)=> {
      const text = `${r?.direction||''} ${r?.protocol||''} ${r?.ethertype||''} ${r?.port_min||''}-${r?.port_max||''} ${r?.remote_group_id||''} ${r?.remote_ip_prefix||''} ${r?.description||''}`.toLowerCase();
      const okKw = !kw || text.includes(kw);
      const okTab = String(r?.direction||'').toLowerCase() === tabKey;
      return okKw && okTab;
    });
  }, [listRaw, keyword, tab]);

  const stableKey = (r:any)=> r?.id || `${r?.direction}-${r?.protocol}-${r?.remote_ip_prefix}-${r?.remote_group_id}-${r?.port_min}-${r?.port_max}`;

  const renderProtoPort = (r:any) => {
    const p = String(r?.protocol || '').toLowerCase();
    const min = r?.port_min;
    const max = r?.port_max;
    if (!p || p === 'all') return '全部';
    if (p === 'icmp') return 'ICMP: 全部';
    if (min != null && max != null && min === max) return `${p.toUpperCase()}: ${min}`;
    if (min != null || max != null) return `${p.toUpperCase()}: ${(min ?? '')}-${(max ?? '')}`;
    return p.toUpperCase();
  };

  const protoSorter = (a:any, b:any) => {
    const order = (p:string) => {
      const x = String(p || '').toLowerCase();
      if (x === 'all') return 0;
      if (x === 'icmp') return 1;
      if (x === 'tcp') return 2;
      if (x === 'udp') return 3;
      return 9;
    };
    const oa = order(a?.protocol);
    const ob = order(b?.protocol);
    if (oa !== ob) return oa - ob;
    const am = Number(a?.port_min ?? -1);
    const bm = Number(b?.port_min ?? -1);
    if (am !== bm) return am - bm;
    const ax = Number(a?.port_max ?? -1);
    const bx = Number(b?.port_max ?? -1);
    return ax - bx;
  };

  const columns = [
    { title: '状态', key: 'enabled', render: ()=> (<span style={{ color:'#52c41a' }}>● 启用</span>) },
    { title: '策略', key: 'policy', render: ()=> ('允许') },
    { title: '类型', dataIndex: 'ethertype', key: 'ethertype', render: (_:any, r:any)=> (r?.ethertype ? String(r.ethertype).toUpperCase() : 'IPv4'), sorter: (a:any,b:any)=> String(a?.ethertype||'ipv4').localeCompare(String(b?.ethertype||'ipv4')) },
    { title: '协议端口', key: 'protoport', render: (_:any, r:any)=> renderProtoPort(r), sorter: protoSorter },
    { title: '源地址', key: 'remote', render: (_:any, r:any)=> { const rgid = r?.remote_group_id; const g = (secGroups||[]).find((x:any)=> String(x?.id||x?.SecurityGroupId||'')===String(rgid||'')); const nm = g?.name; const txt = nm || r?.remote_ip_prefix || rgid || '-'; return txt; }, sorter: (a:any,b:any)=> { const ta = String(a?.remote_group_id || a?.remote_ip_prefix || '').toLowerCase(); const tb = String(b?.remote_group_id || b?.remote_ip_prefix || '').toLowerCase(); return ta.localeCompare(tb); } },
    { title: '描述', dataIndex: 'description', key: 'desc', sorter: (a:any,b:any)=> String(a?.description||'').localeCompare(String(b?.description||'')) },
    { title: '操作', key: 'op', render: (_:any, r:any)=> {
      const items = [ { key: 'edit', label: '编辑' }, { key: 'delete', label: '删除', danger: true } ];
      return (
        <Dropdown
          menu={{ items, onClick: async ({ key }) => {
            if (key === 'edit') { setEditTarget(r); setFormOpen(true); }
            else if (key === 'delete') {
              try {
                const gid = target?.id || target?.SecurityGroupId; const rid = r?.id; if (!gid || !rid) return;
                await deleteHuaweiCloudSecurityGroupRule(cloudId, String(gid), String(rid));
                const resp:any = await showCloudProviderSecurityGroup(cloudId, String(gid));
                const data0:any = resp?.data || resp; const data:any = data0?.security_group || data0?.securityGroup || data0?.securitygroup || data0;
                onUpdated(data);
                message.success('已删除规则');
              } catch(e:any){ message.error(normalizeErr(e, '删除失败')); }
            }
          } }}
        >
          <Button type="link" icon={<MoreOutlined />} />
        </Dropdown>
      );
    } }
  ];

  const quickAdd = async (preset: 'http'|'https'|'ssh'|'icmp'|'rdp', direction: 'ingress'|'egress') => {
    try {
      const gid = target?.id || target?.SecurityGroupId; if (!gid) return;
      const spec: any = { direction, remote_ip_prefix: '0.0.0.0/0' };
      if (preset === 'icmp') { spec.protocol = 'icmp'; }
      else if (preset === 'ssh') { spec.protocol = 'tcp'; spec.port_range_min = 22; spec.port_range_max = 22; }
      else if (preset === 'http') { spec.protocol = 'tcp'; spec.port_range_min = 80; spec.port_range_max = 80; }
      else if (preset === 'https') { spec.protocol = 'tcp'; spec.port_range_min = 443; spec.port_range_max = 443; }
      else if (preset === 'rdp') { spec.protocol = 'tcp'; spec.port_range_min = 3389; spec.port_range_max = 3389; }
      await createHuaweiCloudSecurityGroupRule(cloudId, String(gid), spec);
      const resp:any = await showCloudProviderSecurityGroup(cloudId, String(gid));
      const data0:any = resp?.data || resp; const data:any = data0?.security_group || data0?.securityGroup || data0?.securitygroup || data0;
      onUpdated(data);
      message.success('已添加规则');
    } catch(e:any){ message.error(normalizeErr(e, '添加失败')); }
  };

  const bulkDelete = async () => {
    try {
      const gid = target?.id || target?.SecurityGroupId; if (!gid) return;
      const selected = new Set<string>(selKeys.map(String));
      const withIds = listByTab.filter(r=> r?.id && selected.has(String(r?.id)));
      for (const r of withIds) { await deleteHuaweiCloudSecurityGroupRule(cloudId, String(gid), String(r.id)); }
      const resp:any = await showCloudProviderSecurityGroup(cloudId, String(gid));
      const data0:any = resp?.data || resp; const data:any = data0?.security_group || data0?.securityGroup || data0?.securitygroup || data0;
      onUpdated(data);
      setSelKeys([]);
      message.success('已删除规则');
    } catch(e:any){ message.error(normalizeErr(e, '批量删除失败')); }
  };

  return (
    <StdSideDrawer
      open={open}
      onClose={onClose}
      width={1000}
      title={`配置规则 · ${target?.name || target?.SecurityGroupName || target?.id || target?.SecurityGroupId || '-'}`}
    >
      <Tabs
        activeKey={tab}
        onChange={(k)=>{ setTab(k); setSelKeys([]); }}
        items={[
          {
            key:'ingress',
            label:'入站',
            children:(
              <>
                <Input allowClear placeholder="关键字（协议/端口/CIDR）" value={keyword} onChange={(e)=> setKeyword(e.target.value)} style={{ width: '100%', marginBottom: 12 }} />
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom: 16 }}>
                  <Space>
                    <span style={{ fontWeight: 500 }}>快速添加</span>
                    <Button onClick={()=> quickAdd('http','ingress')}>HTTP 80</Button>
                    <Button onClick={()=> quickAdd('https','ingress')}>HTTPS 443</Button>
                    <Button onClick={()=> quickAdd('ssh','ingress')}>SSH 22</Button>
                    <Button onClick={()=> quickAdd('icmp','ingress')}>ICMP</Button>
                  </Space>
                  <Space>
                    <Button onClick={()=>{ setFormOpen(true); setEditTarget(null); }}>新增规则</Button>
                    <Button danger disabled={!selKeys.length} onClick={bulkDelete}>批量删除</Button>
                  </Space>
                </div>
                <Table
                  bordered
                  rowKey={stableKey as any}
                  rowSelection={{ selectedRowKeys: selKeys, onChange: (keys)=> setSelKeys(keys as any[]) }}
                  columns={columns as any}
                  dataSource={listByTab}
                  pagination={{ pageSize: 10 }}
                />
              </>
            )
          },
          {
            key:'egress',
            label:'出站',
            children:(
              <>
                <Input allowClear placeholder="关键字（协议/端口/CIDR）" value={keyword} onChange={(e)=> setKeyword(e.target.value)} style={{ width: '100%', marginBottom: 12 }} />
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom: 16 }}>
                  <Space>
                    <span style={{ fontWeight: 500 }}>快速添加</span>
                    <Button onClick={()=> quickAdd('http','egress')}>HTTP 80</Button>
                    <Button onClick={()=> quickAdd('https','egress')}>HTTPS 443</Button>
                    <Button onClick={()=> quickAdd('rdp','egress')}>RDP 3389</Button>
                    <Button onClick={()=> quickAdd('icmp','egress')}>ICMP</Button>
                  </Space>
                  <Space>
                    <Button onClick={()=>{ setFormOpen(true); setEditTarget(null); }}>新增规则</Button>
                    <Button danger disabled={!selKeys.length} onClick={bulkDelete}>批量删除</Button>
                  </Space>
                </div>
                <Table
                  bordered
                  rowKey={stableKey as any}
                  rowSelection={{ selectedRowKeys: selKeys, onChange: (keys)=> setSelKeys(keys as any[]) }}
                  columns={columns as any}
                  dataSource={listByTab}
                  pagination={{ pageSize: 10 }}
                />
              </>
            )
          }
        ]}
      />

      <SecurityGroupRuleDrawer
        open={formOpen}
        cloudId={cloudId}
        secGroups={secGroups}
        target={target}
        tab={tab}
        editTarget={editTarget}
        onClose={()=>{ setFormOpen(false); setEditTarget(null); }}
        onUpdated={(group)=>{ onUpdated(group); }}
      />
    </StdSideDrawer>
  );
};

export default SecurityGroupRuleManageDrawer;