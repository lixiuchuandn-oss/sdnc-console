import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { Select, Alert, App, Space, Spin, Menu, Empty } from 'antd';
import type { MenuProps } from 'antd';
import {
  ApartmentOutlined,
  AppstoreOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  NodeIndexOutlined,
} from '@ant-design/icons';
import PageContainer from '../../../components/PageContainer';
import { useAuth } from '../../../contexts/AuthContext';
import { isSystemNamespace } from '../../../utils/harvesterUtils';
import { fetchHarvesterNamespaces, fetchHarvesterTemplates, fetchHarvesterSshKeys, fetchHarvesterSnapshots, fetchHarvesterBackups, fetchHarvesterScheduleVmBackups, fetchHarvesterCloudInits, fetchHarvesterGpuResources, fetchHarvesterStorageClasses, fetchCloudProviderOvnEips, fetchCloudProviderOvnSnatRules, fetchCloudProviderOvnDnatRules, fetchHarvesterVolumes, fetchHarvesterImages, fetchKubeOvnVpcs, fetchKubeOvnSubnets } from '../../../services/harvesterApi';
import {
  fetchClouds,
  fetchCloudProviderEcs,
  API_BASE_URL,
  startCloudProviderEcs,
  stopCloudProviderEcs,
  rebootCloudProviderEcs,
  softRebootCloudProviderEcs,
  pauseCloudProviderEcs,
  unpauseCloudProviderEcs,
  deleteCloudProviderEcs,
} from '../../../services/api';
import { getToken } from '../../../utils/tokenStorage';
import './CloudConsole.css';
import CloudConsoleMainPanel, { type CloudConsoleLeftNavScope } from './CloudConsoleMainPanel';
import VmReconfigureModal from '../Harvester/modals/VmReconfigureModal';
import { useLicense } from '../../../contexts/LicenseContext';
import { shouldMergePublicScenarioForTenantConsole } from './cloudConsoleTenantPublicScope';
import { useCloudConsoleProHeaderSlot } from './CloudConsoleProHeaderSlotContext';

type CloudItem = { id: string; name: string; region?: string; type?: string; config?: any; status?: string };

/** 左侧产品导航（与 CloudConsoleMainPanel.leftNavScope 联动） */
type ConsoleLeftNavKey = 'host' | 'container' | 'flat' | 'vpc' | 'rds';

/**
 * 云主机控制台：仅面向 Cloudmap 资源池的快捷管理界面（不再承载多云/非 Cloudmap 分支）。
 */
const CloudConsolePage: React.FC = () => {
  const { user } = useAuth();
  const { message } = App.useApp();
  const { hasFeature } = useLicense();
  const ovnVpcEnabled = hasFeature('network.ovn.vpc');

  /** 租户控制台：为 GET 附加 mergePublicScenarioNamespaces；非租户不传（后端保持兼容） */
  const isTenantConsole = useMemo(
    () =>
      user?.role === 'tenant' ||
      (!!user?.tenantId && String(user?.role ?? '') !== 'sase_device'),
    [user],
  );
  const mergeTenantPublicScope = useCallback(
    (merge: boolean): boolean | undefined => (isTenantConsole ? merge : undefined),
    [isTenantConsole],
  );
  
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
  const [eips, setEips] = useState<any[]>([]);            // EIP (Harvester VPC)
  const [snatRules, setSnatRules] = useState<any[]>([]);  // SNAT 规则 (Harvester VPC)
  const [dnatRules, setDnatRules] = useState<any[]>([]);  // DNAT 规则 (Harvester VPC)
  const [vpcs, setVpcs] = useState<any[]>([]);      // VPC 列表
  const [subnets, setSubnets] = useState<any[]>([]); // 子网列表
  const [storageClasses, setStorageClasses] = useState<any[]>([]); // 存储类
  
  // UI 状态
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const CONSOLE_REFRESH_KEY = 'cloud_console_refresh_after_create';

  /** 主面板导航：类目 + 资源 key（由 CloudConsoleMainPanel 消费） */
  const [harvesterCategory, setHarvesterCategory] = useState<string>('compute');
  const [harvesterResource, setHarvesterResource] = useState<string>('vm');

  // VmSection specific state
  const [nsValue, setNsValue] = useState<string | undefined>(undefined);
  const [nodeValue, setNodeValue] = useState<string | undefined>(undefined);
  const [reconfVisible, setReconfVisible] = useState(false);
  const [reconfVm, setReconfVm] = useState<any>(null);

  const [consoleLeftNavKey, setConsoleLeftNavKey] = useState<ConsoleLeftNavKey>('host');

  const vmStatusBuffer = useRef(new Map<string, any>());

  const leftNavMenuItems: MenuProps['items'] = useMemo(
    () => [
      { key: 'host', icon: <CloudServerOutlined />, label: '云主机' },
      { key: 'container', icon: <AppstoreOutlined />, label: '容器' },
      { key: 'flat', icon: <NodeIndexOutlined />, label: '扁平网络' },
      { key: 'vpc', icon: <ApartmentOutlined />, label: 'VPC网络' },
      { key: 'rds', icon: <DatabaseOutlined />, label: '云RDS' },
    ],
    [],
  );

  const handleLeftNavClick = useCallback<NonNullable<MenuProps['onClick']>>((e) => {
    const key = e.key as ConsoleLeftNavKey;
    setConsoleLeftNavKey(key);
    if (key === 'host') {
      setHarvesterCategory('compute');
      setHarvesterResource('vm');
    } else if (key === 'flat') {
      setHarvesterCategory('flatnet');
      setHarvesterResource('flat-subnet');
    } else if (key === 'vpc') {
      setHarvesterCategory('vpc-net');
      setHarvesterResource('vpc-subnet');
    }
  }, []);

  /** 当前选中资源池是否为 Cloudmap（列表已过滤为仅 Cloudmap，此处用于行为分支） */
  const isCloudmap = useMemo(() => {
    if (!currentCloudId) return false;
    const cloud = clouds.find((c) => String(c.id) === String(currentCloudId));
    if (!cloud && clouds.length > 0) {
      console.warn(
        `[CloudConsole] 资源池 id 未在列表中: '${currentCloudId}'，可选:`,
        clouds.map((c) => `${c.id}(${typeof c.id})`),
      );
    }
    return String(cloud?.config?.provider ?? '')
      .toLowerCase()
      .startsWith('cloudmap');
  }, [currentCloudId, clouds]);

  // ---------- VM 电源与生命周期 ----------
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

  // ---------- SSE：VM 列表推送 ----------
  useEffect(() => {
    if (!currentCloudId) return;
    // Cloudmap 下 VM 列表实时更新（与资源池绑定）
    
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

      eventSource.onerror = () => {
        /* 不断开，由浏览器自动重连 */
      };
    };

    connectSSE();

    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [currentCloudId]);

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

  // ---------- 数据加载（按资源类型） ----------

  // 加载资源池列表
  const loadClouds = async () => {
    setCloudsLoading(true);
    try {
      const list: any[] = await fetchClouds();
      const arr = Array.isArray(list) ? list : [];
      const filtered = arr.filter((c) => {
        const pRaw = String(c?.config?.provider || '');
        return pRaw.toLowerCase().startsWith('cloudmap');
      });
      setClouds(filtered);

      if (!currentCloudId && filtered.length > 0) {
        setCurrentCloudId(filtered[0].id);
      } else if (currentCloudId && !filtered.find((c) => String(c.id) === String(currentCloudId))) {
        setCurrentCloudId(filtered.length > 0 ? filtered[0].id : undefined);
      }

      if (filtered.length === 0) {
        setError('当前未找到 Cloudmap 资源池，请先在「资源池管理」中创建');
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
      const res = await fetchHarvesterNamespaces(cid, false, false, false, mergeTenantPublicScope(false));
      const list: any[] = Array.isArray(res?.data?.items) ? res.data.items : (Array.isArray(res?.items) ? res.items : []);
      setNamespaces(list);
    } catch (e: any) {
      console.error('[CloudConsole] loadNamespaces error:', e);
      setNamespaces([]);
    }
  };

  // 加载云主机列表（Cloudmap 返回 K8s/VM 风格数据，保留多形态解析以兼容后端）
  const loadEcs = async (cloudId?: string, forceRefresh: boolean = false) => {
    const cid = cloudId || currentCloudId;
    if (!cid || cid === 'all') return;
    
    setLoading(true);
    setError(null);
    try {
      const json: any = await fetchCloudProviderEcs(cid, forceRefresh, mergeTenantPublicScope(false));
      
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
  const loadPvcs = async (cloudId?: string, force: boolean = false) => {
    const cid = cloudId || currentCloudId;
    if (!cid || cid === 'all') return;

    setLoading(true);
    setError(null);
    try {
      const json = await fetchHarvesterVolumes(cid, force, force, mergeTenantPublicScope(false));
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
  const loadImages = async (cloudId?: string, force: boolean = false) => {
    const cid = cloudId || currentCloudId;
    if (!cid || cid === 'all') return;

    setLoading(true);
    setError(null);
    try {
      const json = await fetchHarvesterImages(
        cid,
        force,
        false,
        mergeTenantPublicScope(shouldMergePublicScenarioForTenantConsole(harvesterCategory, harvesterResource)),
      );
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
      const res = await fetchHarvesterTemplates(
        cid,
        force,
        false,
        mergeTenantPublicScope(shouldMergePublicScenarioForTenantConsole(harvesterCategory, harvesterResource)),
      );
      setTemplates(res?.data?.items || []);
    } catch (e: any) {
      console.error('[CloudConsole] loadTemplates error:', e);
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  };

  // 加载存储类
  const loadStorageClasses = async (cloudId?: string, force: boolean = false, skipSync: boolean = false) => {
    const cid = cloudId || currentCloudId;
    if (!cid || cid === 'all') return;
    setLoading(true);
    try {
      const res = await fetchHarvesterStorageClasses(cid, force, skipSync, mergeTenantPublicScope(false));
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
      const res = await fetchHarvesterSshKeys(cid, false, false, mergeTenantPublicScope(false));
      setSshKeys(res?.data?.items || []);
    } catch (e: any) {
      console.error('[CloudConsole] loadSshKeys error:', e);
      setSshKeys([]);
    } finally {
      setLoading(false);
    }
  };

  // 加载快照列表
  const loadSnapshots = async (cloudId?: string, force: boolean = false) => {
    const cid = cloudId || currentCloudId;
    if (!cid || cid === 'all') return;
    setLoading(true);
    try {
      const res = await fetchHarvesterSnapshots(cid, force, false, mergeTenantPublicScope(false));
      setSnapshots(res?.data?.items || []);
    } catch (e: any) {
      console.error('[CloudConsole] loadSnapshots error:', e);
      setSnapshots([]);
    } finally {
      setLoading(false);
    }
  };

  // 加载备份列表
  const loadBackups = async (cloudId?: string, force: boolean = false) => {
    const cid = cloudId || currentCloudId;
    if (!cid || cid === 'all') return;
    setLoading(true);
    try {
      const res = await fetchHarvesterBackups(cid, force, false, mergeTenantPublicScope(false));
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
      const res = await fetchHarvesterScheduleVmBackups(cid, false, false, mergeTenantPublicScope(false));
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
      const res = await fetchHarvesterCloudInits(cid, false, mergeTenantPublicScope(false));
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
      const res = await fetchHarvesterGpuResources(cid, false, mergeTenantPublicScope(false));
      setGpus(res?.data?.items || []);
    } catch (e: any) {
      console.error('[CloudConsole] loadGpus error:', e);
      setGpus([]);
    } finally {
      setLoading(false);
    }
  };

  // 加载 VPC 和 子网
  const loadVpcsAndSubnets = async (cloudId?: string, force: boolean = false) => {
    const cid = cloudId || currentCloudId;
    if (!cid || cid === 'all') return;
    if (!ovnVpcEnabled) {
      setVpcs([]);
      setSubnets([]);
      return;
    }
    try {
      const [vpcsJson, subnetsJson] = await Promise.all([
        fetchKubeOvnVpcs(cid, force, false, 'vpc', mergeTenantPublicScope(false)),
        fetchKubeOvnSubnets(cid, force, false, 'all', mergeTenantPublicScope(false)),
      ]);
      setVpcs(vpcsJson?.data?.items || []);
      setSubnets(subnetsJson?.data?.items || []);
    } catch (e: any) {
      console.error('[CloudConsole] loadVpcsAndSubnets error:', e);
      setVpcs([]);
      setSubnets([]);
    }
  };

  // 加载 EIP 列表
  const loadEips = async (cloudId?: string) => {
    const cid = cloudId || currentCloudId;
    if (!cid || cid === 'all') return;
    setLoading(true);
    try {
      const res = await fetchCloudProviderOvnEips(cid, false, 'legacy', mergeTenantPublicScope(false));
      setEips(res?.data?.items || []);
    } catch (e: any) {
      console.error('[CloudConsole] loadEips error:', e);
      setEips([]);
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
      const res = await fetchCloudProviderOvnSnatRules(cid, false, false, 'legacy', mergeTenantPublicScope(false));
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
      const res = await fetchCloudProviderOvnDnatRules(cid, false, false, 'legacy', mergeTenantPublicScope(false));
      setDnatRules(res?.data?.items || []);
    } catch (e: any) {
      console.error('[CloudConsole] loadDnatRules error:', e);
      setDnatRules([]);
    } finally {
      setLoading(false);
    }
  };

  // ==================== Effects ====================

  useEffect(() => {
    void loadClouds();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载时拉取资源池列表
  }, []);

  useEffect(() => {
    if (!currentCloudId) return;
    const raw = sessionStorage.getItem(CONSOLE_REFRESH_KEY);
    if (!raw) return;
    if (raw !== String(currentCloudId)) return;

    sessionStorage.removeItem(CONSOLE_REFRESH_KEY);
    loadEcs(currentCloudId, true);
    loadPvcs(currentCloudId, true);
    loadImages(currentCloudId, true);
    loadSnapshots(currentCloudId, true);
    loadBackups(currentCloudId, true);
    loadSchedules(currentCloudId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅随 currentCloudId 变化；load* 保持单次会话语义
  }, [currentCloudId]);

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
      setEips([]);
      setSnatRules([]);
      setDnatRules([]);
      setStorageClasses([]);
      setVpcs([]);
      setSubnets([]);
      
      setHarvesterCategory('compute');
      setHarvesterResource('vm');
      setConsoleLeftNavKey('host');

      if (ovnVpcEnabled) {
        loadVpcsAndSubnets(currentCloudId);
      }
    }
    // 仅随 currentCloudId / OVN 开关变化；勿把 clouds 放入依赖，否则 setClouds 后反复清空列表导致「一直刷新」
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCloudId, ovnVpcEnabled]);

  /** 主面板内切换类目时，同步高亮左侧「云主机 / 扁平 / VPC」 */
  useEffect(() => {
    if (consoleLeftNavKey === 'container' || consoleLeftNavKey === 'rds') return;
    if (harvesterCategory === 'flatnet') setConsoleLeftNavKey('flat');
    else if (
      harvesterCategory === 'vpc-net' ||
      harvesterCategory === 'vpc-nat' ||
      harvesterCategory === 'vpc'
    ) {
      setConsoleLeftNavKey('vpc');
    }
    else if (['compute', 'storage', 'backup'].includes(harvesterCategory)) setConsoleLeftNavKey('host');
  }, [harvesterCategory, consoleLeftNavKey]);

  useEffect(() => {
    if (!ovnVpcEnabled) {
      setVpcs([]);
      setSubnets([]);
    }
  }, [ovnVpcEnabled]);

  // Cloudmap 资源按需加载：监听 harvesterResource 与 currentCloudId
  useEffect(() => {
    if (!currentCloudId || !isCloudmap) return;

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
        if (images.length === 0) loadImages(currentCloudId, true);
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
        // 仅首次进入云盘视图时自动加载，避免覆盖“创建后强制刷新”的最新结果
        if (pvcs.length === 0) loadPvcs(currentCloudId);
        if (storageClasses.length === 0) loadStorageClasses(currentCloudId, true, true);
        break;
      case 'volume-snapshot':
        loadSnapshots(currentCloudId, true);
        break;
      case 'snapshot':
      case 'backup':
        loadBackups(currentCloudId, true);
        break;
      case 'schedule':
        loadSchedules(currentCloudId);
        break;
      case 'vpc-subnet':
        // VPC 数据通常已加载，但可强制刷新
        loadVpcsAndSubnets(currentCloudId);
        break;
      case 'eip':
        loadEips(currentCloudId);
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
    // 勿加入 loading / images.length：否则 load* 会改 loading 或 images，effect 反复执行，镜像等 Tab 会无限强制刷新
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 按导航与列表长度触发；不将 load* 全部列入避免重复请求
  }, [
    currentCloudId,
    isCloudmap,
    harvesterResource,
    ecs.length,
    namespaces.length,
    pvcs.length,
    storageClasses.length,
  ]);

  // ==================== 派生数据（渲染） ====================
  
  const namespacesOptions = useMemo(() => {
    const s = new Set<string>();
    (namespaces || []).forEach((n: any) => {
      const ns = n?.metadata?.name || n?.name || '';
      if (ns && !isSystemNamespace(ns)) s.add(ns);
    });
    return Array.from(s).sort();
  }, [namespaces]);

  const nodesOptions = useMemo(() => {
    return Array.from(new Set(ecs.map(r => r?.vmi?.status?.nodeName || r?.status?.nodeName || r?.nodeName || r?.Extra?.NodeName).filter(Boolean))) as string[];
  }, [ecs]);

  const mainPanelLeftNavScope = useMemo((): CloudConsoleLeftNavScope => {
    if (consoleLeftNavKey === 'host') return 'host';
    if (consoleLeftNavKey === 'flat') return 'flat';
    if (consoleLeftNavKey === 'vpc') return 'vpc';
    return 'all';
  }, [consoleLeftNavKey]);

  /** 页头「可用区」下拉：仅 Cloudmap 资源池（挂到 AdminLayout ProHeader 中间槽位） */
  const availabilityZoneOptions = useMemo(() => {
    return clouds.map((c) => {
      const name = c.name || String(c.id);
      const region = c.region ? ` · ${c.region}` : '';
      return {
        value: String(c.id),
        label: `[Cloudmap] ${name}${region}`,
      };
    });
  }, [clouds]);

  const { setCenterSlot } = useCloudConsoleProHeaderSlot();

  const proHeaderAvailabilityZone = useMemo(
    () => (
      <Space align="center" size={8}>
        <span style={{ color: 'rgba(0,0,0,0.65)', whiteSpace: 'nowrap' }}>可用区</span>
        <Select
          style={{ minWidth: 260 }}
          showSearch
          placeholder="选择可用区"
          loading={cloudsLoading}
          value={currentCloudId}
          onChange={(v) => setCurrentCloudId(v)}
          disabled={clouds.length === 0}
          options={availabilityZoneOptions}
          optionFilterProp="label"
          popupMatchSelectWidth={false}
        />
      </Space>
    ),
    [
      availabilityZoneOptions,
      clouds.length,
      cloudsLoading,
      currentCloudId,
      setCurrentCloudId,
    ],
  );

  useEffect(() => {
    setCenterSlot(proHeaderAvailabilityZone);
    return () => setCenterSlot(null);
  }, [proHeaderAvailabilityZone, setCenterSlot]);

  return (
    <PageContainer
      asCard={false}
      hideHeader
      pagePadding={0}
      style={{ height: '100%' }}
    >
      <div className="cloud-console-root">
        <div className="cloud-console-body">
          {isCloudmap && currentCloudId ? (
            <aside className="cloud-console-left-nav-box" aria-label="控制台产品导航">
              <Menu
                mode="inline"
                selectedKeys={[consoleLeftNavKey]}
                items={leftNavMenuItems}
                onClick={handleLeftNavClick}
              />
            </aside>
          ) : null}

          <div className="cloud-console-content">
            <div className="cloud-console-content-scroll">
              {error && <Alert message={error} type="error" showIcon style={{ marginBottom: 16 }} />}

              {isCloudmap && currentCloudId ? (
                <>
                  {consoleLeftNavKey === 'container' && (
                    <div style={{ flex: 1, padding: 48 }}>
                      <Empty description="容器服务敬请期待" />
                    </div>
                  )}
                  {consoleLeftNavKey === 'rds' && (
                    <div style={{ flex: 1, padding: 48 }}>
                      <Empty description="云 RDS 敬请期待" />
                    </div>
                  )}
                  {(consoleLeftNavKey === 'host' || consoleLeftNavKey === 'flat' || consoleLeftNavKey === 'vpc') && (
                    <CloudConsoleMainPanel
                      leftNavScope={mainPanelLeftNavScope}
                      cloudId={currentCloudId}
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
                      vpcs={vpcs}
                      subnets={subnets}
                      eips={eips}
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
                      activeCategory={harvesterCategory}
                      setActiveCategory={setHarvesterCategory}
                      activeResource={harvesterResource}
                      setActiveResource={setHarvesterResource}
                      onRefreshVms={() => {
                        loadEcs(currentCloudId, true);
                        loadPvcs(currentCloudId, true);
                      }}
                      onRefreshStorageClasses={(force?: boolean, skipSync?: boolean) =>
                        loadStorageClasses(currentCloudId, !!force, !!skipSync)
                      }
                      onRefreshTemplates={(force) => loadTemplates(currentCloudId, !!force)}
                      onRefreshSshKeys={() => loadSshKeys(currentCloudId)}
                      onRefreshVolumes={(force?: boolean) => loadPvcs(currentCloudId, !!force)}
                      onRefreshImages={() => loadImages(currentCloudId, true)}
                      onRefreshSnapshots={() => loadSnapshots(currentCloudId, true)}
                      onRefreshBackups={() => loadBackups(currentCloudId, true)}
                      onRefreshSchedules={() => loadSchedules(currentCloudId)}
                      onRefreshCloudInits={() => loadCloudInits(currentCloudId)}
                      onRefreshGpus={() => loadGpus(currentCloudId)}
                      onRefreshVpcs={() => loadVpcsAndSubnets(currentCloudId, true)}
                      onRefreshEips={() => loadEips(currentCloudId)}
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
                  )}
                </>
              ) : cloudsLoading ? (
                <div style={{ padding: 100, textAlign: 'center' }}>
                  <Spin size="large" />
                  <div style={{ marginTop: 8 }}>加载资源池...</div>
                </div>
              ) : (
                <div style={{ padding: 24, textAlign: 'center' }}>
                  <Alert
                    message="暂无 Cloudmap 资源池"
                    description="请先在「资源池管理」中创建 Cloudmap 类型资源池后再使用本控制台。"
                    type="info"
                    showIcon
                    style={{ maxWidth: 600, margin: '0 auto' }}
                  />
                </div>
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
      </div>
    </PageContainer>
  );
};

export default CloudConsolePage;
