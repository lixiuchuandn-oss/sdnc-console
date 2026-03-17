import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Table, Tag, Space, Button, Statistic, Row, Col, Alert, Tabs, Descriptions, Modal, Select, Popconfirm, message, Dropdown, Typography } from 'antd';
// 引入各个资源模块组件
import NodesSection from './sections/NodesSection';
import ImagesSection from './sections/ImagesSection';
import VolumesSection from './sections/VolumesSection';
import NadsSection from './sections/NadsSection';
import KubeOvnVpcsSection from './kube-ovn/VpcsSection';
import KubeOvnSubnetsSection from './kube-ovn/SubnetsSection';
import KubeOvnPublicNetworksSection from './kube-ovn/PubnetSection';
import GpusSection from './sections/GpusSection';
import PciDevicesSection from './sections/PciDevicesSection';
import UsbDevicesSection from './sections/UsbDevicesSection';
import TasksSection from './sections/TasksSection';
import StorageClassesSection from './sections/StorageClassesSection';
import SnapshotsSection from './sections/SnapshotsSection';
import BackupsSection from './sections/BackupsSection';
import SshKeysSection from './sections/SshKeysSection';
import CloudInitsSection from './sections/CloudInitsSection';
import IngressesSection from './sections/IngressesSection';
import ServicesSection from './sections/ServicesSection';
import LoadBalancersSection from './sections/LoadBalancersSection';
import IPPoolsSection from './sections/IPPoolsSection';
import ClusterNetworksSection from './sections/ClusterNetworksSection';
// 重新编译触发引入
import NamespacesTab from './sections/NamespacesTab';
import { CloudUploadOutlined, ArrowLeftOutlined, ReloadOutlined, HomeOutlined, LoginOutlined } from '@ant-design/icons';
import PageDetailContainer from '../../../components/PageDetailContainer';
import { API_BASE_URL, fetchClouds, fetchCloudProviderEcs, startCloudProviderEcs, stopCloudProviderEcs, rebootCloudProviderEcs, softRebootCloudProviderEcs, pauseCloudProviderEcs, unpauseCloudProviderEcs, deleteCloudProviderEcs, apiPost } from '../../../services/api';
import { useAuth } from '../../../contexts/AuthContext';
import { useLicense } from '../../../contexts/LicenseContext';
import { hasPermissionForAction } from '../../../utils/accessMapping';
import { getToken } from '../../../utils/tokenStorage';
import { isSystemNamespace } from '../../../utils/harvesterUtils';
// 引入Harvester特定的API请求函数
import { fetchHarvesterSnapshots, fetchHarvesterBackups, fetchHarvesterScheduleVmBackups, fetchHarvesterSshKeys, fetchHarvesterCloudInits, fetchHarvesterIngresses, fetchHarvesterServices, fetchHarvesterLoadBalancers, fetchHarvesterIPPools, fetchHarvesterNads, fetchHarvesterImages, fetchHarvesterVolumes, fetchHarvesterNodes, fetchHarvesterVmDetail, fetchKubeOvnVpcs, fetchKubeOvnSubnets, fetchHarvesterGpuResources, fetchHarvesterNamespaces, fetchHarvesterStorageClasses, fetchHarvesterCapabilities, fetchHarvesterTemplates, fetchHarvesterClusterNetworks, fetchCloudProviderOvnEips, fetchCloudProviderOvnFips, fetchCloudProviderOvnSnatRules, fetchCloudProviderOvnDnatRules, stopHarvesterVm, fetchHarvesterUsbResources, fetchHarvesterPciDevices } from '../../../services/harvesterApi';
import VmReconfigureModal from './modals/VmReconfigureModal';
import VmSection from './sections/VmSection';
import RecycleBinSection from './sections/RecycleBinSection';
import TemplatesSection from './sections/TemplatesSection';
import ScheduleVmBackupsSection from './sections/ScheduleVmBackupsSection';
import VmRestoreTasksSection from './sections/VmRestoreTasksSection';
import EipSection from './kube-ovn/EipSection';
import FipSection from './kube-ovn/FipSection';
import SnatSection from './kube-ovn/SnatSection';
import DnatSection from './kube-ovn/DnatSection';
import MonitoringOverview from './Monitoring/MonitoringOverview';
import LogsConfig from './Monitoring/LogsConfig';
import LogOutputs from './Monitoring/LogOutputs';
import LogsTarget from './Monitoring/LogsTarget';
import LogsFlowConfig from './Monitoring/LogsFlowConfig';
import LogsOutputConfig from './Monitoring/LogsOutputConfig';
import HarvesterMonitoringAlerts from './Monitoring/MonitoringAlerts';
import MonitoringAlertNotificationPolicy from './Monitoring/MonitoringAlertNotificationPolicy';
import MonitoringAlertNotificationTargets from './Monitoring/MonitoringAlertNotificationTargets';
import MonitoringPrometheusRules from './Monitoring/MonitoringPrometheusRules';
import MonitoringAlertSecrets from './Monitoring/MonitoringAlertSecrets';
import { MonitoringProvider } from './Monitoring/context/MonitoringContext';
import { LoggingProvider } from './Monitoring/context/LoggingContext';

/**
 * 云资源项接口定义
 */
interface CloudItem { id: string; name: string; region: string; type: string; config?: any; status?: string; endpoint?: string; description?: string; createdAt?: string; updatedAt?: string; }

/**
 * 状态标签渲染辅助函数
 * @param s 状态字符串
 */
const statusTag = (s?: string) => {
  const color = s === 'Available' ? 'green' : s === 'Pending' ? 'orange' : 'blue';
  return <Tag color={color}>{s || '-'}</Tag>;
};

/**
 * Harvester/CloudMap 云资源详情页组件
 * 
 * 职责：
 * 1. 作为容器组件，管理该云资源池下的所有资源数据（VM, Network, Storage等）。
 * 2. 处理资源的初始化加载和按需加载（Lazy Loading），避免一次性请求过多接口。
 * 3. 维护 SSE (Server-Sent Events) 连接，实现虚拟机状态的实时更新。
 * 4. 提供全局的刷新机制和权限控制。
 */
const CloudDetailHarvester: React.FC<{ cloudId: string; defaultProvider?: string }> = ({ cloudId, defaultProvider }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { hasFeature } = useLicense();
  const ovnVpcEnabled = hasFeature('network.ovn.vpc');
  const permissions = user?.permissions;
  // 权限检查辅助函数
  const checkPerm = (act: string) => hasPermissionForAction(permissions || [], act);

  // --- 状态定义 ---

  // 云资源池基础信息
  const [cloud, setCloud] = useState<CloudItem | null>(null);
  // 全局加载状态（主要用于初始加载）
  const [loading, setLoading] = useState(false);
  // 各个资源模块的独立加载状态 map
  const [resourceLoading, setResourceLoading] = useState<Record<string, boolean>>({});
  // 全局错误信息
  const [error, setError] = useState<string | null>(null);
  
  // --- 核心资源数据 ---
  const [ecs, setEcs] = useState<any[]>([]); // 虚拟机列表
  const [harvesterNads, setHarvesterNads] = useState<any[]>([]); // NAD网络列表
  const [harvesterImages, setHarvesterImages] = useState<any[]>([]); // 镜像列表
  const [harvesterVolumes, setHarvesterVolumes] = useState<any[]>([]); // 虚拟卷列表
  const [harvesterNodes, setHarvesterNodes] = useState<any[]>([]); // 节点列表
  const [harvesterNamespaces, setHarvesterNamespaces] = useState<any[]>([]); // 命名空间列表（用于筛选和展示，已过滤系统命名空间）
  const [harvesterNamespacesForManagement, setHarvesterNamespacesForManagement] = useState<any[]>([]); // 命名空间管理页面专用（包含系统命名空间）
  const [harvesterStorageClasses, setHarvesterStorageClasses] = useState<any[]>([]); // 存储类列表
  const [capabilities, setCapabilities] = useState<any>(null); // 集群能力（如架构信息）

  // --- Kube-OVN 网络相关数据 ---
  const [kubeOvnVpcs, setKubeOvnVpcs] = useState<any[]>([]);
  const [kubeOvnSubnets, setKubeOvnSubnets] = useState<any[]>([]);
  const [kubeOvnEips, setKubeOvnEips] = useState<any[]>([]);
  const [kubeOvnFips, setKubeOvnFips] = useState<any[]>([]);
  const [kubeOvnSnatRules, setKubeOvnSnatRules] = useState<any[]>([]);
  const [kubeOvnDnatRules, setKubeOvnDnatRules] = useState<any[]>([]);

  // --- 次要/按需加载资源数据 ---
  const [harvesterSnapshots, setHarvesterSnapshots] = useState<any[]>([]); // 卷快照
  const [harvesterBackups, setHarvesterBackups] = useState<any[]>([]); // 虚拟机备份
  const [backupsGroupActiveKey, setBackupsGroupActiveKey] = useState<string>('backups'); // 备份组内层 tab 的 activeKey
  const [harvesterSshKeys, setHarvesterSshKeys] = useState<any[]>([]); // SSH 密钥
  const [harvesterCloudInits, setHarvesterCloudInits] = useState<any[]>([]); // CloudInit 配置
  const [harvesterIngresses, setHarvesterIngresses] = useState<any[]>([]); // Ingress 路由
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
  const [showLog, setShowLog] = useState<boolean>(false); // 是否显示原始 JSON 日志

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
  const [rawIngresses, setRawIngresses] = useState<any | null>(null);
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
        if (!silent) {
          message.success('NAD网络刷新成功');
        }
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
  // 请求超时时间（毫秒）- 防止单个请求阻塞整个页面
  const REQUEST_TIMEOUT = 30000; // 30秒
  
  const loadResource = async (key: string, fn: () => Promise<any>, cb: (json: any) => void, force = false) => {
      // 如果非强制刷新且已加载过，直接跳过
      if (!force && loadedRef.current.has(key)) return;
      
      // 强制刷新时，清除已加载标记，确保重新加载
      if (force && loadedRef.current.has(key)) {
        loadedRef.current.delete(key);
      }
      
      setResourceLoading(prev => ({ ...prev, [key]: true }));
      try {
          // 添加超时机制，防止请求长时间挂起
          const timeoutPromise = new Promise((_, reject) => {
              setTimeout(() => reject(new Error(`请求超时: ${key} (${REQUEST_TIMEOUT}ms)`)), REQUEST_TIMEOUT);
          });
          
          const json = await Promise.race([fn(), timeoutPromise]);
          cb(json);
          // 强制刷新时，不更新 loadedRef，确保下次还能刷新
          // 非强制刷新时，标记为已加载，避免重复请求
          if (!force) {
            loadedRef.current.add(key);
          }
      } catch (e: any) {
          console.warn(`Failed to load ${key}:`, e?.message || e);
          // 不阻塞其他资源加载，只记录错误
          // 如果回调函数支持错误处理，可以传递 null 或空数据
          try {
              cb(null);
          } catch {
              // 忽略回调错误
          }
      } finally {
          setResourceLoading(prev => ({ ...prev, [key]: false }));
      }
  };

  /**
   * 加载核心资源 (首页/概览页必须的数据)
   * 包括: 云信息, VM, 网络, 卷, 镜像, 节点, 命名空间
   * @param force 是否强制刷新
   */
  const loadEssentials = async (force = false) => {
    // 1. 加载云池基础信息
    loadResource('cloud', fetchClouds, (cloudsRes) => {
       const cloudList: any[] = Array.isArray(cloudsRes) ? cloudsRes : (Array.isArray((cloudsRes as any)?.data) ? (cloudsRes as any).data : []);
       setCloud((cloudList || []).find((c:any)=> String(c.id) === String(cloudId)) || null);
    }, force);

    // 2. 加载核心资源 (带权限检查)
    if (checkPerm('clouds.instances:read')) {
      loadResource('ecs', () => fetchCloudProviderEcs(cloudId, force), (json) => {
        const list: any[] = Array.isArray((json as any)?.data) ? (json as any).data : (((json as any)?.data?.Instances?.Instance) || ((json as any)?.data?.items) || ((json as any)?.data?.data) || []);
        setEcs(Array.isArray(list) ? list : []);
        setRawEcs(json || null);
      }, force);
    }

    if (checkPerm('clouds.networks:read')) {
      loadResource('nads', () => fetchHarvesterNads(cloudId, force), (json) => {
        const list: any[] = (json as any)?.data?.items || [];
        setHarvesterNads(Array.isArray(list) ? list : []);
        setRawNads(json || null);
      }, force);
      
      // Kube-OVN 基础网络资源
      if (ovnVpcEnabled) {
        loadResource('vpcs', () => fetchKubeOvnVpcs(cloudId, force), (json) => {
          const list: any[] = (json as any)?.data?.items || [];
          setKubeOvnVpcs(Array.isArray(list) ? list : []);
          setRawVpcs(json || null);
        }, force);
        loadResource('subnets', () => fetchKubeOvnSubnets(cloudId, force), (json) => {
          const list: any[] = (json as any)?.data?.items || [];
          setKubeOvnSubnets(Array.isArray(list) ? list : []);
          setRawSubnets(json || null);
        }, force);
      } else {
        setKubeOvnVpcs([]);
        setKubeOvnSubnets([]);
        setRawVpcs(null);
        setRawSubnets(null);
      }
    }

    if (checkPerm('clouds.images:read')) {
      loadResource('images', () => fetchHarvesterImages(cloudId, force), (json) => {
        const list: any[] = (json as any)?.data?.items || [];
        setHarvesterImages(Array.isArray(list) ? list : []);
        setRawImages(json || null);
      }, force);
    }

    if (checkPerm('clouds.volumes:read')) {
      loadResource('volumes', () => fetchHarvesterVolumes(cloudId, force), (json) => {
        const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : (Array.isArray((json as any)?.items) ? (json as any).items : []);
        setHarvesterVolumes(Array.isArray(list) ? list : []);
        setRawVolumes(json || null);
      }, force);
      // 存储类通常在下拉框需要，作为核心资源加载
      loadResource('storageClasses', () => fetchHarvesterStorageClasses(cloudId, force), (json) => {
        const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : (Array.isArray((json as any)?.items) ? (json as any).items : []);
        setHarvesterStorageClasses(Array.isArray(list) ? list : []);
      }, force);
    }

    if (checkPerm('clouds.nodes:read')) {
      loadResource('nodes', () => fetchHarvesterNodes(cloudId, force), (json) => {
        const list: any[] = (json as any)?.data?.items || [];
        setHarvesterNodes(Array.isArray(list) ? list : []);
        setRawNodes(json || null);
      }, force);
    }

    // 命名空间查询：用于筛选和展示时过滤系统命名空间
    // 注意：命名空间管理 Tab 会单独查询所有命名空间（包括系统命名空间）
    loadResource('namespaces', () => fetchHarvesterNamespaces(cloudId, force, true), (json) => {
        const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : (Array.isArray((json as any)?.items) ? (json as any).items : []);
        setHarvesterNamespaces(Array.isArray(list) ? list : []);
        setRawNamespaces(json || null);
    }, force);

    loadResource('capabilities', () => fetchHarvesterCapabilities(cloudId), (json) => {
        setCapabilities(json?.data || null);
    }, force);
  };

  /**
   * 按需加载标签页资源 (Lazy Loading)
   * 仅在用户切换到对应 Tab 时触发加载
   * @param key Tab 的 key 或资源标识
   * @param force 是否强制刷新
   */
  const loadTabResource = async (key: string, force = false) => {
      switch (key) {
          case 'namespaces':
            // 命名空间管理页面：加载所有命名空间（包括系统命名空间），使用独立状态避免影响其他组件
            // 后端已实现租户隔离，租户用户即使查询所有命名空间，也只会看到分配给自己的命名空间
            if (checkPerm('clouds.namespaces:read')) {
              setResourceLoading(prev => ({ ...prev, namespaces: true }));
              fetchHarvesterNamespaces(cloudId, force, false) // excludeSystem=false，管理页面需要查看系统命名空间
                .then((json) => {
                  const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : (Array.isArray((json as any)?.items) ? (json as any).items : []);
                  setHarvesterNamespacesForManagement(Array.isArray(list) ? list : []);
                })
                .catch((e) => {
                  console.warn('Failed to load namespaces for management', e);
                })
                .finally(() => {
                  setResourceLoading(prev => ({ ...prev, namespaces: false }));
                });
            }
            break;
          case 'volumes':
            // 确保进入 PVC 页面时，关联的 VM 数据也已加载 (用于挂载操作)
            if (checkPerm('clouds.instances:read')) {
              loadResource('ecs', () => fetchCloudProviderEcs(cloudId, force), (json) => {
                const list: any[] = Array.isArray((json as any)?.data) ? (json as any).data : (((json as any)?.data?.Instances?.Instance) || ((json as any)?.data?.items) || ((json as any)?.data?.data) || []);
                setEcs(Array.isArray(list) ? list : []);
                setRawEcs(json || null);
              }, force);
            }
            break;
          case 'snapshots':
            if (checkPerm('clouds.snapshots:read')) {
              // 注意：loadTabResource 的 force 参数会被传递给 fetchHarvesterSnapshots
              // 如果需要 skipSync，需要在调用时传递 skipSync 参数
              // 但 loadTabResource 不支持 skipSync，所以这里保持原样
              // 创建后的刷新会通过 SnapshotsSection 的 onRefresh 处理
              loadResource('snapshots', () => fetchHarvesterSnapshots(cloudId, force), (json) => {
                const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : [];
                setHarvesterSnapshots(Array.isArray(list) ? list : []);
                setRawSnapshots(json || null);
              }, force);
            }
            break;
          case 'backups':
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
          case 'scheduleVmBackups':
            if (checkPerm('clouds.backups:read')) {
              // 直接加载，不使用 loadResource 的缓存逻辑
              setResourceLoading(prev => ({ ...prev, scheduleVmBackups: true }));
              fetchHarvesterScheduleVmBackups(cloudId, force)
                .then((json) => {
                  const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : [];
                  setHarvesterScheduleVmBackups(Array.isArray(list) ? list : []);
                  setRawScheduleVmBackups(json || null);
                })
                .catch((e) => {
                  console.warn('Failed to load scheduleVmBackups', e);
                })
                .finally(() => {
                  setResourceLoading(prev => ({ ...prev, scheduleVmBackups: false }));
                });
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
            if (checkPerm('clouds.instances:read')) {
              loadResource('gpu', () => fetchHarvesterGpuResources(cloudId, force), (json) => {
                const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : (Array.isArray((json as any)?.items) ? (json as any).items : []);
                setHarvesterGpuResources(Array.isArray(list) ? list : []);
                setRawGpu(json || null);
              }, force);
            }
            break;
          case 'usb_devices':
            if (checkPerm('clouds.instances:read')) {
              loadResource('usbDevices', () => fetchHarvesterUsbResources(cloudId, force), (json) => {
                const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : (Array.isArray((json as any)?.items) ? (json as any).items : []);
                setHarvesterUsbDevices(Array.isArray(list) ? list : []);
                setRawUsbDevices(json || null);
              }, force);
            }
            break;
          case 'pci_devices':
            if (checkPerm('clouds.instances:read')) {
              loadResource('pciDevices', () => fetchHarvesterPciDevices(cloudId, force), (json) => {
                const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : (Array.isArray((json as any)?.items) ? (json as any).items : []);
                setHarvesterPciDevices(Array.isArray(list) ? list : []);
                setRawPciDevices(json || null);
              }, force);
            }
            break;
          case 'load_balancers':
            if (checkPerm('clouds.loadbalancers:read')) {
              loadResource('loadBalancers', () => fetchHarvesterLoadBalancers(cloudId, force), (json) => {
                const list = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : [];
                setHarvesterLoadBalancers(list);
                setRawLoadBalancers(json || null);
              }, force);
            }
            break;
          case 'cluster_services':
          case 'services':
            if (checkPerm('clouds.services:read')) {
              loadResource('services', () => fetchHarvesterServices(cloudId, force), (json) => {
                const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : [];
                setHarvesterServices(Array.isArray(list) ? list : []);
                setRawServices(json || null);
              }, force);
            }
            break;
          case 'ingresses':
            if (checkPerm('clouds.ingresses:read')) {
              loadResource('ingresses', () => fetchHarvesterIngresses(cloudId, force), (json) => {
                const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : [];
                setHarvesterIngresses(Array.isArray(list) ? list : []);
                setRawIngresses(json || null);
              }, force);
            }
            break;
          case 'ippools':
            if (checkPerm('clouds.ippools:read')) {
              loadResource('ippools', () => fetchHarvesterIPPools(cloudId, force), (json) => {
                const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : [];
                setHarvesterIPPools(Array.isArray(list) ? list : []);
                setRawIPPools(json || null);
              }, force);
            }
            break;
          case 'cluster_networks':
            if (checkPerm('clouds.networks:read')) {
              loadResource('clusterNetworks', () => fetchHarvesterClusterNetworks(cloudId, force), (json) => {
                const list: any[] = Array.isArray((json as any)?.items) ? (json as any).items : [];
                setHarvesterClusterNetworks(Array.isArray(list) ? list : []);
                setRawClusterNetworks(json || null);
              }, force);
            }
            break;
          case 'eips':
          case 'fips':
          case 'snat':
          case 'dnat':
          case 'kube_ovn_group': // Kube-OVN 扩展组
            if (checkPerm('clouds.networks:read')) {
                if (key === 'eips' || key === 'kube_ovn_group') {
                    loadResource('eips', () => fetchCloudProviderOvnEips(cloudId, force), (json) => {
                        const list: any[] = (json as any)?.data?.items || [];
                        setKubeOvnEips(Array.isArray(list) ? list : []);
                        setRawEips(json || null);
                    }, force);
                }
                if (key === 'fips' || key === 'kube_ovn_group') {
                    loadResource('fips', () => fetchCloudProviderOvnFips(cloudId, force), (json) => {
                        const list: any[] = (json as any)?.data?.items || [];
                        setKubeOvnFips(Array.isArray(list) ? list : []);
                        setRawFips(json || null);
                    }, force);
                }
                if (key === 'snat' || key === 'kube_ovn_group') {
                    loadResource('snatRules', () => fetchCloudProviderOvnSnatRules(cloudId, force), (json) => {
                        const list: any[] = (json as any)?.data?.items || [];
                        setKubeOvnSnatRules(Array.isArray(list) ? list : []);
                        setRawSnatRules(json || null);
                    }, force);
                }
                if (key === 'dnat' || key === 'kube_ovn_group') {
                    loadResource('dnatRules', () => fetchCloudProviderOvnDnatRules(cloudId, force), (json) => {
                        const list: any[] = (json as any)?.data?.items || [];
                        setKubeOvnDnatRules(Array.isArray(list) ? list : []);
                        setRawDnatRules(json || null);
                    }, force);
                }
            }
            break;
      }
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
        const secondaryKeys = ['snapshots', 'backups', 'ssh_keys', 'cloud_inits', 'templates', 'gpu', 'services', 'ingresses', 'ippools', 'cluster_networks', 'eips', 'fips', 'snat', 'dnat', 'load_balancers'];
        // 只有当资源之前被加载过，才刷新它
        secondaryKeys.forEach(k => {
             // 注意：这里简化判断，只要之前请求过相关key，就刷新
             // 对于组合key (如 kube_ovn_group)，我们依赖具体子key的加载记录
             // 这里简单遍历调用，loadResource 内部会再次检查 loadedRef (但在 isForce=true 下会穿透)
             // 为了避免未看过的 tab 被刷新，我们检查 previouslyLoaded
             
             // 映射关系检查 (loadTabResource 的 key 和 loadedRef 的 key 可能不完全一致，需注意)
             // loadedRef keys: 'snapshots', 'backups', 'scheduleVmBackups', 'sshKeys', 'cloudInits', 'templates', 'gpu', 'services', 'ingresses', 'ippools', 'clusterNetworks', 'eips', 'fips', 'snatRules', 'dnatRules'
             
             let shouldRefresh = false;
             if (k === 'snapshots' && previouslyLoaded.includes('snapshots')) shouldRefresh = true;
             if (k === 'backups' && (previouslyLoaded.includes('backups') || previouslyLoaded.includes('scheduleVmBackups'))) shouldRefresh = true;
             if (k === 'ssh_keys' && previouslyLoaded.includes('sshKeys')) shouldRefresh = true;
             if (k === 'cloud_inits' && previouslyLoaded.includes('cloudInits')) shouldRefresh = true;
             if (k === 'templates' && previouslyLoaded.includes('templates')) shouldRefresh = true;
             if (k === 'gpu' && previouslyLoaded.includes('gpu')) shouldRefresh = true;
             if (k === 'services' && previouslyLoaded.includes('services')) shouldRefresh = true;
             if (k === 'ingresses' && previouslyLoaded.includes('ingresses')) shouldRefresh = true;
             if (k === 'ippools' && previouslyLoaded.includes('ippools')) shouldRefresh = true;
             if (k === 'load_balancers' && previouslyLoaded.includes('loadBalancers')) shouldRefresh = true;
             if (k === 'cluster_networks' && previouslyLoaded.includes('clusterNetworks')) shouldRefresh = true;
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
    if (!checkPerm('clouds.instances:read')) return;
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
  useEffect(() => { loadEssentials(); }, [cloudId]);

  /**
   * 处理 Tab 切换事件，实现按需加载
   * @param key 激活的 Tab Key
   */
  const handleTabChange = (key: string) => {
      // 外层 Tabs 特殊情况映射
      if (key === 'backups_group') { loadTabResource('backups'); return; }

      // 内层 Tabs 映射
      if (key === 'cluster_services') { loadTabResource('services'); return; }
      if (key === 'cluster_usb') { loadTabResource('usb_devices'); return; }
      if (key === 'cluster_pci') { loadTabResource('pci_devices'); return; }
      if (key === 'load_balancers') { loadTabResource('load_balancers'); return; }
      if (key === 'kubeovn_eips') { loadTabResource('eips'); return; }
      if (key === 'kubeovn_fips') { loadTabResource('fips'); return; }
      if (key === 'kubeovn_snat') { loadTabResource('snat'); return; }
      if (key === 'kubeovn_dnat') { loadTabResource('dnat'); return; }
      if (key === 'schedule_vm_backups') { loadTabResource('backups'); return; } // 同时加载备份和策略
      if (key === 'vm_snapshots') { loadTabResource('backups'); return; }
      if (key === 'vm_clones') { loadTabResource('backups'); return; }
      if (key === 'templates') { loadTabResource('templates', true); return; }

      // 直接匹配的 Key
      loadTabResource(key);
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
      // 添加时间戳防止缓存
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

  // 客户端过滤后的 VM 列表
  const ecsFiltered = useMemo(() => {
    return ecs.filter((r:any)=>{
      const iid = String(r?.InstanceId || '');
      const ns = iid.includes('/') ? iid.split('/')[0] : '';
      const node = r?.Extra?.NodeName || '';
      if (nsFilter && ns !== nsFilter) return false;
      if (nodeFilter && node !== nodeFilter) return false;
      return true;
    });
  }, [ecs, nsFilter, nodeFilter]);

  // 供应商类型判断
  const providerRaw = useMemo(() => String(cloud?.config?.provider || defaultProvider || ''), [cloud, defaultProvider]);
  const provider = useMemo(() => providerRaw.toLowerCase(), [providerRaw]);
  const isCloudmap = useMemo(() => provider === 'cloudmap' || provider === 'cloudmap.private' || provider === 'cloudmap.edge', [provider]);
  const providerName = useMemo(() => (isCloudmap ? 'Cloudmap' : 'Harvester'), [isCloudmap]);
  
  // 版本显示
  const versionText = useMemo(() => {
    const fromConfig = cloud?.config?.harvesterVersion;
    const fromNodes = (harvesterNodes.find((n:any)=> n?.version)?.version) || undefined;
    return fromConfig || fromNodes || '-';
  }, [cloud, harvesterNodes]);
  
  // 是否启用 Kube-OVN
  const hasKubeOvn = useMemo(() => (kubeOvnVpcs.length > 0 || kubeOvnSubnets.length > 0), [kubeOvnVpcs, kubeOvnSubnets]);
  
  const tlsIgnored = !!(cloud?.config?.ignoreTls);

  // 独立 GPU 刷新
  const refreshGpu = async (force: boolean = false) => {
    try {
      const r = await fetchHarvesterGpuResources(cloudId, force);
      const items = Array.isArray((r as any)?.data?.items) ? (r as any).data.items : (Array.isArray((r as any)?.items) ? (r as any).items : []);
      setHarvesterGpuResources(items);
      setRawGpu(r);
    } catch (e: any) {
      message.error(e?.message || '刷新失败');
    }
  };

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
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/admin/clouds')}></Button>
          <Button icon={<ReloadOutlined />} onClick={() => loadAll(true)}></Button>
        </Space>
      }
      asCard={false}
      subtitle="集中展示云资源池信息，提供多种资源类型的生命周期管理能力"
      defaultOverviewCollapsed={true}
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
          defaultActiveKey="overview"
          onChange={handleTabChange}
          items={[
            {
              key: 'Overview',
              label: '资源总览',
              children: <MonitoringOverview cloudId={cloudId} />
            },
            {
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
                        children: <HarvesterMonitoringAlerts cloudId={cloudId} />,
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
                    ]}
                  />
                </MonitoringProvider>
              )
            },
            {
              key: 'cluster',
              label: '集群',
              children: (
                <Tabs
                  type="line"
                  destroyOnHidden
                  defaultActiveKey="cluster_nodes"
                  onChange={handleTabChange}
                  items={[
                    {
                      key: 'cluster_nodes',
                      label: 'Node 节点',
                      children: (
                        <>
                          <NodesSection nodes={harvesterNodes} loading={resourceLoading.nodes || nodesLoading} onRefresh={refreshNodes} cloudId={cloudId} />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawNodes, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    },
                    {
                      key: 'cluster_services',
                      label: 'K8s 服务 ',
                      children: (
                        <>
                          <ServicesSection cloudId={cloudId} services={harvesterServices} loading={resourceLoading.services} onRefresh={() => loadTabResource('services', true)} />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawServices, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    },
                    {
                      key: 'cluster_networks',
                      label: '集群网络',
                      children: (
                        <>
                          <ClusterNetworksSection cloudId={cloudId} clusterNetworks={harvesterClusterNetworks} loading={resourceLoading.clusterNetworks} onRefresh={() => loadTabResource('cluster_networks', true)} />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawClusterNetworks, null, 2)}</pre>
                            </div>
                          )}
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
                          console.log('[CloudDetailHarvester] 命名空间刷新开始, cloudId:', cloudId, 'force:', force, 'silent:', silent);
                          setResourceLoading(prev => ({ ...prev, namespaces: true }));
                          try {
                            // 创建后刷新（silent=true）时，使用 skipSync=true 跳过全量同步，只查询数据库
                            const skipSync = silent; // 静默刷新 = 创建后刷新，跳过全量同步
                            console.log('[CloudDetailHarvester] 调用 fetchHarvesterNamespaces, force:', force, 'skipSync:', skipSync);
                            const json = await fetchHarvesterNamespaces(cloudId, force, false, skipSync);
                            console.log('[CloudDetailHarvester] fetchHarvesterNamespaces 返回:', json);
                            const items = json?.data?.items || json?.items || [];
                            const list = Array.isArray(items) ? items : [];
                            console.log('[CloudDetailHarvester] 解析后的命名空间数量:', list.length);
                            setHarvesterNamespacesForManagement(list);
                            // 同步更新通用命名空间列表（过滤系统命名空间）
                            const filtered = list.filter((ns: any) => {
                              const name = ns?.metadata?.name || ns?.name;
                              return name && !isSystemNamespace(name);
                            });
                            console.log('[CloudDetailHarvester] 过滤后的命名空间数量:', filtered.length);
                            setHarvesterNamespaces(filtered);
                            // 只有在非静默模式且是手动刷新时才显示提示信息
                            if (force && !silent) {
                              message.success(`刷新成功，共 ${list.length} 个命名空间`);
                            }
                          } catch (e: any) {
                            console.error('[CloudDetailHarvester] 刷新命名空间列表失败', e);
                            // 静默模式下不显示错误提示（创建后的自动刷新）
                            if (!silent) {
                              message.error('刷新失败: ' + (e?.message || '未知错误'));
                            }
                          } finally {
                            console.log('[CloudDetailHarvester] 命名空间刷新结束，重置 loading 状态');
                            setResourceLoading(prev => ({ ...prev, namespaces: false }));
                          }
                        }} 
                        showLog={showLog} 
                        raw={rawNamespaces}
                        isTenant={user?.role === 'tenant' || (user as any)?.tenantId}
                      />
                    },
                    {
                      key: 'storage_classes',
                      label: '存储类',
                      children: (
                        <>
                          <StorageClassesSection cloudId={cloudId} storageClasses={harvesterStorageClasses} loading={resourceLoading.storageClasses} onRefresh={() => loadResource('storageClasses', () => fetchHarvesterStorageClasses(cloudId), (json) => setHarvesterStorageClasses(json?.data?.items || []), true)} />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(harvesterStorageClasses, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    },
                    {
                      key: 'ingresses',
                      label: 'Ingress 路由',
                      children: (
                        <>
                          <IngressesSection cloudId={cloudId} ingresses={harvesterIngresses} loading={resourceLoading.ingresses} onRefresh={(force = true, silent = false) => {
                            const skipSync = silent;
                            setResourceLoading(prev => ({ ...prev, ingresses: true }));
                            fetchHarvesterIngresses(cloudId, force, skipSync)
                              .then((json) => {
                                const list: any[] = (json as any)?.data?.items || [];
                                setHarvesterIngresses(Array.isArray(list) ? list : []);
                                setRawIngresses(json || null);
                              })
                              .catch((e) => {
                                console.warn('Failed to load Ingresses', e);
                              })
                              .finally(() => {
                                setResourceLoading(prev => ({ ...prev, ingresses: false }));
                              });
                          }} />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawIngresses, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    },
                    {
                      key: 'gpu',
                      label: 'GPU',
                      children: (<GpusSection cloudId={cloudId} resources={harvesterGpuResources} onRefresh={refreshGpu} raw={rawGpu} showLog={showLog} />)
                    },
                    {
                      key: 'cluster_usb',
                      label: 'USB',
                      children: (<UsbDevicesSection cloudId={cloudId} usbDevices={harvesterUsbDevices} loading={resourceLoading.usbDevices} onRefresh={() => loadTabResource('usb_devices', true)} raw={rawUsbDevices} showLog={showLog} />)
                    },
                    {
                      key: 'cluster_pci',
                      label: 'PCI 设备',
                      children: (<PciDevicesSection cloudId={cloudId} devices={harvesterPciDevices} loading={resourceLoading.pciDevices} onRefresh={() => loadTabResource('pci_devices', true)} raw={rawPciDevices} showLog={showLog} />)
                    }
                  ].filter((i:any) => {
                      if (i.key === 'cluster_nodes') return checkPerm('clouds.nodes:read');
                      if (i.key === 'cluster_services') return checkPerm('clouds.services:read');
                      if (i.key === 'cluster_networks') return checkPerm('clouds.networks:read');
                      if (i.key === 'namespaces') return checkPerm('clouds.namespaces:read') || checkPerm('clouds:read');
                      if (i.key === 'storage_classes') return checkPerm('clouds.volumes:read');
                      if (i.key === 'ingresses') return checkPerm('clouds.ingresses:read');
                      if (i.key === 'gpu') return checkPerm('clouds.instances:read');
                      if (i.key === 'cluster_usb') return checkPerm('clouds.instances:read');
                      if (i.key === 'cluster_pci') return checkPerm('clouds.instances:read');
                      return true;
                   })}
                />
              )
            },
            {
              key: 'compute_group',
              label: '弹性计算',
              children: (
                <Tabs
                  type="line"
                  destroyOnHidden
                  defaultActiveKey="ecs"
                  onChange={handleTabChange}
                  items={[
                    {
                      key: 'ecs',
                      label: 'VM 云主机',
                      children: (
                        <>
                          <VmSection
                            vms={ecs}
                            volumes={harvesterVolumes}
                            loading={resourceLoading.ecs}
                            namespacesOptions={namespacesOptions}
                            nodesOptions={nodesOptions}
                            cloudId={cloudId}
                            nsValue={nsFilter || undefined}
                            nodeValue={nodeFilter || undefined}
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
                                if (checkPerm('clouds.volumes:read')) {
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
                                // 解析实例ID获取命名空间和名称
                                const [namespace, name] = iid.split('/');
                                if (!namespace || !name) {
                                  throw new Error('无效的实例ID格式');
                                }
                                
                                // 查找虚拟机对象以检查状态
                                const vm = ecs.find((v: any) => {
                                  const vmNs = v?.metadata?.namespace || v?.namespace || '';
                                  const vmName = v?.metadata?.name || v?.InstanceId?.split('/')[1] || '';
                                  return vmNs === namespace && vmName === name;
                                });
                                
                                // 检查虚拟机状态，如果正在运行则先停止
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
                                      // 等待虚拟机停止
                                      await new Promise(resolve => setTimeout(resolve, 3000));
                                      message.destroy();
                                    } catch (stopError: any) {
                                      message.destroy();
                                      throw new Error(`停止虚拟机失败: ${stopError?.message || stopError}`);
                                    }
                                  }
                                }
                                
                                // 删除虚拟机到回收站
                                await deleteCloudProviderEcs(cloudId, iid, deleteVolumes); 
                                message.success('虚拟机已移入回收站，到期后自动删除'); 
                                apiPost(`/api/clouds/${cloudId}/sync`).catch(console.warn).finally(() => refreshVms());
                              } catch(e:any){ message.error(e?.message||'移入回收站失败'); } 
                            }}
                            images={harvesterImages}
                            namespaces={harvesterNamespaces}
                          />
                          <VmReconfigureModal 
                            open={vmReconfOpen} 
                            cloudId={cloudId} 
                            record={vmReconfTarget} 
                            onClose={()=>{ setVmReconfOpen(false); setVmReconfTarget(null); }} 
                            onOk={() => {
                              // 刷新列表
                              refreshVms();
                              // [改进] 如果详情页已打开且显示的是当前变配的VM，刷新详情页数据
                              // 通过更新 vmReconfTarget 的引用，触发详情页的 useEffect 刷新
                              if (vmReconfTarget) {
                                // 延迟更新，确保后端数据已同步
                                setTimeout(() => {
                                  setVmReconfTarget({ ...vmReconfTarget, _refreshTrigger: Date.now() });
                                }, 300);
                              }
                            }} 
                            storageClasses={harvesterStorageClasses} 
                            images={harvesterImages} 
                            gpuResources={harvesterGpuResources} 
                          />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawEcs, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    },
                  
                    {
                      key: 'templates',
                      label: 'VM 模板',
                      children: (
                        <>
                          <TemplatesSection
                            cloudId={cloudId}
                            templates={harvesterTemplates}
                            loading={resourceLoading.templates}
                            onRefresh={(force = true, silent = false) => {
                              const skipSync = silent;
                              if (checkPerm('clouds.templates:read')) {
                                setResourceLoading(prev => ({ ...prev, templates: true }));
                                fetchHarvesterTemplates(cloudId, force, skipSync)
                                  .then((json) => {
                                    const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : [];
                                    setHarvesterTemplates(Array.isArray(list) ? list : []);
                                    setRawTemplates(json || null);
                                    if (force && !silent) {
                                      message.success(`刷新成功，共 ${list.length} 个模板`);
                                    }
                                  })
                                  .catch((e) => {
                                    console.warn('Failed to load Templates', e);
                                    if (!silent) {
                                      message.error('刷新失败: ' + (e?.message || '未知错误'));
                                    }
                                  })
                                  .finally(() => {
                                    setResourceLoading(prev => ({ ...prev, templates: false }));
                                  });
                              }
                            }}
                          />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawTemplates, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    },
                    {
                      key: 'ssh_keys',
                      label: 'SSH 密钥',
                      children: (
                        <>
                          <SshKeysSection cloudId={cloudId} sshKeys={harvesterSshKeys} loading={resourceLoading.sshKeys} onRefresh={(force = true, silent = false) => {
                            // 创建后刷新（silent=true）时，使用 skipSync=true 跳过全量同步
                            const skipSync = silent;
                            if (checkPerm('clouds.sshkeys:read')) {
                              setResourceLoading(prev => ({ ...prev, sshKeys: true }));
                              fetchHarvesterSshKeys(cloudId, force, skipSync)
                                .then((json) => {
                                  const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : [];
                                  setHarvesterSshKeys(Array.isArray(list) ? list : []);
                                  setRawSshKeys(json || null);
                                  // 只有在非静默模式且是手动刷新时才显示提示信息
                                  if (force && !silent) {
                                    message.success(`刷新成功，共 ${list.length} 个 SSH 密钥`);
                                  }
                                })
                                .catch((e) => {
                                  console.warn('Failed to load SSH keys', e);
                                  // 静默模式下不显示错误提示（创建后的自动刷新）
                                  if (!silent) {
                                    message.error('刷新失败: ' + (e?.message || '未知错误'));
                                  }
                                })
                                .finally(() => {
                                  setResourceLoading(prev => ({ ...prev, sshKeys: false }));
                                });
                            }
                          }} />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawSshKeys, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    },
                    {
                      key: 'cloud_inits',
                      label: 'Cloud Init',
                      children: (
                        <>
                          <CloudInitsSection cloudId={cloudId} cloudInits={harvesterCloudInits} loading={resourceLoading.cloudInits} onRefresh={() => loadTabResource('cloud_inits', true)} />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawCloudInits, null, 2)}</pre>
                            </div>
                          )}
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
                      key: 'tasks',
                      label: '任务记录',
                      children: <TasksSection cloudId={cloudId} />
                    }
                  ].filter((i:any) => {
                      if (i.key === 'ecs') return checkPerm('clouds.instances:read');
                      if (i.key === 'templates') return checkPerm('clouds.templates:read');
                      if (i.key === 'ssh_keys') return checkPerm('clouds.sshkeys:read');
                      if (i.key === 'cloud_inits') return checkPerm('clouds.cloudinits:read');
                      if (i.key === 'tasks') return checkPerm('clouds.instances:read');
                      return true;
                  })}
                />
              )
            },
            {
              key: 'storage_group',
              label: '块存储',
              children: (
                <Tabs
                  type="line"
                  destroyOnHidden
                  defaultActiveKey="volumes"
                  onChange={handleTabChange}
                  items={[
                    {
                      key: 'volumes',
                      label: 'PVC虚拟卷',
                      children: (
                        <>
                          <VolumesSection cloudId={cloudId} volumes={harvesterVolumes} loading={resourceLoading.volumes} vms={ecs} storageClasses={harvesterStorageClasses} onRefreshImages={async (force = false, silent = false) => {
                            const skipSync = silent; // 静默刷新 = 创建后刷新，跳过全量同步
                            setResourceLoading(prev => ({ ...prev, images: true }));
                            try {
                              const json = await fetchHarvesterImages(cloudId, force, skipSync);
                              const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : [];
                              setHarvesterImages(Array.isArray(list) ? list : []);
                              setRawImages(json || null);
                              if (force && !silent) {
                                message.success(`刷新成功，共 ${list.length} 个镜像`);
                              }
                            } catch (e: any) {
                              if (!silent) {
                                message.error('刷新失败: ' + (e?.message || '未知错误'));
                              }
                            } finally {
                              setResourceLoading(prev => ({ ...prev, images: false }));
                            }
                          }} onRefresh={async (force = false, silent = false) => {
                            const skipSync = silent; // 静默刷新 = 创建后刷新，跳过全量同步
                            setResourceLoading(prev => ({ ...prev, volumes: true }));
                            try {
                              const json = await fetchHarvesterVolumes(cloudId, force, skipSync);
                              const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : (Array.isArray((json as any)?.items) ? (json as any).items : []);
                              setHarvesterVolumes(Array.isArray(list) ? list : []);
                              setRawVolumes(json || null);
                              if (force && !silent) {
                                message.success(`刷新成功，共 ${list.length} 个卷`);
                              }
                            } catch (e: any) {
                              if (!silent) {
                                message.error('刷新失败: ' + (e?.message || '未知错误'));
                              }
                            } finally {
                              setResourceLoading(prev => ({ ...prev, volumes: false }));
                            }
                            // 同时刷新 VM 列表（如果需要）
                            loadResource('ecs', () => fetchCloudProviderEcs(cloudId, true), (json) => {
                              const list: any[] = Array.isArray((json as any)?.data) ? (json as any).data : (((json as any)?.data?.Instances?.Instance) || ((json as any)?.data?.items) || ((json as any)?.data?.data) || []);
                              setEcs(Array.isArray(list) ? list : []);
                            }, true);
                          }} />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawVolumes, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    },
                    {
                      key: 'images',
                      label: '镜像',
                      children: (
                        <>
                          <ImagesSection cloudId={cloudId} images={harvesterImages} loading={resourceLoading.images} onRefresh={async (force = false, silent = false) => {
                            const skipSync = silent; // 静默刷新 = 创建后刷新，跳过全量同步
                            setResourceLoading(prev => ({ ...prev, images: true }));
                            try {
                              const json = await fetchHarvesterImages(cloudId, force, skipSync);
                              const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : [];
                              setHarvesterImages(Array.isArray(list) ? list : []);
                              setRawImages(json || null);
                              if (force && !silent) {
                                message.success(`刷新成功，共 ${list.length} 个镜像`);
                              }
                            } catch (e: any) {
                              if (!silent) {
                                message.error('刷新失败: ' + (e?.message || '未知错误'));
                              }
                            } finally {
                              setResourceLoading(prev => ({ ...prev, images: false }));
                            }
                          }} />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawImages, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    },
                    {
                      key: 'snapshots',
                      label: '卷快照',
                      children: (
                        <>
                          <SnapshotsSection cloudId={cloudId} snapshots={harvesterSnapshots} namespaces={harvesterNamespaces} loading={resourceLoading.snapshots} onRefresh={async (force = false, silent = false) => {
                            const skipSync = silent; // 静默刷新 = 创建后刷新，跳过全量同步
                            setResourceLoading(prev => ({ ...prev, snapshots: true }));
                            try {
                              const json = await fetchHarvesterSnapshots(cloudId, force, skipSync);
                              const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : [];
                              setHarvesterSnapshots(Array.isArray(list) ? list : []);
                              setRawSnapshots(json || null);
                              if (force && !silent) {
                                message.success(`刷新成功，共 ${list.length} 个快照`);
                              }
                            } catch (e: any) {
                              if (!silent) {
                                message.error('刷新失败: ' + (e?.message || '未知错误'));
                              }
                            } finally {
                              setResourceLoading(prev => ({ ...prev, snapshots: false }));
                            }
                          }} />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawSnapshots, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    }
                  ].filter((i:any) => {
                     if (i.key === 'volumes') return checkPerm('clouds.volumes:read');
                     if (i.key === 'images') return checkPerm('clouds.images:read');
                     if (i.key === 'snapshots') return checkPerm('clouds.snapshots:read');
                     return true;
                  })}
                />
              )
            },
            {
              key: 'backups_group',
              label: '快照/备份',
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
                      label: 'VM 备份',
                      children: (
                        <>
                          <BackupsSection cloudId={cloudId} backups={harvesterBackups} loading={resourceLoading.backups} onRefresh={async (force = true, silent = false) => {
                            const skipSync = false;
                            if (checkPerm('clouds.backups:read')) {
                              if (!silent) setResourceLoading(prev => ({ ...prev, backups: true }));
                              try {
                                if (force && !skipSync) {
                                  try { await apiPost(`/api/clouds/${cloudId}/sync`); } catch {}
                                }
                                const json = await fetchHarvesterBackups(cloudId, force, skipSync);
                                const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : [];
                                setHarvesterBackups(Array.isArray(list) ? list : []);
                                setRawBackups(json || null);
                              } catch (e) {
                                console.warn('Failed to load backups', e);
                              } finally {
                                if (!silent) setResourceLoading(prev => ({ ...prev, backups: false }));
                              }
                            }
                          }} namespaces={harvesterNamespaces} vms={ecs} type="backup" />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawBackups, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    },
                    {
                      key: 'vm_snapshots',
                      label: 'VM 快照',
                      children: (
                        <>
                          <BackupsSection cloudId={cloudId} backups={harvesterBackups} loading={resourceLoading.backups} onRefresh={async (force = true, silent = false) => {
                            const skipSync = false;
                            if (checkPerm('clouds.backups:read')) {
                              if (!silent) setResourceLoading(prev => ({ ...prev, backups: true }));
                              try {
                                if (force && !skipSync) {
                                  try { await apiPost(`/api/clouds/${cloudId}/sync`); } catch {}
                                }
                                const json = await fetchHarvesterBackups(cloudId, force, skipSync);
                                const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : [];
                                setHarvesterBackups(Array.isArray(list) ? list : []);
                                setRawBackups(json || null);
                              } catch (e) {
                                console.warn('Failed to load backups', e);
                              } finally {
                                if (!silent) setResourceLoading(prev => ({ ...prev, backups: false }));
                              }
                            }
                          }} namespaces={harvesterNamespaces} vms={ecs} type="snapshot" />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawBackups, null, 2)}</pre>
                            </div>
                          )}
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
                            if (checkPerm('clouds.backups:read')) {
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
                            }
                          }} />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawScheduleVmBackups, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    },
                    {
                      key: 'vm_restores',
                      label: '恢复任务',
                      children: (
                        <VmRestoreTasksSection cloudId={cloudId} isTenant={user?.role === 'tenant' || (user as any)?.tenantId} vms={ecs} />
                      )
                    }
                  ]}
                />
              )
            },

            {
              key: 'native_network',
              label: '原生网络',
              children: (
                <Tabs
                  type="line"
                  destroyOnHidden
                  defaultActiveKey="nad"
                  onChange={handleTabChange}
                  items={[
                    {
                      key: 'nad',
                      label: 'NAD 网络',
                      children: (
                        <>
                          <NadsSection nads={harvesterNads} loading={resourceLoading.nads || nadsLoading} onRefresh={refreshNads} cloudId={cloudId} />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawNads, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    },
                    {
                      key: 'load_balancers',
                      label: '负载均衡',
                      children: (
                        <>
                          <LoadBalancersSection 
                            cloudId={cloudId} 
                            loadBalancers={harvesterLoadBalancers}
                            namespaces={harvesterNamespaces}
                            loading={resourceLoading.loadBalancers} 
                            onRefresh={(force, silent) => {
                              const skipSync = silent || false;
                              setResourceLoading(prev => ({ ...prev, loadBalancers: true }));
                              fetchHarvesterLoadBalancers(cloudId, force, skipSync)
                                .then((json) => {
                                  const list = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : [];
                                  setHarvesterLoadBalancers(list);
                                  setRawLoadBalancers(json || null);
                                })
                                .catch((e) => {
                                  console.warn('Failed to refresh load balancers', e);
                                })
                                .finally(() => {
                                  setResourceLoading(prev => ({ ...prev, loadBalancers: false }));
                                });
                            }} 
                          />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawLoadBalancers, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    },
                    {
                      key: 'ippools',
                      label: '地址池',
                      children: (
                        <>
                          <IPPoolsSection 
                            cloudId={cloudId} 
                            ippools={harvesterIPPools} 
                            loading={resourceLoading.ippools} 
                            onRefresh={(force, silent) => {
                              const skipSync = silent || false;
                              setResourceLoading(prev => ({ ...prev, ippools: true }));
                              fetchHarvesterIPPools(cloudId, force, skipSync)
                                .then((json) => {
                                  const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any).data.items : [];
                                  setHarvesterIPPools(Array.isArray(list) ? list : []);
                                  setRawIPPools(json || null);
                                })
                                .catch((e) => {
                                  console.warn('Failed to refresh IP pools', e);
                                })
                                .finally(() => {
                                  setResourceLoading(prev => ({ ...prev, ippools: false }));
                                });
                            }} 
                          />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawIPPools, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    }
                  ].filter((i:any) => {
                     if (i.key === 'nad') return checkPerm('clouds.networks:read');
                     if (i.key === 'load_balancers') return checkPerm('clouds.loadbalancers:read');
                     if (i.key === 'ippools') return checkPerm('clouds.ippools:read');
                     return true;
                  })}
                />
              )
            },
            ...(ovnVpcEnabled ? [{
              key: 'kube_ovn',
              label: 'Kube-OVN',
              children: (
                <Tabs
                  type="line"
                  destroyOnHidden
                  defaultActiveKey="kubeovn_vpcs"
                  onChange={handleTabChange}
                  items={[
                    {
                      key: 'kubeovn_public_networks',
                      label: '公共网络',
                      children: (
                        <>
                          <KubeOvnPublicNetworksSection />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawSubnets, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    },
                    {
                      key: 'kubeovn_vpcs',
                      label: 'VPC 私有网络',
                      children: (
                        <>
                          <KubeOvnVpcsSection vpcs={kubeOvnVpcs} subnets={kubeOvnSubnets} loading={resourceLoading.vpcs || resourceLoading.subnets} onRefresh={async (force = false, silent = false) => {
                            const skipSync = silent;
                            loadResource('vpcs', () => fetchKubeOvnVpcs(cloudId, force, skipSync), (json) => setKubeOvnVpcs(json?.data?.items || []), true);
                            loadResource('subnets', () => fetchKubeOvnSubnets(cloudId, force, skipSync), (json) => setKubeOvnSubnets(json?.data?.items || []), true);
                          }} />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawVpcs, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    },
                    {
                      key: 'kubeovn_subnets',
                      label: 'Subnet 子网',
                      children: (
                        <>
                          <KubeOvnSubnetsSection subnets={kubeOvnSubnets} vpcList={kubeOvnVpcs} loading={resourceLoading.subnets} onRefresh={() => { loadResource('subnets', () => fetchKubeOvnSubnets(cloudId, true), (json) => setKubeOvnSubnets(json?.data?.items || []), true); }} />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawSubnets, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    },
                    {
                      key: 'kubeovn_eips',
                      label: 'EIP 外部IP',
                      children: (
                        <>
                          <EipSection cloudId={cloudId} eips={kubeOvnEips} subnets={kubeOvnSubnets} loading={resourceLoading.eips} onRefresh={() => loadTabResource('eips', true)} />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawEips, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    },
                    {
                      key: 'kubeovn_fips',
                      label: 'FIP 浮动IP',
                      children: (
                        <>
                          <FipSection cloudId={cloudId} fips={kubeOvnFips} eips={kubeOvnEips} vpcs={kubeOvnVpcs} loading={resourceLoading.fips} onRefresh={() => loadTabResource('fips', true)} />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawFips, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    },
                    {
                      key: 'kubeovn_snat',
                      label: 'SNAT 规则',
                      children: (
                        <>
                          <SnatSection cloudId={cloudId} snatRules={kubeOvnSnatRules} eips={kubeOvnEips} vpcs={kubeOvnVpcs} subnets={kubeOvnSubnets} loading={resourceLoading.snatRules} onRefresh={(force = true, silent = false) => {
                            const skipSync = silent;
                            setResourceLoading(prev => ({ ...prev, snatRules: true }));
                            fetchCloudProviderOvnSnatRules(cloudId, force, skipSync)
                              .then((json) => {
                                const list: any[] = (json as any)?.data?.items || [];
                                setKubeOvnSnatRules(Array.isArray(list) ? list : []);
                                setRawSnatRules(json || null);
                              })
                              .catch((e) => {
                                console.warn('Failed to load SNAT rules', e);
                              })
                              .finally(() => {
                                setResourceLoading(prev => ({ ...prev, snatRules: false }));
                              });
                          }} />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawSnatRules, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    },
                    {
                      key: 'kubeovn_dnat',
                      label: 'DNAT 规则',
                      children: (
                        <>
                          <DnatSection cloudId={cloudId} dnatRules={kubeOvnDnatRules} eips={kubeOvnEips} vpcs={kubeOvnVpcs} loading={resourceLoading.dnatRules} onRefresh={(force = true, silent = false) => {
                            const skipSync = silent;
                            setResourceLoading(prev => ({ ...prev, dnatRules: true }));
                            fetchCloudProviderOvnDnatRules(cloudId, force, skipSync)
                              .then((json) => {
                                const list: any[] = (json as any)?.data?.items || [];
                                setKubeOvnDnatRules(Array.isArray(list) ? list : []);
                                setRawDnatRules(json || null);
                              })
                              .catch((e) => {
                                console.warn('Failed to load DNAT rules', e);
                              })
                              .finally(() => {
                                setResourceLoading(prev => ({ ...prev, dnatRules: false }));
                              });
                          }} />
                          {showLog && (
                            <div style={{ marginTop: 12 }}>
                              <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawDnatRules, null, 2)}</pre>
                            </div>
                          )}
                        </>
                      )
                    }
                  ].filter((i:any) => {
                     if (i.key === 'kubeovn_vpcs' || i.key === 'kubeovn_subnets' || i.key === 'kubeovn_public_networks') return checkPerm('clouds.networks:read');
                     if (i.key === 'kubeovn_eips') return checkPerm('clouds.networks:read');
                     if (i.key === 'kubeovn_fips') return checkPerm('clouds.networks:read');
                     if (i.key === 'kubeovn_snat') return checkPerm('clouds.networks:read');
                     if (i.key === 'kubeovn_dnat') return checkPerm('clouds.networks:read');
                     return true;
                  })}
                />
              )
            }] : []),
            {
              key: 'logs-config',
              label: '日志管理',
              children: (
                <LoggingProvider cloudId={cloudId}>
                  <Tabs
                    defaultActiveKey="logs-config"
                    tabPosition="top"
                    type="line"
                    destroyInactiveTabPane
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
                    ]}
                  />
                </LoggingProvider>
              )
            },
          ]}
      />
    </PageDetailContainer>
  );
};

export default CloudDetailHarvester;
