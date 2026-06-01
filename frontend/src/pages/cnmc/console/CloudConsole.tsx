import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { Select, Alert, App, Spin } from 'antd';
import type { MenuProps } from 'antd';
import PageContainer from '../../../components/PageContainer';
import { useAuth } from '../../../contexts/AuthContext';
import { isSystemNamespace } from '../../../utils/harvesterUtils';
import {
  fetchHarvesterNamespaces,
  fetchHarvesterTemplates,
  fetchHarvesterSshKeys,
  fetchHarvesterSnapshots,
  fetchHarvesterBackups,
  fetchHarvesterScheduleVmBackups,
  fetchHarvesterCloudInits,
  fetchHarvesterGpuResources,
  fetchHarvesterStorageClasses,
  fetchCloudProviderOvnEips,
  fetchCloudProviderOvnSnatRules,
  fetchCloudProviderOvnDnatRules,
  fetchHarvesterVolumes,
  fetchHarvesterImages,
  fetchHarvesterServices,
  fetchKubeOvnVpcs,
  fetchKubeOvnSubnets,
  fetchHarvesterNads,
  fetchHarvesterDeployments,
  fetchHarvesterStatefulSets,
  fetchHarvesterDaemonSets,
  fetchHarvesterPods,
  fetchHarvesterJobs,
  fetchHarvesterCronJobs,
  fetchHarvesterConfigMaps,
  fetchHarvesterSecrets,
  fetchHarvesterImagePullSecrets,
  fetchHarvesterIngresses,
  checkGatewayApiStatus,
  fetchGatewayClasses,
  fetchGateways,
  fetchHttpRoutes,
  fetchGrpcRoutes,
  fetchHarvesterPDBs,
  fetchNetworkPolicies,
  fetchHarvesterCapabilities,
} from '../../../services/harvesterApi';
import {
  fetchClouds,
  fetchCloudProviderEcs,
  API_BASE_URL,
  apiPost,
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
import CloudConsoleMainPanel, { type CloudConsoleLeftNavScope } from './sections/CloudConsoleMainPanel';
import CloudConsoleContainerPanel from './sections/CloudConsoleContainerPanel';
import CloudConsoleDatabasePanel, {
  type CloudConsoleDatabaseCategory,
  type CloudConsoleDatabaseResource,
} from './sections/CloudConsoleDatabasePanel';
import { shouldMergePublicScenarioForTenantConsole } from './lib/tenantConsolePaths';
import { useTenantConsoleHeaderSlot } from '../../../contexts/TenantConsoleHeaderSlotContext';
import { useTenantConsoleSider } from '../../../layouts/tenant';
import { useTenantConsolePermissions } from './hooks/useTenantConsolePermissions';
import {
  TENANT_CONSOLE_RESOURCES_NEEDING_ECS,
} from './lib/tenantConsolePageAccess';
import {
  buildTenantConsoleSiderItems,
  getTenantConsoleOpenKeysForSelection,
  getTenantConsoleSelectedLeafKey,
  resolveTenantConsoleSiderLeaf,
} from './lib/tenantConsoleSiderNav';
import { createBackupsTabOnRefresh } from '../clouds/Cloudmap/pool/loaders/backupsRefresh';

type CloudItem = { id: string; name: string; region?: string; type?: string; config?: any; status?: string };

/** 可用区下拉的「供应商」展示名（仅 label，不影响 value / 请求） */
function cloudResourcePoolProviderLabel(c: CloudItem): string {
  const p = String(c?.config?.provider ?? c?.type ?? '').trim().toLowerCase();
  const map: Record<string, string> = {
    cloudmap: 'Cloudmap',
    'cloudmap.private': 'Cloudmap',
    'cloudmap.edge': 'Cloudmap 边缘',
    'cloudmap.csm': 'CSM（SDN）',
  };
  if (map[p]) return map[p];
  if (p.startsWith('cloudmap.')) return 'Cloudmap';
  if (p.startsWith('cloudmap')) return 'Cloudmap';
  return p || 'Cloudmap';
}

/** region 仍参与数据与筛选逻辑；仅当非空且不是 default 时拼进下拉文案 */
function cloudResourcePoolRegionSuffix(region?: string): string {
  const r = String(region ?? '').trim();
  if (!r) return '';
  if (r.toLowerCase() === 'default') return '';
  return ` ${r}`;
}

/** 左侧产品导航（与 CloudConsoleMainPanel.leftNavScope 联动） */
type ConsoleLeftNavKey = 'host' | 'container' | 'flat' | 'vpc' | 'rds';

/**
 * 云主机控制台（租户侧主入口）
 *
 * 【定位】本目录 `frontend/src/pages/cnmc/console` 为 **租户侧 Cloudmap 控制台** 的正式实现与沟通锚点；
 * 路由：`/console`（租户云控制台专用前缀，与 `/admin/*` 平台后台分离）。管理员从资源池详情等入口进入时走其它页面，但租户日常以本 Console 为主。
 * 详见同目录 `README.md`（`#租户控制台入口`）。
 *
 * 仅面向 Cloudmap 资源池的快捷管理界面（不再承载多云/非 Cloudmap 分支）。
 */
const CloudConsolePage: React.FC = () => {
  const { user } = useAuth();
  const { message } = App.useApp();

  const {
    canAccessLeftNav,
    canAccessMainResource,
    canAccessContainerResource,
    firstAccessibleLeftNav,
    pickFirstMainResourceForScope,
    pickFirstContainerResource,
    ovnVpcEnabled,
  } = useTenantConsolePermissions();

  /** 租户控制台：为 GET 附加 mergePublicScenarioNamespaces；非租户不传（后端保持兼容） */
  const isTenantConsole = useMemo(
    () =>
      user?.role === 'tenant' ||
      (!!user?.tenantId && String(user?.role ?? '') !== 'sase_device'),
    [user],
  );
  const isTenantUser = useMemo(
    () => user?.role === 'tenant' || !!user?.tenantId,
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
  /** 供快速创建 / PaaS 扁平子网 Multus 就绪判断；与资源池详情页一致须拉取真实 NAD 列表 */
  const [harvesterNads, setHarvesterNads] = useState<any[]>([]);
  const [storageClasses, setStorageClasses] = useState<any[]>([]); // 存储类

  // 容器服务（控制台）
  const [ctrDeployments, setCtrDeployments] = useState<any[]>([]);
  const [ctrStatefulSets, setCtrStatefulSets] = useState<any[]>([]);
  const [ctrDaemonSets, setCtrDaemonSets] = useState<any[]>([]);
  const [ctrPods, setCtrPods] = useState<any[]>([]);
  const [ctrJobs, setCtrJobs] = useState<any[]>([]);
  const [ctrCronJobs, setCtrCronJobs] = useState<any[]>([]);
  const [ctrServices, setCtrServices] = useState<any[]>([]);
  const [ctrIngresses, setCtrIngresses] = useState<any[]>([]);
  const [ctrConfigMaps, setCtrConfigMaps] = useState<any[]>([]);
  const [ctrSecrets, setCtrSecrets] = useState<any[]>([]);
  const [ctrImagePullSecrets, setCtrImagePullSecrets] = useState<any[]>([]);
  const [ctrPdbs, setCtrPdbs] = useState<any[]>([]);
  const [ctrNetworkPolicies, setCtrNetworkPolicies] = useState<any[]>([]);
  const [ctrGatewayApiStatus, setCtrGatewayApiStatus] = useState<{
    installed: boolean;
    resources: {
      gatewayClass: boolean;
      gateway: boolean;
      httpRoute: boolean;
      grpcRoute: boolean;
    };
  } | null>(null);
  const [ctrGatewayClasses, setCtrGatewayClasses] = useState<any[]>([]);
  const [ctrGateways, setCtrGateways] = useState<any[]>([]);
  const [ctrHttpRoutes, setCtrHttpRoutes] = useState<any[]>([]);
  const [ctrGrpcRoutes, setCtrGrpcRoutes] = useState<any[]>([]);
  const [ctrResourceLoading, setCtrResourceLoading] = useState<Record<string, boolean>>({});
  const [containerCategory, setContainerCategory] = useState('ctr-run');
  const [containerResource, setContainerResource] = useState('ctr-workloads');
  
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

  const [consoleLeftNavKey, setConsoleLeftNavKey] = useState<ConsoleLeftNavKey>('host');
  const [siderOpenKeys, setSiderOpenKeys] = useState<string[]>(['host']);

  const [databaseCategory, setDatabaseCategory] = useState<CloudConsoleDatabaseCategory>('rds');
  const [databaseResource, setDatabaseResource] = useState<CloudConsoleDatabaseResource>('mysql');

  /** 与资源池详情页一致：供 VmSection / 快速创建使用（架构、推荐 machine.type 等）；勿长期为 null，否则与管理员侧行为不一致 */
  const [harvesterCapabilities, setHarvesterCapabilities] = useState<any>(null);

  const vmStatusBuffer = useRef(new Map<string, any>());
  /** 避免「列表为空 + loading 结束」时 VM 拉取 effect 反复触发导致无限 GET */
  const ecsBootstrapTicketRef = useRef('');
  const ecsRdsBootstrapTicketRef = useRef('');

  const applyMainResourceKey = useCallback(
    (resourceKey: string) => {
      if (resourceKey === 'flat-subnet') {
        setHarvesterCategory('flatnet');
        setHarvesterResource('flat-subnet');
        return;
      }
      if (['vpc-subnet', 'eip', 'snat', 'dnat'].includes(resourceKey)) {
        setHarvesterCategory(
          resourceKey === 'vpc-subnet' ? 'vpc-net' : 'vpc-nat',
        );
        setHarvesterResource(resourceKey);
        return;
      }
      if (['volume', 'volume-snapshot'].includes(resourceKey)) {
        setHarvesterCategory('storage');
        setHarvesterResource(resourceKey);
        return;
      }
      if (['snapshot', 'backup', 'schedule', 'restore-task'].includes(resourceKey)) {
        setHarvesterCategory('backup');
        setHarvesterResource(resourceKey);
        return;
      }
      setHarvesterCategory('compute');
      setHarvesterResource(resourceKey);
    },
    [],
  );

  const applySiderLeafSelection = useCallback(
    (leafKey: string) => {
      const resolved = resolveTenantConsoleSiderLeaf(leafKey);
      if (!resolved) return;
      const { leftNavKey, category, resource } = resolved;
      setConsoleLeftNavKey(leftNavKey);
      setSiderOpenKeys((prev) => [...new Set([...prev, ...getTenantConsoleOpenKeysForSelection(leftNavKey)])]);
      if (leftNavKey === 'container') {
        setContainerCategory(category);
        setContainerResource(resource);
        return;
      }
      if (leftNavKey === 'rds') {
        setDatabaseCategory(category as CloudConsoleDatabaseCategory);
        setDatabaseResource(resource as CloudConsoleDatabaseResource);
        return;
      }
      applyMainResourceKey(resource);
    },
    [applyMainResourceKey],
  );

  const siderMenuItems: MenuProps['items'] = useMemo(
    () =>
      buildTenantConsoleSiderItems({
        canAccessLeftNav,
        canAccessMainResource,
        canAccessContainerResource,
        canAccessDatabase: canAccessLeftNav('rds'),
        ovnVpcEnabled,
      }),
    [
      canAccessLeftNav,
      canAccessMainResource,
      canAccessContainerResource,
      ovnVpcEnabled,
    ],
  );

  const siderSelectedKey = useMemo(
    () =>
      getTenantConsoleSelectedLeafKey({
        leftNavKey: consoleLeftNavKey,
        harvesterResource,
        containerResource,
        databaseResource,
      }),
    [consoleLeftNavKey, harvesterResource, containerResource, databaseResource],
  );

  const handleSiderMenuClick = useCallback<NonNullable<MenuProps['onClick']>>(
    (e) => {
      const key = String(e.key);
      if (['host', 'container', 'flat', 'vpc', 'rds'].includes(key)) return;
      applySiderLeafSelection(key);
    },
    [applySiderLeafSelection],
  );

  /** 无当前侧栏权限时落到首个可访问产品域（与池内 pathSync fallback 一致） */
  useEffect(() => {
    if (canAccessLeftNav(consoleLeftNavKey)) return;
    const fallback = firstAccessibleLeftNav;
    if (!fallback) return;
    setConsoleLeftNavKey(fallback);
    setSiderOpenKeys(getTenantConsoleOpenKeysForSelection(fallback));
    if (fallback === 'host') {
      applyMainResourceKey(pickFirstMainResourceForScope('host') ?? 'vm');
    } else if (fallback === 'container') {
      setContainerCategory('ctr-run');
      setContainerResource(pickFirstContainerResource() ?? 'ctr-workloads');
    } else if (fallback === 'flat') {
      applyMainResourceKey(pickFirstMainResourceForScope('flat') ?? 'flat-subnet');
    } else if (fallback === 'vpc') {
      applyMainResourceKey(pickFirstMainResourceForScope('vpc') ?? 'vpc-subnet');
    } else if (fallback === 'rds') {
      setDatabaseCategory('rds');
      setDatabaseResource('mysql');
    }
  }, [
    consoleLeftNavKey,
    canAccessLeftNav,
    firstAccessibleLeftNav,
    pickFirstMainResourceForScope,
    pickFirstContainerResource,
    applyMainResourceKey,
  ]);

  /** 当前主面板资源无读权限时，落到同域首个可访问页面（如云主机域仅有备份权时不应停在 vm） */
  useEffect(() => {
    if (consoleLeftNavKey === 'container' || consoleLeftNavKey === 'rds') return;
    if (canAccessMainResource(harvesterResource)) return;
    const scope: 'host' | 'flat' | 'vpc' =
      consoleLeftNavKey === 'flat' ? 'flat' : consoleLeftNavKey === 'vpc' ? 'vpc' : 'host';
    const next = pickFirstMainResourceForScope(scope);
    if (next) applyMainResourceKey(next);
  }, [
    consoleLeftNavKey,
    harvesterResource,
    canAccessMainResource,
    pickFirstMainResourceForScope,
    applyMainResourceKey,
  ]);

  useEffect(() => {
    setSiderOpenKeys((prev) => [
      ...new Set([...prev, ...getTenantConsoleOpenKeysForSelection(consoleLeftNavKey)]),
    ]);
  }, [consoleLeftNavKey]);

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

  const { setTenantConsoleSiderModel } = useTenantConsoleSider();

  useEffect(() => {
    if (!isCloudmap || !currentCloudId) {
      setTenantConsoleSiderModel(null);
      return;
    }
    setTenantConsoleSiderModel({
      selectedKeys: [siderSelectedKey],
      openKeys: siderOpenKeys,
      onOpenChange: setSiderOpenKeys,
      items: siderMenuItems,
      onClick: handleSiderMenuClick,
      width: 240,
    });
    return () => setTenantConsoleSiderModel(null);
  }, [
    isCloudmap,
    currentCloudId,
    siderSelectedKey,
    siderOpenKeys,
    siderMenuItems,
    handleSiderMenuClick,
    setTenantConsoleSiderModel,
  ]);

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
        const p = String(c?.config?.provider || '').toLowerCase();
        return p === 'cloudmap.private' || p === 'cloudmap.edge';
      });
      setClouds(filtered);

      if (!currentCloudId && filtered.length > 0) {
        setCurrentCloudId(filtered[0].id);
      } else if (currentCloudId && !filtered.find((c) => String(c.id) === String(currentCloudId))) {
        setCurrentCloudId(filtered.length > 0 ? filtered[0].id : undefined);
      }

      if (filtered.length === 0) {
        setError('当前未找到 Cloudmap 资源池，请先在「资源池管理」中创建');
      } else {
        setError(null);
      }
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : typeof e === 'string' ? e : '加载资源池失败';
      setError(msg.includes('403') || msg.includes('权限') ? '无法加载资源池列表，请确认账号已授予控制台页面读权限' : msg);
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
    const ECS_FETCH_TIMEOUT_MS = 35_000;
    try {
      const json: any = await Promise.race([
        fetchCloudProviderEcs(cid, forceRefresh, mergeTenantPublicScope(false)),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('云主机列表请求超时')), ECS_FETCH_TIMEOUT_MS);
        }),
      ]);
      
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
  const loadImages = async (
    cloudId?: string,
    force: boolean = false,
    mergePublicScenarioOverride?: boolean,
  ) => {
    const cid = cloudId || currentCloudId;
    if (!cid || cid === 'all') return;

    setLoading(true);
    setError(null);
    try {
      const mergePublic =
        mergePublicScenarioOverride !== undefined
          ? mergePublicScenarioOverride
          : shouldMergePublicScenarioForTenantConsole(harvesterCategory, harvesterResource);
      const json = await fetchHarvesterImages(cid, force, false, mergeTenantPublicScope(mergePublic));
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

  // 云备份域：与 Cloudmap 池一致，并行拉备份列表与定时策略
  const loadBackupsTabResource = useCallback(
    async (cloudId?: string, force: boolean = false, skipSync: boolean = false) => {
      const cid = cloudId || currentCloudId;
      if (!cid || cid === 'all') return;
      setLoading(true);
      try {
        const scope = mergeTenantPublicScope(false);
        const [bkRes, schedRes] = await Promise.all([
          fetchHarvesterBackups(cid, force, skipSync, scope),
          fetchHarvesterScheduleVmBackups(cid, force, skipSync, scope),
        ]);
        setBackups(bkRes?.data?.items || []);
        setSchedules(schedRes?.data?.items || []);
      } catch (e: any) {
        console.error('[CloudConsole] loadBackupsTabResource error:', e);
        setBackups([]);
        setSchedules([]);
      } finally {
        setLoading(false);
      }
    },
    [currentCloudId, mergeTenantPublicScope],
  );

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

  // 加载 VPC 和 子网（云数据库创建依赖扁平子网列表时，可对子网请求合并公共场景命名空间）
  const loadVpcsAndSubnets = async (
    cloudId?: string,
    force: boolean = false,
    mergePublicSubnets: boolean = false,
  ) => {
    const cid = cloudId || currentCloudId;
    if (!cid || cid === 'all') return;
    if (!ovnVpcEnabled) {
      setVpcs([]);
      setSubnets([]);
      setHarvesterNads([]);
      return;
    }
    try {
      const [vpcsJson, subnetsJson, nadsRes] = await Promise.all([
        fetchKubeOvnVpcs(cid, force, false, 'vpc', mergeTenantPublicScope(false)),
        fetchKubeOvnSubnets(cid, force, false, 'all', mergeTenantPublicScope(mergePublicSubnets)),
        fetchHarvesterNads(cid, force).catch(() => ({ data: { items: [] } })),
      ]);
      setVpcs(vpcsJson?.data?.items || []);
      setSubnets(subnetsJson?.data?.items || []);
      setHarvesterNads(Array.isArray(nadsRes?.data?.items) ? nadsRes.data.items : []);
    } catch (e: any) {
      console.error('[CloudConsole] loadVpcsAndSubnets error:', e);
      setVpcs([]);
      setSubnets([]);
      setHarvesterNads([]);
    }
  };

  // 加载 EIP 列表；force=true 时跳过服务端/客户端缓存（删除、创建成功后需立即反映）
  const loadEips = async (cloudId?: string, forceRefresh = false) => {
    const cid = cloudId || currentCloudId;
    if (!cid || cid === 'all') return;
    setLoading(true);
    try {
      const res = await fetchCloudProviderOvnEips(cid, !!forceRefresh, 'legacy', mergeTenantPublicScope(false));
      setEips(res?.data?.items || []);
    } catch (e: any) {
      console.error('[CloudConsole] loadEips error:', e);
      setEips([]);
    } finally {
      setLoading(false);
    }
  };

  // 加载 SNAT 规则（同时拉 EIP，创建 SNAT 下拉依赖公网 IP 列表；仅进 SNAT 页时此前可能未请求过 EIP）
  const loadSnatRules = async (cloudId?: string, forceRefresh = false) => {
    const cid = cloudId || currentCloudId;
    if (!cid || cid === 'all') return;
    const fr = !!forceRefresh;
    setLoading(true);
    try {
      const mergePublicNs = mergeTenantPublicScope(false);
      const [snatRes, eipRes] = await Promise.all([
        fetchCloudProviderOvnSnatRules(cid, fr, false, 'legacy', mergePublicNs),
        fetchCloudProviderOvnEips(cid, fr, 'legacy', mergePublicNs),
      ]);
      setSnatRules(snatRes?.data?.items || []);
      setEips(eipRes?.data?.items || []);
    } catch (e: any) {
      console.error('[CloudConsole] loadSnatRules error:', e);
      setSnatRules([]);
      setEips([]);
    } finally {
      setLoading(false);
    }
  };

  // 加载 DNAT 规则（同上，创建 DNAT 需选公网 IP）
  const loadDnatRules = async (cloudId?: string, forceRefresh = false, silent = false) => {
    const cid = cloudId || currentCloudId;
    if (!cid || cid === 'all') return;
    const fr = !!forceRefresh;
    if (!silent) setLoading(true);
    try {
      const mergePublicNs = mergeTenantPublicScope(false);
      const [dnatRes, eipRes] = await Promise.all([
        fetchCloudProviderOvnDnatRules(cid, fr, false, 'legacy', mergePublicNs),
        fetchCloudProviderOvnEips(cid, fr, 'legacy', mergePublicNs),
      ]);
      setDnatRules(dnatRes?.data?.items || []);
      setEips(eipRes?.data?.items || []);
    } catch (e: any) {
      console.error('[CloudConsole] loadDnatRules error:', e);
      setDnatRules([]);
      setEips([]);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const mergeCtrLoading = useCallback((patch: Record<string, boolean>) => {
    setCtrResourceLoading((prev) => ({ ...prev, ...patch }));
  }, []);

  const loadCtrWorkloads = async (cloudId: string, force = false) => {
    mergeCtrLoading({
      deployments: true,
      statefulsets: true,
      daemonsets: true,
      imagePullSecrets: true,
      secrets: true,
      configmaps: true,
    });
    try {
      const [d, s, ds, ips, sec, cm] = await Promise.all([
        fetchHarvesterDeployments(cloudId, undefined, force),
        fetchHarvesterStatefulSets(cloudId, undefined, force),
        fetchHarvesterDaemonSets(cloudId, undefined, force),
        fetchHarvesterImagePullSecrets(cloudId, undefined, force),
        fetchHarvesterSecrets(cloudId, undefined, undefined, force),
        fetchHarvesterConfigMaps(cloudId, undefined, force),
      ]);
      setCtrDeployments((d as any)?.data?.items || []);
      setCtrStatefulSets((s as any)?.data?.items || []);
      setCtrDaemonSets((ds as any)?.data?.items || []);
      setCtrImagePullSecrets((ips as any)?.data?.items || []);
      setCtrSecrets((sec as any)?.data?.items || []);
      setCtrConfigMaps((cm as any)?.data?.items || []);
    } catch (e) {
      console.error('[CloudConsole] loadCtrWorkloads', e);
    } finally {
      mergeCtrLoading({
        deployments: false,
        statefulsets: false,
        daemonsets: false,
        imagePullSecrets: false,
        secrets: false,
        configmaps: false,
      });
    }
  };

  const loadCtrPods = async (cloudId: string, force = false) => {
    mergeCtrLoading({ pods: true });
    try {
      const res = await fetchHarvesterPods(cloudId, undefined, force);
      setCtrPods((res as any)?.data?.items || []);
    } catch (e) {
      console.error('[CloudConsole] loadCtrPods', e);
    } finally {
      mergeCtrLoading({ pods: false });
    }
  };

  const loadCtrJobs = async (cloudId: string, force = false) => {
    mergeCtrLoading({ jobs: true, cronjobs: true, secrets: true, imagePullSecrets: true });
    try {
      const [j, c, sec, ips] = await Promise.all([
        fetchHarvesterJobs(cloudId, undefined, force),
        fetchHarvesterCronJobs(cloudId, undefined, force),
        fetchHarvesterSecrets(cloudId, undefined, undefined, force),
        fetchHarvesterImagePullSecrets(cloudId, undefined, force),
      ]);
      setCtrJobs((j as any)?.data?.items || []);
      setCtrCronJobs((c as any)?.data?.items || []);
      setCtrSecrets((sec as any)?.data?.items || []);
      setCtrImagePullSecrets((ips as any)?.data?.items || []);
    } catch (e) {
      console.error('[CloudConsole] loadCtrJobs', e);
    } finally {
      mergeCtrLoading({ jobs: false, cronjobs: false, secrets: false, imagePullSecrets: false });
    }
  };

  const loadCtrServices = async (cloudId: string, force = false) => {
    mergeCtrLoading({ services: true });
    try {
      const res = await fetchHarvesterServices(cloudId, force);
      setCtrServices((res as any)?.data?.items || []);
    } catch (e) {
      console.error('[CloudConsole] loadCtrServices', e);
    } finally {
      mergeCtrLoading({ services: false });
    }
  };

  const loadCtrIngresses = async (cloudId: string, force = false) => {
    mergeCtrLoading({ ingresses: true });
    try {
      const res = await fetchHarvesterIngresses(cloudId, force);
      setCtrIngresses((res as any)?.data?.items || []);
    } catch (e) {
      console.error('[CloudConsole] loadCtrIngresses', e);
    } finally {
      mergeCtrLoading({ ingresses: false });
    }
  };

  const loadCtrGateway = async (cloudId: string, force = false) => {
    mergeCtrLoading({
      gatewayApiStatus: true,
      gateways: true,
      gatewayClasses: true,
      httpRoutes: true,
      grpcRoutes: true,
      services: true,
    });
    try {
      const [st, gc, gw, http, grpc, svc] = await Promise.all([
        checkGatewayApiStatus(cloudId),
        fetchGatewayClasses(cloudId),
        fetchGateways(cloudId),
        fetchHttpRoutes(cloudId),
        fetchGrpcRoutes(cloudId),
        fetchHarvesterServices(cloudId, force),
      ]);
      setCtrGatewayApiStatus((st as any)?.data ?? null);
      setCtrGatewayClasses((gc as any)?.data?.items || []);
      setCtrGateways((gw as any)?.data?.items || []);
      setCtrHttpRoutes((http as any)?.data?.items || []);
      setCtrGrpcRoutes((grpc as any)?.data?.items || []);
      setCtrServices((svc as any)?.data?.items || []);
    } catch (e) {
      console.error('[CloudConsole] loadCtrGateway', e);
    } finally {
      mergeCtrLoading({
        gatewayApiStatus: false,
        gateways: false,
        gatewayClasses: false,
        httpRoutes: false,
        grpcRoutes: false,
        services: false,
      });
    }
  };

  const loadCtrConfigs = async (cloudId: string, force = false) => {
    mergeCtrLoading({ configmaps: true, secrets: true });
    try {
      const [cm, sec] = await Promise.all([
        fetchHarvesterConfigMaps(cloudId, undefined, force),
        fetchHarvesterSecrets(cloudId, undefined, undefined, force),
      ]);
      setCtrConfigMaps((cm as any)?.data?.items || []);
      setCtrSecrets((sec as any)?.data?.items || []);
    } catch (e) {
      console.error('[CloudConsole] loadCtrConfigs', e);
    } finally {
      mergeCtrLoading({ configmaps: false, secrets: false });
    }
  };

  const loadCtrRegistries = async (cloudId: string, force = false) => {
    mergeCtrLoading({ imagePullSecrets: true, secrets: true });
    try {
      const secRes = await fetchHarvesterSecrets(
        cloudId,
        undefined,
        undefined,
        force,
      );
      const list: any[] = (secRes as any)?.data?.items || [];
      setCtrSecrets(list);
      if (list.length > 0 && !force) {
        const dockerSecrets = list.filter(
          (item: any) => item?.type === 'kubernetes.io/dockerconfigjson',
        );
        setCtrImagePullSecrets(dockerSecrets);
      } else {
        const ips = await fetchHarvesterImagePullSecrets(
          cloudId,
          undefined,
          force,
        );
        setCtrImagePullSecrets((ips as any)?.data?.items || []);
      }
    } catch (e) {
      console.error('[CloudConsole] loadCtrRegistries', e);
    } finally {
      mergeCtrLoading({ imagePullSecrets: false, secrets: false });
    }
  };

  const loadCtrPdbs = async (cloudId: string, force = false) => {
    mergeCtrLoading({ pdbs: true });
    try {
      const res = await fetchHarvesterPDBs(cloudId, undefined, force);
      setCtrPdbs((res as any)?.data?.items || []);
    } catch (e) {
      console.error('[CloudConsole] loadCtrPdbs', e);
    } finally {
      mergeCtrLoading({ pdbs: false });
    }
  };

  const loadCtrNetpol = async (cloudId: string, force = false) => {
    mergeCtrLoading({ networkpolicies: true });
    try {
      const res = await fetchNetworkPolicies(cloudId, undefined, force);
      setCtrNetworkPolicies((res as any)?.data?.items || []);
    } catch (e) {
      console.error('[CloudConsole] loadCtrNetpol', e);
    } finally {
      mergeCtrLoading({ networkpolicies: false });
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
    loadBackupsTabResource(currentCloudId, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅随 currentCloudId 变化；load* 保持单次会话语义
  }, [currentCloudId]);

  useEffect(() => {
    if (currentCloudId) {
      // 立即重置旧数据，避免 UI 渲染旧状态或发起错误请求
      setHarvesterCapabilities(null);
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
      setHarvesterNads([]);

      setCtrDeployments([]);
      setCtrStatefulSets([]);
      setCtrDaemonSets([]);
      setCtrPods([]);
      setCtrJobs([]);
      setCtrCronJobs([]);
      setCtrServices([]);
      setCtrIngresses([]);
      setCtrConfigMaps([]);
      setCtrSecrets([]);
      setCtrImagePullSecrets([]);
      setCtrPdbs([]);
      setCtrNetworkPolicies([]);
      setCtrGatewayApiStatus(null);
      setCtrGatewayClasses([]);
      setCtrGateways([]);
      setCtrHttpRoutes([]);
      setCtrGrpcRoutes([]);
      setCtrResourceLoading({});
      setContainerCategory('ctr-run');
      setContainerResource(pickFirstContainerResource() ?? 'ctr-workloads');

      const nav = firstAccessibleLeftNav ?? 'host';
      setConsoleLeftNavKey(nav);
      setSiderOpenKeys(getTenantConsoleOpenKeysForSelection(nav));
      if (nav === 'host') {
        applyMainResourceKey(pickFirstMainResourceForScope('host') ?? 'vm');
      } else if (nav === 'flat') {
        applyMainResourceKey(pickFirstMainResourceForScope('flat') ?? 'flat-subnet');
      } else if (nav === 'vpc') {
        applyMainResourceKey(pickFirstMainResourceForScope('vpc') ?? 'vpc-subnet');
      } else {
        setHarvesterCategory('compute');
        setHarvesterResource('vm');
      }
      setNsValue(undefined);
      setNodeValue(undefined);

      const needsVpcInventory =
        ovnVpcEnabled &&
        (canAccessLeftNav('vpc') ||
          canAccessLeftNav('rds') ||
          canAccessMainResource('vm') ||
          canAccessMainResource('flat-subnet'));
      if (needsVpcInventory) {
        loadVpcsAndSubnets(currentCloudId);
      }
    }
    // 仅随 currentCloudId / OVN 开关变化；勿把 clouds 放入依赖，否则 setClouds 后反复清空列表导致「一直刷新」
    // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [currentCloudId, ovnVpcEnabled, canAccessLeftNav, canAccessMainResource]);

  /** 拉取 Harvester 集群能力（与资源池详情页一致），供云主机 Tab 快速创建等使用 */
  useEffect(() => {
    if (!currentCloudId || !isCloudmap) return;
    let cancelled = false;
    void (async () => {
      try {
        const json: any = await fetchHarvesterCapabilities(currentCloudId);
        const data = json?.data ?? null;
        if (!cancelled) setHarvesterCapabilities(data);
      } catch {
        if (!cancelled) setHarvesterCapabilities(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentCloudId, isCloudmap]);

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
      setHarvesterNads([]);
    }
  }, [ovnVpcEnabled]);

  /**
   * VM 列表单独 effect：避免因 namespaces / pvcs / storageClasses 等长度先后就绪
   * 在 ecs 仍为空时反复触发 loadEcs（连续 GET）。
   * 列表合法为空时（租户无云主机）也必须只拉一次：用 ticket ref 防止 loading 回落后再次满足条件形成死循环。
   * 「云数据库」侧栏由下方专用 effect 拉 ecs，此处排除 rds。
   */
  useEffect(() => {
    if (!currentCloudId || !isCloudmap) return;
    if (consoleLeftNavKey === 'container' || consoleLeftNavKey === 'rds') return;
    if (!canAccessMainResource(harvesterResource)) return;
    if (!TENANT_CONSOLE_RESOURCES_NEEDING_ECS.has(harvesterResource)) return;
    const ticket = `${currentCloudId}|${consoleLeftNavKey}|${harvesterResource}`;
    if (ecs.length > 0) {
      ecsBootstrapTicketRef.current = ticket;
      return;
    }
    if (!loading && ecsBootstrapTicketRef.current !== ticket) {
      ecsBootstrapTicketRef.current = ticket;
      void loadEcs(currentCloudId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅随云/导航/资源类型与列表是否已加载触发，不随其它资源长度抖动
  }, [
    currentCloudId,
    isCloudmap,
    consoleLeftNavKey,
    harvesterResource,
    ecs.length,
    loading,
    canAccessMainResource,
  ]);

  // Cloudmap 资源按需加载：监听 harvesterResource 与 currentCloudId（容器视图走独立 effect）
  useEffect(() => {
    if (!currentCloudId || !isCloudmap) return;
    if (consoleLeftNavKey === 'container') return;

    if (namespaces.length === 0) loadNamespaces(currentCloudId);

    switch (harvesterResource) {
      case 'vm':
        if (!canAccessMainResource('vm')) break;
        if (pvcs.length === 0) loadPvcs(currentCloudId);
        if (images.length === 0) loadImages(currentCloudId);
        break;
      case 'image':
        if (!canAccessMainResource('image')) break;
        if (images.length === 0) loadImages(currentCloudId, true);
        break;
      case 'ssh':
        if (!canAccessMainResource('ssh')) break;
        loadSshKeys(currentCloudId);
        break;
      case 'cloudinit':
        if (!canAccessMainResource('cloudinit')) break;
        loadCloudInits(currentCloudId);
        break;
      case 'gpu':
        if (!canAccessMainResource('gpu')) break;
        loadGpus(currentCloudId);
        break;
      case 'volume':
        if (!canAccessMainResource('volume')) break;
        if (pvcs.length === 0) loadPvcs(currentCloudId);
        if (storageClasses.length === 0) loadStorageClasses(currentCloudId, true, true);
        break;
      case 'volume-snapshot':
        if (!canAccessMainResource('volume-snapshot')) break;
        loadSnapshots(currentCloudId, true);
        break;
      case 'snapshot':
        if (!canAccessMainResource('snapshot')) break;
        loadBackupsTabResource(currentCloudId, true);
        break;
      case 'backup':
        if (!canAccessMainResource('backup')) break;
        loadBackupsTabResource(currentCloudId, true);
        break;
      case 'schedule':
        if (!canAccessMainResource('schedule')) break;
        loadBackupsTabResource(currentCloudId, true);
        break;
      case 'restore-task':
        if (!canAccessMainResource('restore-task')) break;
        break;
      case 'vpc-subnet':
        if (!canAccessMainResource('vpc-subnet')) break;
        loadVpcsAndSubnets(currentCloudId);
        break;
      case 'eip':
        if (!canAccessMainResource('eip')) break;
        loadEips(currentCloudId);
        break;
      case 'snat':
        if (!canAccessMainResource('snat')) break;
        loadSnatRules(currentCloudId);
        break;
      case 'dnat':
        if (!canAccessMainResource('dnat')) break;
        loadDnatRules(currentCloudId);
        break;
      case 'template':
        if (!canAccessMainResource('template')) break;
        loadTemplates(currentCloudId);
        break;
      case 'recycle-bin':
        if (!canAccessMainResource('recycle-bin')) break;
        break;
    }
    // 勿加入 loading / images.length / ecs.length：否则与其它 load* 交织会放大请求；VM 列表由上方独立 effect 处理
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 按导航与列表长度触发；不将 load* 全部列入避免重复请求
  }, [
    currentCloudId,
    isCloudmap,
    consoleLeftNavKey,
    harvesterResource,
    namespaces.length,
    pvcs.length,
    storageClasses.length,
    canAccessMainResource,
  ]);

  /** 容器服务：按子页拉取 K8s 资源 */
  useEffect(() => {
    if (!currentCloudId || !isCloudmap || consoleLeftNavKey !== 'container') return;
    if (!canAccessContainerResource(containerResource)) return;
    void loadNamespaces(currentCloudId);
    const cid = currentCloudId;
    switch (containerResource) {
      case 'ctr-workloads':
        void loadCtrWorkloads(cid);
        break;
      case 'ctr-pods':
        void loadCtrPods(cid);
        break;
      case 'ctr-jobs':
        void loadCtrJobs(cid);
        break;
      case 'ctr-services':
        void loadCtrServices(cid);
        break;
      case 'ctr-ingresses':
        void loadCtrIngresses(cid);
        break;
      case 'ctr-gateway':
        void loadCtrGateway(cid);
        break;
      case 'ctr-configs':
        void loadCtrConfigs(cid);
        break;
      case 'ctr-registries':
        void loadCtrRegistries(cid);
        break;
      case 'ctr-pdbs':
        void loadCtrPdbs(cid);
        break;
      case 'ctr-netpol':
        void loadCtrNetpol(cid);
        break;
      default:
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 按导航 key 触发；loadCtr* 为稳定拉数封装
  }, [
    currentCloudId,
    isCloudmap,
    consoleLeftNavKey,
    containerResource,
    canAccessContainerResource,
  ]);

  /** 云数据库侧栏：实例列表（单独 effect，避免 loading / 其它列表长度导致重复 GET；空列表同主面板防死循环） */
  useEffect(() => {
    if (!currentCloudId || !isCloudmap || consoleLeftNavKey !== 'rds' || !canAccessLeftNav('rds')) return;
    const ticket = `${currentCloudId}|rds`;
    if (ecs.length > 0) {
      ecsRdsBootstrapTicketRef.current = ticket;
      return;
    }
    if (!loading && ecsRdsBootstrapTicketRef.current !== ticket) {
      ecsRdsBootstrapTicketRef.current = ticket;
      void loadEcs(currentCloudId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCloudId, isCloudmap, consoleLeftNavKey, ecs.length, loading]);

  /** 云数据库侧栏：镜像、存储类、子网、命名空间 */
  useEffect(() => {
    if (!currentCloudId || !isCloudmap || consoleLeftNavKey !== 'rds' || !canAccessLeftNav('rds')) return;
    if (namespaces.length === 0) loadNamespaces(currentCloudId);
    if (images.length === 0) loadImages(currentCloudId, false, true);
    if (storageClasses.length === 0) loadStorageClasses(currentCloudId, true, true);
    if (ovnVpcEnabled && subnets.length === 0) loadVpcsAndSubnets(currentCloudId, false, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentCloudId,
    isCloudmap,
    consoleLeftNavKey,
    ovnVpcEnabled,
    namespaces.length,
    images.length,
    storageClasses.length,
    subnets.length,
  ]);

  const handleDatabaseForceRefresh = useCallback(async () => {
    const cid = currentCloudId;
    if (!cid) return;
    setLoading(true);
    try {
      try {
        await apiPost(`/api/clouds/${cid}/sync`);
      } catch {
        /* 同步失败仍尝试拉取列表 */
      }
      const json: any = await fetchCloudProviderEcs(cid, true, mergeTenantPublicScope(false));
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
      setEcs(Array.isArray(list) ? list : []);
    } finally {
      setLoading(false);
    }
  }, [currentCloudId, mergeTenantPublicScope]);

  // ==================== 派生数据（渲染） ====================
  
  const namespacesOptions = useMemo(() => {
    const s = new Set<string>();
    (namespaces || []).forEach((n: any) => {
      const ns = n?.metadata?.name || n?.name || '';
      if (ns && !isSystemNamespace(ns)) s.add(ns);
    });
    if (consoleLeftNavKey === 'container') {
      const addNs = (item: any) => {
        const ns = item?.metadata?.namespace;
        if (ns && !isSystemNamespace(ns)) s.add(ns);
      };
      ctrDeployments.forEach(addNs);
      ctrStatefulSets.forEach(addNs);
      ctrDaemonSets.forEach(addNs);
      ctrPods.forEach(addNs);
      ctrJobs.forEach(addNs);
      ctrCronJobs.forEach(addNs);
      ctrServices.forEach(addNs);
      ctrIngresses.forEach(addNs);
      ctrConfigMaps.forEach(addNs);
      ctrSecrets.forEach(addNs);
      ctrImagePullSecrets.forEach(addNs);
    }
    return Array.from(s).sort();
  }, [
    namespaces,
    consoleLeftNavKey,
    ctrDeployments,
    ctrStatefulSets,
    ctrDaemonSets,
    ctrPods,
    ctrJobs,
    ctrCronJobs,
    ctrServices,
    ctrIngresses,
    ctrConfigMaps,
    ctrSecrets,
    ctrImagePullSecrets,
  ]);

  /** 租户控制台：未选择命名空间时，在命名空间列表就绪后默认选中第一个非系统命名空间，避免快速创建落到 default 被拒 */
  useEffect(() => {
    if (!isTenantUser || !currentCloudId) return;
    const cur = String(nsValue ?? '').trim();
    if (cur) return;
    if (!namespacesOptions.length) return;
    setNsValue(namespacesOptions[0]);
  }, [isTenantUser, currentCloudId, nsValue, namespacesOptions]);

  const nodesOptions = useMemo(() => {
    return Array.from(new Set(ecs.map(r => r?.vmi?.status?.nodeName || r?.status?.nodeName || r?.nodeName || r?.Extra?.NodeName).filter(Boolean))) as string[];
  }, [ecs]);

  const mainPanelLeftNavScope = useMemo((): CloudConsoleLeftNavScope => {
    if (consoleLeftNavKey === 'host') return 'host';
    if (consoleLeftNavKey === 'flat') return 'flat';
    if (consoleLeftNavKey === 'vpc') return 'vpc';
    return 'all';
  }, [consoleLeftNavKey]);

  const backupsTabOnRefresh = useMemo(() => {
    const deps = {
      loadTabResource: (_key: string, force?: boolean, skipSync?: boolean) => {
        void loadBackupsTabResource(currentCloudId, force !== false, skipSync);
      },
    };
    return {
      backups: createBackupsTabOnRefresh('backups', deps),
      vm_snapshots: createBackupsTabOnRefresh('vm_snapshots', deps),
      schedule_vm_backups: createBackupsTabOnRefresh('schedule_vm_backups', deps),
    };
  }, [currentCloudId, loadBackupsTabResource]);

  /** 页头「可用区」下拉：供应商 / 资源池名称；region 为 default 时不展示但仍随 id 生效 */
  const availabilityZoneOptions = useMemo(() => {
    return clouds.map((c) => {
      const name = c.name || String(c.id);
      const provider = cloudResourcePoolProviderLabel(c);
      const region = cloudResourcePoolRegionSuffix(c.region);
      return {
        value: String(c.id),
        label: `${provider} / ${name}${region}`,
      };
    });
  }, [clouds]);

  const { setCenterSlot } = useTenantConsoleHeaderSlot();

  const proHeaderAvailabilityZone = useMemo(
    () => (
      <div
        className={
          clouds.length === 0
            ? 'cloud-console-header-az-combo cloud-console-header-az-combo--disabled'
            : 'cloud-console-header-az-combo'
        }
      >
        <span className="cloud-console-header-az-prefix">可用区</span>
        <Select
          className="cloud-console-header-az-select"
          variant="borderless"
          style={{ minWidth: 220 }}
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
      </div>
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
      style={{ height: '100%', minHeight: 0 }}
    >
      <div className="cloud-console-workspace">
          {error && (
            <div className="cloud-console-content-placeholder">
              <Alert message={error} type="error" showIcon />
            </div>
          )}

          {isCloudmap && currentCloudId && firstAccessibleLeftNav === null ? (
            <div className="cloud-console-content-placeholder" style={{ textAlign: 'center' }}>
              <Alert
                message="暂无可用控制台功能"
                description="当前账号未授予任何云控制台页面读权限，请联系管理员在「系统设置 → 角色」中配置。"
                type="info"
                showIcon
                style={{ maxWidth: 600, margin: '0 auto' }}
              />
            </div>
          ) : isCloudmap && currentCloudId ? (
            <>
              {consoleLeftNavKey === 'container' && currentCloudId && canAccessLeftNav('container') && (
                <CloudConsoleContainerPanel
                  cloudId={currentCloudId}
                  activeCategory={containerCategory}
                  setActiveCategory={setContainerCategory}
                  activeResource={containerResource}
                  setActiveResource={setContainerResource}
                  namespacesOptions={namespacesOptions}
                  namespaceRecords={namespaces}
                  nodesOptions={nodesOptions}
                  nsValue={nsValue}
                  nodeValue={nodeValue}
                  onNsChange={setNsValue}
                  onNodeChange={setNodeValue}
                  deployments={ctrDeployments}
                  statefulsets={ctrStatefulSets}
                  daemonsets={ctrDaemonSets}
                  pods={ctrPods}
                  jobs={ctrJobs}
                  cronjobs={ctrCronJobs}
                  services={ctrServices}
                  ingresses={ctrIngresses}
                  configmaps={ctrConfigMaps}
                  secrets={ctrSecrets}
                  imagePullSecrets={ctrImagePullSecrets}
                  pdbs={ctrPdbs}
                  networkpolicies={ctrNetworkPolicies}
                  gatewayApiStatus={ctrGatewayApiStatus}
                  gatewayClasses={ctrGatewayClasses}
                  gateways={ctrGateways}
                  httpRoutes={ctrHttpRoutes}
                  grpcRoutes={ctrGrpcRoutes}
                  volumes={pvcs}
                  resourceLoading={ctrResourceLoading}
                  onRefreshWorkloads={() => loadCtrWorkloads(currentCloudId, true)}
                  onRefreshPods={() => loadCtrPods(currentCloudId, true)}
                  onRefreshJobs={(force) => loadCtrJobs(currentCloudId, force ?? true)}
                  onRefreshServices={() => loadCtrServices(currentCloudId, true)}
                  onRefreshIngresses={() => loadCtrIngresses(currentCloudId, true)}
                  onRefreshGateway={() => loadCtrGateway(currentCloudId, true)}
                  onRefreshConfigs={(force) => loadCtrConfigs(currentCloudId, force ?? true)}
                  onRefreshRegistries={() => loadCtrRegistries(currentCloudId, true)}
                  onRefreshPdbs={(force) => loadCtrPdbs(currentCloudId, force ?? true)}
                  onRefreshNetpol={(force) => loadCtrNetpol(currentCloudId, force ?? true)}
                />
              )}
              {consoleLeftNavKey === 'rds' && currentCloudId && canAccessLeftNav('rds') && (
                <CloudConsoleDatabasePanel
                  cloudId={currentCloudId}
                  vms={ecs}
                  images={images}
                  storageClasses={storageClasses}
                  subnets={subnets}
                  harvesterNads={harvesterNads}
                  loading={loading}
                  activeCategory={databaseCategory}
                  setActiveCategory={setDatabaseCategory}
                  activeResource={databaseResource}
                  setActiveResource={setDatabaseResource}
                  onRefreshVms={(force) => loadEcs(currentCloudId, !!force)}
                  onForceRefreshVms={handleDatabaseForceRefresh}
                  onReloadImages={() => loadImages(currentCloudId, true, true)}
                  onReloadSubnets={() => loadVpcsAndSubnets(currentCloudId, true, true)}
                  onReloadStorageClasses={(force, skipSync) =>
                    loadStorageClasses(currentCloudId, !!force, !!skipSync)
                  }
                  isTenant={isTenantUser}
                  namespacesOptions={namespacesOptions}
                  namespaceRecords={namespaces}
                  harvesterClusterCapabilities={harvesterCapabilities}
                />
              )}
              {((consoleLeftNavKey === 'host' && canAccessLeftNav('host')) ||
                (consoleLeftNavKey === 'flat' && canAccessLeftNav('flat')) ||
                (consoleLeftNavKey === 'vpc' && canAccessLeftNav('vpc'))) && (
                <CloudConsoleMainPanel
                  canAccessMainResource={canAccessMainResource}
                  leftNavScope={mainPanelLeftNavScope}
                  cloudId={currentCloudId}
                  harvesterCapabilities={harvesterCapabilities}
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
                  harvesterNads={harvesterNads}
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
                  onRefreshVms={async (force?: boolean) => {
                    await loadEcs(currentCloudId, force !== false);
                  }}
                  onRefreshStorageClasses={(force?: boolean, skipSync?: boolean) =>
                    loadStorageClasses(currentCloudId, !!force, !!skipSync)
                  }
                  onRefreshTemplates={(force) => loadTemplates(currentCloudId, !!force)}
                  onRefreshSshKeys={() => loadSshKeys(currentCloudId)}
                  onRefreshVolumes={(force?: boolean) => loadPvcs(currentCloudId, !!force)}
                  onRefreshImages={(force?: boolean) => loadImages(currentCloudId, force ?? true)}
                  onRefreshSnapshots={() => loadSnapshots(currentCloudId, true)}
                  backupsTabOnRefresh={backupsTabOnRefresh}
                  onRefreshCloudInits={() => loadCloudInits(currentCloudId)}
                  onRefreshGpus={() => loadGpus(currentCloudId)}
                  onRefreshVpcs={() => loadVpcsAndSubnets(currentCloudId, true)}
                  onRefreshEips={(force?: boolean) => loadEips(currentCloudId, force !== false)}
                  onRefreshSnatRules={(force?: boolean) => loadSnatRules(currentCloudId, force !== false)}
                  onRefreshDnatRules={(force?: boolean, silent?: boolean) =>
                    loadDnatRules(currentCloudId, force !== false, silent === true)
                  }
                  onStart={handleStart}
                  onStop={handleStop}
                  onReboot={handleReboot}
                  onSoftReboot={handleSoftReboot}
                  onPause={handlePause}
                  onUnpause={handleUnpause}
                  onDelete={handleDelete}
                />
              )}
            </>
          ) : cloudsLoading ? (
            <div className="cloud-console-content-placeholder" style={{ textAlign: 'center', paddingTop: 100, paddingBottom: 100 }}>
              <Spin size="large" />
              <div style={{ marginTop: 8 }}>加载资源池...</div>
            </div>
          ) : (
            <div className="cloud-console-content-placeholder" style={{ textAlign: 'center' }}>
              <Alert
                message="暂无 Cloudmap 资源池"
                description="请先在「资源池管理」中创建 Cloudmap 类型资源池后再使用本控制台。"
                type="info"
                showIcon
                style={{ maxWidth: 600, margin: '0 auto' }}
              />
            </div>
          )}
      </div>
    </PageContainer>
  );
};

export default CloudConsolePage;
