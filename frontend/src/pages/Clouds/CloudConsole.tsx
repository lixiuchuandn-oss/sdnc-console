import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Divider, Form, Input, Select, Space, Table, Dropdown, Modal, Alert, InputNumber, Tree, Row, Col, Tabs, Typography, Tooltip, Radio, Badge, App } from 'antd';
import { DesktopOutlined, ReloadOutlined, EllipsisOutlined, GlobalOutlined, PlusOutlined, CloudUploadOutlined, CloudServerOutlined, ClusterOutlined, HddOutlined, DatabaseOutlined } from '@ant-design/icons';
import PageContainer from '../../components/PageContainer';
import { useNavigate, useLocation } from 'react-router-dom';
import { API_BASE_URL, fetchClouds, fetchCloudProviderEcs, startCloudProviderEcs, stopCloudProviderEcs, rebootCloudProviderEcs, deleteCloudProviderEcs, fetchCloudProviderVpcs, fetchCloudProviderEips, fetchCloudProviderDisks, fetchCloudProviderEnis, fetchAllInstances, fetchInventoryInstancesByCloud, refreshInventoryInstances, refreshInventoryInstancesSlow, fetchAliyunEcsVncUrl } from '../../services/api';
import '../common/filters.css';
import './CloudConsole.css';

type CloudItem = { id: string; name: string; region?: string; type?: string; config?: any; status?: string };
const SUPPORTED_PROVIDERS = ['aliyun','huaweicloud','harvester','cloudmap'];

const statusMark = (raw: any) => {
  const v = String(raw || '').toLowerCase();
  if (['running', 'healthy', 'ok'].includes(v)) return <Badge status="processing" text="运行中" />;
  if (['warning', 'degraded'].includes(v)) return <Badge status="warning" text="告警" />;
  if (['error', 'failed', 'unhealthy'].includes(v)) return <Badge status="error" text="异常" />;
  if (['stopped', 'offline'].includes(v)) return <Badge status="default" text="已停止" />;
  return <Badge status="default" text="未知" />;
};

const CloudConsolePage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { message } = App.useApp();
  const basePrefix = location.pathname.startsWith('/admin') ? '/admin' : '';
  const [clouds, setClouds] = useState<CloudItem[]>([]);
  const [currentCloudId, setCurrentCloudId] = useState<string | undefined>('all');
  const [ecs, setEcs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterForm] = Form.useForm();
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [statusMulti, setStatusMulti] = useState<string[]>([]);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10, total: 0 });
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [activeTab, setActiveTab] = useState<'ecs'|'vpcs'|'eips'|'disks'|'enis'>('ecs');
  const [vpcs, setVpcs] = useState<any[]>([]);
  const [eips, setEips] = useState<any[]>([]);
  const [disks, setDisks] = useState<any[]>([]);
  const [enis, setEnis] = useState<any[]>([]);
  const [advOpen, setAdvOpen] = useState<boolean>(false);
  const [providerFilter, setProviderFilter] = useState<string>('all');
  const [groupBy, setGroupBy] = useState<'none'|'namespace'|'node'>('none');
  const [nsFilter, setNsFilter] = useState<string>('all');
  const [nodeFilter, setNodeFilter] = useState<string>('all');
  const [caps, setCaps] = useState<any>({});
  const [invRefreshTarget, setInvRefreshTarget] = useState<string | undefined>('all');

  const [remoteOpen, setRemoteOpen] = useState(false);
  const [remoteType, setRemoteType] = useState<'ssh' | 'rdp'>('ssh');
  const [remoteTarget, setRemoteTarget] = useState<any | null>(null);
  const [remoteForm] = Form.useForm();
  const [invRefreshOpen, setInvRefreshOpen] = useState<boolean>(false);
  const [refreshMode, setRefreshMode] = useState<'single'|'global'>('single');
  const [cloudFilterIds, setCloudFilterIds] = useState<string[]>([]);
  const [useAggColumns, setUseAggColumns] = useState<boolean>(false);
  
  const ecsEventSourceRef = useRef<EventSource | null>(null);

  const loadClouds = async () => {
    try {
      const list: any[] = await fetchClouds();
      const arr = Array.isArray(list) ? list : [];
      const filtered = arr.filter(c => SUPPORTED_PROVIDERS.includes(String(c?.config?.provider || '').toLowerCase()));
      setClouds(filtered);
      if (!currentCloudId && filtered.length > 0) {
        setCurrentCloudId('all');
        filterForm.setFieldsValue({ cloudId: 'all' });
      }
      if (filtered.length === 0) {
        setError('当前仅支持阿里云/华为云/腾讯云/Harvester/Cloudmap，请先在“资源池管理”中创建并配置对应云账号');
      }
    } catch (e) {
      // ignore
    }
  };

  const loadEcs = async (cloudId?: string) => {
    const cid = cloudId || currentCloudId;
    if (!cid) return;
    setLoading(true);
    setError(null);
    try {
      if (cid === 'all') {
        const json: any = await fetchAllInstances();
        const list: any[] = Array.isArray(json?.data) ? json.data : [];
        setCaps({});
        setEcs(list);
        setPagination(prev => ({ ...prev, total: list.length }));
        setUseAggColumns(true);
        return;
      }
      const provider = ((clouds.find(c => c.id === cid)?.config?.provider) || '').toLowerCase();
      if (SUPPORTED_PROVIDERS.includes(provider)) {
        let json: any;
        if (provider.includes('huaweicloud')) {
          json = await refreshInventoryInstances(cid);
        } else {
          json = await fetchInventoryInstancesByCloud(cid);
          if (!Array.isArray(json?.data) || json.data.length === 0) {
            json = await refreshInventoryInstances(cid);
          }
        }
        const list: any[] = Array.isArray(json?.data) ? json.data : [];
        const defaultCaps2 = (provider === 'harvester' || provider === 'cloudmap') ? {
          isHarvester: true,
          supportsInstanceType: false,
          supportsZone: false,
          supportsVpc: true,
          supportsNetworkFusion: true,
          supportsMultus: true
        } : {
          isHarvester: false,
          supportsInstanceType: true,
          supportsZone: true,
          supportsVpc: true,
          supportsNetworkFusion: false,
          supportsMultus: false
        };
        setCaps(json?.capabilities || defaultCaps2);
        setEcs(list);
        setPagination(prev => ({ ...prev, total: list.length }));
        setUseAggColumns(true);
        return;
      }
      const json: any = await fetchCloudProviderEcs(cid);
      if (!SUPPORTED_PROVIDERS.includes(provider)) {
        setError('当前仅支持阿里云/华为云/腾讯云/Harvester 资源查询');
        setEcs([]);
        setPagination(prev => ({ ...prev, total: 0 }));
        return;
      }
      let rawList: any[] = [];
      if (provider === 'tencentcloud') {
        rawList = json?.data?.InstanceSet || [];
      } else if (provider === 'huaweicloud') {
        rawList = json?.data?.servers || [];
      } else {
        rawList = json?.data?.Instances?.Instance || [];
      }
      const list: any[] = Array.isArray(rawList) ? rawList : [];
      const defaultCaps = (provider === 'harvester' || provider === 'cloudmap') ? {
        isHarvester: true,
        supportsInstanceType: false,
        supportsZone: false,
        supportsVpc: true,
        supportsNetworkFusion: true,
        supportsMultus: true
      } : {
        isHarvester: false,
        supportsInstanceType: true,
        supportsZone: true,
        supportsVpc: true,
        supportsNetworkFusion: false,
        supportsMultus: false
      };
      setCaps((json?.capabilities || defaultCaps));
      setEcs(list);
      setPagination(prev => ({ ...prev, total: list.length }));
    } catch (e: any) {
      setError(e?.message || '查询失败');
      setEcs([]);
      setPagination(prev => ({ ...prev, total: 0 }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClouds();
  }, []);

  const currentCloud = useMemo(() => clouds.find(c => c.id === currentCloudId), [clouds, currentCloudId]);
  const provider = useMemo(() => String(currentCloud?.config?.provider || '').toLowerCase(), [currentCloud]);

  useEffect(() => {
    if (currentCloudId) loadEcs(currentCloudId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCloudId]);

  useEffect(() => {
    try { if (ecsEventSourceRef.current) { ecsEventSourceRef.current.close(); ecsEventSourceRef.current = null; } } catch {}
    const cid = currentCloudId;
    const pv = provider;
    if (!cid || cid === 'all') return;
    if (!(pv.includes('harvester') || pv.includes('cloudmap') || pv.includes('aliyun') || pv.includes('huaweicloud'))) return;
    try {
      const url = `${API_BASE_URL}/api/clouds/${encodeURIComponent(cid)}/resources/ecs/stream${(() => { const t = localStorage.getItem('token'); return t ? `?token=${encodeURIComponent(t)}` : ''; })()}`;
      const es = new EventSource(url);
      ecsEventSourceRef.current = es;
      es.addEventListener('vms', (ev: MessageEvent) => {
        try {
          const json = JSON.parse(String(ev.data || '{}'));
          const list: any[] = Array.isArray(json?.items) ? json.items : [];
          setEcs(list);
          setPagination(prev => ({ ...prev, total: list.length }));
        } catch {}
      });
      es.addEventListener('vm_created', (ev: MessageEvent) => {
        try {
          const r = JSON.parse(String(ev.data || '{}'));
          const iid = String(r?.InstanceId || r?.id || '');
          if (!iid) return;
          setEcs(prev => {
            const exists = (prev || []).some((x: any) => String(x?.InstanceId || x?.id || '') === iid);
            if (exists) return prev;
            return [r, ...(prev || [])];
          });
          setPagination(prev => ({ ...prev, total: (prev.total || 0) + 1 }));
        } catch {}
      });
      es.addEventListener('vm_deleted', (ev: MessageEvent) => {
        try {
          const json = JSON.parse(String(ev.data || '{}'));
          const iid = String(json?.iid || '');
          if (!iid) return;
          setEcs(prev => (prev || []).filter((x: any) => String(x?.InstanceId || x?.id || '') !== iid));
          setPagination(prev => ({ ...prev, total: Math.max(0, (prev.total || 0) - 1) }));
        } catch {}
      });
      es.addEventListener('vm_status', (ev: MessageEvent) => {
        try {
          const json = JSON.parse(String(ev.data || '{}'));
          const iid = String(json?.iid || '');
          const status = String(json?.status || '');
          if (!iid) return;
          setEcs(prev => (prev || []).map((x: any) => {
            const xiid = String(x?.InstanceId || x?.id || '');
            if (xiid === iid) return { ...x, Status: status, status };
            return x;
          }));
        } catch {}
      });
      es.onerror = () => { try { es.close(); } catch {}; ecsEventSourceRef.current = null; };
    } catch {}
    return () => { try { ecsEventSourceRef.current?.close(); ecsEventSourceRef.current = null; } catch {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCloudId, provider]);

  const treeData = useMemo(() => {
    const groups: Record<string, any[]> = {};
    const filteredClouds = clouds.filter(c => providerFilter === 'all' ? true : String(c?.config?.provider || '').toLowerCase() === providerFilter);
    const regionLabel = (c: CloudItem): string => {
      const r = String(c?.region || '').toLowerCase();
      let base = r.includes('shanghai') ? '上海' : r.includes('beijing') ? '北京' : r.includes('shenzhen') ? '深圳' : (c.region || '未知区域');
      const t = String(c?.type || '').toLowerCase();
      if (t.includes('office')) base = `${base}-office`;
      else if (t.includes('idc')) base = `${base}-IDC`;
      return base;
    };
    const providerText = (c: CloudItem): string => {
      const p = String(c?.config?.provider || '').toLowerCase();
      return (p === 'aliyun' && '阿里云') || (p === 'huaweicloud' && '华为云') || (p === 'tencentcloud' && '腾讯云') || (p === 'harvester' && 'Harvester') || (p === 'cloudmap' && 'Cloudmap') || (p === 'cloudmap-security' && 'Cloudmap') || (c?.config?.provider || '未知厂商');
    };
    const typeIcon = (type?: string): React.ReactNode => {
      const t = String(type || '').toLowerCase();
      switch (t) {
        case 'central':
          return <CloudUploadOutlined />;
        case 'private':
          return <CloudServerOutlined />;
        case 'edge':
          return <CloudServerOutlined />;
        case 'virtualization':
          return <HddOutlined />;
        case 'object_storage':
          return <DatabaseOutlined />;
        case 'security_pool':
          return <CloudServerOutlined />;
        case 'sase_gateway':
          return <ClusterOutlined />;
        case 'hybrid':
          return <CloudUploadOutlined />;
        default:
          return <CloudUploadOutlined />;
      }
    };
    filteredClouds.forEach(c => {
      const label = `${providerText(c)} ${regionLabel(c)}`;
      if (!groups[label]) groups[label] = [];
      groups[label].push({ key: `cloud:${c.id}`, title: (<span className="cloud-title"><span style={{ fontSize: 16, color:'#1677ff', marginRight: 6, display:'inline-flex', alignItems:'center' }}>{typeIcon(c.type)}</span>{c.name}</span>) });
    });
    const nodes = Object.keys(groups).map(l => ({ key: `region:${l}`, title: (<span className="region-title"><GlobalOutlined style={{ color:'#1677ff', marginRight: 6 }} />{l}</span>), children: groups[l] }));
    return [{ key: 'cloud:all', title: (<span className="cloud-title"><GlobalOutlined style={{ color:'#1677ff', marginRight: 6 }} />全部区域</span>) }, ...nodes];
  }, [clouds, providerFilter]);

  useEffect(() => {
    const keys = treeData.map(n => n.key as string);
    setExpandedKeys(keys);
  }, [treeData]);

  const cloudMap = useMemo(() => {
    const m: Record<string, CloudItem> = {};
    (clouds || []).forEach(c => { m[c.id] = c; });
    return m;
  }, [clouds]);
  const providerLabel = (p: string): string => (
    (p === 'aliyun' && '阿里云') ||
    (p === 'huaweicloud' && '华为云') ||
    (p === 'harvester' && 'Harvester') ||
    (p === 'cloudmap' && 'Cloudmap') ||
    (p === 'cloudmap-security' && 'CSM') ||
    p || '-'
  );
  const providerName = useMemo(() => {
    const p = String(currentCloud?.config?.provider || '').toLowerCase();
    if (currentCloudId === 'all') return '全部区域';
    return (p === 'aliyun' && '阿里云') || (p === 'huaweicloud' && '华为云') || (p === 'tencentcloud' && '腾讯云') || (p === 'harvester' && 'Harvester') || (p === 'cloudmap' && 'Cloudmap') || (p === 'cloudmap-security' && 'CSM') || p || '-';
  }, [currentCloud]);

  const statusStats = useMemo(() => {
    const arr = Array.isArray(clouds) ? clouds : [];
    const norm = (s: any) => String(s || '').toLowerCase();
    const online = arr.filter(c => ['online','running','ok','healthy'].includes(norm(c.status))).length;
    const maintenance = arr.filter(c => ['maintenance','warning','degraded'].includes(norm(c.status))).length;
    const offline = arr.filter(c => ['offline','stopped','error','failed','unhealthy'].includes(norm(c.status))).length;
    const unknown = Math.max(0, arr.length - online - maintenance - offline);
    return { online, maintenance, offline, unknown };
  }, [clouds]);

  const harvesterNsOptions = useMemo(() => {
    if (!caps?.isHarvester) return [] as string[];
    const set = new Set<string>();
    (ecs || []).forEach((r:any) => {
      const s = String(r?.InstanceId || '');
      const ns = s.includes('/') ? s.split('/')[0] : '';
      if (ns) set.add(ns);
    });
    return Array.from(set).sort();
  }, [ecs, caps]);

  const harvesterNodeOptions = useMemo(() => {
    if (!caps?.isHarvester) return [] as string[];
    const set = new Set<string>();
    (ecs || []).forEach((r:any) => {
      const node = r?.Extra?.NodeName || '';
      if (node) set.add(node);
    });
    return Array.from(set).sort();
  }, [ecs, caps]);

  const loadVpcs = async () => {
    if (!currentCloudId) return;
    try {
      const json: any = await fetchCloudProviderVpcs(currentCloudId);
      const list: any[] = json?.data?.Vpcs?.Vpc || json?.data?.vpcs || [];
      setVpcs(Array.isArray(list) ? list : []);
    } catch(e:any){ setVpcs([]); }
  };

  const loadEips = async () => {
    if (!currentCloudId) return;
    try {
      const json: any = await fetchCloudProviderEips(currentCloudId);
      const list: any[] = json?.data?.Eips?.Eip || json?.data?.eips || [];
      setEips(Array.isArray(list) ? list : []);
    } catch(e:any){ setEips([]); }
  };

  const loadDisks = async () => {
    if (!currentCloudId) return;
    try {
      const json: any = await fetchCloudProviderDisks(currentCloudId);
      const list: any[] = json?.data?.Disks?.Disk || json?.data?.disks || [];
      setDisks(Array.isArray(list) ? list : []);
    } catch(e:any){ setDisks([]); }
  };

  const loadEnis = async () => {
    if (!currentCloudId) return;
    try {
      const json: any = await fetchCloudProviderEnis(currentCloudId);
      const list: any[] = json?.data?.NetworkInterfaces?.NetworkInterface || json?.data?.enis || [];
      setEnis(Array.isArray(list) ? list : []);
    } catch(e:any){ setEnis([]); }
  };

  useEffect(() => {
    if (!currentCloudId) return;
    if (activeTab === 'ecs') loadEcs(currentCloudId);
    if (activeTab === 'vpcs') loadVpcs();
    if (activeTab === 'eips') loadEips();
    if (activeTab === 'disks') loadDisks();
    if (activeTab === 'enis') loadEnis();
  }, [activeTab, currentCloudId]);

  const vpcColumns: any[] = [
    { title: '名称', dataIndex: 'VpcName', key: 'name' },
    { title: 'ID', dataIndex: 'VpcId', key: 'id' },
    { title: 'CIDR', dataIndex: 'CidrBlock', key: 'cidr' },
    { title: '状态', dataIndex: 'Status', key: 'status' },
  ];
  const eipColumns: any[] = [
    { title: '地址', dataIndex: 'IpAddress', key: 'ip' },
    { title: 'ID', dataIndex: 'AllocationId', key: 'id' },
    { title: '带宽(Mbps)', dataIndex: 'Bandwidth', key: 'bw' },
    { title: '状态', dataIndex: 'Status', key: 'status' },
  ];
  const diskColumns: any[] = [
    { title: '名称', dataIndex: 'DiskName', key: 'name' },
    { title: 'ID', dataIndex: 'DiskId', key: 'id' },
    { title: '容量(GB)', dataIndex: 'Size', key: 'size' },
    { title: '类型', dataIndex: 'Category', key: 'category' },
  ];
  const eniColumns: any[] = [
    { title: '名称', dataIndex: 'NetworkInterfaceName', key: 'name' },
    { title: 'ID', dataIndex: 'NetworkInterfaceId', key: 'id' },
    { title: '私网IP', dataIndex: ['PrivateIpSets','PrivateIpSet'], key: 'ips', render:(s:any)=>Array.isArray(s)? (s.map((x:any)=>x?.PrivateIpAddress).filter(Boolean).join(', ')||'-'):'-' },
    { title: '安全组', dataIndex: 'SecurityGroupId', key: 'sg' },
  ];
  const filteredEcs = useMemo(() => {
    const src = ecs || [];
    return src.filter((r: any) => {
      const name = r.InstanceName || r.name || '';
      const ns = (provider === 'harvester' || provider === 'cloudmap') ? (String(r?.InstanceId || '').split('/')[0] || '') : '';
      const nodeName = (provider === 'harvester' || provider === 'cloudmap') ? (r?.Extra?.NodeName || '') : '';
      const s = (r.Status || r.status || '').toLowerCase();
      if (currentCloudId === 'all' && cloudFilterIds.length > 0) {
        if (!cloudFilterIds.includes(String(r.cloudId || ''))) return false;
      }
      if (keyword) {
        const kw = keyword.toLowerCase();
        const hit = [String(name).toLowerCase(), String(ns).toLowerCase(), String(nodeName).toLowerCase()].some(v => v.includes(kw));
        if (!hit) return false;
      }
      if (provider === 'harvester' || provider === 'cloudmap') {
        if (nsFilter !== 'all' && ns !== nsFilter) return false;
        if (nodeFilter !== 'all' && nodeName !== nodeFilter) return false;
      }
      if (statusFilter && s !== statusFilter.toLowerCase()) return false;
      if (statusMulti.length > 0 && !statusMulti.includes(s)) return false;
      return true;
    });
  }, [ecs, keyword, statusFilter, statusMulti, provider, nsFilter, nodeFilter, cloudFilterIds]);

  const pagedEcs = useMemo(() => {
    const start = (pagination.current - 1) * pagination.pageSize;
    const end = start + pagination.pageSize;
    return filteredEcs.slice(start, end);
  }, [filteredEcs, pagination]);

  const groupedEcs = useMemo(() => {
    if (groupBy === 'none') return {} as Record<string, any[]>;
    const map: Record<string, any[]> = {};
    (filteredEcs || []).forEach((r: any) => {
      let key = '';
      if (caps?.isHarvester) {
        if (groupBy === 'namespace') {
          const s = String(r?.InstanceId || '');
          key = s.includes('/') ? s.split('/')[0] : '';
        } else if (groupBy === 'node') {
          key = r?.Extra?.NodeName || '';
        }
      }
      const k = key || '未知';
      if (!map[k]) map[k] = [];
      map[k].push(r);
    });
    return map;
  }, [filteredEcs, caps, groupBy]);

  const handleTableChange = (p: any) => {
    setPagination(prev => ({ ...prev, current: p.current, pageSize: p.pageSize }));
  };

  const openRemoteConnect = (record: any) => {
    setRemoteTarget(record);
    const pubArr = record?.PublicIpAddress?.IpAddress;
    const pub = Array.isArray(pubArr) && pubArr.length > 0 ? pubArr[0] : (record?.EipAddress?.IpAddress || record?.publicIpAddress || (Array.isArray(record?.PublicIpAddress?.IpAddress) ? record?.PublicIpAddress?.IpAddress[0] : null));
    const priArr = record?.VpcAttributes?.PrivateIpAddress?.IpAddress;
    const pri = Array.isArray(priArr) && priArr.length > 0 ? priArr[0] : (record?.privateIpAddress || (Array.isArray(record?.privateIps) ? record?.privateIps[0] : undefined));
    const host = pub || pri || '';
    remoteForm.setFieldsValue({ host, user: 'root', port: 22 });
    setRemoteType('ssh');
    setRemoteOpen(true);
  };

  const columns: any[] = [
    { title: '实例名', dataIndex: 'InstanceName', key: 'name' },
    ...(caps?.isHarvester ? [] : [{ title: '实例ID', dataIndex: 'InstanceId', key: 'id' }]),
    ...(caps?.supportsNetworkFusion ? [{ title: '网络', key: 'networks', ellipsis: true, render: (_: any, r: any) => {
      const vpc = r?.VpcId || '';
      const subnet = r?.Extra?.SubnetName || '';
      const nads = Array.isArray(r?.Extra?.Networks) ? r?.Extra?.Networks : [];
      const items: string[] = [];
      if (vpc) items.push(subnet ? `${vpc}/${subnet}` : vpc);
      const nadNames = nads.map((n: any) => {
        const s = String(n || '');
        return s.includes('/') ? s.split('/').pop() : s;
      }).filter((s: string) => !!s);
      items.push(...nadNames);
      return items.length ? items.join(' | ') : '-';
    } }] : []),
    ...(caps?.isHarvester ? [{ title: '实例规格', key: 'spec', render: (_: any, r: any) => {
      const cpu = r?.Extra?.CPU;
      const memMi = parseMem(r?.Extra?.Memory);
      const memGi = memMi ? Math.round(memMi / 1024) : undefined;
      const base = (typeof cpu === 'number' || typeof memGi === 'number')
        ? `CPU ${cpu ?? '-'}核 / 内存 ${typeof memGi === 'number' ? memGi : '-'}G`
        : '-';
      return base;
    } }] : []),
    { title: '状态', dataIndex: 'Status', key: 'status', render: (s: string, r: any) => statusMark(s || r.status) },
    ...(caps?.supportsInstanceType ? [{ title: '实例规格', dataIndex: 'InstanceType', key: 'type' }] : []),
    ...(caps?.supportsZone ? [{ title: '可用区', dataIndex: 'ZoneId', key: 'zone' }] : []),
    ...((caps?.supportsVpc && !caps?.supportsNetworkFusion) ? [{ title: 'VPC', dataIndex: 'VpcId', key: 'vpc' }] : []),
    { title: '私网IP', dataIndex: ['VpcAttributes','PrivateIpAddress','IpAddress'], key: 'ip', render:(ips:any)=>Array.isArray(ips)? ips.join(', '): '-' },
    { title: '创建时间', dataIndex: 'CreationTime', key: 'ctime' },
    { title: '操作', key: 'actions', fixed: 'right', render: (_: any, r: any) => {
      const provider = ((clouds.find(c => c.id === currentCloudId)?.config?.provider) || '').toLowerCase();
      const disabled = !(['aliyun','harvester','cloudmap','huaweicloud','tencentcloud'].some(x => provider.includes(x)));
      const iid = r?.InstanceId || r?.id;
      const items = [
        { key: 'detail', label: '详情' },
        { key: 'connect', label: '远程连接' },
        { key: 'webvnc', label: 'WebVNC（浏览器）' },
        { key: 'start', label: '启动', disabled },
        { key: 'stop', label: '停止', disabled },
        { key: 'reboot', label: '重启', disabled },
        { key: 'delete', label: '删除', danger: true, disabled },
      ];
      return (
        <Dropdown
          menu={{ items, onClick: async ({ key }) => {
            if (key === 'detail') { if (!currentCloudId || !iid) return; navigate(`${basePrefix}/clouds/${currentCloudId}/instances/${encodeURIComponent(iid)}`, { state: { backgroundLocation: location } }); return; }
            if (key === 'connect') { openRemoteConnect(r); return; }
            if (key === 'webvnc') {
              const providerNowRaw = ((clouds.find(c => c.id === currentCloudId)?.config?.provider) || '').toLowerCase();
              const isAliyun = providerNowRaw.includes('aliyun');
              const isHuawei = providerNowRaw.includes('huawei');
              if ((isAliyun || isHuawei) && currentCloudId && iid) {
                try {
                  const json = await fetchAliyunEcsVncUrl(currentCloudId!, iid);
                  const url = json?.data?.VncUrl || json?.data?.vncUrl;
                  if (url) {
                    const w = Math.max(1280, (window.screen?.availWidth || 1600) - 40);
                    const h = Math.max(800, (window.screen?.availHeight || 900) - 80);
                    const features = `width=${w},height=${h},top=0,left=0,menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes`;
                    if (isAliyun) {
                      const osRaw = String(r?.OSName || r?.OSType || r?.Platform || '').toLowerCase();
                      const isWindows = osRaw.includes('win');
                      const page = 'https://g.alicdn.com/aliyun/ecs-console-vnc2/0.0.8/index.html';
                      const web = `${page}?vncUrl=${encodeURIComponent(url)}&instanceId=${encodeURIComponent(iid)}&isWindows=${isWindows ? 'true' : 'false'}`;
                      window.open(web, 'webvnc', features);
                    } else {
                      window.open(url, 'webvnc', features);
                    }
                  } else {
                    message.warning('未获取到VNC地址');
                  }
                } catch (e: any) {
                  message.error(e?.message || '获取VNC地址失败');
                }
                return;
              }
              const isHarvester = providerNowRaw.includes('harvester') || providerNowRaw.includes('cloudmap');
              if (isHarvester && currentCloudId && iid) {
                const s = String(iid || '');
                const ns = s.includes('/') ? s.split('/')[0] : '';
                const nm = s.includes('/') ? s.split('/')[1] : s;
                const w = Math.max(1280, (window.screen?.availWidth || 1600) - 40);
                const h = Math.max(800, (window.screen?.availHeight || 900) - 80);
                const features = `width=${w},height=${h},top=0,left=0,menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes`;
                const url = `${basePrefix}/clouds/${encodeURIComponent(currentCloudId!)}/harvester/vnc?cloudId=${encodeURIComponent(currentCloudId!)}&namespace=${encodeURIComponent(ns)}&name=${encodeURIComponent(nm)}`;
                window.open(url, 'harvester-vnc', features);
                return;
              }
              message.warning('WebVNC 已移除');
              return;
            }
            if (key === 'webssh') {
              const pubArr = r?.PublicIpAddress?.IpAddress;
              const pub = Array.isArray(pubArr) && pubArr.length > 0 ? pubArr[0] : (r?.EipAddress?.IpAddress || r?.publicIpAddress || (Array.isArray(r?.PublicIpAddress?.IpAddress) ? r?.PublicIpAddress?.IpAddress[0] : null));
              const priArr = r?.VpcAttributes?.PrivateIpAddress?.IpAddress;
              const pri = Array.isArray(priArr) && priArr.length > 0 ? priArr[0] : r?.privateIpAddress;
              const host = pub || pri || '';
              const user = 'root';
              navigate(`${basePrefix}/clouds/${currentCloudId}/webssh?host=${encodeURIComponent(host)}&user=${encodeURIComponent(user)}&port=22`);
              return;
            }
            if (!currentCloudId || !iid) return;
            try {
              const providerKey = String((clouds.find(c => c.id === currentCloudId)?.config?.provider) || '').toLowerCase();
              if (key === 'start') {
                if (providerKey.includes('aliyun') || providerKey.includes('huawei') || providerKey.includes('tencent') || providerKey.includes('harvester') || providerKey.includes('cloudmap')) {
                  await startCloudProviderEcs(currentCloudId!, iid);
                }
                message.success('启动指令已下发');
                await loadEcs();
              } else if (key === 'stop') {
                if (providerKey.includes('aliyun') || providerKey.includes('huawei') || providerKey.includes('tencent') || providerKey.includes('harvester') || providerKey.includes('cloudmap')) {
                  await stopCloudProviderEcs(currentCloudId!, iid, true);
                }
                message.success('停止指令已下发');
                await loadEcs();
              } else if (key === 'reboot') {
                if (providerKey.includes('aliyun') || providerKey.includes('huawei') || providerKey.includes('tencent') || providerKey.includes('harvester') || providerKey.includes('cloudmap')) {
                  await rebootCloudProviderEcs(currentCloudId!, iid, true);
                }
                message.success('重启指令已下发');
                await loadEcs();
              } else if (key === 'delete') {
                Modal.confirm({
                  title: '确认删除该云主机？',
                  content: '删除后不可恢复，请确保已停止实例且无重要数据。',
                  okText: '删除', okType: 'danger', cancelText: '取消',
                  onOk: async () => {
                    try {
                      if (providerKey.includes('aliyun') || providerKey.includes('huawei') || providerKey.includes('tencent') || providerKey.includes('harvester') || providerKey.includes('cloudmap')) {
                        await deleteCloudProviderEcs(currentCloudId!, iid);
                      }
                      message.success('删除指令已下发');
                      await loadEcs();
                    } catch (e:any) { message.error(e?.message || '删除失败'); }
                  }
                });
              }
            } catch(e:any){ message.error(e?.message || '操作失败'); }
          }}}
          trigger={["click"]}
        >
          <Button type="link" icon={<EllipsisOutlined />} />
        </Dropdown>
      );
    } },
  ];

  const forceRefresh = () => {
    loadEcs();
  };

  const refreshInventory = async () => {
    try {
      if (!invRefreshTarget) { message.warning('请选择要刷新的云资源池'); return; }
      setLoading(true);
      if (invRefreshTarget === 'all') {
        await refreshInventoryInstancesSlow();
        message.success('全部资源池库存已刷新');
        await loadEcs('all');
      } else {
        await refreshInventoryInstances(invRefreshTarget);
        message.success('库存已刷新');
        if (currentCloudId === 'all') { await loadEcs('all'); }
      }
    } catch (e: any) {
      message.error(e?.message || '刷新库存失败');
    } finally {
      setLoading(false);
    }
  };

  const refreshInventoryGlobalSlow = async () => {
    try {
      setLoading(true);
      await refreshInventoryInstancesSlow();
      message.success('全量库存刷新完成');
      if (currentCloudId === 'all') { await loadEcs('all'); }
    } catch (e: any) {
      message.error(e?.message || '全量刷新库存失败');
    } finally {
      setLoading(false);
    }
  };

  const refreshCurrentInventory = async () => {
    try {
      if (!currentCloudId || currentCloudId === 'all') { message.warning('请在侧栏选择具体资源池'); return; }
      setLoading(true);
      await refreshInventoryInstances(currentCloudId);
      message.success('库存已刷新');
      await loadEcs(currentCloudId);
    } catch (e:any) {
      message.error(e?.message || '刷新库存失败');
    } finally {
      setLoading(false);
    }
  };

  const batchOperate = async (op: 'start'|'stop'|'reboot'|'delete') => {
    try {
      if (!currentCloudId) return;
      const ids = selectedRowKeys.map(k => String(k)).filter(Boolean);
      if (ids.length === 0) { message.info('请先选择实例'); return; }
      for (const iid of ids) {
        if (op === 'start') await startCloudProviderEcs(currentCloudId!, iid);
        if (op === 'stop') await stopCloudProviderEcs(currentCloudId!, iid, true);
        if (op === 'reboot') await rebootCloudProviderEcs(currentCloudId!, iid, true);
        if (op === 'delete') await deleteCloudProviderEcs(currentCloudId!, iid);
      }
      message.success('批量指令已下发');
      await loadEcs();
      setSelectedRowKeys([]);
    } catch (e:any) {
      message.error(e?.message || '操作失败');
    }
  };

  return (
    <PageContainer asCard={false} hideHeader title="" pagePadding={0}>
      <div className="cloud-console-root">
      <Row gutter={0}>
        <Col span={3} style={{ padding: 0 }}>
          <div className="cloud-console-sidebar" style={{ position: 'sticky', top: 0 }}>
            <div className="sidebar-header" style={{ marginBottom:8 }}>
              <Space size={6} direction="vertical" style={{ width:'100%' }}>
                <Space size={6}>
                  <DesktopOutlined />
                  <span>资源控制台pro</span>
                </Space>
                <div className="sidebar-status">
                  <Space size={8} wrap>
                    <Space size={6}>
                      <span className="status-dot success" />
                      <span>在线 {statusStats.online}</span>
                    </Space>
                    {statusStats.maintenance>0 && (
                      <Space size={6}>
                        <span className="status-dot warning" />
                        <span>维护 {statusStats.maintenance}</span>
                      </Space>
                    )}
                    {statusStats.offline>0 && (
                      <Space size={6}>
                        <span className="status-dot error" />
                        <span>离线 {statusStats.offline}</span>
                      </Space>
                    )}
                    {statusStats.unknown>0 && (
                      <Space size={6}>
                        <span className="status-dot unknown" />
                        <span>未知 {statusStats.unknown}</span>
                      </Space>
                    )}
                  </Space>
                </div>
              </Space>
            </div>
             <Tree
               treeData={treeData as any}
               expandedKeys={expandedKeys}
               onExpand={(keys)=> setExpandedKeys(keys as string[])}
               onSelect={(keys)=> {
                 const k = String((keys || [])[0] || '');
                 if (k.startsWith('cloud:')) {
                   const id = k.slice('cloud:'.length);
                   setCurrentCloudId(id);
                 }
               }}
             />
            
            {advOpen && (
              <div style={{ marginTop:6 }}>
                <Space size={8}>
                  <span style={{ color:'#8c8c8c' }}>供应商</span>
                  <Select size="small" value={providerFilter} style={{ width:140 }} onChange={(v)=> setProviderFilter(v)}>
                    <Select.Option value="all">全部</Select.Option>
                    <Select.Option value="aliyun">阿里云</Select.Option>
                    <Select.Option value="huaweicloud">华为云</Select.Option>
                    <Select.Option value="tencentcloud">腾讯云</Select.Option>
                    <Select.Option value="harvester">Harvester</Select.Option>
                    <Select.Option value="cloudmap">Cloudmap</Select.Option>
                  </Select>
                </Space>
              </div>
            )}
            
          </div>
        </Col>
        <Col span={21} style={{ padding: '0 0 0 30px' }} className="cloud-console-content">
          <div className="cloud-console-content-scroll">
          <Divider style={{ margin: '0 0 30px 0' }} />
          {error && (
            <Alert
              type="error"
              message={error.includes('仅支持') ? '不支持的云资源池' : '查询失败'}
              description={error}
              style={{ marginBottom: 12 }}
              showIcon
              action={<Button type="link" onClick={()=>navigate('/admin/clouds')}>前往资源池管理</Button>}
            />
          )}
          <Typography.Title level={3} style={{ marginTop: 0, color: '#1f2a44' }}>{currentCloudId === 'all' ? providerName : `${providerName} ${currentCloud?.name || '-'}`}</Typography.Title>

          <Tabs
            activeKey={activeTab}
            onChange={(k)=> setActiveTab(k as any)}
            className="cloud-console-tabs"
            items={[
              { key: 'ecs', label: '云主机', children: (
                <>
                  <div className="filters-row filters-row--compact">
                  <Space size={12} wrap>
                    <Input allowClear placeholder="请输入关键字搜索" style={{ width: 220 }} onChange={(e)=> setKeyword(e.target.value)} />
                    <Select
                      mode="multiple"
                      value={statusMulti}
                      onChange={(v)=> setStatusMulti(v)}
                      placeholder="选择状态"
                      style={{ width: 120 }}
                      allowClear
                    >
                      <Select.Option value="running">运行中</Select.Option>
                      <Select.Option value="stopped">已停止</Select.Option>
                    </Select>
                    {currentCloudId === 'all' && (
                      <Select
                        mode="multiple"
                        value={cloudFilterIds}
                        onChange={(v)=> setCloudFilterIds(v)}
                        placeholder="按资源池筛选"
                        style={{ width: 220 }}
                        allowClear
                      >
                        {(clouds || []).map(c => (
                          <Select.Option key={c.id} value={c.id}>{`${c.name} (${String(c?.config?.provider || '').toLowerCase()})`}</Select.Option>
                        ))}
                      </Select>
                    )}
                    {caps?.isHarvester && (
                      <Select value={groupBy} onChange={(v)=> setGroupBy(v)} style={{ width: 140 }}>
                        <Select.Option value="none">不分组</Select.Option>
                        <Select.Option value="namespace">按命名空间</Select.Option>
                        <Select.Option value="node">按节点</Select.Option>
                      </Select>
                    )}
                    {caps?.isHarvester && (
                      <>
                        <Select value={nsFilter} onChange={(v)=> setNsFilter(v)} style={{ width: 160 }} placeholder="按命名空间">
                          <Select.Option value="all">全部命名空间</Select.Option>
                          {harvesterNsOptions.map(ns => (<Select.Option key={ns} value={ns}>{ns}</Select.Option>))}
                        </Select>
                        <Select value={nodeFilter} onChange={(v)=> setNodeFilter(v)} style={{ width: 160 }} placeholder="按节点">
                          <Select.Option value="all">全部节点</Select.Option>
                          {harvesterNodeOptions.map(n => (<Select.Option key={n} value={n}>{n}</Select.Option>))}
                        </Select>
                      </>
                    )}
                  </Space>
                  <Space className="filter-actions">
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      onClick={() => navigate(`/clouds/${currentCloudId || 'all'}/instances/create`, { state: { backgroundLocation: location } })}
                    >
                      创建实例
                    </Button>
                    {currentCloudId === 'all' ? (
                      <>
                        <Select
                          value={invRefreshTarget}
                          onChange={(v)=> setInvRefreshTarget(v)}
                          style={{ width: 220 }}
                          placeholder="选择云资源池"
                        >
                          <Select.Option key="all" value="all">全部</Select.Option>
                          {(clouds || []).map(c => (
                            <Select.Option key={c.id} value={c.id}>{`${c.name} (${String(c?.config?.provider || '').toLowerCase()})`}</Select.Option>
                          ))}
                        </Select>
                        <Button icon={<ReloadOutlined />} onClick={refreshInventory} />
                      </>
                    ) : (
                      <Button icon={<ReloadOutlined />} onClick={refreshCurrentInventory} />
                    )}
                    
                  </Space>
                  </div>
                  {groupBy === 'none' ? (
                    <Table
            className="vr-table"
            size="small"
            rowKey={(r:any)=> r.InstanceId || r.id || Math.random().toString(36).slice(2)}
                      columns={((currentCloudId === 'all' || useAggColumns) ? [
                        { title: '实例名', dataIndex: 'name', key: 'name' },
                        { title: '资源池名称', key: 'cloudName', render: (_: any, r: any) => cloudMap[r.cloudId]?.name || '-' },
                        { title: '资源池信息', key: 'cloudInfo', render: (_: any, r: any) => {
                          const vendor = providerLabel(String(r.provider || ''));
                          const region = cloudMap[r.cloudId]?.region || r.region || '';
                          return (
                            <div>
                              <div>{vendor}</div>
                              {region ? (<div style={{ color:'#8c8c8c' }}>{region}</div>) : null}
                            </div>
                          );
                        } },
                        { title: '状态', dataIndex: 'status', key: 'status', render: (s: string) => statusMark(s) },
                        { title: '实例规格', key: 'spec', render: (_: any, r: any) => {
                          const cpu = r?.cpu;
                          const providerKey = String(r?.provider || '').toLowerCase();
                          let memGi: number | undefined;
                          if (providerKey === 'harvester' || providerKey === 'cloudmap') {
                            const memMi = parseMem(r?.extra?.memory || r?.Extra?.Memory || r?.Memory || r?.memory);
                            memGi = memMi && memMi > 0 ? Math.round(memMi / 1024) : undefined;
                            if (memGi == null) {
                              const memGbRaw = r?.memoryGb ?? r?.memoryGB ?? r?.memory;
                              const gb = parseFloat(String(memGbRaw));
                              if (Number.isFinite(gb)) {
                                // 临时兜底：后端 Cloudmap/Harvester 聚合可能出现按 2048 错误换算，尝试纠正为 Gi
                                memGi = gb > 1024 && gb < 65536 ? Math.round((gb * 2) / 1024) : Math.round(gb);
                              }
                            }
                          } else {
                            const memGbRaw = r?.memoryGb ?? r?.memoryGB ?? r?.memory;
                            const val = parseFloat(String(memGbRaw));
                            memGi = Number.isFinite(val) ? Math.round(val) : undefined;
                          }
                          const base = (typeof cpu === 'number' || typeof memGi === 'number')
                            ? `CPU ${cpu ?? '-'}核 / 内存 ${typeof memGi === 'number' ? memGi : '-'}G`
                            : '-';
                          const type = r?.instanceType;
                          return (
                            <div>
                              <div>{base}</div>
                              {type ? (<div style={{ color:'#8c8c8c' }}>{type}</div>) : null}
                            </div>
                          );
                        } },
                        { title: '虚拟网络', key: 'vnet', render: (_: any, r: any) => {
                          const p = String(r?.provider || '').toLowerCase();
                          if (p === 'harvester' || p === 'cloudmap') {
                            const vpcName = r?.extra?.vpcId || r?.vpcId || '';
                            const subnet = r?.extra?.subnetName || r?.subnetName || '';
                            const netsArr = Array.isArray(r?.extra?.networks) ? r.extra.networks : [];
                            const nets = netsArr.map((n:any)=>{ const s=String(n||''); return s.includes('/')? s.split('/').pop() : s; }).filter(Boolean).join(', ');
                            if (vpcName || subnet) {
                              return (
                                <div>
                                  <div>{vpcName || '-'}</div>
                                  {subnet ? (<div style={{ color:'#8c8c8c' }}>{subnet}</div>) : null}
                                </div>
                              );
                            }
                            return nets || '-';
                          }
                          if (p.includes('huawei')) {
                            const nets = Array.isArray(r?.extra?.networks) ? r.extra.networks.join(', ') : '';
                            const name = r?.extra?.vpcName || r?.vpcId || '';
                            return (
                              <div>
                                <div>{name || '-'}</div>
                                {nets ? (<div style={{ color:'#8c8c8c' }}>{nets}</div>) : null}
                              </div>
                            );
                          }
                          const name = r?.extra?.vpcName || r?.vpcId || r?.VpcId || r?.VpcAttributes?.VpcId || '';
                          const cidr = r?.extra?.subnetCidr || r?.extra?.vpcCidr || r?.VpcAttributes?.CidrBlock || '';
                          return (
                            <div>
                              <div>{name || '-'}</div>
                              {cidr ? (<div style={{ color:'#8c8c8c' }}>{cidr}</div>) : null}
                            </div>
                          );
                        } },
                        { title: '私网IP', dataIndex: 'privateIps', key: 'ip', render: (ips: any[]) => Array.isArray(ips) ? ips.join(', ') : '-' },
                        { title: '创建时间', dataIndex: 'createdAt', key: 'ctime', render: (_: any, r: any) => r?.createdAt || r?.updatedAt || '-' },
                        { title: '操作', key: 'actions', fixed: 'right', render: (_: any, r: any) => {
                          const provider = String(r?.provider || '').toLowerCase();
                          const cloudId = String(r?.cloudId || '');
                          const iid = String(r?.id || '');
                          const disabled = !(['aliyun','harvester','cloudmap','huaweicloud','tencentcloud'].some(x => provider.includes(x)));
                          const items = [
                            { key: 'detail', label: '详情' },
                            { key: 'webvnc', label: 'WebVNC（浏览器）' },
                            { key: 'start', label: '启动', disabled },
                            { key: 'stop', label: '停止', disabled },
                            { key: 'reboot', label: '重启', disabled },
                            { key: 'delete', label: '删除', danger: true, disabled },
                          ];
                          return (
                            <Dropdown
                              menu={{ items, onClick: async ({ key }) => {
                                if (key === 'detail') { if (!cloudId || !iid) return; navigate(`/admin/clouds/${cloudId}/instances/${encodeURIComponent(iid)}`, { state: { backgroundLocation: location } }); return; }
                                if (key === 'webvnc') {
                                  const isAliyun = provider.includes('aliyun');
                                  const isHuawei = provider.includes('huawei');
                                  if ((isAliyun || isHuawei) && cloudId && iid) {
                                    try {
                                      const json = await fetchAliyunEcsVncUrl(cloudId, iid);
                                      const url = json?.data?.VncUrl || json?.data?.vncUrl;
                                      if (url) {
                                        const w = Math.max(1280, (window.screen?.availWidth || 1600) - 40);
                                        const h = Math.max(800, (window.screen?.availHeight || 900) - 80);
                                        const features = `width=${w},height=${h},top=0,left=0,menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes`;
                                        if (isAliyun) {
                                          const osRaw = String(r?.os || r?.image || '').toLowerCase();
                                          const isWindows = osRaw.includes('win');
                                          const page = 'https://g.alicdn.com/aliyun/ecs-console-vnc2/0.0.8/index.html';
                                          const web = `${page}?vncUrl=${encodeURIComponent(url)}&instanceId=${encodeURIComponent(iid)}&isWindows=${isWindows ? 'true' : 'false'}`;
                                          window.open(web, 'webvnc', features);
                                        } else {
                                          window.open(url, 'webvnc', features);
                                        }
                                      } else {
                                        message.warning('未获取到VNC地址');
                                      }
                                    } catch (e: any) {
                                      message.error(e?.message || '获取VNC地址失败');
                                    }
                                    return;
                                  }
                                  const pub = Array.isArray(r?.publicIps) && r.publicIps.length > 0 ? r.publicIps[0] : null;
                                  const pri = Array.isArray(r?.privateIps) && r.privateIps.length > 0 ? r.privateIps[0] : null;
                                  const host = pub || pri || '';
                                  navigate(`${basePrefix}/clouds/${cloudId || 'all'}/webvnc?host=${encodeURIComponent(host)}&port=5900`);
                                  return;
                                }
                                if (key === 'webssh') {
                                  const pub = Array.isArray(r?.publicIps) && r.publicIps.length > 0 ? r.publicIps[0] : null;
                                  const pri = Array.isArray(r?.privateIps) && r.privateIps.length > 0 ? r.privateIps[0] : null;
                                  const host = pub || pri || '';
                                  const user = 'root';
                                  navigate(`${basePrefix}/clouds/${cloudId || 'all'}/webssh?host=${encodeURIComponent(host)}&user=${encodeURIComponent(user)}&port=22`);
                                  return;
                                }
                                try {
                                  if (!cloudId || !iid) return;
      const providerKey2 = String(r?.provider || '').toLowerCase();
      if (key === 'start') {
        if (providerKey2.includes('aliyun') || providerKey2.includes('huawei') || providerKey2.includes('harvester') || providerKey2.includes('cloudmap')) {
          await startCloudProviderEcs(cloudId, iid);
        }
        message.success('启动指令已下发');
      } else if (key === 'stop') {
        if (providerKey2.includes('aliyun') || providerKey2.includes('huawei') || providerKey2.includes('harvester') || providerKey2.includes('cloudmap')) {
          await stopCloudProviderEcs(cloudId, iid, true);
        }
        message.success('停止指令已下发');
      } else if (key === 'reboot') {
        if (providerKey2.includes('aliyun') || providerKey2.includes('huawei') || providerKey2.includes('harvester') || providerKey2.includes('cloudmap')) {
          await rebootCloudProviderEcs(cloudId, iid, true);
        }
        message.success('重启指令已下发');
      } else if (key === 'delete') {
                                    Modal.confirm({ title: '确认删除该云主机？', content: '删除后不可恢复，请确保已停止实例且无重要数据。', okText: '删除', okType: 'danger', cancelText: '取消', onOk: async () => {
                                      try {
                                        if (providerKey2.includes('aliyun') || providerKey2.includes('huawei') || providerKey2.includes('tencent') || providerKey2.includes('harvester') || providerKey2.includes('cloudmap')) {
                                          await deleteCloudProviderEcs(cloudId, iid);
                                        }
                                        message.success('删除指令已下发'); await loadEcs(currentCloudId || 'all');
                                      } catch (e:any) { message.error(e?.message || '删除失败'); }
                                    } });
                                    return;
                                  }
                                  await loadEcs(currentCloudId || 'all');
                                } catch (e:any) { message.error(e?.message || '操作失败'); }
                              } }}
                              trigger={["click"]}
                            >
                              <Button type="link" icon={<EllipsisOutlined />} />
                            </Dropdown>
                          );
                        } },
                      ] : columns) as any}
                      dataSource={pagedEcs}
                      loading={loading}
                      rowSelection={{ selectedRowKeys, onChange: (keys)=> setSelectedRowKeys(keys) }}
                      pagination={{
                        current: pagination.current,
                        pageSize: pagination.pageSize,
                        total: filteredEcs.length,
                        showSizeChanger: true,
                        pageSizeOptions: ['10','20','50'],
                      }}
                      onChange={handleTableChange}
                      scroll={{ x: 'max-content' }}
                    />
                  ) : (
                    Object.keys(groupedEcs).map((k) => (
                      <div key={k} style={{ marginBottom: 16 }}>
                        <Typography.Title level={5} style={{ margin: '8px 0' }}>{k}</Typography.Title>
                        <Table
                          className="vr-table"
                          size="small"
                          rowKey={(r:any)=> r.InstanceId || r.id || Math.random().toString(36).slice(2)}
                          columns={columns as any}
                          dataSource={groupedEcs[k]}
                          loading={loading}
                          pagination={false}
                          scroll={{ x: 'max-content' }}
                        />
                      </div>
                    ))
                  )}
                </>
              ) },
              { key: 'vpcs', label: 'VPC', children: (
                <Table className="vr-table" size="small" bordered rowKey={(r:any)=> r.VpcId || r.id} columns={vpcColumns as any} dataSource={vpcs} />
              ) },
              { key: 'eips', label: 'EIP', children: (
                <Table className="vr-table" size="small" bordered rowKey={(r:any)=> r.AllocationId || r.id} columns={eipColumns as any} dataSource={eips} />
              ) },
              { key: 'disks', label: '磁盘', children: (
                <Table className="vr-table" size="small" bordered rowKey={(r:any)=> r.DiskId || r.id} columns={diskColumns as any} dataSource={disks} />
              ) },
              { key: 'enis', label: '弹性网卡', children: (
                <Table className="vr-table" size="small" bordered rowKey={(r:any)=> r.NetworkInterfaceId || r.id} columns={eniColumns as any} dataSource={enis} />
              ) },
            ]}
          />
          </div>
        </Col>
      </Row>
      </div>

      <Modal
        title="远程连接"
        open={remoteOpen}
        onCancel={() => { setRemoteOpen(false); setRemoteTarget(null); remoteForm.resetFields(); }}
        onOk={async () => {
          try {
            const values = await remoteForm.validateFields();
            const host = values.host;
            const user = values.user || (remoteType === 'ssh' ? 'root' : 'Administrator');
            const port = values.port || (remoteType === 'ssh' ? 22 : 3389);
            if (remoteType === 'ssh') {
              const cmd = `ssh ${user}@${host} -p ${port}`;
              await navigator.clipboard.writeText(cmd);
              message.success('SSH 命令已复制到剪贴板');
            } else {
              const content = [
                `full address:s:${host}:${port}`,
                user ? `username:s:${user}` : '',
              ].filter(Boolean).join('\n');
              const blob = new Blob([content], { type: 'application/x-rdp' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              const iid = remoteTarget?.InstanceId || 'ecs';
              a.download = `connect-${iid}.rdp`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              message.success('RDP 文件已下载');
            }
            setRemoteOpen(false);
            setRemoteTarget(null);
            remoteForm.resetFields();
          } catch (e:any) {
            message.error(e?.message || '操作失败，请检查参数');
          }
        }}
        okText={remoteType === 'ssh' ? '复制 SSH 命令' : '下载 RDP 文件'}
        destroyOnHidden
      >
        <Alert type="info" message={remoteType === 'ssh' ? '本功能将复制 SSH 命令，请在本地终端执行。若无公网IP，请通过堡垒机或为实例绑定EIP。' : '本功能将生成并下载 RDP 文件，在本地使用远程桌面连接打开。'} style={{ marginBottom: 12 }} />
        <Form form={remoteForm} layout="vertical">
          <Form.Item label="连接方式" name="type">
            <Radio.Group value={remoteType} onChange={(e:any)=>{
              setRemoteType(e.target.value);
              const port = e.target.value === 'ssh' ? 22 : 3389;
              const v = remoteForm.getFieldValue('port');
              if (!v) remoteForm.setFieldsValue({ port });
            }}>
              <Radio.Button value="ssh">SSH（Linux）</Radio.Button>
              <Radio.Button value="rdp">RDP（Windows）</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="host" label="主机地址" rules={[{ required: true, message: '请输入主机地址（建议公网IP）' }]}> 
            <Input placeholder="如：47.XX.XX.XX 或 主机名" />
          </Form.Item>
          <Form.Item name="user" label="用户名"> 
            <Input placeholder={remoteType === 'ssh' ? '如：root' : '如：Administrator'} />
          </Form.Item>
          <Form.Item name="port" label="端口"> 
            <InputNumber min={1} max={65535} placeholder={remoteType === 'ssh' ? '默认 22' : '默认 3389'} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="库存刷新"
        open={invRefreshOpen}
        onCancel={() => setInvRefreshOpen(false)}
        onOk={async () => {
          if (refreshMode === 'global') { await refreshInventoryGlobalSlow(); setInvRefreshOpen(false); return; }
          await refreshInventory(); setInvRefreshOpen(false);
        }}
        okText="开始刷新"
        destroyOnHidden
      >
        <Radio.Group value={refreshMode} onChange={(e:any)=> setRefreshMode(e.target.value)} style={{ marginBottom: 12 }}>
          <Radio value="single">单云</Radio>
          <Radio value="global">全部云（慢速）</Radio>
        </Radio.Group>
        {refreshMode === 'single' && (
          <Select
            value={invRefreshTarget}
            onChange={(v)=> setInvRefreshTarget(v)}
            style={{ width: '100%' }}
            placeholder="选择云资源池"
          >
            {(clouds || []).map(c => (
              <Select.Option key={c.id} value={c.id}>{`${c.name} (${String(c?.config?.provider || '').toLowerCase()})`}</Select.Option>
            ))}
          </Select>
        )}
      </Modal>

      
    </PageContainer>
  );
};

export default CloudConsolePage;

const parseCpu = (v:any): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const parseMem = (v:any): number => {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return 0;
  if (/^\d+$/.test(s)) return Number(s);
  const m = s.match(/^(\d+(?:\.\d+)?)(?:\s*)(gib?|gi|gb?|g|mib?|mi|mb?|m|kib?|ki|kb?|k|tib?|ti|tb?|t|b)$/);
  if (!m) return 0;
  const val = Number(m[1]);
  const unit = m[2];
  if (unit === 'gib' || unit === 'gi' || unit === 'gb' || unit === 'g') return val * 1024;
  if (unit === 'mib' || unit === 'mi' || unit === 'mb' || unit === 'm') return val;
  if (unit === 'kib' || unit === 'ki' || unit === 'kb' || unit === 'k') return val / 1024;
  if (unit === 'tib' || unit === 'ti' || unit === 'tb' || unit === 't') return val * 1024 * 1024;
  if (unit === 'b') return val / (1024 * 1024);
  return 0;
};
