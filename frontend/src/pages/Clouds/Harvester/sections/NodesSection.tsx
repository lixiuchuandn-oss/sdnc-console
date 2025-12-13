import React, { useMemo, useState } from 'react';
import { Table, Tag, Input, Select } from 'antd';
import SharedToolbar from '../../../../components/SharedToolbar';

type Props = {
  nodes: any[];
  loading: boolean;
};

const NodesSection: React.FC<Props> = ({ nodes, loading }) => {
  const [keyword, setKeyword] = useState<string>('');
  const [roleFilter, setRoleFilter] = useState<string>('');
  const [readyFilter, setReadyFilter] = useState<string>('');

  const getRoles = (r: any): string[] => {
    const base: string[] = Array.isArray(r?.roles) ? r.roles : [];
    const labels: Record<string,string> = r?.metadata?.labels || {};
    const legacy = String(labels?.['kubernetes.io/role'] || '').trim();
    const extra = Object.keys(labels || {})
      .filter(k => k.startsWith('node-role.kubernetes.io/'))
      .map(k => k.split('/').pop() || k);
    const all = [...base, ...(legacy ? [legacy] : []), ...extra]
      .map(s => String(s || '').trim())
      .filter(Boolean);
    return Array.from(new Set(all));
  };
  const isReady = (r: any): boolean => {
    if (typeof r?.ready === 'boolean') return r.ready;
    const conds: any[] = Array.isArray(r?.status?.conditions) ? r.status.conditions : [];
    return conds.some(c => String(c?.type || '') === 'Ready' && String(c?.status || '').toLowerCase() === 'true');
  };
  const roleOptions = useMemo(() => {
    const set = new Set<string>();
    for (const n of (nodes || [])) {
      for (const r of getRoles(n)) set.add(r);
    }
    return Array.from(set).map(x => ({ label: x, value: x }));
  }, [nodes]);
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const role = roleFilter.trim().toLowerCase();
    const rf = readyFilter.trim().toLowerCase();
    return (nodes || []).filter((r:any) => {
      const name = String(r?.name || r?.metadata?.name || '').toLowerCase();
      if (kw && !name.includes(kw)) return false;
      if (role) {
        const roles = getRoles(r).map(s => s.toLowerCase());
        if (!roles.includes(role)) return false;
      }
      if (rf) {
        const ok = isReady(r);
        if (rf === 'ready' && !ok) return false;
        if (rf === 'notready' && ok) return false;
      }
      return true;
    });
  }, [nodes, keyword, roleFilter, readyFilter]);
  const formatCpu = (cpu?: string | number): string => {
    if (cpu === undefined || cpu === null) return '-';
    const s = String(cpu);
    if (/m$/i.test(s)) {
      const v = Number(s.replace(/m$/i, ''));
      if (!isFinite(v)) return '-';
      return `${(v / 1000).toFixed(2)} core`;
    }
    const v = Number(s);
    if (!isFinite(v)) return '-';
    return `${v} core`;
  };
  const formatMemGb = (mem?: string | number): string => {
    if (mem === undefined || mem === null) return '-';
    const s = String(mem);
    const m = s.match(/^(\d+(?:\.\d+)?)([KMG]i?)?$/i);
    if (m) {
      const val = Number(m[1]);
      const unit = (m[2] || '').toLowerCase();
      let bytes = val;
      if (unit === 'ki') bytes = val * 1024;
      else if (unit === 'mi') bytes = val * 1024 * 1024;
      else if (unit === 'gi') bytes = val * 1024 * 1024 * 1024;
      else if (unit === 'k') bytes = val * 1000;
      else if (unit === 'm') bytes = val * 1000 * 1000;
      else if (unit === 'g') bytes = val * 1000 * 1000 * 1000;
      const gb = bytes / (1024 * 1024 * 1024);
      return `${gb.toFixed(2)} GB`;
    }
    const n = Number(s);
    if (isFinite(n)) return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    return '-';
  };
  return (
    <>
      <SharedToolbar
        left={(
          <>
            <Input.Search allowClear placeholder="关键字" onSearch={(v)=>setKeyword(v || '')} onChange={(e)=>setKeyword(e.target.value)} style={{ width: 240 }} />
            <Select allowClear placeholder="角色" value={roleFilter || undefined} onChange={(v)=> setRoleFilter(v || '')} style={{ width: 180 }} options={[{ value: '', label: '全部' }, ...roleOptions]} />
            <Select allowClear placeholder="就绪" value={readyFilter || undefined} onChange={(v)=> setReadyFilter(v || '')} style={{ width: 160 }} options={[{ value: '', label: '全部' }, { value:'ready', label:'就绪' }, { value:'notready', label:'未就绪' }]} />
          </>
        )}
      />
    <Table
      className="kv-section-table"
      bordered
      rowKey={(r:any)=> r?.name || r?.metadata?.name || Math.random().toString(36).slice(2)}
      columns={[
        { title: '名称', key: 'name', render: (_:any, r:any)=> r?.name || r?.metadata?.name || '-' },
        { title: '角色', key: 'roles', render: (_:any, r:any)=> Array.isArray(r?.roles) ? r.roles.join(',') : (r?.metadata?.labels?.['kubernetes.io/role'] || '-') },
        { title: '内网IP', key: 'inip', render: (_:any, r:any)=> r?.internalIP || r?.status?.addresses?.find((a:any)=>a?.type==='InternalIP')?.address || '-' },
        { title: '公网IP', key: 'exip', render: (_:any, r:any)=> r?.externalIP || r?.status?.addresses?.find((a:any)=>a?.type==='ExternalIP')?.address || '-' },
        { title: '就绪', key: 'ready', render: (_:any, r:any)=> (r?.ready ? <Tag color="green">Ready</Tag> : <Tag color="red">NotReady</Tag>) },
        { title: 'CPU', key: 'cpu', render: (_:any, r:any)=> formatCpu(r?.cpu ?? r?.status?.capacity?.cpu) },
        { title: '内存', key: 'mem', render: (_:any, r:any)=> formatMemGb(r?.memory ?? r?.status?.capacity?.memory) },
        { title: '版本', key: 'version', render: (_:any, r:any)=> r?.version || r?.status?.nodeInfo?.kubeletVersion || '-' },
      ] as any}
      dataSource={filtered}
      loading={loading}
      pagination={{ showSizeChanger:true, showQuickJumper:true, pageSize:10, pageSizeOptions:[10,20,50,100] }}
    />
    </>
  );
};

export default NodesSection;
