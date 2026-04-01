
// 页面门控分三层：
// 1) License/Feature：能力是否启用
// 2) RBAC：用户是否有读写权限
// 3) 标准/运维（mode）：仅影响各 Section 内交互/展示细节；Tab 显隐仅由授权 + RBAC 决定

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tag, Space, Button,  Alert, Tabs, Descriptions, message, Segmented } from 'antd';
// 引入各个资源模块组件 (注意路径调整，指向 Harvester 目录)
import NodesSection from '../Harvester/cluster/NodesSection';
import ImagesSection from '../Harvester/ecs/ImagesSection';
import VolumesSection from '../Harvester/ebs/VolumesSection';
import NadsSection from '../Harvester/nad/NadsSection';
import KubeOvnVpcsSection from '../Harvester/kube-ovn/VpcsSection';
import KubeOvnSubnetsSection from '../Harvester/kube-ovn/SubnetsSection';
import UnderlaySubnetsSection from '../Harvester/kube-ovn/UnderlaySubnetsSection';
import SecurityGroupsSection from '../Harvester/kube-ovn/SecurityGroupsSection';
import VlansSection from '../Harvester/kube-ovn/VlansSection';
import GpusSection from '../Harvester/cluster/GpusSection';
import MigrationsSection from '../Harvester/ecs/MigrationsSection';
import StorageClassesSection from '../Harvester/cluster/StorageClassesSection';
import SnapshotsSection from '../Harvester/ebs/SnapshotsSection';
import BackupsSection from '../Harvester/cbr/BackupsSection';
import SshKeysSection from '../Harvester/ecs/SshKeysSection';
import CloudInitsSection from '../Harvester/ecs/CloudInitsSection';
import ServicesSection from '../Harvester/cluster/ServicesSection';
import LoadBalancersSection from '../Harvester/nad/LoadBalancersSection';
import IPPoolsSection from '../Harvester/nad/IPPoolsSection';
import ClusterNetworksSection from '../Harvester/cluster/ClusterNetworksSection';
import ProviderNetworksSection from '../Harvester/kube-ovn/ProviderNetworksSection';
import RecycleBinSection from '../Harvester/ecs/RecycleBinSection';
import PciDevicesSection from '../Harvester/cluster/PciDevicesSection';
import UsbDevicesSection from '../Harvester/cluster/UsbDevicesSection';
// 重新编译触发引入
import NamespacesTab from '../Harvester/cluster/NamespacesTab';
import { CloudUploadOutlined, ArrowLeftOutlined, HomeOutlined, LoginOutlined, ReloadOutlined } from '@ant-design/icons';
import PageDetailContainer from '../../../components/PageDetailContainer';
import { API_BASE_URL, fetchCloudById, fetchCloudProviderEcs, startCloudProviderEcs, stopCloudProviderEcs, rebootCloudProviderEcs, softRebootCloudProviderEcs, pauseCloudProviderEcs, unpauseCloudProviderEcs, deleteCloudProviderEcs, apiPost } from '../../../services/api';
import { useAuth } from '../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../utils/accessMapping';
import {
  CLOUD_CLOUDMAP_OPS_VIEW_WRITE,
  CLOUD_PROVIDER_NETWORKS_READ,
  CLOUD_SUBNETS_FLAT_READ,
  CLOUD_SUBNETS_PUBLIC_READ,
  CLOUD_SUBNETS_VPC_READ,
} from '../../../constants/cloudPermissions';
import { isSystemNamespace } from '../../../utils/harvesterUtils';
// 引入Harvester特定的API请求函数
import { fetchHarvesterSnapshots, fetchHarvesterBackups, fetchHarvesterScheduleVmBackups, fetchHarvesterSshKeys, fetchHarvesterCloudInits, fetchHarvesterServices, fetchHarvesterLoadBalancers, fetchHarvesterIPPools, fetchHarvesterNads, fetchHarvesterImages, fetchHarvesterVolumes, fetchHarvesterNodes, fetchKubeOvnVpcs, fetchKubeOvnSubnets, fetchKubeOvnVlans, fetchKubeOvnProviderNetworks, fetchHarvesterGpuResources, fetchHarvesterNamespaces, fetchHarvesterStorageClasses, fetchHarvesterCapabilities, fetchHarvesterTemplates, fetchHarvesterClusterNetworks, fetchCloudProviderOvnEips, fetchCloudProviderOvnFips, fetchCloudProviderOvnSnatRules, fetchCloudProviderOvnDnatRules, stopHarvesterVm, fetchHarvesterUsbResources, fetchHarvesterPciDevices } from '../../../services/harvesterApi';
import VmReconfigureModal from '../Harvester/modals/VmReconfigureModal';
import SimpleVmCreateModal from '../Harvester/modals/SimpleVmCreateModal';
import VmSection from '../Harvester/ecs/VmSection';
import TemplatesSection from '../Harvester/ecs/TemplatesSection';
import ScheduleVmBackupsSection from '../Harvester/cbr/ScheduleVmBackupsSection';
import VmRestoreTasksSection from '../Harvester/cbr/VmRestoreTasksSection';
import EipSection from '../Harvester/kube-ovn/EipSection';
import FipSection from '../Harvester/kube-ovn/FipSection';
import MonitoringOverview from '../Harvester/Monitoring/MonitoringOverview';
import MonitoringAlerts from '../Harvester/Monitoring/MonitoringAlerts';
import LogsConfig from '../Harvester/Monitoring/LogsConfig';
import LogsTarget from '../Harvester/Monitoring/LogsTarget';
import LogOutputs from '../Harvester/Monitoring/LogOutputs';
import MonitoringPrometheusRules from '../Harvester/Monitoring/MonitoringPrometheusRules';
import MonitoringAlertNotificationPolicy from '../Harvester/Monitoring/MonitoringAlertNotificationPolicy';
import MonitoringAlertNotificationTargets from '../Harvester/Monitoring/MonitoringAlertNotificationTargets';
import MonitoringAlertSecrets from '../Harvester/Monitoring/MonitoringAlertSecrets';
import { MonitoringProvider } from '../Harvester/Monitoring/context/MonitoringContext';
import { LoggingProvider } from '../Harvester/Monitoring/context/LoggingContext';
import SnatSection from '../Harvester/kube-ovn/SnatSection';
import DnatSection from '../Harvester/kube-ovn/DnatSection';
import { getToken } from '../../../utils/tokenStorage';
import { clearCache } from '../../../utils/requestManager';
import { useLicense } from '../../../contexts/LicenseContext';

const REQUEST_TIMEOUT = 30000;

/**
 * 调试用的 JSON 展示组件
 */
const DebugJSON: React.FC<{ data: any; show: boolean }> = ({ data, show }) => {
  if (!show) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
};

/**
 * 云资源项接口定义
 */
interface CloudItem { id: string; name: string; region: string; type: string; config?: any; status?: string; endpoint?: string; description?: string; createdAt?: string; updatedAt?: string; }

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
  const checkPerm = React.useCallback((act: string) => hasPermissionForAction(permissions || [], act), [permissions]);
  /** 具备该权限方可将页面切到「运维」视图 */
  const canToggleOpsView = useMemo(() => checkPerm(CLOUD_CLOUDMAP_OPS_VIEW_WRITE), [checkPerm]);
  const canReadVpcSubnets = checkPerm(CLOUD_SUBNETS_VPC_READ) || checkPerm('clouds.subnets:read');
  const canReadFlatSubnets = checkPerm(CLOUD_SUBNETS_FLAT_READ) || checkPerm('clouds.subnets:read');
  const canReadPublicSubnets = checkPerm(CLOUD_SUBNETS_PUBLIC_READ) || checkPerm('clouds.subnets:read');
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
  const [resourceLoading, setResourceLoading] = useState<Record<string, boolean>>({});
  // 顶层错误提示（预留给初始化场景）
  const [error] = useState<string | null>(null);
  
  // --- 核心资源数据 ---
  const [ecs, setEcs] = useState<any[]>([]); // 虚拟机列表
  const [harvesterNads, setHarvesterNads] = useState<any[]>([]); // NAD网络列表
  const [harvesterImages, setHarvesterImages] = useState<any[]>([]); // 镜像列表
  const [harvesterVolumes, setHarvesterVolumes] = useState<any[]>([]); // 虚拟卷列表
  const [harvesterNodes, setHarvesterNodes] = useState<any[]>([]); // 节点列表
  const [harvesterNamespaces, setHarvesterNamespaces] = useState<any[]>([]); // 命名空间列表
  const [harvesterNamespacesForManagement, setHarvesterNamespacesForManagement] = useState<any[]>([]); // 命名空间管理列表（含系统命名空间）
  const [harvesterStorageClasses, setHarvesterStorageClasses] = useState<any[]>([]); // 存储类列表
  const [capabilities, setCapabilities] = useState<any>(null); // 集群能力（如架构信息）

  // --- Kube-OVN 网络相关数据 ---
  const [kubeOvnVpcs, setKubeOvnVpcs] = useState<any[]>([]);
  const [kubeOvnSubnets, setKubeOvnSubnets] = useState<any[]>([]);
  const [kubeOvnEips, setKubeOvnEips] = useState<any[]>([]);
  const [kubeOvnFips, setKubeOvnFips] = useState<any[]>([]);
  const [kubeOvnSnatRules, setKubeOvnSnatRules] = useState<any[]>([]);
  const [kubeOvnDnatRules, setKubeOvnDnatRules] = useState<any[]>([]);
  const [kubeOvnFlatEips, setKubeOvnFlatEips] = useState<any[]>([]);
  const [kubeOvnFlatFips, setKubeOvnFlatFips] = useState<any[]>([]);
  const [kubeOvnFlatSnatRules, setKubeOvnFlatSnatRules] = useState<any[]>([]);
  const [kubeOvnFlatDnatRules, setKubeOvnFlatDnatRules] = useState<any[]>([]);

  // --- 次要/按需加载资源数据 ---
  const [harvesterSnapshots, setHarvesterSnapshots] = useState<any[]>([]); // 卷快照
  const [harvesterBackups, setHarvesterBackups] = useState<any[]>([]); // 虚拟机备份
  const [harvesterSshKeys, setHarvesterSshKeys] = useState<any[]>([]); // SSH 密钥
  const [harvesterCloudInits, setHarvesterCloudInits] = useState<any[]>([]); // CloudInit 配置
  const [harvesterVlans, setHarvesterVlans] = useState<any[]>([]); // Kube-OVN VLANs
  const [harvesterKubeOvnProviderNetworks, setHarvesterKubeOvnProviderNetworks] = useState<any[]>([]); // 物理网络 / VLAN 筛选共用
  const [harvesterServices, setHarvesterServices] = useState<any[]>([]); // K8s 服务
  const [harvesterLoadBalancers, setHarvesterLoadBalancers] = useState<any[]>([]); // Harvester LoadBalancers
  const [harvesterIPPools, setHarvesterIPPools] = useState<any[]>([]); // IP 地址池
  const [harvesterClusterNetworks, setHarvesterClusterNetworks] = useState<any[]>([]); // 集群网络
  const [harvesterTemplates, setHarvesterTemplates] = useState<any[]>([]); // 虚拟机模板
  const [harvesterScheduleVmBackups, setHarvesterScheduleVmBackups] = useState<any[]>([]); // 定时备份策略
  const [harvesterGpuResources, setHarvesterGpuResources] = useState<any[]>([]); // GPU 资源
  const [harvesterUsbDevices, setHarvesterUsbDevices] = useState<any[]>([]); // USB 资源
  const [harvesterPciDevices, setHarvesterPciDevices] = useState<any[]>([]); // PCI 设备

  // --- UI 交互状态 ---
  const [vmReconfOpen, setVmReconfOpen] = useState(false); // 虚拟机配额调整模态框开关
  const [vmReconfTarget, setVmReconfTarget] = useState<any | null>(null); // 待调整的虚拟机对象
  const [nsFilter, setNsFilter] = useState<string>(''); // 命名空间筛选值
  const [nodeFilter, setNodeFilter] = useState<string>(''); // 节点筛选值
  const [showLog] = useState<boolean>(false); // 是否显示原始 JSON 日志
  /** 标准：租户向精简；运维：命名空间、ACL、运维抽屉等 */
  const [mode, setMode] = useState<'standard' | 'ops'>('standard');
  const [activeTabKey, setActiveTabKey] = useState<string>('overview');
  const [backupsGroupActiveKey, setBackupsGroupActiveKey] = useState<string>('backups');
  const [clusterNetworkSegmentKey, setClusterNetworkSegmentKey] = useState<string>('clusterNetworks');
  const [simpleVmCreateOpen, setSimpleVmCreateOpen] = useState(false);

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
  const [rawScheduleVmBackups, setRawScheduleVmBackups] = useState<any | null>(null);
  const [rawIPPools, setRawIPPools] = useState<any | null>(null);
  const [rawClusterNetworks, setRawClusterNetworks] = useState<any | null>(null);
  
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
  const loadResource = React.useCallback(async (key: string, fn: () => Promise<any>, cb: (json: any) => void, force = false) => {
    // 如果非强制刷新且已加载过，直接跳过
    if (!force && loadedRef.current.has(key)) return;
    
    // 强制刷新时，清除已加载标记，确保重新加载
    if (force && loadedRef.current.has(key)) {
      loadedRef.current.delete(key);
    }
    
    setResourceLoading(prev => ({ ...prev, [key]: true }));
    try {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`请求超时: ${key} (${REQUEST_TIMEOUT}ms)`)), REQUEST_TIMEOUT);
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
      setResourceLoading(prev => ({ ...prev, [key]: false }));
    }
  }, []);

  /**
   * 加载核心资源 (首页/概览页必须的数据)
   * 包括: 云信息, VM, 网络, 卷, 镜像, 节点, 命名空间
   * @param force 是否强制刷新
   */
  const loadEssentials = React.useCallback((force = false) => {
    // 1. 加载云池基础信息
    loadResource('cloud', () => fetchCloudById(cloudId, { skipCache: force }), (cloudRes) => {
      setCloud(cloudRes || null);
    }, force);

    // 2. 加载核心资源 (带权限检查)
    if (checkPerm('clouds.ecs:read')) {
      loadResource('ecs', () => fetchCloudProviderEcs(cloudId, force), (json) => {
        const list: any[] = Array.isArray((json as any)?.data) ? (json as any).data : (((json as any)?.data?.Instances?.Instance) || ((json as any)?.data?.items) || ((json as any)?.data?.data) || []);
        setEcs(Array.isArray(list) ? list : []);
        setRawEcs(json || null);
      }, force);
    }

    if (canReadNetworkScope) {
      loadResource('nads', () => fetchHarvesterNads(cloudId, force), (json) => {
        const list: any[] = (json as any)?.data?.items || [];
        setHarvesterNads(Array.isArray(list) ? list : []);
        setRawNads(json || null);
      }, force);
    }

    // VPC 列表：VPC 分组或扁平 OVN（FIP/DNAT 选 VPC）需要
    const shouldPrefetchVpcs =
      canViewKubeOvnGroup ||
      checkPerm('clouds.eips.flat:read') ||
      checkPerm('clouds.fips.flat:read') ||
      checkPerm('clouds.snat.flat:read') ||
      checkPerm('clouds.dnat.flat:read');
    // 扁平网络分组必须不受「VPC 授权」影响：即使未开通 network.ovn.vpc，也应允许拉取用于扁平 NAT 的 VPC 列表
    if (shouldPrefetchVpcs) {
      loadResource('vpcs', () => fetchKubeOvnVpcs(cloudId, force), (json) => {
        const list: any[] = (json as any)?.data?.items || [];
        setKubeOvnVpcs(Array.isArray(list) ? list : []);
        setRawVpcs(json || null);
      }, force);
    } else {
      setKubeOvnVpcs([]);
      setRawVpcs(null);
    }

    const shouldPrefetchKubeOvnSubnets =
      checkPerm('clouds:read') ||
      canReadFlatSubnets ||
      canReadVpcSubnets ||
      checkPerm('clouds.subnets:read') ||
      (ovnVpcEnabled && canViewKubeOvnGroup) ||
      // 扁平 EIP/SNAT 等不应被 VPC 授权控制
      checkPerm('clouds.snat.flat:read') ||
      checkPerm('clouds.eips.flat:read') ||
      // VPC 侧仍由授权控制
      (ovnVpcEnabled && (checkPerm('clouds.snat.vpc:read') || checkPerm('clouds.eips.vpc:read')));
    if (shouldPrefetchKubeOvnSubnets) {
      loadResource('subnets', () => fetchKubeOvnSubnets(cloudId, force), (json) => {
        const list: any[] = (json as any)?.data?.items || [];
        setKubeOvnSubnets(Array.isArray(list) ? list : []);
        setRawSubnets(json || null);
      }, force);
    }

    if (checkPerm('clouds.images:read') || checkPerm('clouds.ecs:read')) {
      loadResource('images', () => fetchHarvesterImages(cloudId, force), (json) => {
        const list: any[] = (json as any)?.data?.items || [];
        setHarvesterImages(Array.isArray(list) ? list : []);
        setRawImages(json || null);
      }, force);
    }

    if (checkPerm('clouds.disks:read')) {
      loadResource('volumes', () => fetchHarvesterVolumes(cloudId, force), (json) => {
        const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : (Array.isArray((json as any)?.items) ? (json as any).items : []);
        setHarvesterVolumes(Array.isArray(list) ? list : []);
        setRawVolumes(json || null);
      }, force);
    }

    if (checkPerm('clouds.storage-classes:read') || checkPerm('clouds.ecs:read')) {
      loadResource('storageClasses', () => fetchHarvesterStorageClasses(cloudId, force), (json) => {
        const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : (Array.isArray((json as any)?.items) ? (json as any).items : []);
        setHarvesterStorageClasses(Array.isArray(list) ? list : []);
      }, force);
    }

    if (checkPerm('clouds.cluster-nodes:read') || checkPerm('clouds.ecs:read')) {
      loadResource('nodes', () => fetchHarvesterNodes(cloudId, force), (json) => {
        const list: any[] = (json as any)?.data?.items || [];
        setHarvesterNodes(Array.isArray(list) ? list : []);
        setRawNodes(json || null);
      }, force);
    }

    loadResource('namespaces', () => fetchHarvesterNamespaces(cloudId, force, true), (json) => {
        const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : (Array.isArray((json as any)?.items) ? (json as any).items : []);
        setHarvesterNamespaces(Array.isArray(list) ? list : []);
        setRawNamespaces(json || null);
    }, force);

    loadResource('capabilities', () => fetchHarvesterCapabilities(cloudId), (json) => {
        setCapabilities(json?.data || null);
    }, force);
  }, [
    cloudId,
    loadResource,
    checkPerm,
    canReadNetworkScope,
    canViewKubeOvnGroup,
    ovnVpcEnabled,
    canReadFlatSubnets,
    canReadVpcSubnets,
  ]);

  /**
   * 按需加载标签页资源 (Lazy Loading)
   * 仅在用户切换到对应 Tab 时触发加载
   * @param key Tab 的 key 或资源标识
   * @param force 是否强制刷新
   */
  const loadTabResource = async (key: string, force = false, skipSync = false) => {
      switch (key) {
          case 'namespaces':
            if (checkPerm('clouds.namespaces:read') || checkPerm('clouds.ecs:read')) {
              setResourceLoading((prev) => ({ ...prev, namespaces: true }));
              try {
                const json = await fetchHarvesterNamespaces(cloudId, force, false, skipSync);
                const list: any[] = Array.isArray((json as any)?.data?.items)
                  ? (json as any).data.items
                  : Array.isArray((json as any)?.items)
                    ? (json as any).items
                    : [];
                setHarvesterNamespacesForManagement(Array.isArray(list) ? list : []);
                const filtered = list.filter((ns: any) => {
                  const name = ns?.metadata?.name || ns?.name;
                  return name && !isSystemNamespace(name);
                });
                setHarvesterNamespaces(filtered);
              } catch (e) {
                console.warn('Failed to load namespaces for management', e);
              } finally {
                setResourceLoading((prev) => ({ ...prev, namespaces: false }));
              }
            }
            break;
          case 'volumes':
            // 确保进入 PVC 页面时，关联的 VM 数据也已加载 (用于挂载操作)
            if (checkPerm('clouds.ecs:read')) {
              loadResource('ecs', () => fetchCloudProviderEcs(cloudId, force), (json) => {
                const list: any[] = Array.isArray((json as any)?.data) ? (json as any).data : (((json as any)?.data?.Instances?.Instance) || ((json as any)?.data?.items) || ((json as any)?.data?.data) || []);
                setEcs(Array.isArray(list) ? list : []);
                setRawEcs(json || null);
              }, force);
            }
            break;
          case 'snapshots':
            if (checkPerm('clouds.snapshots:read')) {
              loadResource('snapshots', () => fetchHarvesterSnapshots(cloudId, force), (json) => {
                const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : [];
                setHarvesterSnapshots(Array.isArray(list) ? list : []);
                setRawSnapshots(json || null);
              }, force);
            }
            break;
          case 'backups':
            // 与云备份内层 Tab 可见条件对齐：clouds.backups:read（含 clouds:read 扩张），勿仅绑 ecs:read
            if (checkPerm('clouds.backups:read')) {
              loadResource('backups', () => fetchHarvesterBackups(cloudId, force), (json) => {
                const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : [];
                setHarvesterBackups(Array.isArray(list) ? list : []);
                setRawBackups(json || null);
              }, force);
              loadResource('scheduleVmBackups', () => fetchHarvesterScheduleVmBackups(cloudId, force), (json) => {
                const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : [];
                setHarvesterScheduleVmBackups(Array.isArray(list) ? list : []);
                setRawScheduleVmBackups(json || null);
              }, force);
            }
            break;
          case 'ssh_keys':
            if (checkPerm('clouds.sshkeys:read')) {
              loadResource('sshKeys', () => fetchHarvesterSshKeys(cloudId, force), (json) => {
                const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : [];
                setHarvesterSshKeys(Array.isArray(list) ? list : []);
                setRawSshKeys(json || null);
              }, force);
            }
            break;
          case 'cloud_inits':
            if (checkPerm('clouds.cloudinits:read')) {
              loadResource('cloudInits', () => fetchHarvesterCloudInits(cloudId, force), (json) => {
                const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : [];
                setHarvesterCloudInits(Array.isArray(list) ? list : []);
                setRawCloudInits(json || null);
              }, force);
            }
            break;
          case 'templates':
            if (checkPerm('clouds.templates:read')) {
              loadResource('templates', () => fetchHarvesterTemplates(cloudId, force, false), (json) => {
                const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : [];
                setHarvesterTemplates(Array.isArray(list) ? list : []);
                setRawTemplates(json || null);
              }, force);
            }
            break;
          case 'gpu':
            if (checkPerm('clouds.gpus:read') || checkPerm('clouds.ecs:read')) {
              loadResource('gpu', () => fetchHarvesterGpuResources(cloudId, force), (json) => {
                const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : (Array.isArray((json as any)?.items) ? (json as any).items : []);
                setHarvesterGpuResources(Array.isArray(list) ? list : []);
                setRawGpu(json || null);
              }, force);
            }
            break;
          case 'usb_devices':
          case 'cluster_usb':
            if (checkPerm('clouds.usb-devices:read') || checkPerm('clouds.ecs:read')) {
              loadResource('usbDevices', () => fetchHarvesterUsbResources(cloudId, force), (json) => {
                const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : (Array.isArray((json as any)?.items) ? (json as any).items : []);
                setHarvesterUsbDevices(Array.isArray(list) ? list : []);
                setRawUsbDevices(json || null);
              }, force);
            }
            break;
          case 'pci_devices':
          case 'cluster_pci':
            if (checkPerm('clouds.pci-devices:read') || checkPerm('clouds.ecs:read')) {
              loadResource('pciDevices', () => fetchHarvesterPciDevices(cloudId, force), (json) => {
                const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : (Array.isArray((json as any)?.items) ? (json as any).items : []);
                setHarvesterPciDevices(Array.isArray(list) ? list : []);
                setRawPciDevices(json || null);
              }, force);
            }
            break;
          case 'load_balancers':
            if (canReadLoadBalancers) {
              loadResource('loadBalancers', () => fetchHarvesterLoadBalancers(cloudId, force), (json) => {
                const list = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : [];
                setHarvesterLoadBalancers(list);
                setRawLoadBalancers(json || null);
              }, force);
            }
            break;
          case 'cluster_services':
          case 'services':
            if (checkPerm('clouds.cluster-services:read')) {
              loadResource('services', () => fetchHarvesterServices(cloudId, force), (json) => {
                const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : [];
                setHarvesterServices(Array.isArray(list) ? list : []);
                setRawServices(json || null);
              }, force);
            }
            break;
          case 'cluster_vlans':
          case 'vlans':
            if (checkPerm('clouds.vlans:read') || checkPerm(CLOUD_PROVIDER_NETWORKS_READ)) {
              loadResource('vlans', () => fetchKubeOvnVlans(cloudId, force, skipSync), (json) => {
                const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : [];
                setHarvesterVlans(Array.isArray(list) ? list : []);
                setRawVlans(json || null);
                if (force && cloudId) {
                  clearCache(`/api/clouds/${cloudId}/resources/vlans`, 'GET');
                }
              }, force);
              loadResource('kubeOvnProviderNetworks', () => fetchKubeOvnProviderNetworks(cloudId, force, skipSync), (json) => {
                const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : [];
                setHarvesterKubeOvnProviderNetworks(Array.isArray(list) ? list : []);
              }, force);
            }
            break;
          case 'ippools':
            if (checkPerm('clouds.nads:read')) {
              loadResource('ippools', () => fetchHarvesterIPPools(cloudId, force), (json) => {
                const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : [];
                setHarvesterIPPools(Array.isArray(list) ? list : []);
                setRawIPPools(json || null);
              }, force);
            }
            break;
          case 'clusterNetworks':
            if (checkPerm('clouds.cluster-networks:read')) {
              loadResource('clusterNetworks', () => fetchHarvesterClusterNetworks(cloudId, force), (json) => {
                const list: any[] = Array.isArray((json as any)?.items) ? (json as any).items : [];
                setHarvesterClusterNetworks(Array.isArray(list) ? list : []);
                setRawClusterNetworks(json || null);
              }, force);
            }
            break;
          case 'cluster_nodes':
            if (checkPerm('clouds.cluster-nodes:read') || checkPerm('clouds.ecs:read')) {
              loadResource('nodes', () => fetchHarvesterNodes(cloudId, force), (json) => {
                const list: any[] = (json as any)?.data?.items || [];
                setHarvesterNodes(Array.isArray(list) ? list : []);
                setRawNodes(json || null);
              }, force);
            }
            break;
          case 'storage_classes':
            if (checkPerm('clouds.storage-classes:read') || checkPerm('clouds.ecs:read')) {
              loadResource('storageClasses', () => fetchHarvesterStorageClasses(cloudId, force), (json) => {
                const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : (Array.isArray((json as any)?.items) ? (json as any).items : []);
                setHarvesterStorageClasses(Array.isArray(list) ? list : []);
              }, force);
            }
            break;
          case 'kubeovn_public_networks':
            if (checkPerm(CLOUD_PROVIDER_NETWORKS_READ)) {
              loadResource(
                'providerNetworksTab',
                async () => {
                  const [pnRes, vlanRes] = await Promise.all([
                    fetchKubeOvnProviderNetworks(cloudId, force, skipSync),
                    fetchKubeOvnVlans(cloudId, force, skipSync).catch(() => ({ data: { items: [] } })),
                  ]);
                  return { pn: pnRes, vlan: vlanRes };
                },
                (json: any) => {
                  if (!json?.pn) {
                    setHarvesterKubeOvnProviderNetworks([]);
                    return;
                  }
                  const pnItems = Array.isArray(json.pn?.data?.items) ? json.pn.data.items : [];
                  const vItems = Array.isArray(json.vlan?.data?.items) ? json.vlan.data.items : [];
                  setHarvesterKubeOvnProviderNetworks(pnItems);
                  setHarvesterVlans(vItems);
                  setRawVlans(json.vlan || null);
                  if (!force) {
                    loadedRef.current.add('vlans');
                    loadedRef.current.add('kubeOvnProviderNetworks');
                  }
                  if (force && cloudId) {
                    clearCache(`/api/clouds/${cloudId}/resources/provider-networks`, 'GET');
                    clearCache(`/api/clouds/${cloudId}/resources/vlans`, 'GET');
                  }
                },
                force,
              );
            }
            break;
          case 'kube_ovn_group':
            // 进入 VPC 分组时不「一刀切」拉四类 NAT；仅按对应读权限拉取（与内层 Tab filter 一致），避免无原子仍请求
            if (!canViewKubeOvnGroup) break;
            if (checkPerm('clouds.eips.vpc:read')) {
              loadResource('eips', () => fetchCloudProviderOvnEips(cloudId, force, 'vpc'), (json) => {
                const list: any[] = (json as any)?.data?.items || [];
                setKubeOvnEips(Array.isArray(list) ? list : []);
                setRawEips(json || null);
              }, force);
            }
            if (checkPerm('clouds.fips.vpc:read')) {
              loadResource('fips', () => fetchCloudProviderOvnFips(cloudId, force, 'vpc'), (json) => {
                const list: any[] = (json as any)?.data?.items || [];
                setKubeOvnFips(Array.isArray(list) ? list : []);
                setRawFips(json || null);
              }, force);
            }
            if (checkPerm('clouds.snat.vpc:read')) {
              loadResource('snatRules', () => fetchCloudProviderOvnSnatRules(cloudId, force, false, 'vpc'), (json) => {
                const list: any[] = (json as any)?.data?.items || [];
                setKubeOvnSnatRules(Array.isArray(list) ? list : []);
                setRawSnatRules(json || null);
              }, force);
            }
            if (checkPerm('clouds.dnat.vpc:read')) {
              loadResource('dnatRules', () => fetchCloudProviderOvnDnatRules(cloudId, force, false, 'vpc'), (json) => {
                const list: any[] = (json as any)?.data?.items || [];
                setKubeOvnDnatRules(Array.isArray(list) ? list : []);
                setRawDnatRules(json || null);
              }, force);
            }
            break;
          case 'flat_network_group':
            // 扁平网络分组必须不受「VPC 授权」影响
            if (!canViewFlatNetworkGroup) break;
            if (checkPerm('clouds.eips.flat:read')) {
              loadResource('flatEips', () => fetchCloudProviderOvnEips(cloudId, force, 'flat'), (json) => {
                const list: any[] = (json as any)?.data?.items || [];
                setKubeOvnFlatEips(Array.isArray(list) ? list : []);
              }, force);
            }
            if (checkPerm('clouds.fips.flat:read')) {
              loadResource('flatFips', () => fetchCloudProviderOvnFips(cloudId, force, 'flat'), (json) => {
                const list: any[] = (json as any)?.data?.items || [];
                setKubeOvnFlatFips(Array.isArray(list) ? list : []);
              }, force);
            }
            if (checkPerm('clouds.snat.flat:read')) {
              loadResource('flatSnatRules', () => fetchCloudProviderOvnSnatRules(cloudId, force, false, 'flat'), (json) => {
                const list: any[] = (json as any)?.data?.items || [];
                setKubeOvnFlatSnatRules(Array.isArray(list) ? list : []);
              }, force);
            }
            if (checkPerm('clouds.dnat.flat:read')) {
              loadResource('flatDnatRules', () => fetchCloudProviderOvnDnatRules(cloudId, force, false, 'flat'), (json) => {
                const list: any[] = (json as any)?.data?.items || [];
                setKubeOvnFlatDnatRules(Array.isArray(list) ? list : []);
              }, force);
            }
            break;
          case 'eips':
          case 'kubeovn_eips':
          case 'fips':
          case 'kubeovn_fips':
          case 'snat':
          case 'kubeovn_snat':
          case 'dnat':
          case 'kubeovn_dnat':
            if (canViewKubeOvnGroup) {
                if (key === 'eips' || key === 'kubeovn_eips') {
                    loadResource('eips', () => fetchCloudProviderOvnEips(cloudId, force, 'vpc'), (json) => {
                        const list: any[] = (json as any)?.data?.items || [];
                        setKubeOvnEips(Array.isArray(list) ? list : []);
                        setRawEips(json || null);
                    }, force);
                }
                if (key === 'fips' || key === 'kubeovn_fips') {
                    loadResource('fips', () => fetchCloudProviderOvnFips(cloudId, force, 'vpc'), (json) => {
                        const list: any[] = (json as any)?.data?.items || [];
                        setKubeOvnFips(Array.isArray(list) ? list : []);
                        setRawFips(json || null);
                    }, force);
                }
                if (key === 'snat' || key === 'kubeovn_snat') {
                    loadResource('snatRules', () => fetchCloudProviderOvnSnatRules(cloudId, force, false, 'vpc'), (json) => {
                        const list: any[] = (json as any)?.data?.items || [];
                        setKubeOvnSnatRules(Array.isArray(list) ? list : []);
                        setRawSnatRules(json || null);
                    }, force);
                }
                if (key === 'dnat' || key === 'kubeovn_dnat') {
                    loadResource('dnatRules', () => fetchCloudProviderOvnDnatRules(cloudId, force, false, 'vpc'), (json) => {
                        const list: any[] = (json as any)?.data?.items || [];
                        setKubeOvnDnatRules(Array.isArray(list) ? list : []);
                        setRawDnatRules(json || null);
                    }, force);
                }
            }
            break;
          case 'flat_kubeovn_eips':
          case 'flat_kubeovn_fips':
          case 'flat_kubeovn_snat':
          case 'flat_kubeovn_dnat':
            // 扁平网络分组必须不受「VPC 授权」影响
            if (!canViewFlatNetworkGroup) break;
            if (key === 'flat_kubeovn_eips' && checkPerm('clouds.eips.flat:read')) {
              loadResource('flatEips', () => fetchCloudProviderOvnEips(cloudId, force, 'flat'), (json) => {
                const list: any[] = (json as any)?.data?.items || [];
                setKubeOvnFlatEips(Array.isArray(list) ? list : []);
              }, force);
            }
            if (key === 'flat_kubeovn_fips' && checkPerm('clouds.fips.flat:read')) {
              loadResource('flatFips', () => fetchCloudProviderOvnFips(cloudId, force, 'flat'), (json) => {
                const list: any[] = (json as any)?.data?.items || [];
                setKubeOvnFlatFips(Array.isArray(list) ? list : []);
              }, force);
            }
            if (key === 'flat_kubeovn_snat' && checkPerm('clouds.snat.flat:read')) {
              loadResource('flatSnatRules', () => fetchCloudProviderOvnSnatRules(cloudId, force, false, 'flat'), (json) => {
                const list: any[] = (json as any)?.data?.items || [];
                setKubeOvnFlatSnatRules(Array.isArray(list) ? list : []);
              }, force);
            }
            if (key === 'flat_kubeovn_dnat' && checkPerm('clouds.dnat.flat:read')) {
              loadResource('flatDnatRules', () => fetchCloudProviderOvnDnatRules(cloudId, force, false, 'flat'), (json) => {
                const list: any[] = (json as any)?.data?.items || [];
                setKubeOvnFlatDnatRules(Array.isArray(list) ? list : []);
              }, force);
            }
            break;
      }
  };

  const refreshVlans = async (force = false, skipSync = false) => {
    if (!checkPerm('clouds.vlans:read') && !checkPerm(CLOUD_PROVIDER_NETWORKS_READ)) return;
    await loadTabResource('vlans', force, skipSync);
  };

  /**
   * 全局/手动刷新函数
   * 策略：刷新所有核心资源 + 刷新所有"已加载过"的按需资源
   * 这保证了用户看到的页面内容最新，同时避免盲目加载所有 Tab
   */
  const loadAll = async (force: boolean | any = false) => {
    // 兼容事件对象调用
    const isForce = force === true || (typeof force === 'object' && force !== null);
    
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
      const secondaryKeys = ['snapshots', 'backups', 'ssh_keys', 'cloud_inits', 'templates', 'gpu', 'services', 'vlans', 'ippools', 'clusterNetworks', 'kubeovn_public_networks', 'eips', 'fips', 'snat', 'dnat', 'load_balancers'];
      // 只有当资源之前被加载过，才刷新它
      secondaryKeys.forEach(k => {
        let shouldRefresh = false;
        if (k === 'snapshots' && previouslyLoaded.includes('snapshots')) shouldRefresh = true;
        if (k === 'backups' && (previouslyLoaded.includes('backups') || previouslyLoaded.includes('scheduleVmBackups'))) shouldRefresh = true;
        if (k === 'ssh_keys' && previouslyLoaded.includes('sshKeys')) shouldRefresh = true;
        if (k === 'cloud_inits' && previouslyLoaded.includes('cloudInits')) shouldRefresh = true;
        if (k === 'templates' && previouslyLoaded.includes('templates')) shouldRefresh = true;
        if (k === 'gpu' && previouslyLoaded.includes('gpu')) shouldRefresh = true;
        if (k === 'services' && previouslyLoaded.includes('services')) shouldRefresh = true;
        if (k === 'vlans' && previouslyLoaded.includes('vlans')) shouldRefresh = true;
        if (k === 'ippools' && previouslyLoaded.includes('ippools')) shouldRefresh = true;
        if (k === 'load_balancers' && previouslyLoaded.includes('loadBalancers')) shouldRefresh = true;
        if (k === 'clusterNetworks' && previouslyLoaded.includes('clusterNetworks')) shouldRefresh = true;
        if (k === 'kubeovn_public_networks' && previouslyLoaded.includes('providerNetworksTab')) shouldRefresh = true;
        if (k === 'eips' && previouslyLoaded.includes('eips')) shouldRefresh = true;
        if (k === 'fips' && previouslyLoaded.includes('fips')) shouldRefresh = true;
        if (k === 'snat' && previouslyLoaded.includes('snatRules')) shouldRefresh = true;
        if (k === 'dnat' && previouslyLoaded.includes('dnatRules')) shouldRefresh = true;

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
    setResourceLoading(prev => ({ ...prev, ecs: true }));
    try {
      // 如果强制刷新，先触发一次后端同步
      if (force) {
        try { await apiPost(`/api/clouds/${cloudId}/sync`); } catch {}
      }
      const json = await fetchCloudProviderEcs(cloudId, force);
      const list: any[] = Array.isArray((json as any)?.data) ? (json as any).data : (((json as any)?.data?.Instances?.Instance) || ((json as any)?.data?.items) || ((json as any)?.data?.data) || []);
      setEcs(Array.isArray(list) ? list : []);
      setRawEcs(json || null);
    } catch (e) {
      console.warn(`Failed to load ecs`, e);
    } finally {
      setResourceLoading(prev => ({ ...prev, ecs: false }));
    }
  };

  // --- 初始化 Effect ---
  // 仅在组件挂载或 cloudId 变化时加载核心资源
  useEffect(() => { loadEssentials(); }, [loadEssentials]);

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
    if (key === 'backups_group' || key === 'schedule_vm_backups' || key === 'vm_snapshots') {
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
      const urlObj = new URL(`${API_BASE_URL}/api/clouds/${cloudId}/resources/ecs/stream`);
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
          setEcs(prev => {
            const iid = String(r?.InstanceId || r?.id || '');
            if (!iid) return prev;
            // 去重防止重复添加
            if ((prev || []).some((x:any)=> String(x?.InstanceId||x?.id||'')===iid)) return prev;
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
          setEcs(prev => (prev || []).filter((x:any)=> String(x?.InstanceId||x?.id||'')!==iid));
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
    return () => { try { es?.close(); } catch {} };
  }, [cloudId]);

  // --- 定时刷新 VM 状态缓冲 ---
  // 每秒检查一次缓冲区，如果有状态更新则合并到 ecs 状态中
  useEffect(() => {
    const timer = setInterval(() => {
      if (vmStatusBuffer.current.size === 0) return;
      
      const updates = new Map(vmStatusBuffer.current);
      vmStatusBuffer.current.clear();
      
      setEcs(prev => {
        let hasChanges = false;
        const next = (prev || []).map((x:any)=> {
           const xiid = String(x?.InstanceId||x?.id||'');
           if (updates.has(xiid)) {
              const json = updates.get(xiid);
              const statusStr = String(json?.status || '');
              const nodeName = String(json?.nodeName || '');
              const ips = Array.isArray(json?.ips) ? json.ips : [];
              
              // 比较状态是否有实质变化
              const currentStatus = String(x?.status?.printableStatus || x?.status?.phase || x?.Status || '');
              const currentNode = String(x?.vmi?.status?.nodeName || x?.status?.nodeName || x?.Extra?.NodeName || '');
              
              // 简单的 IP 比较策略
              const currentIps = x?.ips || [];
              const ipsChanged = ips.length !== currentIps.length || ips.some((ip:string) => !currentIps.includes(ip));

              if (currentStatus === statusStr && currentNode === nodeName && !ipsChanged) {
                  return x;
              }

              hasChanges = true;
              const newItem = { ...x };
              
              // 更新状态结构 (保持兼容性)
              newItem.Status = statusStr; 
              if (typeof newItem.status === 'object' && newItem.status !== null) {
                  newItem.status = { ...newItem.status, printableStatus: statusStr, phase: statusStr };
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
    ecs.forEach((r:any)=>{ 
        const n = r?.nodeName || r?.vmi?.status?.nodeName || r?.status?.nodeName || r?.Extra?.NodeName || '';
        if (n) s.add(n); 
    });
    return Array.from(s).sort();
  }, [ecs]);

  // 命名空间选项列表
  const namespacesOptions = useMemo(() => {
    // 简单直接：仅基于 harvesterNamespaces 生成列表
    // 列表的完整性由 loadEssentials 保证 (管理员加载所有，租户只加载可见的)
    const list = (harvesterNamespaces || [])
      .map((n: any) => n?.metadata?.name || n?.name || '')
      .filter(Boolean);
    
    return Array.from(new Set(list)).sort();
  }, [harvesterNamespaces]);

  const providerName = 'Cloudmap';
  
  const versionText = useMemo(() => {
    const fromConfig = cloud?.config?.harvesterVersion;
    const fromNodes = (harvesterNodes.find((n:any)=> n?.version)?.version) || undefined;
    return fromConfig || fromNodes || '-';
  }, [cloud, harvesterNodes]);
  const hasKubeOvn = useMemo(() => (kubeOvnVpcs.length > 0 || kubeOvnSubnets.length > 0), [kubeOvnVpcs, kubeOvnSubnets]);
  const tlsIgnored = !!(cloud?.config?.ignoreTls);
  const clusterNetworkSegmentOptions = useMemo(() => {
    const opts = [
      { value: 'clusterNetworks', label: '集群网络', visible: checkPerm('clouds.cluster-networks:read') },
      { value: 'nads', label: '附加网络(NAD)', visible: canReadNetworkScope },
      { value: 'load_balancers', label: '负载均衡', visible: canReadLoadBalancers },
      { value: 'ippools', label: 'IP地址池', visible: checkPerm('clouds.nads:read') },
    ];
    return opts.filter((i) => i.visible).map(({ value, label }) => ({ value, label }));
  }, [checkPerm, canReadNetworkScope, canReadLoadBalancers]);

  useEffect(() => {
    if (!clusterNetworkSegmentOptions.length) return;
    const stillValid = clusterNetworkSegmentOptions.some((i) => i.value === clusterNetworkSegmentKey);
    if (!stillValid) {
      setClusterNetworkSegmentKey(clusterNetworkSegmentOptions[0].value as string);
    }
  }, [clusterNetworkSegmentOptions, clusterNetworkSegmentKey]);

  /** 集群内层 Tabs：defaultActiveKey 与首个有权限的子 Tab 对齐，避免空白内容区 */
  const clusterInnerDefaultActiveKey = useMemo(() => {
    if (checkPerm('clouds.cluster-nodes:read')) return 'cluster_nodes';
    if (checkPerm('clouds.cluster-services:read')) return 'cluster_services';
    if (clusterNetworkSegmentOptions.length > 0) return 'clusterNetworks';
    if (checkPerm('clouds.vlans:read') || checkPerm(CLOUD_PROVIDER_NETWORKS_READ)) {
      return checkPerm('clouds.vlans:read') ? 'cluster_vlans' : 'kubeovn_public_networks';
    }
    if (canReadPublicSubnets) return 'kubeovn_public_subnets';
    if (checkPerm('clouds.namespaces:read') || checkPerm('clouds:read')) return 'namespaces';
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
    <PageDetailContainer
      breadcrumbs={[
        { title: <HomeOutlined />, href: '/' },
        { title: '资源控制台' },
        { title: '资源池管理', href: '/admin/clouds' },
        { title: `${providerName} ${cloud?.name || '-'}` }
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
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/admin/clouds')}></Button>
          <Button icon={<ReloadOutlined />} onClick={() => loadAll(true)} />
      </Space>
      }
      asCard={false}
      subtitle="Cloudmap云平台详情页，统一纳管与可视化平台资源及网络拓扑"
      defaultOverviewCollapsed
      overviewContent={(
        <Descriptions bordered size="small" column={4}>
          <Descriptions.Item label="资源名称">{cloud?.name || '-'}</Descriptions.Item>
          <Descriptions.Item label="资源供应商">{providerName}</Descriptions.Item>
          <Descriptions.Item label="资源地域">{cloud?.region || '-'}</Descriptions.Item>
          <Descriptions.Item label="资源类型">{cloud?.type || '-'}</Descriptions.Item>
          <Descriptions.Item label="资源状态">{cloud?.status === 'online' ? <Tag color="green">在线</Tag> : cloud?.status === 'maintenance' ? <Tag color="orange">维护</Tag> : cloud?.status === 'offline' ? <Tag color="red">离线</Tag> : <Tag>未知</Tag>}</Descriptions.Item>
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
              (capabilities.architecture === 'arm64' || capabilities.architecture === 'aarch64') 
                ? <Tag color="blue">ARM64</Tag> 
                : <Tag color="blue">x86_64</Tag>
            ) : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="TLS 忽略">{tlsIgnored ? <Tag color="orange">是</Tag> : <Tag>否</Tag>}</Descriptions.Item>
          <Descriptions.Item label="网络插件">{hasKubeOvn ? <Tag color="blue">Kube-OVN</Tag> : <Tag>未知/未启用</Tag>}</Descriptions.Item>
          <Descriptions.Item label="资源ID">{cloud?.id || '-'}</Descriptions.Item>
          <Descriptions.Item label="更新时间">{cloud?.updatedAt || '-'}</Descriptions.Item>
        </Descriptions>
      )}
    >
      {error && (
        <Alert type="error" message="查询失败" description={error} style={{ marginBottom: 16 }} showIcon />
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
              children: <MonitoringOverview cloudId={cloudId} />
            },
            ...(canViewMonitoringTab ? [{
              key: 'monitoring-alerts',
              label: '监控告警',
              children: (
                <MonitoringProvider cloudId={cloudId}>
                  <Tabs
                    defaultActiveKey="alerts-list"
                    tabPosition="top"
                    type="line"
                    destroyOnHidden
                    items={[
                      {
                        key: 'alerts-list',
                        label: '告警列表',
                        children: <MonitoringAlerts cloudId={cloudId} />,
                      },
                      {
                        key: 'alert-rules',
                        label: '告警规则',
                        children: <MonitoringPrometheusRules cloudId={cloudId} />,
                      },
                      {
                        key: 'notification-policy',
                        label: '告警通知策略',
                        children: <MonitoringAlertNotificationPolicy cloudId={cloudId} />,
                      },
                      {
                        key: 'notification-targets',
                        label: '告警通知对象',
                        children: <MonitoringAlertNotificationTargets cloudId={cloudId} />,
                      },
                      {
                        key: 'alert-secrets',
                        label: '告警密钥',
                        children: <MonitoringAlertSecrets cloudId={cloudId} />,
                      },
                    ].filter((i: any) => {
                      if (i.key === 'alerts-list') return checkPerm('clouds.alerts:read');
                      if (i.key === 'alert-rules') return checkPerm('clouds.alert-rules:read');
                      if (i.key === 'notification-policy') return checkPerm('clouds.alert-policies:read');
                      if (i.key === 'notification-targets') return checkPerm('clouds.alert-receivers:read');
                      if (i.key === 'alert-secrets') return checkPerm('clouds.alert-secrets:read');
                      return true;
                    })}
                  />
                </MonitoringProvider>
              )
            }] : []),
            ...(canViewClusterGroup ? [{
              key: 'cluster',
              label: '集群',
              children: (
                <Tabs
                  type="line"
                  destroyOnHidden={false}
                  defaultActiveKey={clusterInnerDefaultActiveKey}
                  onChange={(key) => {
                    if (key === 'clusterNetworks') {
                      handleTabChange(clusterNetworkSegmentKey);
                      return;
                    }
                    handleTabChange(key);
                  }}
                  items={[
                    {
                      key: 'cluster_nodes',
                      label: '物理节点',
                      children: (
                        <>
                          <NodesSection
                            nodes={harvesterNodes}
                            loading={resourceLoading.nodes || nodesLoading}
                            onRefresh={refreshNodes}
                            cloudId={cloudId}
                            mode={mode}
                          />
                          <DebugJSON data={rawNodes} show={showLog} />
                        </>
                      )
                    },
                    {
                      key: 'cluster_services',
                      label: '基础服务 ',
                      children: (
                        <>
                          <ServicesSection cloudId={cloudId} services={harvesterServices} loading={resourceLoading.services} onRefresh={() => loadTabResource('services', true)} mode={mode} />
                          <DebugJSON data={rawServices} show={showLog} />
                        </>
                      )
                    },
                    {
                      key: 'clusterNetworks',
                      label: '集群网络',
                      children: (
                        <>
                          <Segmented
                            style={{ marginBottom: 12 }}
                            options={clusterNetworkSegmentOptions}
                            value={clusterNetworkSegmentKey}
                            onChange={(value) => {
                              const v = String(value);
                              setClusterNetworkSegmentKey(v);
                              handleTabChange(v);
                            }}
                          />
                          {clusterNetworkSegmentKey === 'clusterNetworks' && (
                            <>
                              <ClusterNetworksSection cloudId={cloudId} clusterNetworks={harvesterClusterNetworks} loading={resourceLoading.clusterNetworks} onRefresh={() => loadTabResource('clusterNetworks', true)} mode={mode} isTenant={isTenant} />
                              <DebugJSON data={rawClusterNetworks} show={showLog} />
                            </>
                          )}
                          {clusterNetworkSegmentKey === 'nads' && (
                            <>
                              <NadsSection nads={harvesterNads} loading={resourceLoading.nads || nadsLoading} onRefresh={refreshNads} cloudId={cloudId} mode={mode} />
                              <DebugJSON data={rawNads} show={showLog} />
                            </>
                          )}
                          {clusterNetworkSegmentKey === 'load_balancers' && (
                            <>
                              <LoadBalancersSection cloudId={cloudId} loadBalancers={harvesterLoadBalancers} loading={resourceLoading.loadBalancers} onRefresh={() => loadTabResource('load_balancers', true)} mode={mode} />
                              <DebugJSON data={rawLoadBalancers} show={showLog} />
                            </>
                          )}
                          {clusterNetworkSegmentKey === 'ippools' && (
                            <>
                              <IPPoolsSection cloudId={cloudId} ippools={harvesterIPPools} loading={resourceLoading.ippools} onRefresh={() => loadTabResource('ippools', true)} mode={mode} />
                              <DebugJSON data={rawIPPools} show={showLog} />
                            </>
                          )}
                        </>
                      )
                    },
                    {
                      key: 'kubeovn_public_networks',
                      label: '物理网络',
                      children: (
                        <>
                          <ProviderNetworksSection
                            cloudId={cloudId}
                            mode={mode}
                            parentNetworks={harvesterKubeOvnProviderNetworks}
                            parentVlans={harvesterVlans}
                            parentLoading={!!resourceLoading.providerNetworksTab}
                            onParentRefresh={(f, s) => {
                              void loadTabResource('kubeovn_public_networks', f ?? false, s ?? false);
                            }}
                          />
                          <DebugJSON data={rawSubnets} show={showLog} />
                        </>
                      )
                    },
                    {
                      key: 'kubeovn_public_subnets',
                      label: '公共子网',
                      children: (
                        <>
                          <UnderlaySubnetsSection cloudId={cloudId} mode="public" displayMode={mode} />
                          <DebugJSON data={rawSubnets} show={showLog} />
                        </>
                      )
                    },
                    {
                      key: 'cluster_vlans',
                      label: 'VLANs',
                      children: (
                        <>
                          <VlansSection
                            cloudId={cloudId}
                            vlans={harvesterVlans}
                            providerNetworks={harvesterKubeOvnProviderNetworks}
                            loading={resourceLoading.vlans}
                            onRefresh={refreshVlans}
                            mode={mode}
                          />
                          <DebugJSON data={rawVlans} show={showLog} />
                        </>
                      )
                    },
                    {
                      key: 'namespaces',
                      label: '命名空间',
                      children: <NamespacesTab 
                        cloudId={cloudId} 
                        namespaces={harvesterNamespacesForManagement} 
                        loading={resourceLoading.namespaces} 
                        onRefresh={async (force = false, silent = false) => {
                          await loadTabResource('namespaces', force, silent);
                          if (force && !silent) {
                            message.success('刷新成功');
                          }
                        }} 
                        showLog={showLog} 
                        raw={rawNamespaces}
                        isTenant={isTenant}
                        mode={mode}
                      />
                    },
                    {
                      key: 'storage_classes',
                      label: '存储池',
                      children: (
                        <>
                          <StorageClassesSection cloudId={cloudId} storageClasses={harvesterStorageClasses} loading={resourceLoading.storageClasses} onRefresh={() => loadTabResource('storage_classes', true)} mode={mode} />
                          <DebugJSON data={harvesterStorageClasses} show={showLog} />
                        </>
                      )
                    },
                    {
                      key: 'gpu',
                      label: 'GPU',
                      children: (<GpusSection cloudId={cloudId} resources={harvesterGpuResources} onRefresh={() => loadTabResource('gpu', true)} raw={rawGpu} showLog={showLog} />)
                    },
                    {
                      key: 'cluster_usb',
                      label: 'USB',
                      children: (<UsbDevicesSection cloudId={cloudId} usbDevices={harvesterUsbDevices} loading={resourceLoading.usbDevices} onRefresh={() => loadTabResource('usb_devices', true)} raw={rawUsbDevices} showLog={showLog} bordered={false} />)
                    },
                    {
                      key: 'cluster_pci',
                      label: 'PCI 设备',
                      children: (<PciDevicesSection cloudId={cloudId} devices={harvesterPciDevices} loading={resourceLoading.pciDevices} onRefresh={() => loadTabResource('pci_devices', true)} raw={rawPciDevices} showLog={showLog} bordered={false} />)
                    },
                  ].filter((i:any) => {
                      if (i.key === 'cluster_nodes') return checkPerm('clouds.cluster-nodes:read');
                      if (i.key === 'cluster_services') return checkPerm('clouds.cluster-services:read');
                      if (i.key === 'clusterNetworks') return clusterNetworkSegmentOptions.length > 0;
                      if (i.key === 'cluster_vlans') {
                        return (
                          checkPerm('clouds.vlans:read') ||
                          checkPerm(CLOUD_PROVIDER_NETWORKS_READ)
                        );
                      }
                      if (i.key === 'kubeovn_public_networks') {
                        return checkPerm(CLOUD_PROVIDER_NETWORKS_READ);
                      }
                      if (i.key === 'kubeovn_public_subnets') return canReadPublicSubnets;
                      if (i.key === 'cluster_usb') return checkPerm('clouds.usb-devices:read');
                      if (i.key === 'cluster_pci') return checkPerm('clouds.pci-devices:read');
                      if (i.key === 'namespaces') return checkPerm('clouds.namespaces:read') || checkPerm('clouds:read');
                      if (i.key === 'storage_classes') return checkPerm('clouds.storage-classes:read');
                      if (i.key === 'gpu') return checkPerm('clouds.gpus:read');
                      return false;
                   })}
                />
              )
            }] : []),
            ...(canViewComputeGroup ? [{
              key: 'compute_group',
              label: '云主机',
              children: (
                <Tabs
                  type="line"
                  destroyOnHidden
                  defaultActiveKey="ecs"
                  onChange={handleTabChange}
                  items={[
                    {
                      key: 'ecs',
                      label: '云主机实例',
                      children: (
                        <>
                          <VmSection
                            vms={ecs}
                            loading={resourceLoading.ecs}
                            mode={mode}
                            namespacesOptions={namespacesOptions}
                            nodesOptions={nodesOptions}
                            cloudId={cloudId}
                            nsValue={nsFilter || undefined}
                            nodeValue={nodeFilter || undefined}
                            onCreateVmOverride={() => setSimpleVmCreateOpen(true)}
                            onNsChange={(v)=> setNsFilter(v || '')}
                            onNodeChange={(v)=> setNodeFilter(v || '')}
                            onRefresh={() => {
                              // 触发后端同步，确保数据最新
                              apiPost(`/api/clouds/${cloudId}/sync`).catch(console.warn).finally(() => {
                                refreshVms();
                                // 刷新关联资源: 镜像(用于显示名称)、命名空间(可能影响租户映射)、节点(可选)
                                if (checkPerm('clouds.images:read')) {
                                  loadResource('images', () => fetchHarvesterImages(cloudId, true), (json) => {
                                    setHarvesterImages(json?.data?.items || []);
                                  }, true);
                                }
                                if (checkPerm('clouds.disks:read')) {
                                  loadResource('volumes', () => fetchHarvesterVolumes(cloudId, true), (json) => {
                                    setHarvesterVolumes(json?.data?.items || []);
                                  }, true);
                                }
                                loadResource('namespaces', () => fetchHarvesterNamespaces(cloudId, true, true), (json) => {
                                  setHarvesterNamespaces(json?.data?.items || []);
                                }, true);
                              });
                            }}
                            onOpenReconfigure={(r:any)=> { setVmReconfTarget(r); setVmReconfOpen(true); }}
                            onStart={async (iid:string)=>{ 
                              try { 
                                // Pre-flight check for resizing volumes to avoid 500 error
                                const vm = ecs.find((v: any) => {
                                  const vId = v?.metadata?.name && v?.metadata?.namespace ? `${v.metadata.namespace}/${v.metadata.name}` : (v?.InstanceId || v?.id);
                                  return vId === iid;
                                });
                                
                                if (vm && harvesterVolumes.length > 0) {
                                  const vmVolumes = vm?.spec?.template?.spec?.volumes || [];
                                  const pvcNames = vmVolumes.map((vol: any) => vol?.persistentVolumeClaim?.claimName).filter(Boolean);
                                  
                                  if (pvcNames.length > 0) {
                                    const vmNamespace = vm?.metadata?.namespace || vm?.namespace;
                                    const resizingPvc = harvesterVolumes.find((pvc: any) => {
                                      const pvcName = pvc?.metadata?.name;
                                      const pvcNs = pvc?.metadata?.namespace;
                                      if (pvcNs !== vmNamespace || !pvcNames.includes(pvcName)) return false;
                                      
                                      const conditions = pvc?.status?.conditions || [];
                                      // Only block if 'Resizing' is true (Backend operation). 
                                      // 'FileSystemResizePending' is safe to start (User needs to resize FS manually).
                                      return conditions.some((c: any) => c.type === 'Resizing' && c.status === 'True');
                                    });
                                    
                                    if (resizingPvc) {
                                       message.error(`无法启动: 关联的磁盘 ${resizingPvc.metadata.name} 正在进行扩容操作 (Resizing)。请等待扩容完成。`);
                                       return;
                                    }
                                  }
                                }

                                await startCloudProviderEcs(cloudId, iid); 
                                message.success('启动成功'); 
                                apiPost(`/api/clouds/${cloudId}/sync`).catch(console.warn).finally(() => refreshVms());
                              } catch(e:any){ 
                                const errMsg = e?.message || String(e);
                                if (errMsg.includes('resizing volume') || errMsg.includes('Resizing')) {
                                  message.warning('启动被拒绝: 关联磁盘正在进行扩容操作，请等待扩容完成后再试。');
                                } else {
                                  message.error(errMsg || '启动失败'); 
                                }
                              } 
                            }}
                            onStop={async (iid:string)=>{ 
                              try { 
                                let force = false;
                                let realId = iid;
                                if (iid.endsWith('::force')) {
                                  force = true;
                                  realId = iid.replace(/::force$/, '');
                                }
                                await stopCloudProviderEcs(cloudId, realId, force); 
                                message.success(force ? '强制停止指令已下发' : '停止成功'); 
                                apiPost(`/api/clouds/${cloudId}/sync`).catch(console.warn).finally(() => refreshVms());
                              } catch(e:any){ message.error(e?.message||'停止失败'); } 
                            }}
                            onReboot={async (iid:string)=>{ 
                              try { 
                                await rebootCloudProviderEcs(cloudId, iid, false); 
                                message.success('重启成功'); 
                                apiPost(`/api/clouds/${cloudId}/sync`).catch(console.warn).finally(() => refreshVms());
                              } catch(e:any){ message.error(e?.message||'重启失败'); } 
                            }}
                            onSoftReboot={async (iid:string)=>{ 
                              try { 
                                await softRebootCloudProviderEcs(cloudId, iid); 
                                message.success('软重启成功'); 
                                apiPost(`/api/clouds/${cloudId}/sync`).catch(console.warn).finally(() => refreshVms());
                              } catch(e:any){ message.error(e?.message||'软重启失败'); } 
                            }}
                            onPause={async (iid:string)=>{ 
                              try { 
                                await pauseCloudProviderEcs(cloudId, iid); 
                                message.success('暂停成功'); 
                                apiPost(`/api/clouds/${cloudId}/sync`).catch(console.warn).finally(() => refreshVms());
                              } catch(e:any){ message.error(e?.message||'暂停失败'); } 
                            }}
                            onUnpause={async (iid:string)=>{ 
                              try { 
                                await unpauseCloudProviderEcs(cloudId, iid); 
                                message.success('恢复成功'); 
                                apiPost(`/api/clouds/${cloudId}/sync`).catch(console.warn).finally(() => refreshVms());
                              } catch(e:any){ message.error(e?.message||'恢复失败'); } 
                            }}
                            onDelete={async (iid:string, deleteVolumes?: boolean)=>{ 
                              try {
                                const [namespace, name] = iid.split('/');
                                if (!namespace || !name) {
                                  throw new Error('无效的实例ID格式');
                                }

                                const vm = ecs.find((v: any) => {
                                  const vmNs = v?.metadata?.namespace || v?.namespace || '';
                                  const vmName = v?.metadata?.name || v?.InstanceId?.split('/')[1] || '';
                                  return vmNs === namespace && vmName === name;
                                });

                                if (vm) {
                                  let status = '';
                                  if (typeof vm?.status === 'string') {
                                    status = vm.status;
                                  } else {
                                    status = vm?.status?.printableStatus || vm?.status?.phase || vm?.Status || 'Unknown';
                                  }
                                  const statusLower = String(status).toLowerCase();
                                  if (statusLower === 'running' || statusLower === 'starting') {
                                    message.loading('虚拟机正在运行，正在停止...', 0);
                                    try {
                                      await stopHarvesterVm(cloudId, namespace, name, true);
                                      await new Promise(resolve => setTimeout(resolve, 3000));
                                      message.destroy();
                                    } catch (stopError: any) {
                                      message.destroy();
                                      throw new Error(`停止虚拟机失败: ${stopError?.message || stopError}`);
                                    }
                                  }
                                }

                                await deleteCloudProviderEcs(cloudId, iid, deleteVolumes); 
                                message.success('虚拟机已移入回收站，到期后自动删除'); 
                                apiPost(`/api/clouds/${cloudId}/sync`).catch(console.warn).finally(() => refreshVms());
                              } catch(e:any){ message.error(e?.message||'移入回收站失败'); } 
                            }}
                            images={harvesterImages}
                            namespaces={harvesterNamespaces}
                            volumes={harvesterVolumes}
                          />
                          <VmReconfigureModal 
                            open={vmReconfOpen} 
                            cloudId={cloudId} 
                            record={vmReconfTarget} 
                            onClose={()=>{ setVmReconfOpen(false); setVmReconfTarget(null); }} 
                            onOk={() => {
                              refreshVms();
                              if (vmReconfTarget) {
                                setTimeout(() => {
                                  setVmReconfTarget({ ...vmReconfTarget, _refreshTrigger: Date.now() });
                                }, 300);
                              }
                            }} 
                            storageClasses={harvesterStorageClasses} 
                            images={harvesterImages} 
                            gpuResources={harvesterGpuResources} 
                          />
                          <DebugJSON data={rawEcs} show={showLog} />
                        </>
                      )
                    },
                    {
                      key: 'images',
                      label: '云主机镜像',
                      children: (
                        <>
                          <ImagesSection cloudId={cloudId} images={harvesterImages} loading={resourceLoading.images} onRefresh={() => loadResource('images', () => fetchHarvesterImages(cloudId, true), (json) => setHarvesterImages(json?.data?.items || []), true)} mode={mode} isTenant={isTenant} />
                          <DebugJSON data={rawImages} show={showLog} />
                        </>
                      )
                    },
                    {
                      key: 'templates',
                      label: '云主机模板',
                      children: (
                        <>
                          <TemplatesSection cloudId={cloudId} templates={harvesterTemplates} loading={resourceLoading.templates} onRefresh={() => loadTabResource('templates', true)} mode={mode} />
                          <DebugJSON data={rawTemplates} show={showLog} />
                        </>
                      )
                    },
                    {
                      key: 'ssh_keys',
                      label: 'SSH 密钥',
                      children: (
                        <>
                          <SshKeysSection cloudId={cloudId} sshKeys={harvesterSshKeys} loading={resourceLoading.sshKeys} onRefresh={() => loadTabResource('ssh_keys', true)} mode={mode} />
                          <DebugJSON data={rawSshKeys} show={showLog} />
                        </>
                      )
                    },
                    {
                      key: 'cloud_inits',
                      label: 'Cloud Init',
                      children: (
                        <>
                          <CloudInitsSection cloudId={cloudId} cloudInits={harvesterCloudInits} loading={resourceLoading.cloudInits} onRefresh={() => loadTabResource('cloud_inits', true)} mode={mode} />
                          <DebugJSON data={rawCloudInits} show={showLog} />
                        </>
                      )
                    },
                    {
                      key: 'recycle_bin',
                      label: '回收站',
                      children: (
                        <>
                          <RecycleBinSection
                            vms={ecs}
                            loading={resourceLoading.ecs}
                            cloudId={cloudId}
                            mode={mode}
                            onRefresh={() => {
                              apiPost(`/api/clouds/${cloudId}/sync`).catch(console.warn).finally(() => refreshVms());
                            }}
                            namespaces={harvesterNamespaces}
                            volumes={harvesterVolumes}
                            images={harvesterImages}
                          />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>
                                {JSON.stringify(ecs.filter((vm: any) => {
                                  const finalizers = vm?.metadata?.finalizers || [];
                                  const labels = vm?.metadata?.labels || {};
                                  return finalizers.includes('tower.io/recycle-bin') || labels['tower.io/recycle-bin'] === 'true';
                                }), null, 2)}
                              </pre>
                            </div>
                          )}
                        </>
                      )
                    },
                    {
                      key: 'migrations',
                      label: '迁移记录',
                      children: <MigrationsSection cloudId={cloudId} mode={mode} />
                    }
                  ].filter((i:any) => {
                      if (i.key === 'ecs') return checkPerm('clouds.ecs:read');
                      if (i.key === 'templates') return checkPerm('clouds.templates:read');
                      if (i.key === 'images') return checkPerm('clouds.images:read');
                      if (i.key === 'ssh_keys') return checkPerm('clouds.sshkeys:read');
                      if (i.key === 'cloud_inits') return checkPerm('clouds.cloudinits:read');
                      if (i.key === 'recycle_bin') return checkPerm('clouds.recycle-bin:read') || checkPerm('clouds.ecs:read');
                      if (i.key === 'migrations') return checkPerm('clouds.migrations:read') || checkPerm('clouds.ecs:read');
                      return true;
                  })}
                />
              )
            }] : []),
            ...(canViewStorageGroup ? [{
              key: 'storage_group',
              label: '云存储',
              children: (
                <Tabs
                  type="line"
                  destroyOnHidden
                  defaultActiveKey="volumes"
                  onChange={handleTabChange}
                  items={[
                    {
                      key: 'volumes',
                      label: '虚拟云盘',
                      children: (
                        <>
                          <VolumesSection cloudId={cloudId} volumes={harvesterVolumes} loading={resourceLoading.volumes} vms={ecs} storageClasses={harvesterStorageClasses} mode={mode} onRefresh={() => {
                            loadResource('volumes', () => fetchHarvesterVolumes(cloudId, true), (json) => setHarvesterVolumes(json?.data?.items || []), true);
                            loadResource('ecs', () => fetchCloudProviderEcs(cloudId, true), (json) => {
                              const list: any[] = Array.isArray((json as any)?.data) ? (json as any).data : (((json as any)?.data?.Instances?.Instance) || ((json as any)?.data?.items) || ((json as any)?.data?.data) || []);
                              setEcs(Array.isArray(list) ? list : []);
                              setRawEcs(json || null);
                            }, true);
                          }} />
                          <DebugJSON data={rawVolumes} show={showLog} />
                        </>
                      )
                    },
                    {
                      key: 'snapshots',
                      label: '云盘快照',
                      children: (
                        <>
                          <SnapshotsSection cloudId={cloudId} snapshots={harvesterSnapshots} namespaces={harvesterNamespaces} loading={resourceLoading.snapshots} onRefresh={() => loadTabResource('snapshots', true)} mode={mode} />
                          <DebugJSON data={rawSnapshots} show={showLog} />
                        </>
                      )
                    },
                  ].filter((i:any) => {
                      if (i.key === 'volumes') return checkPerm('clouds.disks:read');
                      if (i.key === 'snapshots') return checkPerm('clouds.snapshots:read');
                      return true;
                  })}
                />
              )
            }] : []),
...(canViewBackupsGroup ? [{
              key: 'backups_group',
              label: '云备份',
              children: (
                <Tabs
                  type="line"
                  destroyOnHidden
                  activeKey={backupsGroupActiveKey}
                  onChange={(key) => {
                    setBackupsGroupActiveKey(key);
                    handleTabChange(key);
                  }}
                  items={[
                    {
                      key: 'backups',
                      label: '云主机备份',
                      children: (
                        <>
                          <BackupsSection cloudId={cloudId} backups={harvesterBackups} loading={resourceLoading.backups} onRefresh={() => loadTabResource('backups', true)} namespaces={harvesterNamespaces} vms={ecs} type="backup" mode={mode} />
                          <DebugJSON data={rawBackups} show={showLog} />
                        </>
                      )
                    },
                    {
                      key: 'vm_snapshots',
                      label: '云主机快照',
                      children: (
                        <>
                          <BackupsSection cloudId={cloudId} backups={harvesterBackups} loading={resourceLoading.backups} onRefresh={() => loadTabResource('backups', true)} namespaces={harvesterNamespaces} vms={ecs} type="snapshot" mode={mode} />
                          <DebugJSON data={rawBackups} show={showLog} />
                        </>
                      )
                    },
                    {
                      key: 'schedule_vm_backups',
                      label: '定时策略',
                      children: (
                        <>
                          <ScheduleVmBackupsSection cloudId={cloudId} data={harvesterScheduleVmBackups} loading={resourceLoading.scheduleVmBackups} onRefresh={async (force = true, silent = false) => {
                            const skipSync = false;
                            if (!checkPerm('clouds.backups:read')) return;
                            if (!silent) setResourceLoading(prev => ({ ...prev, scheduleVmBackups: true }));
                            try {
                              if (force && !skipSync) {
                                try { await apiPost(`/api/clouds/${cloudId}/sync`); } catch {}
                              }
                              const json = await fetchHarvesterScheduleVmBackups(cloudId, force, skipSync);
                              const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : [];
                              setHarvesterScheduleVmBackups(Array.isArray(list) ? list : []);
                              setRawScheduleVmBackups(json || null);
                            } catch (e) {
                              console.warn('Failed to load schedule vm backups', e);
                            } finally {
                              if (!silent) setResourceLoading(prev => ({ ...prev, scheduleVmBackups: false }));
                            }
                          }} vms={ecs} mode={mode} />
                          <DebugJSON data={rawScheduleVmBackups} show={showLog} />
                        </>
                      )
                    },
                    {
                      key: 'vm_restores',
                      label: '恢复任务',
                      children: (
                        <VmRestoreTasksSection cloudId={cloudId} isTenant={isTenant} mode={mode} />
                      )
                    }
                  ].filter((i: any) => {
                    if (i.key === 'backups') return checkPerm('clouds.backups:read') || checkPerm('clouds:read');
                    if (i.key === 'vm_snapshots') return checkPerm('clouds.backups:read') || checkPerm('clouds:read');
                    if (i.key === 'schedule_vm_backups') return checkPerm('clouds.backups:read') || checkPerm('clouds:read');
                    if (i.key === 'vm_restores') return checkPerm('clouds.restore-tasks:read') || checkPerm('clouds.backups:read') || checkPerm('clouds:read');
                    return true;
                  })}
                />
              )
            }] : []),
            ...(canViewFlatNetworkGroup ? [{
              key: 'flat_network_group',
              label: '扁平子网',
              children: (
                <Tabs
                  type="line"
                  destroyOnHidden
                  defaultActiveKey="flat_public_subnets"
                  onChange={handleTabChange}
                  items={[
                    {
                      key: 'flat_public_subnets',
                      label: '扁平子网',
                      children: (
                        <>
                          <UnderlaySubnetsSection cloudId={cloudId} mode="flat" displayMode={mode} />
                          <DebugJSON data={rawSubnets} show={showLog} />
                        </>
                      )
                    },
                    {
                      key: 'security_groups',
                      label: '安全组',
                      children: (
                        <>
                          {/* kube-ovn/SecurityGroupsSection：扁平子网安全组 */}
                          <SecurityGroupsSection cloudId={cloudId} />
                          <DebugJSON data={rawSubnets} show={showLog} />
                        </>
                      )
                    },
                    {
                      key: 'flat_kubeovn_eips',
                      label: '公网IP',
                      children: (
                        <>
                          <EipSection
                            cloudId={cloudId}
                            eips={kubeOvnFlatEips}
                            subnets={kubeOvnSubnets}
                            loading={!!resourceLoading.flatEips}
                            networkScope="flat"
                            onRefresh={() => loadTabResource('flat_kubeovn_eips', true)}
                          />
                        </>
                      ),
                    },
                    {
                      key: 'flat_kubeovn_snat',
                      label: 'SNAT 网关',
                      children: (
                        <>
                          <SnatSection
                            cloudId={cloudId}
                            snatRules={kubeOvnFlatSnatRules}
                            eips={kubeOvnFlatEips}
                            vpcs={kubeOvnVpcs}
                            subnets={kubeOvnSubnets}
                            loading={!!resourceLoading.flatSnatRules}
                            networkScope="flat"
                            onRefresh={(force = true, silent = false) => {
                              const skipSync = silent;
                              setResourceLoading((prev) => ({ ...prev, flatSnatRules: true }));
                              fetchCloudProviderOvnSnatRules(cloudId, force, skipSync, 'flat')
                                .then((json) => {
                                  const list: any[] = (json as any)?.data?.items || [];
                                  setKubeOvnFlatSnatRules(Array.isArray(list) ? list : []);
                                  if (force && !silent) message.success('刷新成功');
                                })
                                .catch((e) => {
                                  if (!silent) message.error('刷新失败: ' + (e?.message || '未知错误'));
                                })
                                .finally(() => {
                                  setResourceLoading((prev) => ({ ...prev, flatSnatRules: false }));
                                });
                            }}
                          />
                        </>
                      ),
                    },
                    {
                      key: 'flat_kubeovn_dnat',
                      label: 'DNAT 网关',
                      children: (
                        <>
                          <DnatSection
                            cloudId={cloudId}
                            dnatRules={kubeOvnFlatDnatRules}
                            eips={kubeOvnFlatEips}
                            vpcs={kubeOvnVpcs}
                            subnets={kubeOvnSubnets}
                            loading={!!resourceLoading.flatDnatRules}
                            networkScope="flat"
                            onRefresh={(force = true, silent = false) => {
                              const skipSync = silent;
                              setResourceLoading((prev) => ({ ...prev, flatDnatRules: true }));
                              fetchCloudProviderOvnDnatRules(cloudId, force, skipSync, 'flat')
                                .then((json) => {
                                  const list: any[] = (json as any)?.data?.items || [];
                                  setKubeOvnFlatDnatRules(Array.isArray(list) ? list : []);
                                  if (force && !silent) message.success('刷新成功');
                                })
                                .catch((e) => {
                                  if (!silent) message.error('刷新失败: ' + (e?.message || '未知错误'));
                                })
                                .finally(() => {
                                  setResourceLoading((prev) => ({ ...prev, flatDnatRules: false }));
                                });
                            }}
                          />
                        </>
                      ),
                    },
                  ].filter((i:any) => {
                    if (i.key === 'flat_public_subnets') return canReadFlatSubnets;
                    if (i.key === 'security_groups') {
                      return (
                        checkPerm('clouds.security-groups.flat:read') ||
                        checkPerm('clouds:read')
                      );
                    }
                    if (i.key === 'flat_kubeovn_eips') {
                      return checkPerm('clouds.eips.flat:read') || checkPerm('clouds:read');
                    }
                    if (i.key === 'flat_kubeovn_fips') {
                      return checkPerm('clouds.fips.flat:read') || checkPerm('clouds:read');
                    }
                    if (i.key === 'flat_kubeovn_snat') {
                      return checkPerm('clouds.snat.flat:read') || checkPerm('clouds:read');
                    }
                    if (i.key === 'flat_kubeovn_dnat') {
                      return checkPerm('clouds.dnat.flat:read') || checkPerm('clouds:read');
                    }
                    return true;
                  })}
                />
              )
            }] : []),
            ...((ovnVpcEnabled && canViewKubeOvnGroup) ? [{
              key: 'kube_ovn_group',
              label: '虚拟专有云 (VPC)',
              children: (
                <Tabs
                  type="line"
                  destroyOnHidden
                  defaultActiveKey="vpcs"
                  onChange={handleTabChange}
                  items={[
                    {
                      key: 'vpcs',
                      label: 'VPC网络',
                      children: (
                        <>
                          <KubeOvnVpcsSection 
                            vpcs={kubeOvnVpcs} 
                            subnets={kubeOvnSubnets} 
                            loading={resourceLoading.vpcs || resourceLoading.subnets} 
                            showYaml={mode === 'ops'}
                            onRefresh={async (force = false, silent = false) => {
                              const skipSync = silent;
                              loadResource('vpcs', () => fetchKubeOvnVpcs(cloudId, force, skipSync), (json) => {
                                setKubeOvnVpcs(json?.data?.items || []);
                                setRawVpcs(json || null);
                              }, true);
                              loadResource('subnets', () => fetchKubeOvnSubnets(cloudId, force, skipSync), (json) => {
                                setKubeOvnSubnets(json?.data?.items || []);
                                setRawSubnets(json || null);
                              }, true);
                            }} 
                          />
                          <DebugJSON data={rawVpcs} show={showLog} />
                        </>
                      )
                    },
                    {
                      key: 'subnets',
                      label: 'VPC 子网',
                      children: (
                        <>
                          <KubeOvnSubnetsSection 
                            subnets={(kubeOvnSubnets || []).filter((s: any) => String(s?.metadata?.annotations?.['tower.io/subnet-type'] || '').trim().toLowerCase() === 'vpc')} 
                            vpcList={kubeOvnVpcs} 
                            loading={resourceLoading.subnets} 
                            showYaml={mode === 'ops'}
                            onRefresh={() => loadResource('subnets', () => fetchKubeOvnSubnets(cloudId, true), (json) => {
                              setKubeOvnSubnets(json?.data?.items || []);
                              setRawSubnets(json || null);
                            }, true)} 
                          />
                          <DebugJSON data={rawSubnets} show={showLog} />
                        </>
                      )
                    },
                    {
                      key: 'kubeovn_eips',
                      label: '弹性公网IP',
                      children: (
                        <>
                          <EipSection cloudId={cloudId} eips={kubeOvnEips} subnets={kubeOvnSubnets} loading={resourceLoading.eips} onRefresh={() => loadTabResource('eips', true)} networkScope="vpc" />
                          <DebugJSON data={rawEips} show={showLog} />
                        </>
                      )
                    },
                    {
                      key: 'kubeovn_fips',
                      label: '浮动IP',
                      children: (
                        <>
                          <FipSection cloudId={cloudId} fips={kubeOvnFips} eips={kubeOvnEips} vpcs={kubeOvnVpcs} subnets={kubeOvnSubnets} loading={resourceLoading.fips} onRefresh={() => loadTabResource('fips', true)} networkScope="vpc" />
                          <DebugJSON data={rawFips} show={showLog} />
                        </>
                      )
                    },
                    {
                      key: 'kubeovn_snat',
                      label: 'SNAT 网关',
                      children: (
                        <>
                          <SnatSection cloudId={cloudId} snatRules={kubeOvnSnatRules} eips={kubeOvnEips} vpcs={kubeOvnVpcs} subnets={kubeOvnSubnets} loading={resourceLoading.snatRules} networkScope="vpc" onRefresh={(force = true, silent = false) => {
                            const skipSync = silent;
                            setResourceLoading(prev => ({ ...prev, snatRules: true }));
                            fetchCloudProviderOvnSnatRules(cloudId, force, skipSync, 'vpc')
                              .then((json) => {
                                const list: any[] = (json as any)?.data?.items || [];
                                setKubeOvnSnatRules(Array.isArray(list) ? list : []);
                                setRawSnatRules(json || null);
                                if (force && !silent) message.success('刷新成功');
                              })
                              .catch((e) => {
                                if (!silent) message.error('刷新失败: ' + (e?.message || '未知错误'));
                              })
                              .finally(() => {
                                setResourceLoading(prev => ({ ...prev, snatRules: false }));
                              });
                          }} />
                          <DebugJSON data={rawSnatRules} show={showLog} />
                        </>
                      )
                    },
                    {
                      key: 'kubeovn_dnat',
                      label: 'DNAT 网关',
                      children: (
                        <>
                          <DnatSection cloudId={cloudId} dnatRules={kubeOvnDnatRules} eips={kubeOvnEips} vpcs={kubeOvnVpcs} subnets={kubeOvnSubnets} loading={resourceLoading.dnatRules} networkScope="vpc" onRefresh={(force = true, silent = false) => {
                            const skipSync = silent;
                            setResourceLoading(prev => ({ ...prev, dnatRules: true }));
                            fetchCloudProviderOvnDnatRules(cloudId, force, skipSync, 'vpc')
                              .then((json) => {
                                const list: any[] = (json as any)?.data?.items || [];
                                setKubeOvnDnatRules(Array.isArray(list) ? list : []);
                                setRawDnatRules(json || null);
                                if (force && !silent) message.success('刷新成功');
                              })
                              .catch((e) => {
                                if (!silent) message.error('刷新失败: ' + (e?.message || '未知错误'));
                              })
                              .finally(() => {
                                setResourceLoading(prev => ({ ...prev, dnatRules: false }));
                              });
                          }} />
                          <DebugJSON data={rawDnatRules} show={showLog} />
                        </>
                      )
                    }
                  ].filter((i:any) => {
                      if (i.key === 'subnets') return canReadVpcSubnets || checkPerm('clouds:read');
                      if (i.key === 'vpcs') {
                        return (
                          checkPerm('clouds.vpcs:read') ||
                          canReadVpcSubnets ||
                          checkPerm('clouds:read')
                        );
                      }
                      if (i.key === 'kubeovn_eips') {
                        return checkPerm('clouds.eips.vpc:read') || checkPerm('clouds:read');
                      }
                      if (i.key === 'kubeovn_fips') {
                        return checkPerm('clouds.fips.vpc:read') || checkPerm('clouds:read');
                      }
                      if (i.key === 'kubeovn_snat') {
                        return checkPerm('clouds.snat.vpc:read') || checkPerm('clouds:read');
                      }
                      if (i.key === 'kubeovn_dnat') {
                        return checkPerm('clouds.dnat.vpc:read') || checkPerm('clouds:read');
                      }
                      return checkPerm('clouds:read');
                  })}
                />
              )
            }] : []),
            ...(canViewLoggingTab ? [{
              key: 'logs-config',
              label: '日志管理',
              children: (
                <LoggingProvider cloudId={cloudId}>
                  <Tabs
                    defaultActiveKey="logs-target"
                    tabPosition="top"
                    type="line"
                    destroyOnHidden
                    items={[
                      {
                        key: 'logs-target',
                        label: '日志采集对象',
                        children: <LogsTarget cloudId={cloudId} />,
                      }, 
                      {
                        key: 'log-outputs',
                        label: '日志接收端',
                        children: <LogOutputs cloudId={cloudId} />,
                      },   
                      {
                        key: 'logs-flow-config',
                        label: '日志采集配置',
                        children: <LogsConfig cloudId={cloudId} />,
                      }
                    ].filter((i: any) => {
                      if (i.key === 'logs-target') return checkPerm('clouds.log-targets:read');
                      if (i.key === 'log-outputs') return checkPerm('clouds.log-receivers:read');
                      if (i.key === 'logs-flow-config') return checkPerm('clouds.log-configs:read');
                      return true;
                    })}
                  />
                </LoggingProvider>
              )
            }] : [])
          ]}
      />
      <SimpleVmCreateModal
        open={simpleVmCreateOpen}
        onClose={() => setSimpleVmCreateOpen(false)}
        cloudId={cloudId}
        images={harvesterImages}
        storageClasses={harvesterStorageClasses}
        capabilities={capabilities}
        kubeSubnets={kubeOvnSubnets}
        harvesterNads={harvesterNads}
        onReloadSubnets={
          canReadFlatSubnets || canReadVpcSubnets || checkPerm('clouds:read')
            ? () =>
                loadResource(
                  'subnets',
                  () => fetchKubeOvnSubnets(cloudId, true),
                  (json) => {
                    setKubeOvnSubnets(json?.data?.items || []);
                  },
                  true,
                )
            : undefined
        }
        onReloadImages={
          checkPerm('clouds.images:read')
            ? () =>
                loadResource(
                  'images',
                  () => fetchHarvesterImages(cloudId, true),
                  (json) => {
                    setHarvesterImages(json?.data?.items || []);
                  },
                  true,
                )
            : undefined
        }
        existingVms={ecs}
        onCreated={async () => {
          try {
            await apiPost(`/api/clouds/${cloudId}/sync`);
          } catch {
            /* ignore */
          }
          await refreshVms(false);
        }}
      />
    </PageDetailContainer>
  );
};

export default CloudDetailCloudmap;
