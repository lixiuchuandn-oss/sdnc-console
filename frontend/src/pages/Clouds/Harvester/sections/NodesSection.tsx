/**
 * Harvester - 节点 (Node) 列表 Section
 * 展示 Kubernetes/Harvester 集群中的 Node 资源，
 * 支持：
 * - 按名称关键字、角色、就绪状态过滤
 * - 解析并展示 CPU/内存总量
 * - 通过 metrics.k8s.io 获取实时 CPU/内存使用率并绘制进度条
 * - 打开 HarvesterResourceDrawer 查看节点详情及事件
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Table, Tag, Input, Select, Button, Modal, Tabs, Descriptions, message, Drawer, Space, Tooltip, Progress } from 'antd';
import { SettingOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import TableColumnSettings from '../../../../components/TableColumnSettings';
import HarvesterResourceDrawer from '../components/HarvesterOpsinfoDrawer';

/**
 * 组件入参说明
 * - nodes: 节点列表，可能为 Harvester 抽象对象或 K8s Node 原始对象
 * - loading: 外层传入的加载状态
 * - onRefresh: 列表刷新回调，支持 force=true
 * - cloudId: 当前云 ID，用于调用 metrics.k8s.io 接口
 */
type Props = {
  nodes: any[];
  loading: boolean;
  onRefresh?: (force?: boolean) => void;
  cloudId?: string;
  isTenant?: boolean;
};

const NodesSection: React.FC<Props> = ({ nodes, loading, onRefresh, cloudId, isTenant }) => {
  // 过滤条件：关键字、角色、就绪状态
  const [keyword, setKeyword] = useState<string>('');
  const [roleFilter, setRoleFilter] = useState<string>('');
  const [readyFilter, setReadyFilter] = useState<string>('');
  // 从 metrics.k8s.io 拉取到的 CPU/内存使用数据，按节点名索引
  const [metricsMap, setMetricsMap] = useState<Record<string, { cpuUsedCores?: number; memUsedBytes?: number }>>({});

  // 详情抽屉状态
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [drawerRecord, setDrawerRecord] = useState<any>(null);
  const [drawerActiveTab, setDrawerActiveTab] = useState('detail');

  /**
   * 统一打开 HarvesterResourceDrawer 的入口
   * - 在列表视图中 Node 通常没有 kind 字段，这里统一补充为 'Node'
   */
  const handleOpenOpsinfo = useCallback(async (record: any, tab: string) => {
    setDrawerRecord({ ...record, kind: 'Node' });
    setDrawerActiveTab(tab);
    setDrawerVisible(true);
  }, []);

  /**
   * 从节点对象中解析所有角色信息
   * - 兼容 labels["kubernetes.io/role"] 以及 node-role.kubernetes.io/* 多种写法
   */
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
  /**
   * 判断节点是否 Ready
   * - 优先使用 r.ready 布尔字段
   * - 否则回退到 status.conditions 中查找 Ready=True 条目
   */
  const isReady = (r: any): boolean => {
    if (typeof r?.ready === 'boolean') return r.ready;
    const conds: any[] = Array.isArray(r?.status?.conditions) ? r.status.conditions : [];
    return conds.some(c => String(c?.type || '') === 'Ready' && String(c?.status || '').toLowerCase() === 'true');
  };
  // 角色过滤下拉选项，从当前节点列表中动态计算
  const roleOptions = useMemo(() => {
    const set = new Set<string>();
    for (const n of (nodes || [])) {
      for (const r of getRoles(n)) set.add(r);
    }
    return Array.from(set).map(x => ({ label: x, value: x }));
  }, [nodes]);
  /**
   * 综合过滤：关键字 / 角色 / 就绪状态
   */
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
  /**
   * 将 CPU 容量（core 或 m）格式化为可读文本
   */
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
  /**
   * 将内存容量（如 16Gi）转换为 GB 文本
   */
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

  /**
   * 解析 CPU 字符串为核数
   * - 支持 m / n / u 等多种单位
   */
  const parseCpuToCores = (s?: string): number => {
    if (!s) return 0;
    const t = String(s).trim();
    if (/m$/i.test(t)) {
      const v = Number(t.replace(/m$/i, ''));
      return isFinite(v) ? v / 1000 : 0;
    } else if (/n$/i.test(t)) {
      const v = Number(t.replace(/n$/i, ''));
      return isFinite(v) ? v / 1e9 : 0;
    } else if (/u$/i.test(t)) {
      const v = Number(t.replace(/u$/i, ''));
      return isFinite(v) ? v / 1e6 : 0;
    }
    const v = Number(t);
    return isFinite(v) ? v : 0;
  };
  /**
   * 解析内存字符串为字节数
   * - 支持 Ki/Mi/Gi/Ti 等二进制单位以及 K/M/G/T 十进制单位
   */
  const parseMemoryToBytes = (s?: string): number => {
    if (!s) return 0;
    const t = String(s).trim();
    const m = t.match(/^(\d+(?:\.\d+)?)([KMGTP]i?)?$/i);
    if (!m) return 0;
    const val = Number(m[1]);
    const unit = (m[2] || '').toLowerCase();
    let bytes = val;
    if (unit === 'ki') bytes = val * 1024;
    else if (unit === 'mi') bytes = val * 1024 * 1024;
    else if (unit === 'gi') bytes = val * 1024 * 1024 * 1024;
    else if (unit === 'ti') bytes = val * 1024 * 1024 * 1024 * 1024;
    else if (unit === 'k') bytes = val * 1000;
    else if (unit === 'm') bytes = val * 1e6;
    else if (unit === 'g') bytes = val * 1e9;
    else if (unit === 't') bytes = val * 1e12;
    return bytes;
  };

  /**
   * 从 metrics.k8s.io 拉取节点实时指标
   * - 仅在 cloudId 存在时请求
   * - 将 cpu/memory 使用量解析后缓存到 metricsMap 中
   */
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        if (!cloudId) return;
        const res = await (await import('../../../../services/harvesterApi')).fetchHarvesterResourceByLink(cloudId, '/apis/metrics.k8s.io/v1beta1/nodes');
        const items: any[] = Array.isArray((res as any)?.items) ? (res as any).items : [];
        const map: Record<string, { cpuUsedCores?: number; memUsedBytes?: number }> = {};
        for (const it of items) {
          const name = it?.metadata?.name || '';
          const cpuUsed = parseCpuToCores(it?.usage?.cpu);
          const memUsed = parseMemoryToBytes(it?.usage?.memory);
          if (name) map[name] = { cpuUsedCores: cpuUsed, memUsedBytes: memUsed };
        }
        if (!cancelled) setMetricsMap(map);
      } catch {
        if (!cancelled) setMetricsMap({});
      }
    };
    load();
    return () => { cancelled = true; };
  }, [cloudId, nodes]);

  /**
   * 表格列定义
   * - CPU/内存容量使用 formatCpu/formatMemGb 做统一展示
   * - CPU/内存使用率列结合 metricsMap 和节点 allocatable/capacity 计算百分比
   * - 名称列可点击打开节点详情抽屉
   */
  const allColumns = useMemo(() => [
    { title: '名称', key: 'name', render: (_:any, r:any)=> {
      const text = r?.name || r?.metadata?.name || '-';
      return <span>{text}</span>;
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
    { title: 'CPU使用率', key: 'cpu_usage', render: (_:any, r:any)=> {
      const name = r?.name || r?.metadata?.name || '';
      const used = metricsMap[name]?.cpuUsedCores ?? 0;
      const total = parseCpuToCores(r?.status?.allocatable?.cpu || r?.status?.capacity?.cpu || r?.cpu);
      const pct = total > 0 ? Math.round((used / total) * 1000) / 10 : undefined;
      return (
        <div style={{ minWidth: 180 }}>
          {typeof pct === 'number' ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Progress percent={Math.max(0, Math.min(100, pct))} size="small" showInfo={false} />
                <span>{Math.max(0, Math.min(100, pct)).toFixed(1)}%</span>
              </div>
              <div style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>已用 {used.toFixed(2)} 核，{pct.toFixed(1)}%</div>
            </>
          ) : <span>-</span>}
        </div>
      );
    } },
    { title: '内存使用率', key: 'mem_usage', render: (_:any, r:any)=> {
      const name = r?.name || r?.metadata?.name || '';
      const used = metricsMap[name]?.memUsedBytes ?? 0;
      const total = parseMemoryToBytes(r?.status?.allocatable?.memory || r?.status?.capacity?.memory || r?.memory);
      const pct = total > 0 ? Math.round((used / total) * 1000) / 10 : undefined;
      const toGiBNum = (bytes: number) => (bytes > 0 ? (bytes / (1024 * 1024 * 1024)) : 0);
      return (
        <div style={{ minWidth: 180 }}>
          {typeof pct === 'number' ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Progress percent={Math.max(0, Math.min(100, pct))} size="small" showInfo={false} />
                <span>{Math.max(0, Math.min(100, pct)).toFixed(1)}%</span>
              </div>
              <div style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>已用 {toGiBNum(used).toFixed(2)} GiB，{pct.toFixed(1)}%</div>
            </>
          ) : <span>-</span>}
        </div>
      );
    } },
    { title: '版本', key: 'version', render: (_:any, r:any)=> r?.kubeletVersion || r?.status?.nodeInfo?.kubeletVersion || r?.version || '-' },
    { title: '架构', key: 'arch', render: (_:any, r:any)=> r?.architecture || r?.status?.nodeInfo?.architecture || '-' },
    { title: '系统镜像', key: 'os', render: (_:any, r:any)=> r?.osImage || r?.status?.nodeInfo?.osImage || '-' },
    { title: '内核版本', key: 'kernel', render: (_:any, r:any)=> r?.kernelVersion || r?.status?.nodeInfo?.kernelVersion || '-' },
    { title: '容器运行时', key: 'runtime', render: (_:any, r:any)=> r?.containerRuntimeVersion || r?.status?.nodeInfo?.containerRuntimeVersion || '-' },
    { title: '操作', key: 'actions', width: 80, fixed: 'right' as const, render: (_: any, r: any) => {
        const items: any[] = [];
        if (!isTenant) {
          items.push({ key: 'opsinfo', label: '运维信息', onClick: () => handleOpenOpsinfo(r, 'detail') });
        }
        return (
          <ResourceActionsDropdown 
            items={items} 
            buttonProps={{ className: 'row-actions-trigger' }}
          />
        );
      } 
    },
  ], [handleOpenOpsinfo, metricsMap]);

  const [tableColumns, setTableColumns] = useState<any[]>(allColumns);

  const [pagination, setPagination] = useState({ current: 1, pageSize: 10 });

  return (
    <PageDetailSection
      asCard={false}
      autoStyleInputs={false}
      toolbarLeft={(
        <>
          <Input allowClear placeholder="关键字" suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />} value={keyword} onChange={(e)=> { setKeyword(e.target.value); setPagination(p=>({...p, current:1})); }} className="toolbar-search" />
          <Select allowClear placeholder="角色" value={roleFilter || undefined} onChange={(v)=> { setRoleFilter(v || ''); setPagination(p=>({...p, current:1})); }} className="toolbar-filter" options={[{ value: '', label: '全部' }, ...roleOptions]} />
          <Select allowClear placeholder="就绪" value={readyFilter || undefined} onChange={(v)=> { setReadyFilter(v || ''); setPagination(p=>({...p, current:1})); }} className="toolbar-filter-sm" options={[{ value: '', label: '全部' }, { value:'ready', label:'就绪' }, { value:'notready', label:'未就绪' }]} />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              setRoleFilter('');
              setReadyFilter('');
              setPagination(p=>({...p, current:1}));
            }}
          >
            重置
          </button>
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
                onRefresh(true);
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
      pagination={{
        size: 'small',
        showQuickJumper: false,
      }}
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
