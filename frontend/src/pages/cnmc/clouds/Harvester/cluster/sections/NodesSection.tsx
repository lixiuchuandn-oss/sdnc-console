/**
 * Harvester - 节点 (Node) 列表 Section
 * 展示 Kubernetes/Harvester 集群中的 Node 资源，
 * 支持：
 * - 按名称关键字、角色、就绪状态过滤
 * - 解析并展示 CPU/内存总量
 * - 通过 metrics.k8s.io 获取实时 CPU/内存使用率并绘制进度条
 * - 详情抽屉内「运维信息」Tab（ViewLinkTab）查看集群 API 节点 JSON
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Table, Tag, Input, Select, Button, Modal, Tabs, Descriptions, message, Drawer, Space, Tooltip, Progress, Spin } from 'antd';
import { DatabaseTwoTone, ReloadOutlined, SearchOutlined, DatabaseFilled } from '@ant-design/icons';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import PhysicalNodeDetailDrawer from '../drawers/PhysicalNodeDetailDrawer';

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
};

const NodesSection: React.FC<Props> = ({ nodes, loading, onRefresh, cloudId }) => {
  // 过滤条件：关键字、角色、就绪状态
  const [keyword, setKeyword] = useState<string>('');
  const [roleFilter, setRoleFilter] = useState<string>('');
  const [readyFilter, setReadyFilter] = useState<string>('');
  // 从 metrics.k8s.io 拉取到的 CPU/内存使用数据，按节点名索引
  const [metricsMap, setMetricsMap] = useState<Record<string, { cpuUsedCores?: number; memUsedBytes?: number }>>({});
  // 从 Pod 列表计算的 CPU/内存请求数据（已分配资源），按节点名索引
  const [requestsMap, setRequestsMap] = useState<Record<string, { cpuRequestCores?: number; memRequestBytes?: number }>>({});
  // 超配配置（从 overcommit-config 获取）
  const [overcommitConfig, setOvercommitConfig] = useState<{ cpu?: number; memory?: number }>({});
  // 资源数据加载状态
  const [resourceLoading, setResourceLoading] = useState(true);

  // 物理节点详情抽屉
  const [nodeDetailOpen, setNodeDetailOpen] = useState(false);
  const [nodeDetailRecord, setNodeDetailRecord] = useState<any>(null);

  const handleOpenNodeDetail = useCallback((record: any) => {
    setNodeDetailRecord(record);
    setNodeDetailOpen(true);
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
   * 并行获取节点实时指标、Pod 资源请求数据和超配配置
   * - 实时使用数据：从 metrics.k8s.io 获取
   * - 已分配数据：从 Pod 列表计算
   * - 超配配置：从 overcommit-config 获取
   */
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        if (!cloudId) return;
        
        const harvesterApi = await import('../../../../../../services/harvesterApi');
        
        // 并行执行三个 API 请求，overcommit-config 请求失败不影响其他数据
        const [metricsRes, podsRes, overcommitRes] = await Promise.all([
          harvesterApi.fetchHarvesterResourceByLink(cloudId, '/apis/metrics.k8s.io/v1beta1/nodes'),
          harvesterApi.fetchHarvesterResourceByLink(cloudId, '/api/v1/pods?allNamespaces=true'),
          harvesterApi.fetchHarvesterResourceByLink(cloudId, '/v1/harvester/harvesterhci.io.settings').catch(() => null)
        ]);
        
        // 处理实时使用数据
        const metricsItems: any[] = Array.isArray((metricsRes as any)?.items) ? (metricsRes as any).items : [];
        const metricsMap: Record<string, { cpuUsedCores?: number; memUsedBytes?: number }> = {};
        for (const it of metricsItems) {
          const name = it?.metadata?.name || '';
          const cpuUsed = parseCpuToCores(it?.usage?.cpu);
          const memUsed = parseMemoryToBytes(it?.usage?.memory);
          if (name) metricsMap[name] = { cpuUsedCores: cpuUsed, memUsedBytes: memUsed };
        }
        
        // 处理已分配数据
        const podsItems: any[] = Array.isArray((podsRes as any)?.items) ? (podsRes as any).items : [];
        const requestsMap: Record<string, { cpuRequestCores?: number; memRequestBytes?: number }> = {};
        for (const pod of podsItems) {
          const nodeName = pod?.spec?.nodeName || '';
          if (!nodeName) continue;
          
          if (!requestsMap[nodeName]) {
            requestsMap[nodeName] = { cpuRequestCores: 0, memRequestBytes: 0 };
          }
          
          const containers = Array.isArray(pod?.spec?.containers) ? pod.spec.containers : [];
          const initContainers = Array.isArray(pod?.spec?.initContainers) ? pod.spec.initContainers : [];
          const allContainers = [...containers, ...initContainers];
          
          for (const container of allContainers) {
            const requests = container?.resources?.requests || {};
            const limits = container?.resources?.limits || {};
            const cpuReq = requests?.cpu || limits?.cpu;
            const memReq = requests?.memory || limits?.memory;
            
            requestsMap[nodeName].cpuRequestCores = (requestsMap[nodeName].cpuRequestCores || 0) + parseCpuToCores(cpuReq);
            requestsMap[nodeName].memRequestBytes = (requestsMap[nodeName].memRequestBytes || 0) + parseMemoryToBytes(memReq);
          }
        }
        
        // 处理超配配置 - 从设置列表中找到 overcommit-config
        let config: { cpu?: number; memory?: number } = {};
        if (overcommitRes) {
          try {
            // 兼容多种响应格式
            const items = Array.isArray((overcommitRes as any)?.data) ? (overcommitRes as any).data : 
                          Array.isArray((overcommitRes as any)?.items) ? (overcommitRes as any).items : 
                          Array.isArray(overcommitRes) ? overcommitRes : [];
            // 查找 overcommit-config 项
            const overcommitItem = items.find((item: any) => 
              item?.id === 'overcommit-config' || 
              item?.metadata?.name === 'overcommit-config' ||
              item?.name === 'overcommit-config'
            );
            if (overcommitItem) {
              // 兼容多种 value 格式
              const overcommitValue = overcommitItem?.value || 
                                     overcommitItem?.spec?.value || 
                                     overcommitItem?.data?.value || 
                                     '{}';
              const parsed = typeof overcommitValue === 'string' ? JSON.parse(overcommitValue) : overcommitValue;
              // 确保值是有效的数字且大于0
              const cpuValue = parsed?.cpu !== undefined ? Number(parsed.cpu) : undefined;
              const memValue = parsed?.memory !== undefined ? Number(parsed.memory) : undefined;
              config = {
                cpu: cpuValue !== undefined && !isNaN(cpuValue) && cpuValue > 0 ? cpuValue : undefined,
                memory: memValue !== undefined && !isNaN(memValue) && memValue > 0 ? memValue : undefined,
              };
            }
          } catch {
            config = {};
          }
        }
        
        if (!cancelled) {
          setMetricsMap(metricsMap);
          setRequestsMap(requestsMap);
          setOvercommitConfig(config);
          setResourceLoading(false);
        }
      } catch {
        if (!cancelled) {
          setMetricsMap({});
          setRequestsMap({});
          setOvercommitConfig({});
          setResourceLoading(false);
        }
      }
    };
    load();
    return () => { cancelled = true; };
  }, [cloudId]);

  /**
   * 表格列定义
   * - CPU/内存容量使用 formatCpu/formatMemGb 做统一展示
   * - CPU/内存使用率列结合 metricsMap 和节点 allocatable/capacity 计算百分比
   * - 名称列可点击打开节点详情抽屉
   */
  const allColumns = useMemo(() => [
    { title: '名称', key: 'name', fixed: 'left' as const, render: (_:any, r:any)=> {
      const text = r?.name || r?.metadata?.name || '-';
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <DatabaseTwoTone style={{ color: '#1890ff', flexShrink: 0 }} />
          <span className="cell-link" onClick={() => handleOpenNodeDetail(r)}>
            {text}
          </span>
        </span>
      );
    } },
    { title: '角色', key: 'roles', render: (_:any, r:any)=> {
      const roles = getRoles(r);
      const text = roles.join(', ') || '-';
      return (
        <Tooltip title={text}>
          <span className="tags-badge">{text}</span>
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
    { 
      title: (
        <span>
          CPU
          <Tooltip 
            title={
              <div style={{ fontSize: 12, whiteSpace: 'pre-line' }}>
                <b>总量</b>：物理节点的实际CPU核数
                <br />
                <b>超配总量</b>：物理节点的实际CPU核数乘以CPU超配比后得到的逻辑核数
              </div>
            }
            placement="top"
          >
            <span style={{ marginLeft: 4, color: '#999', fontSize: 14, cursor: 'help' }}>?</span>
          </Tooltip>
        </span>
      ), 
      key: 'cpu', 
      render: (_:any, r:any)=> {
      if (resourceLoading) {
        return (
          <div style={{ minWidth: 260, padding: '10px 0' }}>
            <Spin size="small" />
          </div>
        );
      }
      const name = r?.name || r?.metadata?.name || '';
      const used = metricsMap[name]?.cpuUsedCores ?? 0;
      const requested = requestsMap[name]?.cpuRequestCores ?? 0;
      const total = parseCpuToCores(r?.status?.allocatable?.cpu || r?.status?.capacity?.cpu || r?.cpu);
      const usedPct = total > 0 ? Math.round((used / total) * 1000) / 10 : undefined;
      // 使用配置的超配比，默认200%（确保值在合理范围内）- 测试用
      const overcommitRatio = overcommitConfig.cpu !== undefined && overcommitConfig.cpu > 0 
        ? overcommitConfig.cpu 
        : 200;
      const overcommitTotal = total * (overcommitRatio / 100);
      // 已分配率 = 已分配 / 超配总量
      const requestedPct = overcommitTotal > 0 ? Math.round((requested / overcommitTotal) * 1000) / 10 : undefined;
      // 已分配剩余 = 超配总量 - 已分配
      const requestedRemaining = overcommitTotal - requested;
      const usedRemaining = total - used;
      const overcommitRemaining = overcommitTotal - requested;
      return (
        <div style={{ minWidth: 260 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, lineHeight: '18px', marginBottom: 3 }}>
            <Progress 
              percent={typeof requestedPct === 'number' ? Math.max(0, Math.min(100, requestedPct)) : 0} 
              size="small" 
              showInfo={false}
              strokeColor="#52c41a"
            />
            <span style={{ fontSize: 12 }}>{typeof requestedPct === 'number' ? `${requestedPct.toFixed(1)}%` : '-'}</span>
          </div>
          <div style={{ color: 'rgba(0,0,0,0.45)', fontSize: 11, lineHeight: '12px', marginBottom: 4 }}>
            超配总量: {overcommitTotal.toFixed(1)} / 分配: {requested.toFixed(1)} / 未分配: {requestedRemaining.toFixed(1)} core
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, lineHeight: '18px', marginBottom: 3 }}>
            <Progress 
              percent={typeof usedPct === 'number' ? Math.max(0, Math.min(100, usedPct)) : 0} 
              size="small" 
              showInfo={false}
              strokeColor="#1890ff"
            />
            <span style={{ fontSize: 12 }}>{typeof usedPct === 'number' ? `${usedPct.toFixed(1)}%` : '-'}</span>
          </div>
          <div style={{ color: 'rgba(0,0,0,0.45)', fontSize: 11, lineHeight: '12px' }}>
            总量: {total.toFixed(1)} / 使用: {used.toFixed(1)} / 剩余: {usedRemaining.toFixed(1)} core
          </div>
        </div>
      );
    } },
    { 
      title: (
        <span>
          内存
          <Tooltip 
            title={
              <div style={{ fontSize: 12, whiteSpace: 'pre-line' }}>
                <b>总量</b>：物理节点的实际内存总容量
                <br />
                <b>超配总量</b>：物理节点的实际内存总容量乘以内存超配比后得到的逻辑内存数
              </div>
            }
            placement="top"
          >
            <span style={{ marginLeft: 4, color: '#999', fontSize: 14, cursor: 'help' }}>?</span>
          </Tooltip>
        </span>
      ), 
      key: 'mem', 
      render: (_:any, r:any)=> {
      if (resourceLoading) {
        return (
          <div style={{ minWidth: 260, padding: '10px 0' }}>
            <Spin size="small" />
          </div>
        );
      }
      const name = r?.name || r?.metadata?.name || '';
      const used = metricsMap[name]?.memUsedBytes ?? 0;
      const requested = requestsMap[name]?.memRequestBytes ?? 0;
      const total = parseMemoryToBytes(r?.status?.allocatable?.memory || r?.status?.capacity?.memory || r?.memory);
      const usedPct = total > 0 ? Math.round((used / total) * 1000) / 10 : undefined;
      const toGiBNum = (bytes: number) => (bytes > 0 ? (bytes / (1024 * 1024 * 1024)) : 0);
      const requestedGiB = toGiBNum(requested);
      const usedGiB = toGiBNum(used);
      const totalGiB = toGiBNum(total);
      // 使用配置的超配比，默认200%（确保值在合理范围内）- 测试用
      const overcommitRatio = overcommitConfig.memory !== undefined && overcommitConfig.memory > 0 
        ? overcommitConfig.memory 
        : 200;
      const overcommitTotalGiB = totalGiB * (overcommitRatio / 100);
      // 已分配率 = 已分配 / 超配总量
      const requestedPct = overcommitTotalGiB > 0 ? Math.round((requestedGiB / overcommitTotalGiB) * 1000) / 10 : undefined;
      // 已分配剩余 = 超配总量 - 已分配
      const requestedRemaining = overcommitTotalGiB - requestedGiB;
      const usedRemaining = totalGiB - usedGiB;
      const overcommitRemaining = overcommitTotalGiB - requestedGiB;
      return (
        <div style={{ minWidth: 260 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, lineHeight: '18px', marginBottom: 3 }}>
            <Progress 
              percent={typeof requestedPct === 'number' ? Math.max(0, Math.min(100, requestedPct)) : 0} 
              size="small" 
              showInfo={false}
              strokeColor="#52c41a"
            />
            <span style={{ fontSize: 12 }}>{typeof requestedPct === 'number' ? `${requestedPct.toFixed(1)}%` : '-'}</span>
          </div>
          <div style={{ color: 'rgba(0,0,0,0.45)', fontSize: 11, lineHeight: '12px', marginBottom: 4 }}>
            超配总量: {overcommitTotalGiB.toFixed(1)} / 分配: {requestedGiB.toFixed(1)} / 未分配: {requestedRemaining.toFixed(1)} GiB
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, lineHeight: '18px', marginBottom: 3 }}>
            <Progress 
              percent={typeof usedPct === 'number' ? Math.max(0, Math.min(100, usedPct)) : 0} 
              size="small" 
              showInfo={false}
              strokeColor="#1890ff"
            />
            <span style={{ fontSize: 12 }}>{typeof usedPct === 'number' ? `${usedPct.toFixed(1)}%` : '-'}</span>
          </div>
          <div style={{ color: 'rgba(0,0,0,0.45)', fontSize: 11, lineHeight: '12px' }}>
            总量: {totalGiB.toFixed(1)} / 使用: {usedGiB.toFixed(1)} / 剩余: {usedRemaining.toFixed(1)} GiB
          </div>
        </div>
      );
    } },
    { title: '版本', key: 'version', render: (_:any, r:any)=> r?.kubeletVersion || r?.status?.nodeInfo?.kubeletVersion || r?.version || '-' },
    { title: '架构', key: 'arch', render: (_:any, r:any)=> r?.architecture || r?.status?.nodeInfo?.architecture || '-' },
    { title: '系统镜像', key: 'os', render: (_:any, r:any)=> r?.osImage || r?.status?.nodeInfo?.osImage || '-' },
    { title: '内核版本', key: 'kernel', render: (_:any, r:any)=> r?.kernelVersion || r?.status?.nodeInfo?.kernelVersion || '-' },
    { title: '容器运行时', key: 'runtime', render: (_:any, r:any)=> r?.containerRuntimeVersion || r?.status?.nodeInfo?.containerRuntimeVersion || '-' },
    { title: '操作', key: 'actions', fixed: 'right' as const, render: (_: any, r: any) => {
        const items: any[] = [
          { key: 'detail', label: '详情', onClick: () => handleOpenNodeDetail(r) },
        ];
        return (
          <ResourceActionsDropdown 
            items={items} 
            buttonProps={{ className: 'row-actions-trigger' }}
          />
        );
      } 
    },
  ], [handleOpenNodeDetail, metricsMap]);

  // 使用新的 hook 管理列设置
  const { displayColumns: tableColumns } = useTableColumnSettings(allColumns, 'harvester_nodes_table');

  const [pagination, setPagination] = useState({ current: 1, pageSize: 10 });

  return (
    <PageDetailSection
      asCard={false}
      autoStyleInputs={false}
      toolbarLeft={(
        <>
          <Input allowClear placeholder="名称/IP" suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />} value={keyword} onChange={(e)=> { setKeyword(e.target.value); setPagination(p=>({...p, current:1})); }} className="toolbar-search" />
          <Select allowClear placeholder="节点角色" value={roleFilter || undefined} onChange={(v)=> { setRoleFilter(v || ''); setPagination(p=>({...p, current:1})); }} className="toolbar-filter-sm" options={roleOptions} />
          <Select allowClear placeholder="就绪状态" value={readyFilter || undefined} onChange={(v)=> { setReadyFilter(v || ''); setPagination(p=>({...p, current:1})); }} className="toolbar-filter-sm" options={[{ value:'ready', label:'就绪' }, { value:'notready', label:'未就绪' }]} />
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
          <TableColumnSettingsButton
            allColumns={allColumns}
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
      scroll={{ x: true }}
      bordered={false}
      rowKey={(r:any)=> r?.name || r?.metadata?.name || Math.random().toString(36).slice(2)}
      columns={tableColumns}
      dataSource={filtered}
      loading={loading}
      pagination={{
        showTotal: (total) => `共 ${total} 条`,
      }}
    />
    <PhysicalNodeDetailDrawer
      open={nodeDetailOpen}
      onClose={() => setNodeDetailOpen(false)}
      record={nodeDetailRecord}
      cloudId={cloudId}
      metrics={metricsMap[String(nodeDetailRecord?.name || nodeDetailRecord?.metadata?.name || '')]}
      onRefreshFromCluster={onRefresh}
      refreshLoading={loading}
    />

    </PageDetailSection>
  );
};

export default NodesSection;
