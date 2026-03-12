import React, { useEffect, useMemo, useState, useRef } from 'react';
import { Button, Form, Input, Tabs, Alert, Tree, App, Space, Modal, Spin } from 'antd';
import { ReloadOutlined, CloudServerOutlined, CloudOutlined, BranchesOutlined, ApartmentOutlined, LoadingOutlined, MenuFoldOutlined, MenuUnfoldOutlined, SearchOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons';
import PageContainer from '../../../components/PageContainer';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../utils/accessMapping';
import { isSystemNamespace } from '../../../utils/harvesterUtils';
import { fetchHarvesterNamespaces, fetchHarvesterTemplates, fetchHarvesterSshKeys, fetchHarvesterSnapshots, fetchHarvesterBackups, fetchHarvesterScheduleVmBackups, fetchHarvesterCloudInits, fetchHarvesterGpuResources, fetchHarvesterIPPools, fetchHarvesterLoadBalancers, fetchHarvesterStorageClasses, fetchCloudProviderOvnEips, fetchCloudProviderOvnFips, fetchCloudProviderOvnSnatRules, fetchCloudProviderOvnDnatRules, fetchHarvesterVolumes, fetchHarvesterImages } from '../../../services/harvesterApi';
import { 
  fetchClouds, fetchCloudProviderEcs, API_BASE_URL,
  startCloudProviderEcs, stopCloudProviderEcs, rebootCloudProviderEcs, softRebootCloudProviderEcs, pauseCloudProviderEcs, unpauseCloudProviderEcs, deleteCloudProviderEcs,
  apiRequest
} from '../../../services/api';
import { getToken } from '../../../utils/tokenStorage';
import './CloudConsole.css';
import CloudConsoleHarvester from './CloudConsoleHarvester';
import VmSection from '../Harvester/sections/VmSection';
import VmReconfigureModal from '../Harvester/modals/VmReconfigureModal';
import CloudConsoleVpcDetail from './CloudConsoleVpcDetail';

type CloudItem = { id: string; name: string; region?: string; type?: string; config?: any; status?: string };

/**
 * CloudConsolePage 组件
 * 
 * 云主机控制台的主入口页面。
 * 
 * 功能职责:
 * 1. 布局管理: 左侧资源池/VPC 树状导航，右侧资源详情内容区域。
 * 2. 状态管理: 维护当前选中的资源池 (currentCloudId)、选中的 VPC (selectedVpc) 以及各资源列表数据 (ECS, PVC, Images 等)。
 * 3. 数据加载: 负责调用后端 API 获取各类云资源数据，并分发给子组件展示。
 * 4. 权限控制: 检查用户是否有查看云主机的权限。
 */
const CloudConsolePage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { message } = App.useApp();
  
  // ==================== State Definitions (状态定义) ====================
  
  // 资源池列表
  const [clouds, setClouds] = useState<CloudItem[]>([]);
  const [cloudsLoading, setCloudsLoading] = useState(true);
  // 当前选中的资源池 ID
  const [currentCloudId, setCurrentCloudId] = useState<string | undefined>();
  
  // 各类资源数据列表
  const [ecs, setEcs] = useState<any[]>([]);        // 云主机
  const [namespaces, setNamespaces] = useState<any[]>([]); // 命名空间
  const [pvcs, setPvcs] = useState<any[]>([]);      // 虚拟卷 (Harvester)
  const [images, setImages] = useState<any[]>([]);  // 镜像 (Harvester)
  const [templates, setTemplates] = useState<any[]>([]); // 模板 (Harvester)
  const [sshKeys, setSshKeys] = useState<any[]>([]); // SSH 密钥 (Harvester)
  const [snapshots, setSnapshots] = useState<any[]>([]); // 云主机快照 (Harvester)
  const [backups, setBackups] = useState<any[]>([]); // 云主机备份 (Harvester)
  const [schedules, setSchedules] = useState<any[]>([]); // 定时策略 (Harvester)
  const [cloudInits, setCloudInits] = useState<any[]>([]); // Cloud Init 模板 (Harvester)
  const [gpus, setGpus] = useState<any[]>([]);            // GPU 资源 (Harvester)
  const [ippools, setIPPools] = useState<any[]>([]);      // IP 地址池 (Harvester)
  const [eips, setEips] = useState<any[]>([]);            // EIP (Harvester VPC)
  const [fips, setFips] = useState<any[]>([]);            // FIP (Harvester VPC)
  const [snatRules, setSnatRules] = useState<any[]>([]);  // SNAT 规则 (Harvester VPC)
  const [dnatRules, setDnatRules] = useState<any[]>([]);  // DNAT 规则 (Harvester VPC)
  const [nads, setNads] = useState<any[]>([]);      // 网络附件定义 (Harvester 扁平网络)
  const [vpcs, setVpcs] = useState<any[]>([]);      // VPC 列表
  const [subnets, setSubnets] = useState<any[]>([]); // 子网列表
  const [lbrules, setLbrules] = useState<any[]>([]); // 负载均衡 (Harvester)
  const [storageClasses, setStorageClasses] = useState<any[]>([]); // 存储类
  
  // UI 状态
  const [loading, setLoading] = useState(false);
  const [vpcLoading, setVpcLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState<string>(''); // 搜索关键字 (暂未使用)
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10, total: 0 }); // 分页 (暂未使用，由 Table 内部处理)
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]); // 左侧树展开节点

  // 左侧侧边栏折叠状态
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [activeTab, setActiveTab] = useState<string>('ecs'); // 当前激活的 Tab 页签
  const [selectedVpc, setSelectedVpc] = useState<string | null>(null); // 当前选中的 VPC (用于 VPC 详情视图)
  const [caps, setCaps] = useState<any>({}); // 当前云平台的能力集 (capabilities)，用于判断是否为 Harvester 等
  
  // Harvester Specific Navigation State (Lifted Up)
  const [harvesterCategory, setHarvesterCategory] = useState<string>('compute');
  const [harvesterResource, setHarvesterResource] = useState<string>('vm');

  // VmSection specific state
  const [nsValue, setNsValue] = useState<string | undefined>(undefined);
  const [nodeValue, setNodeValue] = useState<string | undefined>(undefined);
  const [reconfVisible, setReconfVisible] = useState(false);
  const [reconfVm, setReconfVm] = useState<any>(null);
  
  // SSE Status Buffer
  const vmStatusBuffer = useRef(new Map<string, any>());

  // ==================== Action Handlers ====================
  const handleStart = async (iid: string) => {
    if (!currentCloudId) return;
    try {
      if (isCloudmap) {
        const vm = ecs.find((v: any) => {
          const vId = v?.metadata?.name && v?.metadata?.namespace ? `${v.metadata.namespace}/${v.metadata.name}` : (v?.InstanceId || v?.id);
          return vId === iid;
        });
        if (vm && pvcs.length > 0) {
          const vmVolumes = vm?.spec?.template?.spec?.volumes || [];
          const pvcNames = vmVolumes.map((vol: any) => vol?.persistentVolumeClaim?.claimName).filter(Boolean);
          if (pvcNames.length > 0) {
            const vmNamespace = vm?.metadata?.namespace || vm?.namespace;
            const resizingPvc = pvcs.find((pvc: any) => {
              const pvcName = pvc?.metadata?.name;
              const pvcNs = pvc?.metadata?.namespace;
              if (pvcNs !== vmNamespace || !pvcNames.includes(pvcName)) return false;
              const conditions = pvc?.status?.conditions || [];
              return conditions.some((c: any) => c.type === 'Resizing' && c.status === 'True');
            });
            if (resizingPvc) {
              message.error(`无法启动: 关联的磁盘 ${resizingPvc.metadata.name} 正在进行扩容操作 (Resizing)。请等待扩容完成。`);
              return;
            }
          }
        }
      }
      await startCloudProviderEcs(currentCloudId, iid);
      message.success('已发送启动指令');
      // Optimistic update or refresh
      loadEcs(currentCloudId);
    } catch (e: any) {
      const errMsg = e?.message || String(e);
      if (isCloudmap && (errMsg.includes('resizing volume') || errMsg.includes('Resizing'))) {
        message.warning('启动被拒绝: 关联磁盘正在进行扩容操作，请等待扩容完成后再试。');
      } else {
        message.error(`启动失败: ${e.message}`);
      }
    }
  };

  const handleStop = async (iid: string) => {
    if (!currentCloudId) return;
    try {
      let force = false;
      let realId = iid;
      if (isCloudmap && iid.endsWith('::force')) {
        force = true;
        realId = iid.replace(/::force$/, '');
      }
      await stopCloudProviderEcs(currentCloudId, realId, force);
      message.success(force ? '强制停止指令已下发' : '已发送停止指令');
      loadEcs(currentCloudId);
    } catch (e: any) {
      message.error(`停止失败: ${e.message}`);
    }
  };

  const handleReboot = async (iid: string) => {
    if (!currentCloudId) return;
    try {
      await rebootCloudProviderEcs(currentCloudId, iid);
      message.success('已发送重启指令');
      loadEcs(currentCloudId);
    } catch (e: any) {
      message.error(`重启失败: ${e.message}`);
    }
  };

  const handleSoftReboot = async (iid: string) => {
    if (!currentCloudId) return;
    try {
      await softRebootCloudProviderEcs(currentCloudId, iid);
      message.success('已发送重启指令');
      loadEcs(currentCloudId);
    } catch (e: any) {
      message.error(`重启失败: ${e.message}`);
    }
  };

  const handlePause = async (iid: string) => {
    if (!currentCloudId) return;
    try {
      await pauseCloudProviderEcs(currentCloudId, iid);
      message.success('已发送暂停指令');
      loadEcs(currentCloudId);
    } catch (e: any) {
      message.error(`暂停失败: ${e.message}`);
    }
  };

  const handleUnpause = async (iid: string) => {
    if (!currentCloudId) return;
    try {
      await unpauseCloudProviderEcs(currentCloudId, iid);
      message.success('已发送恢复指令');
      loadEcs(currentCloudId);
    } catch (e: any) {
      message.error(`恢复失败: ${e.message}`);
    }
  };

  const handleDelete = async (iid: string, deleteVolumes?: boolean) => {
    if (!currentCloudId) return;
    try {
      await deleteCloudProviderEcs(currentCloudId, iid, deleteVolumes);
      message.success('已发送删除指令');
      loadEcs(currentCloudId);
    } catch (e: any) {
      message.error(`删除失败: ${e.message}`);
    }
  };

  // SSE Effect for Real-time Updates
  useEffect(() => {
    if (!currentCloudId) return;
    // Check if it's Harvester (simplified check or use caps)
    // For now we enable it if we are on Harvester tab logic (which implies Harvester provider)
    
    let eventSource: EventSource | null = null;
    const connectSSE = () => {
      const token = getToken() || '';
      const sseUrl = `${API_BASE_URL}/api/clouds/${currentCloudId}/resources/ecs/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`;
      
      eventSource = new EventSource(sseUrl);
      
      eventSource.onopen = () => {
        // SSE 连接已建立
      };

      // Full list update (optional, usually initial load handles it)
      eventSource.addEventListener('vms', (ev: MessageEvent) => {
        try {
          const json = JSON.parse(String(ev.data || '{}'));
          const items: any[] = Array.isArray(json?.items) ? json.items : [];
          if (items.length > 0) setEcs(items);
        } catch {}
      });

      // VM Created
      eventSource.addEventListener('vm_created', (ev: MessageEvent) => {
        try {
          const json = JSON.parse(String(ev.data || '{}'));
          const r = json?.item;
          if (!r) return;
          setEcs(prev => {
            const iid = String(r?.InstanceId || r?.id || '');
            if (!iid) return prev;
            if ((prev || []).some((x:any)=> String(x?.InstanceId||x?.id||'')===iid)) return prev;
            return [r, ...(prev || [])];
          });
        } catch {}
      });

      // VM Deleted
      eventSource.addEventListener('vm_deleted', (ev: MessageEvent) => {
        try {
          const json = JSON.parse(String(ev.data || '{}'));
          const iid = String(json?.iid || '');
          if (!iid) return;
          setEcs(prev => (prev || []).filter(item => 
             !((item.id && item.id === iid) || 
               (item.InstanceId && item.InstanceId === iid) ||
               (item?.metadata?.uid && item?.metadata?.uid === iid))
          ));
        } catch {}
      });

      // VM Status Update (Buffered)
      eventSource.addEventListener('vm_status', (ev: MessageEvent) => {
        try {
          const json = JSON.parse(String(ev.data || '{}'));
          const iid = String(json?.iid || '');
          if (!iid) return;
          vmStatusBuffer.current.set(iid, json);
        } catch {}
      });

      eventSource.onerror = (err) => {
        // console.error('[SSE] Connection Error', err);
        // Do NOT close explicitly; allow browser to auto-reconnect
        // eventSource?.close(); 
      };
    };

    connectSSE();

    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [currentCloudId]);

  // SSE Buffer Flush Effect
  useEffect(() => {
    const timer = setInterval(() => {
      if (vmStatusBuffer.current.size === 0) return;
      
      const updates = new Map(vmStatusBuffer.current);
      vmStatusBuffer.current.clear();
      
      setEcs(prev => {
        let hasChanges = false;
        const next = (prev || []).map((x:any)=> {
           const xiid = String(x?.InstanceId||x?.id||x?.metadata?.uid||'');
           if (updates.has(xiid)) {
              const json = updates.get(xiid);
              const statusStr = String(json?.status || '');
              const nodeName = String(json?.nodeName || '');
              const ips = Array.isArray(json?.ips) ? json.ips : [];
              
              // Deep merge logic or simple update
              // Here we update specific fields that change frequently
              const newStatus = { ...x.status, printableStatus: statusStr };
              if (x.status?.phase) newStatus.phase = statusStr;

              // Check for changes to avoid unnecessary re-renders
              if (
                 x.status?.printableStatus !== statusStr ||
                 x.nodeName !== nodeName ||
                 JSON.stringify(x.ips) !== JSON.stringify(ips)
              ) {
                 hasChanges = true;
                 return {
                    ...x,
                    status: newStatus,
                    nodeName: nodeName,
                    ips: ips,
                    // Also update Extra if needed
                    Extra: { ...(x.Extra || {}), NodeName: nodeName }
                 };
              }
           }
           return x;
        });
        return hasChanges ? next : prev;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // ==================== Permissions & Memoized Data (权限与缓存数据) ====================

  // 检查是否有查看云主机的权限
    // 权限点: clouds.console:read (VNC/Console 原子权限)
    const canReadEcs = useMemo(() => hasPermissionForAction(user?.permissions || [], 'clouds.console:read'), [user]);

  // 构建左侧树状导航数据
  // 结构: Provider Group (Root) -> Resource Pool (Level 1) -> VPCs (Level 2, only for current pool)
  const treeData = useMemo(() => {
    const cloudmapClouds = clouds.filter(c => String(c.config?.provider || '').toLowerCase().startsWith('cloudmap'));
    const harvesterClouds = clouds.filter(c => String(c.config?.provider || '').toLowerCase().startsWith('harvester'));

    // 辅助函数: 映射云资源池到树节点
    const mapCloudToNode = (c: CloudItem) => {
      const isCurrent = String(c.id) === String(currentCloudId);
      const children: any[] = [];
      
      // 如果是当前选中的资源池，则将 VPC 列表作为子节点展示
      if (isCurrent) {
        if (vpcs.length > 0) {
          children.push(...vpcs.map(v => {
            const vpcAlias = v.metadata?.annotations?.['tower.io/alias'];
            const vpcName = vpcAlias || v.alias || v.name || v.metadata?.name || v.id || 'Unknown';
            const vpcKey = v.metadata?.name || v.id || v.name || 'unknown';
            return {
              title: vpcName,
              key: `vpc-${vpcKey}`, // VPC 节点的 key 前缀
              icon: <ApartmentOutlined />,
              isLeaf: true
            };
          }));
        } else if (vpcLoading) {
          // 加载中占位节点，防止展开按钮消失
          children.push({
            title: '加载中...',
            key: `loading-${c.id}`,
            icon: <LoadingOutlined spin />,
            isLeaf: true,
            selectable: false,
            disabled: true
          });
        }
      }

      return {
        title: <span className="cloud-title">{c.name}</span>,
        key: String(c.id),
        icon: <CloudServerOutlined />,
        children: children.length > 0 ? children : undefined,
        isLeaf: children.length === 0
      };
    };

    const result: any[] = [];

    if (cloudmapClouds.length > 0) {
      result.push({
        title: 'Cloudmap',
        key: 'group-cloudmap',
        selectable: true,
        children: cloudmapClouds.map(mapCloudToNode)
      });
    }

    if (harvesterClouds.length > 0) {
      result.push({
        title: 'Harvester',
        key: 'group-harvester',
        selectable: true,
        children: harvesterClouds.map(mapCloudToNode)
      });
    }

    return result;
  }, [clouds, currentCloudId, vpcs, vpcLoading]);

  // ==================== Data Loading Functions (数据加载函数) ====================

  // 加载资源池列表
  const loadClouds = async () => {
    setCloudsLoading(true);
    try {
      const list: any[] = await fetchClouds();
      const arr = Array.isArray(list) ? list : [];
      // 过滤出 Cloudmap 和 Harvester 系列的资源池
      const filtered = arr.filter(c => {
        const pRaw = String(c?.config?.provider || '');
        const lower = pRaw.toLowerCase();
        return lower.startsWith('cloudmap') || lower.startsWith('harvester');
      });
      setClouds(filtered);
      
      // 自动选择资源池：优先选择第一个 Cloudmap 资源池，如果没有则选择其他资源池
      if (!currentCloudId && filtered.length > 0) {
        // 优先查找 Cloudmap 资源池
        const cloudmapCloud = filtered.find(c => {
          const pRaw = String(c?.config?.provider || '');
          return pRaw.toLowerCase().startsWith('cloudmap');
        });
        
        if (cloudmapCloud) {
          setCurrentCloudId(cloudmapCloud.id);
        } else {
          // 如果没有 Cloudmap，选择第一个其他资源池
          setCurrentCloudId(filtered[0].id);
        }
      } else if (currentCloudId && !filtered.find(c => String(c.id) === String(currentCloudId))) {
        // 当前选择的资源池无效，重新选择
        if (filtered.length > 0) {
          // 优先查找 Cloudmap 资源池
          const cloudmapCloud = filtered.find(c => {
            const pRaw = String(c?.config?.provider || '');
            return pRaw.toLowerCase().startsWith('cloudmap');
          });
          
          if (cloudmapCloud) {
            setCurrentCloudId(cloudmapCloud.id);
          } else {
            // 如果没有 Cloudmap，选择第一个其他资源池
            setCurrentCloudId(filtered[0].id);
          }
        } else {
          setCurrentCloudId(undefined);
        }
      }
      
      if (filtered.length === 0) {
        setError('当前未找到可用资源池 (Cloudmap/Harvester)，请先在"资源池管理"中创建');
      }
    } catch (e) {
      // ignore
    } finally {
      setCloudsLoading(false);
    }
  };

  // 加载命名空间列表
  const loadNamespaces = async (cloudId?: string) => {
    const cid = cloudId || currentCloudId;
    if (!cid || cid === 'all') return;
    try {
      const res = await fetchHarvesterNamespaces(cid);
      const list: any[] = Array.isArray(res?.data?.items) ? res.data.items : (Array.isArray(res?.items) ? res.items : []);
      setNamespaces(list);
    } catch (e: any) {
      console.error('[CloudConsole] loadNamespaces error:', e);
      setNamespaces([]);
    }
  };

  // 加载云主机 (ECS) 列表
  // 支持 Harvester (K8s CRD) 和 Standard Cloud (Aliyun, Huawei, etc.) 的数据格式
  const loadEcs = async (cloudId?: string, forceRefresh: boolean = false) => {
    const cid = cloudId || currentCloudId;
    if (!cid || cid === 'all') return;
    
    setLoading(true);
    setError(null);
    try {
      const json: any = await fetchCloudProviderEcs(cid, forceRefresh);
      
      // 兼容不同后端的返回格式:
      // 1. json.data: 标准数组
      // 2. json.data.Instances.Instance: 阿里云风格
      // 3. json.data.servers: OpenStack 风格
      // 4. json.data.InstanceSet: 腾讯云风格
      let list: any[] = [];
      if (Array.isArray(json?.data)) {
        list = json.data;
      } else if (json?.data?.Instances?.Instance) {
        list = json.data.Instances.Instance;
      } else if (json?.data?.servers) {
        list = json.data.servers;
      } else if (json?.data?.InstanceSet) {
        list = json.data.InstanceSet;
      }

      setCaps(json?.capabilities || {}); // 更新能力集 (如 isHarvester)
      setEcs(list);
    } catch (e: any) {
      console.error('[CloudConsole] loadEcs error:', e);
      setError(e?.message || '查询失败');
      setEcs([]);
    } finally {
      setLoading(false);
    }
  };

  // 加载虚拟卷 (PVC) 列表
  const loadPvcs = async (cloudId?: string) => {
    const cid = cloudId || currentCloudId;
    if (!cid || cid === 'all') return;

    setLoading(true);
    setError(null);
    try {
      const json = await fetchHarvesterVolumes(cid);
      const items: any[] = Array.isArray((json as any)?.data?.items) 
          ? (json as any).data.items 
          : (Array.isArray((json as any)?.items) ? (json as any).items : []);
      
      setPvcs(Array.isArray(items) ? items : []);
    } catch (e: any) {
      console.error('[CloudConsole] loadPvcs error:', e);
      setPvcs([]);
    } finally {
      setLoading(false);
    }
  };

  // 加载镜像列表
  const loadImages = async (cloudId?: string) => {
    const cid = cloudId || currentCloudId;
    if (!cid || cid === 'all') return;

    setLoading(true);
    setError(null);
    try {
      const json = await fetchHarvesterImages(cid);
      const items: any[] = Array.isArray((json as any)?.data?.items) 
          ? (json as any).data.items 
          : (Array.isArray((json as any)?.items) ? (json as any).items : []);
      
      setImages(Array.isArray(items) ? items : []);
    } catch (e: any) {
      console.error('[CloudConsole] loadImages error:', e);
      setImages([]);
    } finally {
      setLoading(false);
    }
  };

  // 加载模板列表
  const loadTemplates = async (cloudId?: string, force = false) => {
    const cid = cloudId || currentCloudId;
    if (!cid || cid === 'all') return;
    setLoading(true);
    try {
      const res = await fetchHarvesterTemplates(cid, force, false);
      setTemplates(res?.data?.items || []);
    } catch (e: any) {
      console.error('[CloudConsole] loadTemplates error:', e);
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  };

  // 加载存储类
  const loadStorageClasses = async (cloudId?: string) => {
    const cid = cloudId || currentCloudId;
    if (!cid || cid === 'all') return;
    setLoading(true);
    try {
      const res = await fetchHarvesterStorageClasses(cid);
      const list: any[] = Array.isArray((res as any)?.data?.items) ? (res as any).data.items : (Array.isArray((res as any)?.items) ? (res as any).items : []);
      setStorageClasses(Array.isArray(list) ? list : []);
    } catch (e: any) {
      console.error('[CloudConsole] loadStorageClasses error:', e);
      setStorageClasses([]);
    } finally {
      setLoading(false);
    }
  };

  // 加载 SSH 密钥列表
  const loadSshKeys = async (cloudId?: string) => {
    const cid = cloudId || currentCloudId;
    if (!cid || cid === 'all') return;
    setLoading(true);
    try {
      const res = await fetchHarvesterSshKeys(cid);
      setSshKeys(res?.data?.items || []);
    } catch (e: any) {
      console.error('[CloudConsole] loadSshKeys error:', e);
      setSshKeys([]);
    } finally {
      setLoading(false);
    }
  };

  // 加载快照列表
  const loadSnapshots = async (cloudId?: string) => {
    const cid = cloudId || currentCloudId;
    if (!cid || cid === 'all') return;
    setLoading(true);
    try {
      const res = await fetchHarvesterSnapshots(cid);
      setSnapshots(res?.data?.items || []);
    } catch (e: any) {
      console.error('[CloudConsole] loadSnapshots error:', e);
      setSnapshots([]);
    } finally {
      setLoading(false);
    }
  };

  // 加载备份列表
  const loadBackups = async (cloudId?: string) => {
    const cid = cloudId || currentCloudId;
    if (!cid || cid === 'all') return;
    setLoading(true);
    try {
      const res = await fetchHarvesterBackups(cid);
      setBackups(res?.data?.items || []);
    } catch (e: any) {
      console.error('[CloudConsole] loadBackups error:', e);
      setBackups([]);
    } finally {
      setLoading(false);
    }
  };

  // 加载定时备份策略
  const loadSchedules = async (cloudId?: string) => {
    const cid = cloudId || currentCloudId;
    if (!cid || cid === 'all') return;
    setLoading(true);
    try {
      const res = await fetchHarvesterScheduleVmBackups(cid);
      setSchedules(res?.data?.items || []);
    } catch (e: any) {
      console.error('[CloudConsole] loadSchedules error:', e);
      setSchedules([]);
    } finally {
      setLoading(false);
    }
  };

  // 加载 Cloud Init 模板
  const loadCloudInits = async (cloudId?: string) => {
    const cid = cloudId || currentCloudId;
    if (!cid || cid === 'all') return;
    setLoading(true);
    try {
      const res = await fetchHarvesterCloudInits(cid);
      setCloudInits(res?.data?.items || []);
    } catch (e: any) {
      console.error('[CloudConsole] loadCloudInits error:', e);
      setCloudInits([]);
    } finally {
      setLoading(false);
    }
  };

  // 加载 GPU 资源
  const loadGpus = async (cloudId?: string) => {
    const cid = cloudId || currentCloudId;
    if (!cid || cid === 'all') return;
    setLoading(true);
    try {
      const res = await fetchHarvesterGpuResources(cid);
      setGpus(res?.data?.items || []);
    } catch (e: any) {
      console.error('[CloudConsole] loadGpus error:', e);
      setGpus([]);
    } finally {
      setLoading(false);
    }
  };

  // 加载 IP 地址池
  const loadIPPools = async (cloudId?: string) => {
    const cid = cloudId || currentCloudId;
    if (!cid || cid === 'all') return;
    setLoading(true);
    try {
      const res = await fetchHarvesterIPPools(cid);
      setIPPools(res?.data?.items || []);
    } catch (e: any) {
      console.error('[CloudConsole] loadIPPools error:', e);
      setIPPools([]);
    } finally {
      setLoading(false);
    }
  };

  // 加载网络附件定义 (NADs) - 即扁平网络
  const loadNads = async (cloudId?: string) => {
    const cid = cloudId || currentCloudId;
    if (!cid || cid === 'all') return;

    setLoading(true);
    setError(null);
    try {
      const json = await apiRequest(`/api/clouds/${cid}/resources/nads`);
      if (json?.data?.items) {
          setNads(json.data.items);
      } else {
          setNads([]);
      }
    } catch (e: any) {
      console.error('[CloudConsole] loadNads error:', e);
      setNads([]);
    } finally {
      setLoading(false);
    }
  };

  // 加载 VPC 和 子网
  const loadVpcsAndSubnets = async (cloudId?: string, force: boolean = false) => {
    const cid = cloudId || currentCloudId;
    if (!cid || cid === 'all') return;
    setVpcLoading(true);
    try {
      const query = force ? '?force=true' : '';
      const [vpcsJson, subnetsJson] = await Promise.all([
        apiRequest(`/api/clouds/${cid}/resources/vpcs${query}`),
        apiRequest(`/api/clouds/${cid}/resources/subnets${query}`)
      ]);
      setVpcs(vpcsJson?.data?.items || []);
      setSubnets(subnetsJson?.data?.items || []);
    } catch (e: any) {
      console.error('[CloudConsole] loadVpcsAndSubnets error:', e);
      setVpcs([]);
      setSubnets([]);
    } finally {
      setVpcLoading(false);
    }
  };

  // 加载负载均衡 (Harvester LoadBalancers)
  const loadLbrules = async (cloudId?: string) => {
    const cid = cloudId || currentCloudId;
    if (!cid || cid === 'all') return;
    setLoading(true);
    setError(null);
    try {
      // 使用 Harvester 专用的 LB 接口
      const json = await fetchHarvesterLoadBalancers(cid);
      // 兼容不同的返回格式: { data: { items: [...] } } 或 { items: [...] } 或直接数组
      const items: any[] = Array.isArray(json?.data?.items) 
        ? json.data.items 
        : (Array.isArray(json?.items) ? json.items : (Array.isArray(json) ? json : []));
      setLbrules(items);
    } catch (e: any) {
      console.error('[CloudConsole] loadLbrules error:', e);
      setLbrules([]);
    } finally {
      setLoading(false);
    }
  };

  // 加载 EIP 列表
  const loadEips = async (cloudId?: string) => {
    const cid = cloudId || currentCloudId;
    if (!cid || cid === 'all') return;
    setLoading(true);
    try {
      const res = await fetchCloudProviderOvnEips(cid);
      setEips(res?.data?.items || []);
    } catch (e: any) {
      console.error('[CloudConsole] loadEips error:', e);
      setEips([]);
    } finally {
      setLoading(false);
    }
  };

  // 加载 FIP 列表
  const loadFips = async (cloudId?: string) => {
    const cid = cloudId || currentCloudId;
    if (!cid || cid === 'all') return;
    setLoading(true);
    try {
      const res = await fetchCloudProviderOvnFips(cid);
      setFips(res?.data?.items || []);
    } catch (e: any) {
      console.error('[CloudConsole] loadFips error:', e);
      setFips([]);
    } finally {
      setLoading(false);
    }
  };

  // 加载 SNAT 规则
  const loadSnatRules = async (cloudId?: string) => {
    const cid = cloudId || currentCloudId;
    if (!cid || cid === 'all') return;
    setLoading(true);
    try {
      const res = await fetchCloudProviderOvnSnatRules(cid);
      setSnatRules(res?.data?.items || []);
    } catch (e: any) {
      console.error('[CloudConsole] loadSnatRules error:', e);
      setSnatRules([]);
    } finally {
      setLoading(false);
    }
  };

  // 加载 DNAT 规则
  const loadDnatRules = async (cloudId?: string) => {
    const cid = cloudId || currentCloudId;
    if (!cid || cid === 'all') return;
    setLoading(true);
    try {
      const res = await fetchCloudProviderOvnDnatRules(cid);
      setDnatRules(res?.data?.items || []);
    } catch (e: any) {
      console.error('[CloudConsole] loadDnatRules error:', e);
      setDnatRules([]);
    } finally {
      setLoading(false);
    }
  };

  // ==================== Effects (副作用) ====================

  // 初始化: 加载资源池
  useEffect(() => {
    loadClouds();
  }, []);

  // 当选中的资源池 (currentCloudId) 变化时:
  // 1. 加载该资源池的 VPC 和子网数据 (用于构建左侧树)
  // 2. 展开左侧树的对应节点
  useEffect(() => {
    if (currentCloudId) {
      // 立即重置旧数据，避免 UI 渲染旧状态或发起错误请求
      setEcs([]);
      setNamespaces([]);
      setPvcs([]);
      setImages([]);
      setTemplates([]);
      setSshKeys([]);
      setSnapshots([]);
      setBackups([]);
      setSchedules([]);
      setCloudInits([]);
      setGpus([]);
      setIPPools([]);
      setEips([]);
      setFips([]);
      setSnatRules([]);
      setDnatRules([]);
      setNads([]);
      setLbrules([]);
      setStorageClasses([]);
      setVpcs([]);
      setSubnets([]);
      
      // 重置 Harvester 导航状态
      setHarvesterCategory('compute');
      setHarvesterResource('vm');

      loadVpcsAndSubnets(currentCloudId);
      // Ensure the current cloud node is expanded to show VPCs
      setExpandedKeys(prev => {
        const newKeys = new Set(prev);
        const cloud = clouds.find(c => String(c.id) === String(currentCloudId));
        const provider = String(cloud?.config?.provider || '').toLowerCase();
        
        if (provider.startsWith('cloudmap')) newKeys.add('group-cloudmap');
        if (provider.startsWith('harvester')) newKeys.add('group-harvester');
        
        // newKeys.add(currentCloudId);
        return Array.from(newKeys);
      });
    }
  }, [currentCloudId, clouds]);

  // 计算当前资源池是否为 Harvester (Derived State)
  const isHarvester = useMemo(() => {
    if (!currentCloudId) return false;
    const cloud = clouds.find(c => String(c.id) === String(currentCloudId));
    
    // Diagnostic log for ID mismatch debugging
    if (!cloud && clouds.length > 0) {
      console.warn(`[CloudConsole] isHarvester check: Cloud not found for id '${currentCloudId}' (type: ${typeof currentCloudId}). Available IDs:`, clouds.map(c => `${c.id}(${typeof c.id})`));
    }

    const provider = String(cloud?.config?.provider || '').toLowerCase();
    return provider.startsWith('harvester');
  }, [currentCloudId, clouds]);

  const isCloudmap = useMemo(() => {
    if (!currentCloudId) return false;
    const cloud = clouds.find(c => String(c.id) === String(currentCloudId));
    
    if (!cloud && clouds.length > 0) {
      console.warn(`[CloudConsole] isCloudmap check: Cloud not found for id '${currentCloudId}' (type: ${typeof currentCloudId}). Available IDs:`, clouds.map(c => `${c.id}(${typeof c.id})`));
    }

    const provider = String(cloud?.config?.provider || '').toLowerCase();
    return provider.startsWith('cloudmap');
  }, [currentCloudId, clouds]);

  // Harvester/Cloudmap 资源按需加载逻辑
  // 监听 harvesterResource 和 currentCloudId 的变化，仅加载当前视图所需的数据
  useEffect(() => {
    if (!currentCloudId || (!isHarvester && !isCloudmap)) return;

    // 无论哪个 Tab，VM 列表和 Namespace 都是基础数据 (VM 列表可能在其他 Tab 也需要引用，如 Volume 挂载)
    // 且 VM 列表通常是首页，所以始终检查加载
    if (ecs.length === 0 && !loading) loadEcs(currentCloudId);
    if (namespaces.length === 0) loadNamespaces(currentCloudId);

    switch (harvesterResource) {
      case 'vm':
        // VM 和 Namespace 已在上方处理
        // [修复] VM 列表依赖 PVC 数据 (用于显示扩容状态、CloudMap 启动检查等)，必须加载
        if (pvcs.length === 0) loadPvcs(currentCloudId);
        // [修复] VM 列表依赖镜像数据 (用于显示镜像名称)，必须加载
        if (images.length === 0) loadImages(currentCloudId);
        break;
      case 'image':
        loadImages(currentCloudId);
        break;
      case 'ssh':
        loadSshKeys(currentCloudId);
        break;
      case 'cloudinit':
        loadCloudInits(currentCloudId);
        break;
      case 'gpu':
        loadGpus(currentCloudId);
        break;
      case 'volume':
        loadPvcs(currentCloudId);
        loadStorageClasses(currentCloudId);
        break;
      case 'volume-snapshot':
        loadSnapshots(currentCloudId);
        break;
      case 'snapshot':
      case 'backup':
        loadBackups(currentCloudId);
        break;
      case 'schedule':
        loadSchedules(currentCloudId);
        break;
      case 'nad':
        loadNads(currentCloudId);
        break;
      case 'lb':
        loadLbrules(currentCloudId);
        break;
      case 'ippool':
        loadIPPools(currentCloudId);
        break;
      case 'vpc-subnet':
        // VPC 数据通常已加载，但可强制刷新
        loadVpcsAndSubnets(currentCloudId);
        break;
      case 'eip':
        loadEips(currentCloudId);
        break;
      case 'fip':
        loadFips(currentCloudId);
        break;
      case 'snat':
        loadSnatRules(currentCloudId);
        break;
      case 'dnat':
        loadDnatRules(currentCloudId);
        break;
      case 'template':
        loadTemplates(currentCloudId);
        break;
    }
  }, [
    currentCloudId,
    isHarvester,
    isCloudmap,
    harvesterResource,
    ecs.length,
    namespaces.length,
    pvcs.length,
    images.length,
  ]);

  // 当 Tab 页签切换或资源池变化时，加载对应 Tab 的数据 (非 Harvester/Cloudmap 场景)
  useEffect(() => {
    if (!currentCloudId || isHarvester || isCloudmap) return; // Harvester/Cloudmap 走上面的按需加载逻辑
    switch (activeTab) {
      case 'ecs':
        loadEcs(currentCloudId);
        break;
      case 'vpc':
        // VPC 数据已由上面的 effect 加载，此处无需重复加载
        // 用户若需刷新，可使用界面上的刷新按钮
        break;
      case 'lb':
        loadLbrules(currentCloudId);
        break;
      case 'pvc':
        if (caps?.isHarvester) loadPvcs(currentCloudId);
        break;
      case 'image':
        if (caps?.isHarvester) loadImages(currentCloudId);
        break;
      case 'template':
        if (caps?.isHarvester) loadTemplates(currentCloudId);
        break;
      case 'ssh':
        if (caps?.isHarvester) loadSshKeys(currentCloudId);
        break;
      case 'nad':
        if (caps?.isHarvester) loadNads(currentCloudId);
        break;
    }
  }, [currentCloudId, activeTab, caps?.isHarvester, isHarvester, isCloudmap]);



  // ==================== Render Helpers (渲染辅助) ====================
  
  const namespacesOptions = useMemo(() => {
    const s = new Set<string>();
    (namespaces || []).forEach((n:any)=>{ 
        const ns = n?.metadata?.name || n?.name || '';
        if (ns && !isSystemNamespace(ns)) s.add(ns); 
    });
    return Array.from(s).sort();
  }, [namespaces]);

  const nodesOptions = useMemo(() => {
    return Array.from(new Set(ecs.map(r => r?.vmi?.status?.nodeName || r?.status?.nodeName || r?.nodeName || r?.Extra?.NodeName).filter(Boolean))) as string[];
  }, [ecs]);

  // 页面布局:
  // - PageContainer: 统一的页面容器，提供标题和面包屑
  // - cloud-console-root: Flex 布局容器
  //   - Sidebar: 左侧固定宽度的树状导航
  //   - Content: 右侧自适应宽度的内容区域 (包含 VPC 详情或 Tabs)
  return (
    <PageContainer
      asCard={false}
      breadcrumb={[]}
      title="云主机控制台"
      subtitle="统一管理 Cloudmap/Harvester 云环境下的云主机资源，支持查看、远程连接、电源管理等操作"
      style={{ height: '100%' }}
    >
      <div className="cloud-console-root" style={{ position: 'relative', gap: sidebarCollapsed ? 0 : 16 }}>
        {/* ==================== Sidebar (左侧导航: 资源池/VPC) ==================== */}
        <div 
          className="cloud-console-sidebar" 
          style={{ 
            padding: sidebarCollapsed ? 0 : '12px', 
            backgroundColor: '#fff',
            width: sidebarCollapsed ? 0 : 280,
            minWidth: sidebarCollapsed ? 0 : 280,
            opacity: sidebarCollapsed ? 0 : 1,
            overflow: 'hidden',
            transition: 'all 0.3s cubic-bezier(0.23, 1, 0.32, 1)',
            borderRight: sidebarCollapsed ? 'none' : '1px solid #f0f0f0',
            flexShrink: 0
          }}
        >
          {/* 侧边栏标题与折叠按钮 */}


          <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center' }}>
            <Input 
              placeholder="搜索资源池" 
              allowClear 
              suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
              onChange={(e) => setKeyword(e.target.value)}
              style={{ marginRight: 8 }}
            />
           <Button 
              type="default" 
              size="middle" 
              icon={<LeftOutlined style={{ color: 'rgba(0,0,0,.45)' }} />} 
              onClick={() => setSidebarCollapsed(true)} 
            />
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {/* Loading 状态 */}
            {cloudsLoading ? (
              <div style={{ padding: '20px', textAlign: 'center' }}>
                <Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />} />
              </div>
            ) : (
              /* Tree 组件 */
              <Tree
                className="cloud-console-tree"
                blockNode
                showIcon
                treeData={treeData}
                expandedKeys={expandedKeys}
                onExpand={(keys: any) => {
                  setExpandedKeys(keys);
                }}
                selectedKeys={selectedVpc ? [`vpc-${selectedVpc}`] : (currentCloudId ? [currentCloudId] : [])}
                onSelect={(keys) => {
                  // 处理树节点点击事件
                  // 1. 点击 VPC: 切换到 VPC 详情视图
                  // 2. 点击资源池: 切换到资源列表视图 (Tabs)
                  if (keys.length > 0) {
                    const key = keys[0] as string;
                    // 点击 VPC 节点
                    if (key.startsWith('vpc-')) {
                       // 选中 VPC 时，右侧显示 VPC 详情，不再通过 Tab 切换
                       setSelectedVpc(key.replace(/^vpc-/, ''));
                    } else if (key === 'group-cloudmap' || key === 'group-harvester') {
                       // 点击一级目录节点: 切换展开/收起状态
                       setExpandedKeys((prev) => {
                         if (prev.includes(key)) {
                           return prev.filter((k) => k !== key);
                         }
                         return [...prev, key];
                       });
                    } else if (key.startsWith('loading-')) {
                      // 加载中节点，忽略点击
                    } else {
                      // 点击资源池节点 (二级目录)
                      
                      // 1. 如果点击的是当前已选中的资源池，则切换折叠状态
                      if (key === currentCloudId) {
                        setSelectedVpc(null);
                        setExpandedKeys((prev) => {
                           if (prev.includes(key)) {
                             return prev.filter(k => k !== key);
                           }
                           return [...prev, key];
                        });
                      } else {
                        // 2. 如果点击的是新资源池
                        setCurrentCloudId(key);
                        setSelectedVpc(null);
                        // 自动展开新选中的资源池
                        setExpandedKeys((prev) => {
                            if (!prev.includes(key)) {
                                return [...prev, key];
                            }
                            return prev;
                        });
                      }
                    }
                  }
                }}
                height={600} // Virtual scroll height
              />
            )}
          </div>
        </div>

        {/* 侧边栏展开按钮 (当侧边栏收起时显示) */}
        <div 
          style={{ 
            position: 'absolute', 
            left: sidebarCollapsed ? 0 : -100, // 移出视口以隐藏
            top: 124,
            zIndex: 100,
            transition: 'left 0.3s cubic-bezier(0.23, 1, 0.32, 1)',
            opacity: sidebarCollapsed ? 1 : 0,
            pointerEvents: sidebarCollapsed ? 'auto' : 'none'
          }}
        >
           <Button 
             icon={<RightOutlined style={{ color: 'rgba(0,0,0,.45)' }} />} 
             onClick={() => setSidebarCollapsed(false)}
             style={{ 
               borderLeft: 0, 
               borderTopLeftRadius: 0, 
               borderBottomLeftRadius: 0,
               boxShadow: '1px 0 8px rgba(0,0,0,0.15)',
               width: 20,
               minWidth: 20,
               padding: 0,
               height: 32
             }}
             title="展开侧边栏"
           />
        </div>

        {/* ==================== Content (右侧内容区域) ==================== */}
        <div className="cloud-console-content">
          <div className="cloud-console-content-scroll">
            {error && <Alert message={error} type="error" showIcon style={{ marginBottom: 16 }} />}

            {/* 视图切换逻辑: 选中 VPC 时显示详情，否则显示资源池 Tabs */}
            {selectedVpc ? (
                // 场景 A: 选中了 VPC，显示 VPC 详情视图
                <CloudConsoleVpcDetail
                    cloudId={currentCloudId || ''}
                    vpcName={selectedVpc}
                    vpcs={vpcs}
                    subnets={subnets}
                    ecs={ecs}
                    images={images}
                    volumes={pvcs}
                    snapshots={snapshots}
                    backups={backups}
                    storageClasses={storageClasses}
                    loading={loading}
                    isHarvester={!!caps?.isHarvester}
                    onRefresh={() => loadEcs(currentCloudId, true)}
                    onRefreshVolumes={() => loadPvcs(currentCloudId)}
                    onRefreshSnapshots={() => loadSnapshots(currentCloudId)}
                    onRefreshBackups={() => loadBackups(currentCloudId)}
                    onOpenReconfigure={(vm) => {
                      setReconfVm(vm);
                      setReconfVisible(true);
                    }}
                    onStart={handleStart}
                    onStop={handleStop}
                    onReboot={handleReboot}
                    onSoftReboot={handleSoftReboot}
                    onPause={handlePause}
                    onUnpause={handleUnpause}
                    onDelete={handleDelete}
                    bordered={false}
                />
            ) : (
                // 场景 B: 选中了资源池
                isCloudmap ? (
                  <CloudConsoleHarvester
                    cloudId={currentCloudId || ''}
                    vms={ecs}
                    namespaces={namespaces}
                    templates={templates}
                    sshKeys={sshKeys}
                    volumes={pvcs}
                    images={images}
                    snapshots={snapshots}
                    backups={backups}
                    schedules={schedules}
                    cloudInits={cloudInits}
                    gpus={gpus}
                    ippools={ippools}
                    nads={nads}
                    lbs={lbrules}
                    vpcs={vpcs}
                    subnets={subnets}
                    eips={eips}
                    fips={fips}
                    snatRules={snatRules}
                    dnatRules={dnatRules}
                    storageClasses={storageClasses}
                    loading={loading}
                    
                    namespacesOptions={namespacesOptions}
                    nodesOptions={nodesOptions}
                    nsValue={nsValue}
                    nodeValue={nodeValue}
                    onNsChange={setNsValue}
                    onNodeChange={setNodeValue}
                    
                    // Controlled Navigation State
                    activeCategory={harvesterCategory}
                    setActiveCategory={setHarvesterCategory}
                    activeResource={harvesterResource}
                    setActiveResource={setHarvesterResource}
                    
                    onRefreshVms={() => {
                      loadEcs(currentCloudId, true);
                      loadPvcs(currentCloudId);
                    }}
                    onRefreshTemplates={(force) => loadTemplates(currentCloudId, !!force)}
                    onRefreshSshKeys={() => loadSshKeys(currentCloudId)}
                    onRefreshVolumes={() => loadPvcs(currentCloudId)}
                    onRefreshImages={() => loadImages(currentCloudId)}
                    onRefreshSnapshots={() => loadSnapshots(currentCloudId)}
                    onRefreshBackups={() => loadBackups(currentCloudId)}
                    onRefreshSchedules={() => loadSchedules(currentCloudId)}
                    onRefreshCloudInits={() => loadCloudInits(currentCloudId)}
                    onRefreshGpus={() => loadGpus(currentCloudId)}
                    onRefreshIPPools={() => loadIPPools(currentCloudId)}
                    onRefreshNads={() => loadNads(currentCloudId)}
                    onRefreshLbs={() => loadLbrules(currentCloudId)}
                    onRefreshVpcs={() => loadVpcsAndSubnets(currentCloudId, true)}
                    onRefreshEips={() => loadEips(currentCloudId)}
                    onRefreshFips={() => loadFips(currentCloudId)}
                    onRefreshSnatRules={() => loadSnatRules(currentCloudId)}
                    onRefreshDnatRules={() => loadDnatRules(currentCloudId)}
                    
                    onOpenReconfigure={(vm) => {
                      setReconfVm(vm);
                      setReconfVisible(true);
                    }}
                    onStart={handleStart}
                    onStop={handleStop}
                    onReboot={handleReboot}
                    onSoftReboot={handleSoftReboot}
                    onPause={handlePause}
                    onUnpause={handleUnpause}
                    onDelete={handleDelete}
                    bordered={false}
                  />
                ) : isHarvester ? (
                  <CloudConsoleHarvester
                    cloudId={currentCloudId || ''}
                    vms={ecs}
                    namespaces={namespaces}
                    templates={templates}
                    sshKeys={sshKeys}
                    volumes={pvcs}
                    images={images}
                    snapshots={snapshots}
                    backups={backups}
                    schedules={schedules}
                    cloudInits={cloudInits}
                    gpus={gpus}
                    ippools={ippools}
                    nads={nads}
                    lbs={lbrules}
                    vpcs={vpcs}
                    subnets={subnets}
                    eips={eips}
                    fips={fips}
                    snatRules={snatRules}
                    dnatRules={dnatRules}
                    storageClasses={storageClasses}
                    loading={loading}
                    
                    namespacesOptions={namespacesOptions}
                    nodesOptions={nodesOptions}
                    nsValue={nsValue}
                    nodeValue={nodeValue}
                    onNsChange={setNsValue}
                    onNodeChange={setNodeValue}
                    
                    // Controlled Navigation State
                    activeCategory={harvesterCategory}
                    setActiveCategory={setHarvesterCategory}
                    activeResource={harvesterResource}
                    setActiveResource={setHarvesterResource}
                    
                    onRefreshVms={() => {
                      loadEcs(currentCloudId, true);
                      loadPvcs(currentCloudId);
                    }}
                    onRefreshTemplates={(force) => loadTemplates(currentCloudId, !!force)}
                    onRefreshSshKeys={() => loadSshKeys(currentCloudId)}
                    onRefreshVolumes={() => loadPvcs(currentCloudId)}
                    onRefreshImages={() => loadImages(currentCloudId)}
                    onRefreshSnapshots={() => loadSnapshots(currentCloudId)}
                    onRefreshBackups={() => loadBackups(currentCloudId)}
                    onRefreshSchedules={() => loadSchedules(currentCloudId)}
                    onRefreshCloudInits={() => loadCloudInits(currentCloudId)}
                    onRefreshGpus={() => loadGpus(currentCloudId)}
                    onRefreshIPPools={() => loadIPPools(currentCloudId)}
                    onRefreshNads={() => loadNads(currentCloudId)}
                    onRefreshLbs={() => loadLbrules(currentCloudId)}
                    onRefreshVpcs={() => loadVpcsAndSubnets(currentCloudId, true)}
                    onRefreshEips={() => loadEips(currentCloudId)}
                    onRefreshFips={() => loadFips(currentCloudId)}
                    onRefreshSnatRules={() => loadSnatRules(currentCloudId)}
                    onRefreshDnatRules={() => loadDnatRules(currentCloudId)}
                    
                    onOpenReconfigure={(vm) => {
                      setReconfVm(vm);
                      setReconfVisible(true);
                    }}
                    onStart={handleStart}
                    onStop={handleStop}
                    onReboot={handleReboot}
                    onSoftReboot={handleSoftReboot}
                    onPause={handlePause}
                    onUnpause={handleUnpause}
                    onDelete={handleDelete}
                    bordered={false}
                  />
                ) : cloudsLoading ? (
                  <div style={{ padding: 100, textAlign: 'center' }}>
                    <Spin size="large" />
                    <div style={{ marginTop: 8 }}>加载资源池...</div>
                  </div>
                ) : (
                  <div style={{ padding: 24, textAlign: 'center' }}>
                    <Alert
                      message="暂不支持的云平台类型"
                      description={`当前资源池类型 (${clouds.find(c => c.id === currentCloudId)?.config?.provider || 'Unknown'}) 暂不支持控制台视图。`}
                      type="info"
                      showIcon
                      style={{ maxWidth: 600, margin: '0 auto' }}
                    />
                  </div>
                )
            )}
            
            {reconfVisible && (
              <VmReconfigureModal
                open={reconfVisible}
                onClose={() => setReconfVisible(false)}
                record={reconfVm}
                cloudId={currentCloudId || ''}
                onOk={() => {
                  setReconfVisible(false);
                  loadEcs(currentCloudId, true);
                }}
              />
            )}
          </div>
        </div>
      </div>
    </PageContainer>
  );
};

export default CloudConsolePage;
