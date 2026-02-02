import React, { useMemo, useState } from 'react';
import { Table, Tag, Input, Select, Button, Modal, Tabs, Descriptions, message, Drawer, Space } from 'antd';
import { SettingOutlined, ReloadOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { fetchHarvesterNodeDetail } from '../../../../services/api';
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
  const [drawerResource, setDrawerResource] = useState<any>(null);
  const [drawerActiveTab, setDrawerActiveTab] = useState('detail');
  const [resourceLoading, setResourceLoading] = useState(false);

  // Unified Drawer Handler
  const handleOpenDrawer = async (record: any, tab: string) => {
    setDrawerRecord(record);
    setDrawerResource(null);
    setDrawerActiveTab(tab);
    setDrawerVisible(true);

    const name = record?.metadata?.name || record?.name;
    if (cloudId && name) {
      setResourceLoading(true);
      try {
        const json = await fetchHarvesterNodeDetail(cloudId, name);
        const data = (json as any)?.data || json;
        setDrawerResource(data);
      } catch (e: any) {
        console.error('Fetch Node Resource Failed:', e);
        message.error(`获取资源数据失败: ${e?.message || '未知错误'}`);
      } finally {
        setResourceLoading(false);
      }
    }
  };

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

  const allColumns = useMemo(() => [
    { title: '名称', key: 'name', render: (_:any, r:any)=> r?.name || r?.metadata?.name || '-' },
    { title: '角色', key: 'roles', render: (_:any, r:any)=> Array.isArray(r?.roles) ? r.roles.join(',') : (r?.metadata?.labels?.['kubernetes.io/role'] || '-') },
    { title: '内网IP', key: 'inip', render: (_:any, r:any)=> r?.internalIP || r?.status?.addresses?.find((a:any)=>a?.type==='InternalIP')?.address || '-' },
    { title: '公网IP', key: 'exip', render: (_:any, r:any)=> r?.externalIP || r?.status?.addresses?.find((a:any)=>a?.type==='ExternalIP')?.address || '-' },
    { title: '就绪', key: 'ready', render: (_:any, r:any)=> (r?.ready ? <Tag color="green">Ready</Tag> : <Tag color="red">NotReady</Tag>) },
    { title: 'CPU', key: 'cpu', render: (_:any, r:any)=> formatCpu(r?.cpu ?? r?.status?.capacity?.cpu) },
    { title: '内存', key: 'mem', render: (_:any, r:any)=> formatMemGb(r?.memory ?? r?.status?.capacity?.memory) },
    { title: '版本', key: 'version', render: (_:any, r:any)=> r?.status?.nodeInfo?.kubeletVersion || r?.version || '-' },
    { title: '操作', key: 'actions', render: (_: any, r: any) => {
        const items: any[] = [
            { key: 'view', label: '数据查看', onClick: () => handleOpenDrawer(r, 'detail') },
        ];
        return (
          <ResourceActionsDropdown 
            items={items} 
          />
        );
      } 
    },
  ], [handleOpenDrawer]);

  const [tableColumns, setTableColumns] = useState<any[]>(allColumns);

  return (
    <PageDetailSection
      asCard={false}
      autoStyleInputs={false}
      toolbarLeft={(
        <>
          <Input allowClear placeholder="关键字" value={keyword} onChange={(e)=>setKeyword(e.target.value)} className="toolbar-search" />
          <Select allowClear placeholder="角色" value={roleFilter || undefined} onChange={(v)=> setRoleFilter(v || '')} className="toolbar-filter" options={[{ value: '', label: '全部' }, ...roleOptions]} />
          <Select allowClear placeholder="就绪" value={readyFilter || undefined} onChange={(v)=> setReadyFilter(v || '')} className="toolbar-filter-sm" options={[{ value: '', label: '全部' }, { value:'ready', label:'就绪' }, { value:'notready', label:'未就绪' }]} />
        </>
      )}
      toolbarRight={(
        <Space>
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
        </Space>
      )}
      refreshLoading={loading}
    >
    <Table
      className="std-table"
      bordered
      rowKey={(r:any)=> r?.name || r?.metadata?.name || Math.random().toString(36).slice(2)}
      scroll={{ x: 'max-content' }}
      columns={tableColumns}
      dataSource={filtered}
      loading={loading}
      pagination={{ size: 'small', showSizeChanger: true, pageSize: 10, pageSizeOptions: [10, 20, 50, 100] }}
    />
    <HarvesterResourceDrawer
      open={drawerVisible}
      onClose={() => setDrawerVisible(false)}
      record={drawerRecord}
      resource={drawerResource}
      loading={resourceLoading}
      activeTab={drawerActiveTab}
      onTabChange={setDrawerActiveTab}
      renderDetail={(res) => (
        <Descriptions bordered column={1} size="small">
          <Descriptions.Item label="名称">{res?.metadata?.name || '-'}</Descriptions.Item>
          <Descriptions.Item label="UID">{res?.metadata?.uid || '-'}</Descriptions.Item>
          <Descriptions.Item label="创建时间">{res?.metadata?.creationTimestamp || '-'}</Descriptions.Item>
          <Descriptions.Item label="内网IP">{res?.status?.addresses?.find((a:any)=>a?.type==='InternalIP')?.address || '-'}</Descriptions.Item>
          <Descriptions.Item label="公网IP">{res?.status?.addresses?.find((a:any)=>a?.type==='ExternalIP')?.address || '-'}</Descriptions.Item>
          <Descriptions.Item label="CPU Capacity">{res?.status?.capacity?.cpu || '-'}</Descriptions.Item>
          <Descriptions.Item label="Memory Capacity">{res?.status?.capacity?.memory || '-'}</Descriptions.Item>
          <Descriptions.Item label="CPU Allocatable">{res?.status?.allocatable?.cpu || '-'}</Descriptions.Item>
          <Descriptions.Item label="Memory Allocatable">{res?.status?.allocatable?.memory || '-'}</Descriptions.Item>
          <Descriptions.Item label="Machine ID">{res?.status?.nodeInfo?.machineID || '-'}</Descriptions.Item>
          <Descriptions.Item label="System UUID">{res?.status?.nodeInfo?.systemUUID || '-'}</Descriptions.Item>
          <Descriptions.Item label="Boot ID">{res?.status?.nodeInfo?.bootID || '-'}</Descriptions.Item>
          <Descriptions.Item label="Kernel Version">{res?.status?.nodeInfo?.kernelVersion || '-'}</Descriptions.Item>
          <Descriptions.Item label="OS Image">{res?.status?.nodeInfo?.osImage || '-'}</Descriptions.Item>
          <Descriptions.Item label="Container Runtime">{res?.status?.nodeInfo?.containerRuntimeVersion || '-'}</Descriptions.Item>
          <Descriptions.Item label="Kubelet Version">{res?.status?.nodeInfo?.kubeletVersion || '-'}</Descriptions.Item>
          <Descriptions.Item label="Kube-Proxy Version">{res?.status?.nodeInfo?.kubeProxyVersion || '-'}</Descriptions.Item>
          <Descriptions.Item label="Operating System">{res?.status?.nodeInfo?.operatingSystem || '-'}</Descriptions.Item>
          <Descriptions.Item label="Architecture">{res?.status?.nodeInfo?.architecture || '-'}</Descriptions.Item>
       </Descriptions>
      )}
    />

    </PageDetailSection>
  );
};

export default NodesSection;
