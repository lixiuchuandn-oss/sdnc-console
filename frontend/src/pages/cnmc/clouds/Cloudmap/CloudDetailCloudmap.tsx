// 页面门控分三层：
// 1) License/Feature：能力是否启用
// 2) RBAC：用户是否有读写权限
// 3) 标准/运维（mode）：仅影响各 Section 内交互/展示细节；Tab 显隐仅由授权 + RBAC 决定

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Tag,
  Space,
  Button,
  Alert,
  Tabs,
  Descriptions,
  message,
  Segmented,
} from 'antd';
import {
  CloudUploadOutlined,
  ArrowLeftOutlined,
  HomeOutlined,
  LoginOutlined,
  ReloadOutlined,
} from '@ant-design/icons';

// Harvester 页面子模块（路径 ../Harvester，与独立 Harvester 详情页复用同一套 Section）
import CloudmapOverviewTab from './tabs/overview';
import CloudmapMonitoringAlertsTab from './tabs/monitoring-alerts';
import CloudmapClusterTabs from './tabs/cluster';
import CloudmapComputeGroupTabs from './tabs/compute_group';
import CloudmapContainersTabs from './tabs/containers';
import CloudmapLogsConfigTab from './tabs/logs-config';
import CloudmapStorageGroupTabs from './tabs/storage_group';
import CloudmapBackupsGroupTabs from './tabs/backups_group';
import CloudmapFlatNetworkGroupTabs from './tabs/flat_network_group';
import CloudmapKubeOvnGroupTabs from './tabs/kube_ovn_group';
import { runLoadTabResource, runLoadEssentials } from './loadTabResource';

import PageDetailContainer from '../../../../components/PageDetailContainer';
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
import { isSystemNamespace } from '../../../../utils/harvesterUtils';
import {
  fetchHarvesterSnapshots,
  fetchHarvesterBackups,
  fetchHarvesterSshKeys,
  fetchHarvesterCloudInits,
  fetchHarvesterServices,
  fetchHarvesterLoadBalancers,
  fetchHarvesterIPPools,
  fetchHarvesterNads,
  fetchHarvesterImages,
  fetchHarvesterNodes,
  fetchKubeOvnSubnets,
  fetchKubeOvnVlans,
  fetchKubeOvnProviderNetworks,
  fetchHarvesterGpuResources,
  fetchHarvesterNamespaces,
  fetchHarvesterStorageClasses,
  fetchHarvesterTemplates,
  fetchHarvesterClusterNetworks,
  fetchHarvesterUsbResources,
  fetchHarvesterPciDevices,
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
} from './runtime/api';

import { HarvesterPublicNamespacesProvider } from '../Harvester/context/HarvesterPublicNamespacesContext';
import { getToken } from '../../../../utils/tokenStorage';
import { clearCache } from '../../../../utils/requestManager';
import { useLicense } from '../../../../contexts/LicenseContext';

const REQUEST_TIMEOUT = 30000;

/**
 * 调试用的 JSON 展示组件
 */
const DebugJSON: React.FC<{ data: any; show: boolean }> = ({ data, show }) => {
  if (!show) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <pre
        style={{
          background: '#f7f7f7',
          padding: 12,
          borderRadius: 8,
          maxHeight: 300,
          overflow: 'auto',
        }}
      >
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
};

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
  const [activeTabKey, setActiveTabKey] = useState<string>('overview');
  const [backupsGroupActiveKey, setBackupsGroupActiveKey] =
    useState<string>('backups');
  const [clusterNetworkSegmentKey, setClusterNetworkSegmentKey] =
    useState<string>('clusterNetworks');

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
   * 物理交换机（ASW-CTL）聚合探测结果。ASW-CTL 部署在集群内、对外 HTTP 由 Service 等暴露；
   * Tower 通过 `/api/clouds/:id/resources/harvester/asw-ctl/switches` 代理拉取。UI 在 Harvester/cluster
   * 的 PhysicalSwitchesSection，此处只持状态并下传给 CloudmapClusterTabs。
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

  const refreshVlans = async (force = false, skipSync = false) => {
    if (
      !checkPerm('clouds.vlans:read') &&
      !checkPerm(CLOUD_PROVIDER_NETWORKS_READ)
    )
      return;
    await loadTabResource('vlans', force, skipSync);
  };

  /**
   * 全局/手动刷新函数
   * 策略：刷新所有核心资源 + 刷新所有"已加载过"的按需资源
   * 这保证了用户看到的页面内容最新，同时避免盲目加载所有 Tab
   */
  const loadAll = async (force: boolean | any = false) => {
    // 兼容事件对象调用
    const isForce =
      force === true || (typeof force === 'object' && force !== null);

    if (isForce) {
      message.loading({ content: '正在刷新资源...', key: 'refreshing' });
      // 触发后端数据库同步
      try {
        await apiPost(`/api/clouds/${cloudId}/sync`);
      } catch (e) {
        console.warn('Sync failed', e);
      }
    }

    // 1. 获取当前已加载的资源列表 (用于智能刷新)
    const previouslyLoaded = Array.from(loadedRef.current);

    // 2. 清空缓存标记，强制重新请求
    if (isForce) {
      loadedRef.current.clear();
    }

    // 3. 刷新核心资源
    await loadEssentials(isForce);

    // 4. 智能刷新已加载的按需资源
    if (isForce) {
      const secondaryKeys = [
        'snapshots',
        'backups',
        'ssh_keys',
        'cloud_inits',
        'templates',
        'gpu',
        'services',
        'vlans',
        'ippools',
        'clusterNetworks',
        'cluster_physical_switches', // ASW-CTL 探测（resourceLoading.aswSwitches）
        'kubeovn_public_networks',
        'eips',
        'fips',
        'snat',
        'dnat',
        'load_balancers',
        'containers',
        'workloads',
        'pods',
        'jobs',
        'configs',
        'registries',
        'gateway_api',
        'ingresses',
      ];
      // 只有当资源之前被加载过，才刷新它
      secondaryKeys.forEach((k) => {
        let shouldRefresh = false;
        if (k === 'snapshots' && previouslyLoaded.includes('snapshots'))
          shouldRefresh = true;
        if (
          k === 'backups' &&
          (previouslyLoaded.includes('backups') ||
            previouslyLoaded.includes('scheduleVmBackups'))
        )
          shouldRefresh = true;
        if (k === 'ssh_keys' && previouslyLoaded.includes('sshKeys'))
          shouldRefresh = true;
        if (k === 'cloud_inits' && previouslyLoaded.includes('cloudInits'))
          shouldRefresh = true;
        if (k === 'templates' && previouslyLoaded.includes('templates'))
          shouldRefresh = true;
        if (k === 'gpu' && previouslyLoaded.includes('gpu'))
          shouldRefresh = true;
        if (k === 'services' && previouslyLoaded.includes('services'))
          shouldRefresh = true;
        if (k === 'vlans' && previouslyLoaded.includes('vlans'))
          shouldRefresh = true;
        if (k === 'ippools' && previouslyLoaded.includes('ippools'))
          shouldRefresh = true;
        if (
          k === 'load_balancers' &&
          previouslyLoaded.includes('loadBalancers')
        )
          shouldRefresh = true;
        if (
          k === 'clusterNetworks' &&
          previouslyLoaded.includes('clusterNetworks')
        )
          shouldRefresh = true;
        if (
          k === 'cluster_physical_switches' &&
          previouslyLoaded.includes('aswSwitches')
        )
          shouldRefresh = true;
        if (
          k === 'kubeovn_public_networks' &&
          previouslyLoaded.includes('providerNetworksTab')
        )
          shouldRefresh = true;
        if (k === 'eips' && previouslyLoaded.includes('eips'))
          shouldRefresh = true;
        if (k === 'fips' && previouslyLoaded.includes('fips'))
          shouldRefresh = true;
        if (k === 'snat' && previouslyLoaded.includes('snatRules'))
          shouldRefresh = true;
        if (k === 'dnat' && previouslyLoaded.includes('dnatRules'))
          shouldRefresh = true;
        if (k === 'containers' && previouslyLoaded.includes('deployments'))
          shouldRefresh = true;
        if (k === 'workloads' && previouslyLoaded.includes('deployments'))
          shouldRefresh = true;
        if (k === 'pods' && previouslyLoaded.includes('pods'))
          shouldRefresh = true;
        if (k === 'jobs' && previouslyLoaded.includes('jobs'))
          shouldRefresh = true;
        if (k === 'configs' && previouslyLoaded.includes('configmaps'))
          shouldRefresh = true;
        if (k === 'registries' && previouslyLoaded.includes('imagePullSecrets'))
          shouldRefresh = true;
        if (k === 'gateway_api' && previouslyLoaded.includes('gateways'))
          shouldRefresh = true;
        if (k === 'ingresses' && previouslyLoaded.includes('ingresses'))
          shouldRefresh = true;

        if (shouldRefresh) {
          loadTabResource(k, true);
        }
      });
      message.success({ content: '刷新完成', key: 'refreshing' });
    }
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
    if (
      key === 'backups_group' ||
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
      key === 'kube_ovn_group' ||
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

  const providerName = 'Cloudmap';

  const versionText = useMemo(() => {
    const fromConfig = cloud?.config?.harvesterVersion;
    const fromNodes =
      harvesterNodes.find((n: any) => n?.version)?.version || undefined;
    return fromConfig || fromNodes || '-';
  }, [cloud, harvesterNodes]);
  const hasKubeOvn = useMemo(
    () => kubeOvnVpcs.length > 0 || kubeOvnSubnets.length > 0,
    [kubeOvnVpcs, kubeOvnSubnets],
  );
  const tlsIgnored = !!cloud?.config?.ignoreTls;
  const clusterNetworkSegmentOptions = useMemo(() => {
    const opts = [
      {
        value: 'clusterNetworks',
        label: '集群网络',
        visible: checkPerm('clouds.cluster-networks:read'),
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
    ];
    return opts
      .filter((i) => i.visible)
      .map(({ value, label }) => ({ value, label }));
  }, [checkPerm, canReadNetworkScope, canReadLoadBalancers]);

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
    if (checkPerm('clouds.cluster-services:read')) return 'cluster_services';
    if (clusterNetworkSegmentOptions.length > 0) return 'clusterNetworks';
    if (
      checkPerm('clouds.vlans:read') ||
      checkPerm(CLOUD_PROVIDER_NETWORKS_READ)
    ) {
      return checkPerm('clouds.vlans:read')
        ? 'cluster_vlans'
        : 'kubeovn_public_networks';
    }
    if (canReadPublicSubnets) return 'kubeovn_public_subnets';
    if (checkPerm('clouds.namespaces:read') || checkPerm('clouds:read'))
      return 'namespaces';
    if (checkPerm('clouds.storage-classes:read')) return 'storage_classes';
    if (checkPerm('clouds.gpus:read')) return 'gpu';
    if (checkPerm('clouds.usb-devices:read')) return 'cluster_usb';
    if (checkPerm('clouds.pci-devices:read')) return 'cluster_pci';
    return 'cluster_nodes';
  }, [checkPerm, clusterNetworkSegmentOptions.length, canReadPublicSubnets]);

  useEffect(() => {
    if (!canToggleOpsView && mode === 'ops') setMode('standard');
  }, [canToggleOpsView, mode]);

  return (
    <HarvesterPublicNamespacesProvider cloudId={cloudId}>
      <PageDetailContainer
        breadcrumbs={[
          { title: <HomeOutlined />, href: '/' },
          { title: '资源池管理' },
          { title: '资源池管理', href: '/admin/clouds' },
          { title: `${providerName} ${cloud?.name || '-'}` },
        ]}
        icon={<CloudUploadOutlined />}
        title={`${providerName} ${cloud?.name || '-'}`}
        titleLevel={3}
        extra={
          <Space size="small">
            {canToggleOpsView ? (
              <Segmented
                options={[
                  { label: '标准', value: 'standard' },
                  { label: '运维', value: 'ops' },
                ]}
                value={mode}
                onChange={(value) => {
                  const nextMode = value as 'standard' | 'ops';
                  if (nextMode === mode) return;
                  setMode(nextMode);
                  setActiveTabKey('overview');
                }}
              />
            ) : null}
            <Button
              icon={<ArrowLeftOutlined />}
              onClick={() => navigate('/admin/clouds')}
            ></Button>
            <Button icon={<ReloadOutlined />} onClick={() => loadAll(true)} />
          </Space>
        }
        asCard={false}
        subtitle="Cloudmap云平台详情页，统一纳管与可视化平台资源及网络拓扑"
        defaultOverviewCollapsed
        overviewContent={
          <Descriptions bordered size="small" column={4}>
            <Descriptions.Item label="资源名称">
              {cloud?.name || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="资源供应商">
              {providerName}
            </Descriptions.Item>
            <Descriptions.Item label="资源地域">
              {cloud?.region || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="资源类型">
              {cloud?.type || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="资源状态">
              {cloud?.status === 'online' ? (
                <Tag color="green">在线</Tag>
              ) : cloud?.status === 'maintenance' ? (
                <Tag color="orange">维护</Tag>
              ) : cloud?.status === 'offline' ? (
                <Tag color="red">离线</Tag>
              ) : (
                <Tag>未知</Tag>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="Endpoint">
              <Space>
                {cloud?.endpoint || '-'}
                {cloud?.endpoint && (
                  <Button
                    type="link"
                    size="small"
                    icon={<LoginOutlined />}
                    style={{ padding: 0 }}
                    onClick={() => {
                      let url = cloud.endpoint || '';
                      if (url.endsWith('/v3')) {
                        url = url.substring(0, url.length - 3);
                      } else if (url.endsWith('/v3/')) {
                        url = url.substring(0, url.length - 4);
                      }
                      window.open(url, '_blank');
                    }}
                  >
                    登录OPS
                  </Button>
                )}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="版本">{versionText}</Descriptions.Item>
            <Descriptions.Item label="CPU 架构">
              {capabilities?.architecture ? (
                capabilities.architecture === 'arm64' ||
                capabilities.architecture === 'aarch64' ? (
                  <Tag color="blue">ARM64</Tag>
                ) : (
                  <Tag color="blue">x86_64</Tag>
                )
              ) : (
                '-'
              )}
            </Descriptions.Item>
            <Descriptions.Item label="TLS 忽略">
              {tlsIgnored ? <Tag color="orange">是</Tag> : <Tag>否</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="网络插件">
              {hasKubeOvn ? (
                <Tag color="blue">Kube-OVN</Tag>
              ) : (
                <Tag>未知/未启用</Tag>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="资源ID">
              {cloud?.id || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="更新时间">
              {cloud?.updatedAt || '-'}
            </Descriptions.Item>
          </Descriptions>
        }
      >
        {error && (
          <Alert
            type="error"
            message="查询失败"
            description={error}
            style={{ marginBottom: 16 }}
            showIcon
          />
        )}
        <Tabs
          type="card"
          destroyOnHidden
          activeKey={activeTabKey}
          onChange={(key) => {
            setActiveTabKey(key);
            handleTabChange(key);
          }}
          items={[
            {
              key: 'overview',
              label: '资源总览',
              children: <CloudmapOverviewTab cloudId={cloudId} />,
            },
            ...(canViewMonitoringTab
              ? [
                  {
                    key: 'monitoring-alerts',
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
                        clusterInnerDefaultActiveKey={
                          clusterInnerDefaultActiveKey
                        }
                        clusterNetworkSegmentKey={clusterNetworkSegmentKey}
                        setClusterNetworkSegmentKey={
                          setClusterNetworkSegmentKey
                        }
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
                    key: 'compute_group',
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
                    key: 'storage_group',
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
                    key: 'backups_group',
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
                    key: 'flat_network_group',
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
                    key: 'kube_ovn_group',
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
                    key: 'logs-config',
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
