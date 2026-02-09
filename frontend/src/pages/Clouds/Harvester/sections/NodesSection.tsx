import React, { useMemo, useState } from 'react';
import { Table, Tag, Input, Select, Button, Modal, Tabs, Descriptions, message, Drawer, Space, Tooltip } from 'antd';
import { SettingOutlined, ReloadOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import TableColumnSettings from '../../../../components/TableColumnSettings';
import HarvesterResourceDrawer from '../components/HarvesterResourceDrawer';

type Props = {
  nodes: any[];
  loading: boolean;
  onRefresh?: () => void;
  cloudId?: string;
};

const NodesSection: React.FC<Props> = ({ nodes, loading, onRefresh, cloudId }) => {
  const [keyword, setKeyword] = useState<string>('');
  const [roleFilter, setRoleFilter] = useState<string>('');
  const [readyFilter, setReadyFilter] = useState<string>('');
  
  // Metadata Drawer State
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [drawerRecord, setDrawerRecord] = useState<any>(null);
  const [drawerActiveTab, setDrawerActiveTab] = useState('detail');

  // Unified Drawer Handler
  const handleOpenDrawer = async (record: any, tab: string) => {
    // Inject kind for EventsTab since Node doesn't usually carry it in list view
    setDrawerRecord({ ...record, kind: 'Node' });
    setDrawerActiveTab(tab);
    setDrawerVisible(true);
  };

  const getRoles = (r: any): string[] => {
    const base: string[] = (Array.isArray(r?.roles) ? r.roles : []).map((s: string) => {
      if (s.startsWith('node-role.kubernetes.io/')) return s.split('/').pop() || s;
      return s;
    });
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

  const allColumns = useMemo(() => [
    { title: '名称', key: 'name', render: (_:any, r:any)=> {
      const text = r?.name || r?.metadata?.name || '-';
      return <span className="cell-link" onClick={() => handleOpenDrawer(r, 'detail')}>{text}</span>;
    } },
    { title: '角色', key: 'roles', render: (_:any, r:any)=> {
      const roles = getRoles(r);
      const text = roles.join(', ') || '-';
      return (
        <Tooltip title={text}>
          <span className="stat-trigger">{text}</span>
        </Tooltip>
      );
    }},
    { title: '内网IP', key: 'inip', render: (_:any, r:any)=> r?.internalIP || r?.status?.addresses?.find((a:any)=>a?.type==='InternalIP')?.address || '-' },
    { title: '公网IP', key: 'exip', render: (_:any, r:any)=> r?.externalIP || r?.status?.addresses?.find((a:any)=>a?.type==='ExternalIP')?.address || '-' },
    { 
      title: '就绪', 
      key: 'ready', 
      render: (_:any, r:any)=> {
        const ok = r?.ready;
        return <span className={`std-badge ${ok ? 'std-badge-success' : 'std-badge-error'}`}>{ok ? 'Ready' : 'NotReady'}</span>;
      } 
    },
    { title: 'CPU', key: 'cpu', render: (_:any, r:any)=> formatCpu(r?.cpu ?? r?.status?.capacity?.cpu) },
    { title: '内存', key: 'mem', render: (_:any, r:any)=> formatMemGb(r?.memory ?? r?.status?.capacity?.memory) },
    { title: '版本', key: 'version', render: (_:any, r:any)=> r?.kubeletVersion || r?.status?.nodeInfo?.kubeletVersion || r?.version || '-' },
    { title: '架构', key: 'arch', render: (_:any, r:any)=> r?.architecture || r?.status?.nodeInfo?.architecture || '-' },
    { title: '系统镜像', key: 'os', render: (_:any, r:any)=> r?.osImage || r?.status?.nodeInfo?.osImage || '-' },
    { title: '内核版本', key: 'kernel', render: (_:any, r:any)=> r?.kernelVersion || r?.status?.nodeInfo?.kernelVersion || '-' },
    { title: '容器运行时', key: 'runtime', render: (_:any, r:any)=> r?.containerRuntimeVersion || r?.status?.nodeInfo?.containerRuntimeVersion || '-' },
    { title: '操作', key: 'actions', width: 80, fixed: 'right' as const, render: (_: any, r: any) => {
        const items: any[] = [
            { key: 'detail', label: '资源详情', onClick: () => handleOpenDrawer(r, 'detail') },
        ];
        return (
          <ResourceActionsDropdown 
            items={items} 
            buttonProps={{ className: 'row-actions-trigger' }}
          />
        );
      } 
    },
  ], [handleOpenDrawer]);

  const [tableColumns, setTableColumns] = useState<any[]>(allColumns);

  const [pagination, setPagination] = useState({ current: 1, pageSize: 10 });

  return (
    <PageDetailSection
      asCard={false}
      autoStyleInputs={false}
      toolbarLeft={(
        <>
          <Input allowClear placeholder="关键字" value={keyword} onChange={(e)=> { setKeyword(e.target.value); setPagination(p=>({...p, current:1})); }} className="toolbar-search" />
          <Select allowClear placeholder="角色" value={roleFilter || undefined} onChange={(v)=> { setRoleFilter(v || ''); setPagination(p=>({...p, current:1})); }} className="toolbar-filter" options={[{ value: '', label: '全部' }, ...roleOptions]} />
          <Select allowClear placeholder="就绪" value={readyFilter || undefined} onChange={(v)=> { setReadyFilter(v || ''); setPagination(p=>({...p, current:1})); }} className="toolbar-filter-sm" options={[{ value: '', label: '全部' }, { value:'ready', label:'就绪' }, { value:'notready', label:'未就绪' }]} />
          <a className="toolbar-reset-btn" onClick={() => {
            setKeyword('');
            setRoleFilter('');
            setReadyFilter('');
            setPagination(p=>({...p, current:1}));
          }}>重置</a>
        </>
      )}
      toolbarRight={(
        <div className="toolbar-actions">
          {/* Settings button is handled by columnsConfig if provided, or manual if not */}
          <TableColumnSettings 
            columns={allColumns} 
            onChange={setTableColumns}
            settingsKey="harvester_nodes_table"
          />
          <Button 
            icon={<ReloadOutlined />} 
            onClick={() => {
              if (onRefresh) {
                onRefresh();
              } else {
                message.warning('刷新功能未绑定');
              }
            }}
            loading={loading}
          />
        </div>
      )}
      refreshLoading={loading}
    >
    <Table
      className="std-table"
      bordered
      rowKey={(r:any)=> r?.name || r?.metadata?.name || Math.random().toString(36).slice(2)}
      columns={tableColumns}
      dataSource={filtered}
      loading={loading}
      pagination={{size: 'small'}}
    />
    <HarvesterResourceDrawer
      open={drawerVisible}
      onClose={() => setDrawerVisible(false)}
      resourceType="Node"
      record={drawerRecord}
      activeTab={drawerActiveTab}
      onTabChange={setDrawerActiveTab}
      cloudId={cloudId}
    />

    </PageDetailSection>
  );
};

export default NodesSection;
