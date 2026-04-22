// 页面门控分三层：
// 1) License/Feature：能力是否启用
// 2) RBAC：用户是否有读写权限
// 3) 标准/运维（mode）：仅影响各 Section 内交互/展示细节；Tab 显隐仅由授权 + RBAC 决定

import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Alert, Tabs, message } from 'antd';

// Harvester 页面子模块（路径 ../Harvester，与独立 Harvester 详情页复用同一套 Section）
import CloudmapMonitoringAlertsTab from './tabs/monitoring_alerts/index';
import CloudmapClusterTabs from './tabs/cluster/index';
import CloudmapComputeGroupTabs from './tabs/compute/index';
import CloudmapContainersTabs from './tabs/containers/index';
import CloudmapLogsConfigTab from './tabs/logs_config/index';
import CloudmapStorageGroupTabs from './tabs/storage/index';
import CloudmapBackupsGroupTabs from './tabs/backups/index';
import CloudmapFlatNetworkGroupTabs from './tabs/flat_network/index';
import CloudmapKubeOvnGroupTabs from './tabs/kube_ovn/index';
import CloudmapCloudDatabaseTabs from './tabs/paas_databases/index';
import {
  ResourceOverviewDatacenterTopologyPanel,
  ResourceOverviewMonitoringPanel,
  ResourceOverviewNetworkTopologyPanel,
} from './tabs/resource_hub/index';
import { runLoadTabResource, runLoadEssentials } from './loadTabResource';

import PageDetailContainer from '../../../../components/PageDetailContainer';
import './cloudmap-detail-layout.css';
import './cloudmap-resource-hub-inner-tabs.css';
import {
  normalizeCloudmapPoolTabParam,
  normalizeCloudmapResourceSubParam,
  type CloudmapResourceSubKey,
} from '../../../../layouts/admin/cloudPoolSidebar';
import { readClusterStateFromUrl } from './cloudmapClusterTabVisibility';
import {
  API_BASE_URL,
  apiPost,
  fetchCloudById,
  fetchCloudProviderEcs,
} from './runtime/api';
import { useAuth } from '../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../utils/accessMapping';
import {
  CLOUD_CLOUDMAP_OPS_VIEW_WRITE,
  CLOUD_PROVIDER_NETWORKS_READ,
  CLOUD_SUBNETS_FLAT_READ,
  CLOUD_SUBNETS_PUBLIC_READ,
  CLOUD_SUBNETS_VPC_READ,
} from '../../../../constants/cloudPermissions';
import {
  fetchHarvesterImages,
  fetchHarvesterNads,
  fetchHarvesterNodes,
  fetchHarvesterStorageClasses,
  fetchKubeOvnSubnets,
} from './runtime/api';

import { HarvesterPublicNamespacesProvider } from '../Harvester/context/HarvesterPublicNamespacesContext';
import { getToken } from '../../../../utils/tokenStorage';
import { useLicense } from '../../../../contexts/LicenseContext';

const REQUEST_TIMEOUT = 30000;

/**
 * 云资源项接口定义
 */
interface CloudItem {
  id: string;
  name: string;
  region: string;
  type: string;
  config?: any;
  status?: string;
  endpoint?: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Harvester/CloudMap 云资源详情页组件 (迭代版)
 *
 * 职责：
 * 1. 作为容器组件，管理该云资源池下的所有资源数据（VM, Network, Storage等）。
 * 2. 处理资源的初始化加载和按需加载（Lazy Loading），避免一次性请求过多接口。
 * 3. 维护 SSE (Server-Sent Events) 连接，实现虚拟机状态的实时更新。
 * 4. 提供全局的刷新机制和权限控制。
 */
const CloudDetailCloudmap: React.FC<{ cloudId: string }> = ({ cloudId }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const permissions = user?.permissions;
  const isTenant = user?.role === 'tenant' || (user as any)?.tenantId;
  // 权限检查辅助函数
  const checkPerm = React.useCallback(
    (act: string) => hasPermissionForAction(permissions || [], act),
    [permissions],
  );
  /** 具备该权限方可将页面切到「运维」视图 */
  const canToggleOpsView = useMemo(
    () => checkPerm(CLOUD_CLOUDMAP_OPS_VIEW_WRITE),
    [checkPerm],
  );
  const canReadVpcSubnets =
    checkPerm(CLOUD_SUBNETS_VPC_READ) || checkPerm('clouds.subnets:read');
  const canReadFlatSubnets =
    checkPerm(CLOUD_SUBNETS_FLAT_READ) || checkPerm('clouds.subnets:read');
  const canReadPublicSubnets =
    checkPerm(CLOUD_SUBNETS_PUBLIC_READ) || checkPerm('clouds.subnets:read');
  // 兼容历史权限码，优先命中新原子权限（不含仅物理网络 / 仅 VLAN 读，用于子 Tab 门控）
  const canReadNetworkScopeBase =
    checkPerm('clouds.vpcs:read') ||
    canReadVpcSubnets ||
    canReadFlatSubnets ||
    canReadPublicSubnets ||
    checkPerm('clouds.security-groups.flat:read') ||
    checkPerm('clouds.security-groups.vpc:read') ||
    checkPerm('clouds.nads:read') ||
    checkPerm('clouds.networks:read') ||
    checkPerm('clouds:read');
  /** 拉取物理网络 / VLAN 等数据：在 base 上并入物理网络读、VLAN 读 */
  const canReadNetworkScope =
    canReadNetworkScopeBase ||
    checkPerm(CLOUD_PROVIDER_NETWORKS_READ) ||
    checkPerm('clouds.vlans:read');
  const canReadLoadBalancers =
    checkPerm('clouds.load-balancers:read') ||
    checkPerm('clouds.loadbalancers:read') ||
    checkPerm('clouds.nads:read') ||
    checkPerm('clouds:read');
  const canViewMonitoringTab =
    checkPerm('clouds.alerts:read') ||
    checkPerm('clouds.alert-rules:read') ||
    checkPerm('clouds.alert-policies:read') ||
    checkPerm('clouds.alert-receivers:read') ||
    checkPerm('clouds.alert-secrets:read');
  const canViewLoggingTab =
    checkPerm('clouds.log-targets:read') ||
    checkPerm('clouds.log-receivers:read') ||
    checkPerm('clouds.log-configs:read');
  // 与「集群」内各子 Tab 对齐：勿用宽泛 canReadNetworkScope，否则仅有扁平网络/NAD 等权限也会看到
  // 「物理网络」空壳（Tab 显示但无 provider-networks 读、接口不落数据）
  const canViewClusterGroup =
    checkPerm('clouds.cluster-nodes:read') ||
    checkPerm('clouds.cluster-services:read') ||
    checkPerm('clouds.cluster-networks:read') ||
    checkPerm('clouds.namespaces:read') ||
    checkPerm('clouds.storage-classes:read') ||
    checkPerm('clouds.gpus:read') ||
    checkPerm('clouds.usb-devices:read') ||
    checkPerm('clouds.pci-devices:read') ||
    checkPerm('clouds.nads:read') ||
    checkPerm(CLOUD_PROVIDER_NETWORKS_READ) ||
    checkPerm('clouds.vlans:read') ||
    checkPerm('clouds:read');
  const canViewComputeGroup =
    checkPerm('clouds.ecs:read') ||
    checkPerm('clouds.templates:read') ||
    checkPerm('clouds.images:read') ||
    checkPerm('clouds.sshkeys:read') ||
    checkPerm('clouds.cloudinits:read') ||
    checkPerm('clouds.recycle-bin:read') ||
    checkPerm('clouds.migrations:read') ||
    checkPerm('clouds:read');
  /** 云数据库（RDS）：与 RouteSpec `paas-databases` 页级权限一致 */
  const canViewCloudDatabaseTab =
    checkPerm('clouds.ecs:read') || checkPerm('clouds:read');
  /** 与 Harvester 详情页「容器」分组对齐：容器读或相关服务发现读或全量读 */
  const canViewContainersGroup =
    checkPerm('clouds.containers:read') ||
    checkPerm('clouds.services:read') ||
    checkPerm('clouds.ingresses:read') ||
    checkPerm('clouds:read');
  const canViewStorageGroup =
    checkPerm('clouds.disks:read') ||
    checkPerm('clouds.snapshots:read') ||
    checkPerm('clouds:read');
  const canViewBackupsGroup =
    checkPerm('clouds.backups:read') ||
    checkPerm('clouds.restore-tasks:read') ||
    checkPerm('clouds:read');
  /**
   * 扁平子网分组（与 VPC 分组标价/授权解耦）：仅扁平 underlay 子网读、扁平安全组读，或全量 clouds:read
   * 不包含 VPC 专有能力（vpcs / subnets.vpc / eips.vpc 等）
   */
  const canViewFlatNetworkGroup =
    checkPerm('clouds:read') ||
    canReadFlatSubnets ||
    checkPerm('clouds.security-groups.flat:read') ||
    checkPerm('clouds.eips.flat:read') ||
    checkPerm('clouds.fips.flat:read') ||
    checkPerm('clouds.snat.flat:read') ||
    checkPerm('clouds.dnat.flat:read');
  /**
   * 虚拟专有云（VPC）分组：仅 VPC 侧网络读能力，或全量 clouds:read
   * 不包含仅扁平子网、仅物理网络、仅 NAD 等（那些走 canReadNetworkScope / 集群等其它入口）
   */
  const canViewKubeOvnGroup =
    checkPerm('clouds:read') ||
    checkPerm('clouds.vpcs:read') ||
    canReadVpcSubnets ||
    checkPerm('clouds.security-groups.vpc:read') ||
    checkPerm('clouds.eips.vpc:read') ||
    checkPerm('clouds.fips.vpc:read') ||
    checkPerm('clouds.dnat.vpc:read') ||
    checkPerm('clouds.snat.vpc:read') ||
    checkPerm('clouds.traffic-mirroring.vpc:read');
  const { hasFeature } = useLicense();
  const ovnVpcEnabled = hasFeature('network.ovn.vpc');

  // --- 状态定义 ---

  // 云资源池基础信息
  const [cloud, setCloud] = useState<CloudItem | null>(null);
  // 各个资源模块的独立加载状态 map
  const [resourceLoading, setResourceLoading] = useState<
    Record<string, boolean>
  >({});
  // 顶层错误提示（预留给初始化场景）
  const [error] = useState<string | null>(null);

  // --- 核心资源数据 ---
  const [ecs, setEcs] = useState<any[]>([]); // 虚拟机列表
  const [harvesterNads, setHarvesterNads] = useState<any[]>([]); // NAD网络列表
  const [harvesterImages, setHarvesterImages] = useState<any[]>([]); // 镜像列表
  const [harvesterVolumes, setHarvesterVolumes] = useState<any[]>([]); // 虚拟卷列表
  const [harvesterNodes, setHarvesterNodes] = useState<any[]>([]); // 节点列表
  const [harvesterNamespaces, setHarvesterNamespaces] = useState<any[]>([]); // 命名空间列表
  const [
    harvesterNamespacesForManagement,
    setHarvesterNamespacesForManagement,
  ] = useState<any[]>([]); // 命名空间管理列表（含系统命名空间）
  const [harvesterStorageClasses, setHarvesterStorageClasses] = useState<any[]>(
    [],
  ); // 存储类列表
  const [capabilities, setCapabilities] = useState<any>(null); // 集群能力（如架构信息）

  // --- Kube-OVN 网络相关数据 ---
  const [kubeOvnVpcs, setKubeOvnVpcs] = useState<any[]>([]);
  const [kubeOvnSubnets, setKubeOvnSubnets] = useState<any[]>([]);
  const [kubeOvnEips, setKubeOvnEips] = useState<any[]>([]);
  const [kubeOvnFips, setKubeOvnFips] = useState<any[]>([]);
  const [kubeOvnSnatRules, setKubeOvnSnatRules] = useState<any[]>([]);
  const [kubeOvnDnatRules, setKubeOvnDnatRules] = useState<any[]>([]);
  const [kubeOvnFlatEips, setKubeOvnFlatEips] = useState<any[]>([]);
  const [, setKubeOvnFlatFips] = useState<any[]>([]);
  const [kubeOvnFlatSnatRules, setKubeOvnFlatSnatRules] = useState<any[]>([]);
  const [kubeOvnFlatDnatRules, setKubeOvnFlatDnatRules] = useState<any[]>([]);

  // --- 次要/按需加载资源数据 ---
  const [harvesterSnapshots, setHarvesterSnapshots] = useState<any[]>([]); // 卷快照
  const [harvesterBackups, setHarvesterBackups] = useState<any[]>([]); // 虚拟机备份
  const [harvesterSshKeys, setHarvesterSshKeys] = useState<any[]>([]); // SSH 密钥
  const [harvesterCloudInits, setHarvesterCloudInits] = useState<any[]>([]); // CloudInit 配置
  const [harvesterVlans, setHarvesterVlans] = useState<any[]>([]); // Kube-OVN VLANs
  const [
    harvesterKubeOvnProviderNetworks,
    setHarvesterKubeOvnProviderNetworks,
  ] = useState<any[]>([]); // 物理网络 / VLAN 筛选共用
  const [harvesterServices, setHarvesterServices] = useState<any[]>([]); // K8s 服务
  const [harvesterLoadBalancers, setHarvesterLoadBalancers] = useState<any[]>(
    [],
  ); // Harvester LoadBalancers
  const [harvesterIPPools, setHarvesterIPPools] = useState<any[]>([]); // IP 地址池
  const [harvesterClusterNetworks, setHarvesterClusterNetworks] = useState<
    any[]
  >([]); // 集群网络
  const [harvesterTemplates, setHarvesterTemplates] = useState<any[]>([]); // 虚拟机模板
  const [harvesterScheduleVmBackups, setHarvesterScheduleVmBackups] = useState<
    any[]
  >([]); // 定时备份策略
  const [harvesterGpuResources, setHarvesterGpuResources] = useState<any[]>([]); // GPU 资源
  const [harvesterUsbDevices, setHarvesterUsbDevices] = useState<any[]>([]); // USB 资源
  const [harvesterPciDevices, setHarvesterPciDevices] = useState<any[]>([]); // PCI 设备

  // --- 容器（K8s 工作负载 / 服务发现等）---
  const [harvesterDeployments, setHarvesterDeployments] = useState<any[]>([]);
  const [harvesterStatefulSets, setHarvesterStatefulSets] = useState<any[]>([]);
  const [harvesterDaemonSets, setHarvesterDaemonSets] = useState<any[]>([]);
  const [harvesterPods, setHarvesterPods] = useState<any[]>([]);
  const [harvesterJobs, setHarvesterJobs] = useState<any[]>([]);
  const [harvesterCronJobs, setHarvesterCronJobs] = useState<any[]>([]);
  const [harvesterIngresses, setHarvesterIngresses] = useState<any[]>([]);
  const [harvesterConfigMaps, setHarvesterConfigMaps] = useState<any[]>([]);
  const [harvesterSecrets, setHarvesterSecrets] = useState<any[]>([]);
  const [harvesterImagePullSecrets, setHarvesterImagePullSecrets] = useState<
    any[]
  >([]);
  const [harvesterPDBs, setHarvesterPDBs] = useState<any[]>([]);
  const [harvesterNetworkPolicies, setHarvesterNetworkPolicies] = useState<
    any[]
  >([]);
  const [gatewayApiStatus, setGatewayApiStatus] = useState<{
    installed: boolean;
    resources: {
      gatewayClass: boolean;
      gateway: boolean;
      httpRoute: boolean;
      grpcRoute: boolean;
    };
  } | null>(null);
  const [gatewayClasses, setGatewayClasses] = useState<any[]>([]);
  const [gateways, setGateways] = useState<any[]>([]);
  const [httpRoutes, setHttpRoutes] = useState<any[]>([]);
  const [grpcRoutes, setGrpcRoutes] = useState<any[]>([]);

  // --- UI 交互状态 ---
  const [vmReconfOpen, setVmReconfOpen] = useState(false); // 虚拟机配额调整模态框开关
  const [vmReconfTarget, setVmReconfTarget] = useState<any | null>(null); // 待调整的虚拟机对象
  const [nsFilter, setNsFilter] = useState<string>(''); // 命名空间筛选值
  const [nodeFilter, setNodeFilter] = useState<string>(''); // 节点筛选值
  const [showLog] = useState<boolean>(false); // 是否显示原始 JSON 日志
  /** 标准：租户向精简；运维：命名空间、ACL、运维抽屉等 */
  const [mode, setMode] = useState<'standard' | 'ops'>('standard');
  const [activeTabKey, setActiveTabKey] = useState<string>(() =>
    normalizeCloudmapPoolTabParam(
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('tab')
        : null,
    ),
  );
  const [resourceHubSubKey, setResourceHubSubKey] = useState<CloudmapResourceSubKey>(() =>
    normalizeCloudmapResourceSubParam(
      typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('tab') : null,
      typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('sub') : null,
    ),
  );

  const [backupsGroupActiveKey, setBackupsGroupActiveKey] =
    useState<string>('backups');
  const [clusterNetworkSegmentKey, setClusterNetworkSegmentKey] =
    useState<string>('clusterNetworks');
  /** 集群内层 Tab：'' 表示跟随 clusterInnerDefaultActiveKey；与 URL `cluster_sub` 同步 */
  const [clusterInnerActiveKey, setClusterInnerActiveKey] = useState<string>('');

  // --- 原始数据缓存 (用于日志展示) ---
  const [rawEcs, setRawEcs] = useState<any | null>(null);
  const [rawNads, setRawNads] = useState<any | null>(null);
  const [rawImages, setRawImages] = useState<any | null>(null);
  const [rawVolumes, setRawVolumes] = useState<any | null>(null);
  const [rawNodes, setRawNodes] = useState<any | null>(null);
  const [rawVpcs, setRawVpcs] = useState<any | null>(null);
  const [rawSubnets, setRawSubnets] = useState<any | null>(null);
  const [rawEips, setRawEips] = useState<any | null>(null);
  const [rawFips, setRawFips] = useState<any | null>(null);
  const [rawSnatRules, setRawSnatRules] = useState<any | null>(null);
  const [rawDnatRules, setRawDnatRules] = useState<any | null>(null);
  const [rawGpu, setRawGpu] = useState<any | null>(null);
  const [rawUsbDevices, setRawUsbDevices] = useState<any | null>(null);
  const [rawPciDevices, setRawPciDevices] = useState<any | null>(null);
  const [rawNamespaces, setRawNamespaces] = useState<any | null>(null);
  const [rawSnapshots, setRawSnapshots] = useState<any | null>(null);
  const [rawBackups, setRawBackups] = useState<any | null>(null);
  const [rawSshKeys, setRawSshKeys] = useState<any | null>(null);
  const [rawCloudInits, setRawCloudInits] = useState<any | null>(null);
  const [rawVlans, setRawVlans] = useState<any | null>(null);
  const [rawServices, setRawServices] = useState<any | null>(null);
  const [rawLoadBalancers, setRawLoadBalancers] = useState<any | null>(null);
  const [rawTemplates, setRawTemplates] = useState<any | null>(null);
  const [rawScheduleVmBackups, setRawScheduleVmBackups] = useState<any | null>(
    null,
  );
  const [rawIPPools, setRawIPPools] = useState<any | null>(null);
  const [rawClusterNetworks, setRawClusterNetworks] = useState<any | null>(
    null,
  );
  /**
   * 物理交换机列表：Tower 通过 `.../asw-ctl/switches` 返回本机已入库的末次实例快照，不对集群发实时 HSM 探测。
   * UI 在 PhysicalSwitchesSection 等，此处只持状态并下传给 CloudmapClusterTabs。
   */
  const [aswSwitchSummary, setAswSwitchSummary] = useState<any | null>(null);
  const [rawIngresses, setRawIngresses] = useState<any | null>(null);

  // 虚拟机状态更新缓冲，防止 SSE 频繁触发重渲染
  const vmStatusBuffer = React.useRef<Map<string, any>>(new Map());

  // 已加载资源标记集合，用于避免重复加载
  const loadedRef = React.useRef<Set<string>>(new Set());

  /**
   * 独立刷新节点数据的函数 (传递给子组件使用)
   */
  const [nodesLoading, setNodesLoading] = useState(false);
  const refreshNodes = async (force = false) => {
    if (nodesLoading) return;
    setNodesLoading(true);
    try {
      const nodesJson = await fetchHarvesterNodes(cloudId, force);
      const nodesList: any[] = (nodesJson as any)?.data?.items || [];
      setHarvesterNodes(Array.isArray(nodesList) ? nodesList : []);
      setRawNodes(nodesJson || null);
      message.success('节点刷新成功');
    } catch (e: any) {
      message.error(`刷新节点失败: ${e?.message || '未知错误'}`);
    } finally {
      setNodesLoading(false);
    }
  };

  /**
   * 独立刷新 NAD 数据的函数 (传递给子组件使用)
   */
  const [nadsLoading, setNadsLoading] = useState(false);
  const refreshNads = async (force = false, silent = false) => {
    if (nadsLoading) return;
    setNadsLoading(true);
    try {
      const skipSync = silent || false;
      const nadsJson = await fetchHarvesterNads(cloudId, force, skipSync);
      const nadsList: any[] = (nadsJson as any)?.data?.items || [];
      setHarvesterNads(Array.isArray(nadsList) ? nadsList : []);
      setRawNads(nadsJson || null);
      if (!silent) message.success('NAD网络刷新成功');
    } catch (e: any) {
      message.error(`刷新NAD网络失败: ${e?.message || '未知错误'}`);
    } finally {
      setNadsLoading(false);
    }
  };

  /**
   * 资源加载通用辅助函数
   * @param key 资源标识 Key
   * @param fn 数据获取 Promise 函数
   * @param cb 数据回调处理函数
   * @param force 是否强制刷新 (忽略缓存)
   */
  const loadResource = React.useCallback(
    async (
      key: string,
      fn: () => Promise<any>,
      cb: (json: any) => void,
      force = false,
    ) => {
      // 如果非强制刷新且已加载过，直接跳过
      if (!force && loadedRef.current.has(key)) return;

      // 强制刷新时，清除已加载标记，确保重新加载
      if (force && loadedRef.current.has(key)) {
        loadedRef.current.delete(key);
      }

      setResourceLoading((prev) => ({ ...prev, [key]: true }));
      try {
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(
            () => reject(new Error(`请求超时: ${key} (${REQUEST_TIMEOUT}ms)`)),
            REQUEST_TIMEOUT,
          );
        });
        const json = await Promise.race([fn(), timeoutPromise]);
        cb(json as any);
        // 强制刷新时，不更新 loadedRef，确保下次还能刷新
        // 非强制刷新时，标记为已加载，避免重复请求
        if (!force) {
          loadedRef.current.add(key);
        }
      } catch (e: any) {
        console.warn(`Failed to load ${key}:`, e?.message || e);
        try {
          cb(null);
        } catch {}
      } finally {
        setResourceLoading((prev) => ({ ...prev, [key]: false }));
      }
    },
    [],
  );

  /**
   * 加载核心资源 (首页/概览页必须的数据)
   * 包括: 云信息, VM, 网络, 卷, 镜像, 节点, 命名空间
   * @param force 是否强制刷新
   */
  const reloadCloudMeta = React.useCallback(async () => {
    try {
      const c = await fetchCloudById(cloudId, { skipCache: true });
      if (c) setCloud(c as CloudItem);
    } catch {
      /* 忽略：详情页仍可用缓存的 cloud */
    }
  }, [cloudId]);

  const loadEssentials = React.useCallback(
    (force = false) => {
      runLoadEssentials(force, {
        cloudId,
        loadResource,
        checkPerm,
        canReadNetworkScope,
        canViewKubeOvnGroup,
        ovnVpcEnabled,
        canReadFlatSubnets,
        canReadVpcSubnets,
        setCloud,
        setEcs,
        setRawEcs,
        setHarvesterNads,
        setRawNads,
        setKubeOvnVpcs,
        setRawVpcs,
        setKubeOvnSubnets,
        setRawSubnets,
        setHarvesterImages,
        setRawImages,
        setHarvesterVolumes,
        setRawVolumes,
        setHarvesterStorageClasses,
        setHarvesterNodes,
        setRawNodes,
        setHarvesterNamespaces,
        setRawNamespaces,
        setCapabilities,
      });
    },
    [
      cloudId,
      loadResource,
      checkPerm,
      canReadNetworkScope,
      canViewKubeOvnGroup,
      ovnVpcEnabled,
      canReadFlatSubnets,
      canReadVpcSubnets,
    ],
  );

  /**
   * 按需加载标签页资源 (Lazy Loading)
   * 仅在用户切换到对应 Tab 时触发加载
   * @param key Tab 的 key 或资源标识
   * @param force 是否强制刷新
   */
  const loadTabResource = async (
    key: string,
    force = false,
    skipSync = false,
  ) => {
    await runLoadTabResource(key, force, skipSync, {
              cloudId,
      checkPerm,
      loadResource,
      loadedRef,
      setResourceLoading,
      canReadLoadBalancers,
      canViewKubeOvnGroup,
      canViewFlatNetworkGroup,
      ovnVpcEnabled,
      harvesterSecrets,
      setHarvesterNamespacesForManagement,
      setHarvesterNamespaces,
      setEcs,
      setRawEcs,
      setHarvesterSnapshots,
      setRawSnapshots,
      setHarvesterBackups,
      setRawBackups,
      setHarvesterScheduleVmBackups,
      setRawScheduleVmBackups,
      setHarvesterSshKeys,
      setRawSshKeys,
      setHarvesterCloudInits,
      setRawCloudInits,
      setHarvesterTemplates,
      setRawTemplates,
      setHarvesterGpuResources,
      setRawGpu,
      setHarvesterUsbDevices,
      setRawUsbDevices,
      setHarvesterPciDevices,
      setRawPciDevices,
      setHarvesterLoadBalancers,
      setRawLoadBalancers,
      setHarvesterServices,
      setRawServices,
      setHarvesterVlans,
      setRawVlans,
      setHarvesterKubeOvnProviderNetworks,
      setHarvesterIPPools,
      setRawIPPools,
      setHarvesterClusterNetworks,
      setRawClusterNetworks,
      setAswSwitchSummary,
      setHarvesterNodes,
      setRawNodes,
      setHarvesterStorageClasses,
      setKubeOvnVpcs,
      setRawVpcs,
      setKubeOvnSubnets,
      setRawSubnets,
      setKubeOvnEips,
      setRawEips,
      setKubeOvnSnatRules,
      setRawSnatRules,
      setKubeOvnDnatRules,
      setRawDnatRules,
      setKubeOvnFlatEips,
      setKubeOvnFlatSnatRules,
      setKubeOvnFlatDnatRules,
      setHarvesterDeployments,
      setHarvesterStatefulSets,
      setHarvesterDaemonSets,
      setHarvesterPods,
      setHarvesterJobs,
      setHarvesterCronJobs,
      setHarvesterIngresses,
      setRawIngresses,
      setHarvesterConfigMaps,
      setHarvesterSecrets,
      setHarvesterImagePullSecrets,
      setHarvesterPDBs,
      setHarvesterNetworkPolicies,
      setGatewayApiStatus,
      setGatewayClasses,
      setGateways,
      setHttpRoutes,
      setGrpcRoutes,
    });
  };

  /**
   * `loadTabResource` 为每渲染新函数，若直接列入 URL 同步 `useEffect` 依赖会导致效果每帧执行，
   * 在 `cluster_sub` 缺省时把 `setClusterInnerActiveKey('')` 打回，内层 Tab 受控与点击失步无法切换。
   */
  const loadTabResourceRef = React.useRef(loadTabResource);
  loadTabResourceRef.current = loadTabResource;

  const refreshVlans = async (force = false, skipSync = false) => {
    if (
      !checkPerm('clouds.vlans:read') &&
      !checkPerm(CLOUD_PROVIDER_NETWORKS_READ)
    )
      return;
    await loadTabResource('vlans', force, skipSync);
  };

  /**
   * 专门用于 VM 列表刷新的函数
   */
  const refreshVms = async (force: boolean = false) => {
    if (!checkPerm('clouds.ecs:read')) return;
    setResourceLoading((prev) => ({ ...prev, ecs: true }));
    try {
      // 如果强制刷新，先触发一次后端同步
      if (force) {
        try {
          await apiPost(`/api/clouds/${cloudId}/sync`);
        } catch {}
      }
      const json = await fetchCloudProviderEcs(cloudId, force);
      const list: any[] = Array.isArray((json as any)?.data)
        ? (json as any).data
        : (json as any)?.data?.Instances?.Instance ||
          (json as any)?.data?.items ||
          (json as any)?.data?.data ||
          [];
      setEcs(Array.isArray(list) ? list : []);
      setRawEcs(json || null);
    } catch (e) {
      console.warn(`Failed to load ecs`, e);
    } finally {
      setResourceLoading((prev) => ({ ...prev, ecs: false }));
    }
  };

  // 切换资源池时必须清空按需加载缓存，否则 loadResource 会认为 ecs/cloud 等已加载而跳过请求（仍显示旧池数据）
  useEffect(() => {
    loadedRef.current.clear();
    vmStatusBuffer.current.clear();
  }, [cloudId]);

  // --- 初始化 Effect ---
  // 仅在组件挂载或 cloudId 变化时加载核心资源
  useEffect(() => {
    loadEssentials();
  }, [loadEssentials]);

  /**
   * 处理 Tab 切换事件，实现按需加载
   * @param key 激活的 Tab Key
   */
  /**
   * Tab 切换时按需拉数。
   * 各 Tab 的 key 在 loadTabResource 的 switch 中统一处理（含 kubeovn_*、cluster_* 等别名）；
   * 此处仅保留：多个 Tab 共用「备份+策略」加载。
   */
  const handleTabChange = (key: string) => {
    if (key === 'paas_databases') {
      void loadTabResource('backups');
      return;
    }
    if (
      key === 'backups' ||
      key === 'schedule_vm_backups' ||
      key === 'vm_snapshots' ||
      key === 'rds_data_backups' ||
      key === 'rds_db_backup' ||
      key === 'rds_db_snapshot' ||
      key === 'rds_db_schedule'
    ) {
      loadTabResource('backups');
      return;
    }
    const shouldForceRefresh =
      key === 'kube_ovn' ||
      key === 'flat_kubeovn_eips' ||
      key === 'flat_kubeovn_fips' ||
      key === 'flat_kubeovn_snat' ||
      key === 'flat_kubeovn_dnat';
    loadTabResource(key, shouldForceRefresh);
  };

  // --- SSE 实时数据更新 Effect ---
  // 建立 EventSource 连接，监听 VM 状态变化
  useEffect(() => {
    let es: EventSource | null = null;
    try {
      const token = getToken();
      if (!token) {
        console.warn('[SSE] No auth token found, skipping connection.');
        return;
      }
      const urlObj = new URL(
        `${API_BASE_URL}/api/clouds/${cloudId}/resources/ecs/stream`,
      );
      urlObj.searchParams.append('token', token);
      urlObj.searchParams.append('t', String(Date.now()));
      es = new EventSource(urlObj.toString());

      // 全量 VM 列表更新
      es.addEventListener('vms', (ev: MessageEvent) => {
        try {
          const json = JSON.parse(String(ev.data || '{}'));
          const items: any[] = Array.isArray(json?.items) ? json.items : [];
          setEcs(items);
        } catch {}
      });

      // 单个 VM 创建事件
      es.addEventListener('vm_created', (ev: MessageEvent) => {
        try {
          const json = JSON.parse(String(ev.data || '{}'));
          const r = json?.item;
          if (!r) return;
          setEcs((prev) => {
            const iid = String(r?.InstanceId || r?.id || '');
            if (!iid) return prev;
            // 去重防止重复添加
            if (
              (prev || []).some(
                (x: any) => String(x?.InstanceId || x?.id || '') === iid,
              )
            )
              return prev;
            return [r, ...(prev || [])];
          });
        } catch {}
      });

      // 单个 VM 删除事件
      es.addEventListener('vm_deleted', (ev: MessageEvent) => {
        try {
          const json = JSON.parse(String(ev.data || '{}'));
          const iid = String(json?.iid || '');
          if (!iid) return;
          setEcs((prev) =>
            (prev || []).filter(
              (x: any) => String(x?.InstanceId || x?.id || '') !== iid,
            ),
          );
        } catch {}
      });

      // 单个 VM 状态变更事件 (高频)
      es.addEventListener('vm_status', (ev: MessageEvent) => {
        try {
          const json = JSON.parse(String(ev.data || '{}'));
          const iid = String(json?.iid || '');
          if (!iid) return;
          // 存入缓冲，稍后批量更新
          vmStatusBuffer.current.set(iid, json);
        } catch {}
      });

      // 业务逻辑错误 (服务端主动推送)
      es.addEventListener('stream_error', (ev: MessageEvent) => {
        try {
          const json = JSON.parse(String(ev.data || '{}'));
          const message = String(json?.message ?? '');
          const cause = String(json?.cause ?? '');
          const s = `${message} ${cause}`.toLowerCase();
          if (
            s.includes('aborted') ||
            s.includes('context canceled') ||
            s.includes('context cancelled') ||
            s.includes('canceled') ||
            s.includes('cancelled') ||
            s.includes('client disconnected') ||
            s.includes('connection closed') ||
            s.includes('broken pipe') ||
            s.includes('eof')
          ) {
            return;
          }
          console.warn('[SSE] Server Logic Error:', message, 'Cause:', cause);
        } catch (e) {
          console.warn('[SSE] Server Logic Error (Raw):', ev);
        }
      });

      // 网络连接错误 (浏览器原生触发，无 data 负载)
      es.onerror = () => {
        // SSE 连接丢失，浏览器会自动重连
      };
    } catch (e) {
      console.error('[SSE] Init failed', e);
    }
    return () => {
      try {
        es?.close();
      } catch {}
    };
  }, [cloudId]);

  // --- 定时刷新 VM 状态缓冲 ---
  // 每秒检查一次缓冲区，如果有状态更新则合并到 ecs 状态中
  useEffect(() => {
    const timer = setInterval(() => {
      if (vmStatusBuffer.current.size === 0) return;

      const updates = new Map(vmStatusBuffer.current);
      vmStatusBuffer.current.clear();

      setEcs((prev) => {
        let hasChanges = false;
        const next = (prev || []).map((x: any) => {
          const xiid = String(x?.InstanceId || x?.id || '');
          if (updates.has(xiid)) {
            const json = updates.get(xiid);
            const statusStr = String(json?.status || '');
            const nodeName = String(json?.nodeName || '');
            const ips = Array.isArray(json?.ips) ? json.ips : [];

            // 比较状态是否有实质变化
            const currentStatus = String(
              x?.status?.printableStatus || x?.status?.phase || x?.Status || '',
            );
            const currentNode = String(
              x?.vmi?.status?.nodeName ||
                x?.status?.nodeName ||
                x?.Extra?.NodeName ||
                '',
            );

            // 简单的 IP 比较策略
            const currentIps = x?.ips || [];
            const ipsChanged =
              ips.length !== currentIps.length ||
              ips.some((ip: string) => !currentIps.includes(ip));

            if (
              currentStatus === statusStr &&
              currentNode === nodeName &&
              !ipsChanged
            ) {
              return x;
            }

            hasChanges = true;
            const newItem = { ...x };

            // 更新状态结构 (保持兼容性)
            newItem.Status = statusStr;
            if (typeof newItem.status === 'object' && newItem.status !== null) {
              newItem.status = {
                ...newItem.status,
                printableStatus: statusStr,
                phase: statusStr,
              };
            } else {
              newItem.status = { printableStatus: statusStr, phase: statusStr };
            }

            // 更新节点信息
            if (!newItem.Extra) newItem.Extra = {};
            newItem.Extra.NodeName = nodeName;

            if (!newItem.vmi) newItem.vmi = { status: {} };
            if (!newItem.vmi.status) newItem.vmi.status = {};
            newItem.vmi.status.nodeName = nodeName;

            // 更新 IP
            if (ips.length > 0) {
              newItem.ips = ips;
            }

            return newItem;
          }
          return x;
        });
        return hasChanges ? next : prev;
      });
    }, 1000); // 1秒刷新间隔
    return () => clearInterval(timer);
  }, []);

  // --- 派生状态计算 (Memo) ---

  // 节点选项列表 (从 VM 数据中提取，用于筛选)
  const nodesOptions = useMemo(() => {
    const s = new Set<string>();
    ecs.forEach((r: any) => {
      const n =
        r?.nodeName ||
        r?.vmi?.status?.nodeName ||
        r?.status?.nodeName ||
        r?.Extra?.NodeName ||
        '';
      if (n) s.add(n);
    });
    return Array.from(s).sort();
  }, [ecs]);

  // 命名空间选项列表（与 Harvester 一致：合并集群命名空间与容器资源中的命名空间）
  const namespacesOptions = useMemo(() => {
    const nsSet = new Set<string>();
    (harvesterNamespaces || []).forEach((n: any) => {
      const name = n?.metadata?.name || n?.name || '';
      if (name) nsSet.add(name);
    });
    const addNamespace = (item: any) => {
      const ns = item?.metadata?.namespace;
      if (ns) nsSet.add(ns);
    };
    harvesterDeployments.forEach(addNamespace);
    harvesterStatefulSets.forEach(addNamespace);
    harvesterDaemonSets.forEach(addNamespace);
    harvesterPods.forEach(addNamespace);
    harvesterJobs.forEach(addNamespace);
    harvesterCronJobs.forEach(addNamespace);
    harvesterServices.forEach(addNamespace);
    harvesterIngresses.forEach(addNamespace);
    harvesterConfigMaps.forEach(addNamespace);
    harvesterSecrets.forEach(addNamespace);
    harvesterImagePullSecrets.forEach(addNamespace);
    return Array.from(nsSet).filter(Boolean).sort();
  }, [
    harvesterNamespaces,
    harvesterDeployments,
    harvesterStatefulSets,
    harvesterDaemonSets,
    harvesterPods,
    harvesterJobs,
    harvesterCronJobs,
    harvesterServices,
    harvesterIngresses,
    harvesterConfigMaps,
    harvesterSecrets,
    harvesterImagePullSecrets,
  ]);

  const clusterNetworkSegmentOptions = useMemo(() => {
    const opts = [
      {
        value: 'clusterNetworks',
        label: '集群网络',
        visible: checkPerm('clouds.cluster-networks:read'),
      },
      {
        value: 'cluster_services',
        label: '基础服务',
        visible: checkPerm('clouds.cluster-services:read'),
      },
      {
        value: 'storage_classes',
        label: '存储池',
        visible: checkPerm('clouds.storage-classes:read'),
      },
      { value: 'nads', label: '附加网络(NAD)', visible: canReadNetworkScope },
      {
        value: 'load_balancers',
        label: '负载均衡',
        visible: canReadLoadBalancers,
      },
      {
        value: 'ippools',
        label: 'IP地址池',
        visible: checkPerm('clouds.nads:read'),
      },
      {
        value: 'cluster_pci',
        label: 'PCI 设备',
        visible: checkPerm('clouds.pci-devices:read'),
      },
    ];
    return opts
      .filter((i) => i.visible)
      .map(({ value, label }) => ({ value, label }));
  }, [checkPerm, canReadNetworkScope, canReadLoadBalancers]);

  /** 与 `cluster_sub` 同步的 layout effect 仅应随 options 的 value 集合而变，避免 [] 引用抖动把内层 Tab 打回。 */
  const clusterNetworkSegmentOptionsSyncKey = useMemo(
    () => clusterNetworkSegmentOptions.map((o) => o.value).join('\0'),
    [clusterNetworkSegmentOptions],
  );

  useEffect(() => {
    if (!clusterNetworkSegmentOptions.length) return;
    const stillValid = clusterNetworkSegmentOptions.some(
      (i) => i.value === clusterNetworkSegmentKey,
    );
    if (!stillValid) {
      setClusterNetworkSegmentKey(
        clusterNetworkSegmentOptions[0].value as string,
      );
    }
  }, [clusterNetworkSegmentOptions, clusterNetworkSegmentKey]);

  /** 集群内层 Tabs：defaultActiveKey 与首个有权限的子 Tab 对齐，避免空白内容区 */
  const clusterInnerDefaultActiveKey = useMemo(() => {
    if (checkPerm('clouds.cluster-nodes:read')) return 'cluster_nodes';
    if (checkPerm('clouds.cluster-networks:read'))
      return 'cluster_physical_switches';
    if (checkPerm(CLOUD_PROVIDER_NETWORKS_READ))
      return 'kubeovn_public_networks';
    if (checkPerm('clouds.namespaces:read') || checkPerm('clouds:read'))
      return 'namespaces';
    if (canReadPublicSubnets) return 'kubeovn_public_subnets';
    if (
      checkPerm('clouds.vlans:read') ||
      checkPerm(CLOUD_PROVIDER_NETWORKS_READ)
    ) {
      return checkPerm('clouds.vlans:read')
        ? 'cluster_vlans'
        : 'kubeovn_public_networks';
    }
    if (checkPerm('clouds.gpus:read')) return 'gpu';
    if (checkPerm('clouds.usb-devices:read')) return 'cluster_usb';
    if (clusterNetworkSegmentOptions.length > 0) return 'clusterNetworks';
    return 'cluster_nodes';
  }, [checkPerm, clusterNetworkSegmentOptions.length, canReadPublicSubnets]);

  /**
   * 集群子 Tab 与 `cluster_sub` / `cluster_segment` 的单一数据源：在绘制前用 `useLayoutEffect` 与地址栏同步，
   * 避免与其它 `useEffect`（按需加载、不稳定的 dep）互相覆盖导致 Tab 点不动或闪回。
   */
  useLayoutEffect(() => {
    const sp = new URLSearchParams(location.search);
    if (normalizeCloudmapPoolTabParam(sp.get('tab')) !== 'cluster') {
      return;
    }
    const { innerKey, networkSegment } = readClusterStateFromUrl(sp, {
      defaultSubKey: clusterInnerDefaultActiveKey,
      checkPerm,
      canReadPublicSubnets,
      networkSegmentOptions: clusterNetworkSegmentOptions,
    });
    setClusterInnerActiveKey(innerKey);
    if (networkSegment !== undefined) {
      setClusterNetworkSegmentKey(networkSegment);
    }
  }, [
    location.search,
    clusterInnerDefaultActiveKey,
    checkPerm,
    canReadPublicSubnets,
    clusterNetworkSegmentOptionsSyncKey,
  ]);

  const effectiveClusterInnerKey =
    clusterInnerActiveKey || clusterInnerDefaultActiveKey;

  const onClusterInnerTabChange = React.useCallback(
    (key: string) => {
      if (key === 'clusterNetworks') {
        handleTabChange(clusterNetworkSegmentKey);
      } else {
        handleTabChange(key);
      }
      setClusterInnerActiveKey(key);
      const sp = new URLSearchParams(location.search);
      sp.set('tab', 'cluster');
      sp.set('cluster_sub', key);
      if (key === 'clusterNetworks') {
        sp.set('cluster_segment', clusterNetworkSegmentKey);
      } else {
        sp.delete('cluster_segment');
      }
      navigate(`${location.pathname}?${sp.toString()}`, { replace: true });
    },
    [
      clusterNetworkSegmentKey,
      handleTabChange,
      location.pathname,
      location.search,
      navigate,
    ],
  );

  const onClusterInfoSegmentChange = React.useCallback(
    (segmentKey: string) => {
      setClusterNetworkSegmentKey(segmentKey);
      handleTabChange(segmentKey);
      setClusterInnerActiveKey('clusterNetworks');
      const sp = new URLSearchParams(location.search);
      sp.set('tab', 'cluster');
      sp.set('cluster_sub', 'clusterNetworks');
      sp.set('cluster_segment', segmentKey);
      navigate(`${location.pathname}?${sp.toString()}`, { replace: true });
    },
    [handleTabChange, location.pathname, location.search, navigate],
  );

  /** 从 URL 同步一级 `tab`、资源总览 `sub` 与 PaaS 预拉，不包含集群子 Tab（见上方 `readClusterStateFromUrl`） */
  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    const rawTab = sp.get('tab');
    const sub = sp.get('sub');
    const tab = normalizeCloudmapPoolTabParam(rawTab);
    setActiveTabKey(tab);
    let nextSub = normalizeCloudmapResourceSubParam(rawTab, sub);
    if (nextSub === 'datacenter_topology' && !canViewClusterGroup) {
      nextSub = 'overview';
    }
    setResourceHubSubKey(nextSub);
    const rawTabStr = String(rawTab || '').trim();
    if (rawTabStr && rawTabStr !== tab) {
      const next = new URLSearchParams(location.search);
      next.set('tab', tab);
      navigate(`${location.pathname}?${next.toString()}`, { replace: true });
    }
    if (tab === 'paas_databases') {
      void loadTabResourceRef.current('backups');
    }
  }, [
    location.search,
    cloudId,
    canViewClusterGroup,
    navigate,
    location.pathname,
  ]);

  /** 原一级「资源总览」下的子 Tab：总览 / 机房拓扑 / 网络拓扑 */
  const resourceHubInnerTabItems = useMemo(
    () => [
      {
        key: 'overview',
        label: '资源总览',
        children: <ResourceOverviewMonitoringPanel cloudId={cloudId} />,
      },
      ...(canViewClusterGroup
        ? [
            {
              key: 'datacenter_topology',
              label: '机房拓扑',
              children: (
                <ResourceOverviewDatacenterTopologyPanel cloudId={cloudId} checkPerm={checkPerm} />
              ),
            },
          ]
        : []),
      {
        key: 'network_topology',
        label: '网络拓扑',
        children: (
          <ResourceOverviewNetworkTopologyPanel
            cloudId={cloudId}
            canReadNetworkScope={canReadNetworkScope}
          />
        ),
      },
    ],
    [canViewClusterGroup, cloudId, checkPerm, canReadNetworkScope],
  );

  useEffect(() => {
    if (!canToggleOpsView && mode === 'ops') setMode('standard');
  }, [canToggleOpsView, mode]);

  return (
    <HarvesterPublicNamespacesProvider cloudId={cloudId}>
      <PageDetailContainer
        hideHeader
        asCard={false}
        rootStyle={{
          height: '100%',
          maxHeight: '100%',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxSizing: 'border-box',
        }}
        contentWrapperStyle={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {error && (
          <Alert
            type="error"
            message="查询失败"
            description={error}
            style={{ marginBottom: 16, flexShrink: 0 }}
            showIcon
          />
        )}
        <Tabs
          type="line"
          destroyOnHidden
          className="cloudmap-detail-outer-tabs"
          /** 一级 Tab 由管理侧栏 + `?tab=` 驱动，此处仅保留切换逻辑与内容区 */
          tabBarStyle={{ display: 'none', margin: 0, height: 0, minHeight: 0, padding: 0 }}
          activeKey={activeTabKey}
          onChange={(key) => {
            setActiveTabKey(key);
            navigate(
              `/admin/clouds/${encodeURIComponent(cloudId)}?tab=${encodeURIComponent(key)}`,
              { replace: true },
            );
            handleTabChange(key);
          }}
          items={[
            {
              key: 'resource_hub',
              label: '资源总览',
              children: (
                <Tabs
                  type="line"
                  destroyOnHidden
                  rootClassName="cloudmap-resource-hub-inner-tabs"
                  activeKey={resourceHubSubKey}
                  onChange={(sub) => {
                    const sk = sub as CloudmapResourceSubKey;
                    setResourceHubSubKey(sk);
                    navigate(
                      `/admin/clouds/${encodeURIComponent(cloudId)}?tab=resource_hub&sub=${encodeURIComponent(sk)}`,
                      { replace: true },
                    );
                  }}
                  items={resourceHubInnerTabItems}
                />
              ),
            },
            ...(canViewMonitoringTab
              ? [
                  {
                    key: 'monitoring_alerts',
                    label: '监控告警',
                    children: (
                      <CloudmapMonitoringAlertsTab
                                  cloudId={cloudId}
                        checkPerm={checkPerm}
                      />
                    ),
                  },
                ]
              : []),
            ...(canViewClusterGroup
              ? [
                  {
                    key: 'cluster',
                    label: '集群',
                    children: (
                      <CloudmapClusterTabs
                                  cloudId={cloudId}
                                      mode={mode}
                                      isTenant={isTenant}
                        showLog={showLog}
                        checkPerm={checkPerm}
                        canReadPublicSubnets={canReadPublicSubnets}
                        clusterInnerActiveKey={effectiveClusterInnerKey}
                        onClusterInnerTabChange={onClusterInnerTabChange}
                        onClusterInfoSegmentChange={onClusterInfoSegmentChange}
                        clusterNetworkSegmentKey={clusterNetworkSegmentKey}
                        clusterNetworkSegmentOptions={
                          clusterNetworkSegmentOptions
                        }
                        handleTabChange={handleTabChange}
                        loadTabResource={loadTabResource}
                        loadResource={loadResource}
                        harvesterNodes={harvesterNodes}
                        nodesLoading={nodesLoading}
                        refreshNodes={refreshNodes}
                        rawNodes={rawNodes}
                        harvesterServices={harvesterServices}
                        rawServices={rawServices}
                        harvesterPods={harvesterPods}
                        namespacesOptions={namespacesOptions}
                        nsFilter={nsFilter}
                        setNsFilter={setNsFilter}
                        harvesterClusterNetworks={harvesterClusterNetworks}
                        rawClusterNetworks={rawClusterNetworks}
                        harvesterNads={harvesterNads}
                        nadsLoading={nadsLoading}
                        refreshNads={refreshNads}
                        rawNads={rawNads}
                        harvesterLoadBalancers={harvesterLoadBalancers}
                        rawLoadBalancers={rawLoadBalancers}
                        harvesterIPPools={harvesterIPPools}
                        rawIPPools={rawIPPools}
                        harvesterKubeOvnProviderNetworks={
                                    harvesterKubeOvnProviderNetworks
                                  }
                        harvesterVlans={harvesterVlans}
                        rawVlans={rawVlans}
                        rawSubnets={rawSubnets}
                        setKubeOvnSubnets={setKubeOvnSubnets}
                        setRawSubnets={setRawSubnets}
                        refreshVlans={refreshVlans}
                        harvesterNamespacesForManagement={
                          harvesterNamespacesForManagement
                        }
                        rawNamespaces={rawNamespaces}
                        harvesterStorageClasses={harvesterStorageClasses}
                        harvesterGpuResources={harvesterGpuResources}
                        rawGpu={rawGpu}
                        harvesterUsbDevices={harvesterUsbDevices}
                        rawUsbDevices={rawUsbDevices}
                        harvesterPciDevices={harvesterPciDevices}
                        rawPciDevices={rawPciDevices}
                        aswSwitchSummary={aswSwitchSummary}
                        cloudConfig={cloud?.config ?? null}
                        onReloadCloudMeta={reloadCloudMeta}
                        resourceLoading={resourceLoading}
                      />
                    ),
                  },
                ]
              : []),
            ...(canViewComputeGroup
              ? [
                  {
                    key: 'compute',
                    label: '云主机',
                    children: (
                      <CloudmapComputeGroupTabs
                        cloudId={cloudId}
                                  mode={mode}
                        isTenant={isTenant}
                        showLog={showLog}
                        checkPerm={checkPerm}
                        canReadFlatSubnets={canReadFlatSubnets}
                        canReadVpcSubnets={canReadVpcSubnets}
                        handleTabChange={handleTabChange}
                        loadResource={loadResource}
                        loadTabResource={loadTabResource}
                        resourceLoading={resourceLoading}
                        ecs={ecs}
                        rawEcs={rawEcs}
                                  namespacesOptions={namespacesOptions}
                                  nodesOptions={nodesOptions}
                        nsFilter={nsFilter}
                        setNsFilter={setNsFilter}
                        nodeFilter={nodeFilter}
                        setNodeFilter={setNodeFilter}
                        harvesterStorageClasses={harvesterStorageClasses}
                        kubeOvnSubnets={kubeOvnSubnets}
                                  harvesterNads={harvesterNads}
                                  capabilities={capabilities}
                        setKubeOvnSubnets={setKubeOvnSubnets}
                        setHarvesterImages={setHarvesterImages}
                        setHarvesterVolumes={setHarvesterVolumes}
                        setHarvesterNamespaces={setHarvesterNamespaces}
                        refreshVms={refreshVms}
                        harvesterImages={harvesterImages}
                        harvesterNamespaces={harvesterNamespaces}
                        harvesterVolumes={harvesterVolumes}
                        harvesterTemplates={harvesterTemplates}
                        harvesterSshKeys={harvesterSshKeys}
                        harvesterCloudInits={harvesterCloudInits}
                        harvesterGpuResources={harvesterGpuResources}
                        rawImages={rawImages}
                        rawTemplates={rawTemplates}
                        rawSshKeys={rawSshKeys}
                        rawCloudInits={rawCloudInits}
                        vmReconfOpen={vmReconfOpen}
                        vmReconfTarget={vmReconfTarget}
                        onOpenVmReconfigure={(r: any) => {
                                    setVmReconfTarget(r);
                                    setVmReconfOpen(true);
                                  }}
                        onVmReconfigureModalClose={() => {
                                    setVmReconfOpen(false);
                                    setVmReconfTarget(null);
                                  }}
                        onVmReconfigureModalOk={() => {
                                    refreshVms();
                                    if (vmReconfTarget) {
                                      setTimeout(() => {
                                        setVmReconfTarget({
                                          ...vmReconfTarget,
                                          _refreshTrigger: Date.now(),
                                        });
                                      }, 300);
                                    }
                                  }}
                      />
                    ),
                  },
                ]
              : []),
            ...(canViewCloudDatabaseTab
              ? [
                  {
                    key: 'paas_databases',
                    label: '云数据库',
                    children: (
                      <CloudmapCloudDatabaseTabs
                        cloudId={cloudId}
                        onTabChange={handleTabChange}
                        showBackupsTab={canViewBackupsGroup}
                        ecs={ecs}
                        ecsLoading={!!resourceLoading.ecs}
                        onRefreshVms={() => refreshVms(true)}
                        onForceRefreshVms={() => refreshVms(true)}
                        harvesterImages={harvesterImages}
                        harvesterStorageClasses={harvesterStorageClasses}
                        kubeOvnSubnets={kubeOvnSubnets}
                        harvesterNads={harvesterNads}
                        onReloadImages={
                          checkPerm('clouds.images:read') ||
                          checkPerm('clouds.ecs:read')
                            ? () =>
                                loadResource(
                                  'images',
                                  () => fetchHarvesterImages(cloudId, true),
                                  (json) =>
                                    setHarvesterImages(
                                      (json as any)?.data?.items || [],
                                    ),
                                  true,
                                )
                            : undefined
                        }
                        onReloadSubnets={
                          canReadFlatSubnets ||
                          canReadVpcSubnets ||
                          checkPerm('clouds.networks:read')
                            ? () =>
                                loadResource(
                                  'subnets',
                                  () => fetchKubeOvnSubnets(cloudId, true),
                                  (json) =>
                                    setKubeOvnSubnets(
                                      (json as any)?.data?.items || [],
                                    ),
                                  true,
                                )
                            : undefined
                        }
                        onReloadNads={
                          checkPerm('clouds.networks:read')
                            ? () =>
                                loadResource(
                                  'nads',
                                  () => fetchHarvesterNads(cloudId, true),
                                  (json) =>
                                    setHarvesterNads(
                                      (json as any)?.data?.items || [],
                                    ),
                                  true,
                                )
                            : undefined
                        }
                        onReloadStorageClasses={
                          checkPerm('clouds.disks:read') ||
                          checkPerm('clouds.ecs:read')
                            ? () =>
                                loadResource(
                                  'storageClasses',
                                  () =>
                                    fetchHarvesterStorageClasses(
                                      cloudId,
                                      true,
                                    ),
                                  (json) =>
                                    setHarvesterStorageClasses(
                                      (json as any)?.data?.items || [],
                                    ),
                                  true,
                                )
                            : undefined
                        }
                        harvesterBackups={harvesterBackups}
                        harvesterScheduleVmBackups={harvesterScheduleVmBackups}
                        backupsLoading={!!resourceLoading.backups}
                        scheduleVmBackupsLoading={
                          !!resourceLoading.scheduleVmBackups
                        }
                        harvesterNamespaces={harvesterNamespaces}
                        onRefreshBackups={() =>
                          void loadTabResource('backups', true)
                        }
                        isTenant={isTenant}
                        mode={mode}
                        namespacesOptions={namespacesOptions}
                      />
                    ),
                  },
                ]
              : []),
            ...(canViewContainersGroup
              ? [
                  {
                    key: 'containers',
                    label: '容器',
                    children: (
                      <CloudmapContainersTabs
                                cloudId={cloudId}
                                mode={mode}
                        isTenant={isTenant}
                        checkPerm={checkPerm}
                        handleTabChange={handleTabChange}
                        loadTabResource={loadTabResource}
                        resourceLoading={resourceLoading}
                                namespacesOptions={namespacesOptions}
                        nodesOptions={nodesOptions}
                        nsFilter={nsFilter}
                        setNsFilter={setNsFilter}
                        nodeFilter={nodeFilter}
                        setNodeFilter={setNodeFilter}
                        harvesterDeployments={harvesterDeployments}
                        harvesterStatefulSets={harvesterStatefulSets}
                        harvesterDaemonSets={harvesterDaemonSets}
                        harvesterPods={harvesterPods}
                        harvesterJobs={harvesterJobs}
                        harvesterCronJobs={harvesterCronJobs}
                        harvesterServices={harvesterServices}
                        harvesterIngresses={harvesterIngresses}
                                gatewayApiStatus={gatewayApiStatus}
                                gatewayClasses={gatewayClasses}
                                gateways={gateways}
                                httpRoutes={httpRoutes}
                                grpcRoutes={grpcRoutes}
                        harvesterPDBs={harvesterPDBs}
                        harvesterNetworkPolicies={harvesterNetworkPolicies}
                        harvesterConfigMaps={harvesterConfigMaps}
                        harvesterSecrets={harvesterSecrets}
                        harvesterImagePullSecrets={harvesterImagePullSecrets}
                        harvesterVolumes={harvesterVolumes}
                      />
                    ),
                  },
                ]
              : []),
            ...(canViewStorageGroup
              ? [
                  {
                    key: 'storage',
                    label: '云存储',
                    children: (
                      <CloudmapStorageGroupTabs
                                  cloudId={cloudId}
                                  mode={mode}
                        showLog={showLog}
                        checkPerm={checkPerm}
                        handleTabChange={handleTabChange}
                        loadResource={loadResource}
                        loadTabResource={loadTabResource}
                        ecs={ecs}
                        setEcs={setEcs}
                        setRawEcs={setRawEcs}
                        harvesterVolumes={harvesterVolumes}
                        setHarvesterVolumes={setHarvesterVolumes}
                        harvesterStorageClasses={harvesterStorageClasses}
                        harvesterSnapshots={harvesterSnapshots}
                        harvesterNamespaces={harvesterNamespaces}
                        resourceLoading={resourceLoading}
                        rawVolumes={rawVolumes}
                        rawSnapshots={rawSnapshots}
                      />
                    ),
                  },
                ]
              : []),
            ...(canViewBackupsGroup
              ? [
                  {
                    key: 'backups',
                    label: '云备份',
                    children: (
                      <CloudmapBackupsGroupTabs
                                  cloudId={cloudId}
                                  mode={mode}
                        isTenant={isTenant}
                        showLog={showLog}
                        checkPerm={checkPerm}
                        handleTabChange={handleTabChange}
                        loadTabResource={loadTabResource}
                        backupsGroupActiveKey={backupsGroupActiveKey}
                        setBackupsGroupActiveKey={setBackupsGroupActiveKey}
                        setResourceLoading={setResourceLoading}
                        ecs={ecs}
                        harvesterBackups={harvesterBackups}
                        harvesterNamespaces={harvesterNamespaces}
                        harvesterScheduleVmBackups={harvesterScheduleVmBackups}
                        setHarvesterScheduleVmBackups={
                          setHarvesterScheduleVmBackups
                        }
                        setRawScheduleVmBackups={setRawScheduleVmBackups}
                        resourceLoading={resourceLoading}
                        rawBackups={rawBackups}
                        rawScheduleVmBackups={rawScheduleVmBackups}
                      />
                    ),
                  },
                ]
              : []),
            ...(canViewFlatNetworkGroup
              ? [
                  {
                    key: 'flat_network',
                    label: '扁平子网',
                    children: (
                      <CloudmapFlatNetworkGroupTabs
                                  cloudId={cloudId}
                        mode={mode}
                        showLog={showLog}
                        checkPerm={checkPerm}
                        canReadFlatSubnets={canReadFlatSubnets}
                        handleTabChange={handleTabChange}
                        loadResource={loadResource}
                        loadTabResource={loadTabResource}
                        setResourceLoading={setResourceLoading}
                        kubeOvnSubnets={kubeOvnSubnets}
                        setKubeOvnSubnets={setKubeOvnSubnets}
                        setRawSubnets={setRawSubnets}
                        rawSubnets={rawSubnets}
                        kubeOvnFlatEips={kubeOvnFlatEips}
                        kubeOvnVpcs={kubeOvnVpcs}
                        kubeOvnFlatSnatRules={kubeOvnFlatSnatRules}
                        setKubeOvnFlatSnatRules={setKubeOvnFlatSnatRules}
                        kubeOvnFlatDnatRules={kubeOvnFlatDnatRules}
                        setKubeOvnFlatDnatRules={setKubeOvnFlatDnatRules}
                        resourceLoading={resourceLoading}
                      />
                    ),
                  },
                ]
              : []),
            ...(ovnVpcEnabled && canViewKubeOvnGroup
              ? [
                  {
                    key: 'kube_ovn',
                    label: '虚拟专有云 (VPC)',
                    children: (
                      <CloudmapKubeOvnGroupTabs
                                  cloudId={cloudId}
                        mode={mode}
                        showLog={showLog}
                        checkPerm={checkPerm}
                        canReadVpcSubnets={canReadVpcSubnets}
                        handleTabChange={handleTabChange}
                        loadResource={loadResource}
                        loadTabResource={loadTabResource}
                        setResourceLoading={setResourceLoading}
                        kubeOvnVpcs={kubeOvnVpcs}
                        setKubeOvnVpcs={setKubeOvnVpcs}
                        setRawVpcs={setRawVpcs}
                        kubeOvnSubnets={kubeOvnSubnets}
                        setKubeOvnSubnets={setKubeOvnSubnets}
                        setRawSubnets={setRawSubnets}
                        kubeOvnEips={kubeOvnEips}
                        kubeOvnSnatRules={kubeOvnSnatRules}
                        setKubeOvnSnatRules={setKubeOvnSnatRules}
                        setRawSnatRules={setRawSnatRules}
                        kubeOvnDnatRules={kubeOvnDnatRules}
                        setKubeOvnDnatRules={setKubeOvnDnatRules}
                        setRawDnatRules={setRawDnatRules}
                        resourceLoading={resourceLoading}
                        rawVpcs={rawVpcs}
                        rawSubnets={rawSubnets}
                        rawEips={rawEips}
                        rawSnatRules={rawSnatRules}
                        rawDnatRules={rawDnatRules}
                      />
                    ),
                  },
                ]
              : []),
            ...(canViewLoggingTab
              ? [
                  {
                    key: 'logs_config',
                    label: '日志管理',
                    children: (
                      <CloudmapLogsConfigTab
                        cloudId={cloudId}
                        checkPerm={checkPerm}
                      />
                    ),
                  },
                ]
              : []),
          ]}
        />
      </PageDetailContainer>
    </HarvesterPublicNamespacesProvider>
  );
};

export default CloudDetailCloudmap;
