import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Table, Tag, Space, Button, Statistic, Row, Col, Alert, Tabs, Descriptions, Modal, Select, Popconfirm, message, Dropdown, Typography } from 'antd';
// 引入各个资源模块组件 (注意路径调整，指向 Harvester 目录)
import NodesSection from '../Harvester/sections/NodesSection';
import ImagesSection from '../Harvester/sections/ImagesSection';
import VolumesSection from '../Harvester/sections/VolumesSection';
import NadsSection from '../Harvester/sections/NadsSection';
import KubeOvnVpcsSection from '../Harvester/kube-ovn/VpcsSection';
import KubeOvnSubnetsSection from '../Harvester/kube-ovn/SubnetsSection';
import GpusSection from '../Harvester/sections/GpusSection';
import StorageClassesSection from '../Harvester/sections/StorageClassesSection';
import SnapshotsSection from '../Harvester/sections/SnapshotsSection';
import BackupsSection from '../Harvester/sections/BackupsSection';
import SshKeysSection from '../Harvester/sections/SshKeysSection';
import CloudInitsSection from '../Harvester/sections/CloudInitsSection';
import IngressesSection from '../Harvester/sections/IngressesSection';
import ServicesSection from '../Harvester/sections/ServicesSection';
import LoadBalancersSection from '../Harvester/sections/LoadBalancersSection';
import IPPoolsSection from '../Harvester/sections/IPPoolsSection';
import ClusterNetworksSection from '../Harvester/sections/ClusterNetworksSection';
// 重新编译触发引入
import NamespacesTab from '../Harvester/sections/NamespacesTab';
import { CloudUploadOutlined, CloudServerOutlined, GlobalOutlined, HddOutlined, NodeIndexOutlined, CameraOutlined, ClusterOutlined, ReloadOutlined, ArrowLeftOutlined, UnorderedListOutlined, HomeOutlined, AppstoreOutlined, LoginOutlined } from '@ant-design/icons';
import PageDetailContainer from '../../../components/PageDetailContainer';
import { API_BASE_URL, fetchClouds, fetchCloudProviderEcs, startCloudProviderEcs, stopCloudProviderEcs, rebootCloudProviderEcs, softRebootCloudProviderEcs, pauseCloudProviderEcs, unpauseCloudProviderEcs, deleteCloudProviderEcs, apiPost } from '../../../services/api';
import { useAuth } from '../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../utils/accessMapping';
import { isSystemNamespace } from '../../../utils/harvesterUtils';
// 引入Harvester特定的API请求函数
import { fetchHarvesterSnapshots, fetchHarvesterBackups, fetchHarvesterScheduleVmBackups, fetchHarvesterSshKeys, fetchHarvesterCloudInits, fetchHarvesterIngresses, fetchHarvesterServices, fetchHarvesterLoadBalancers, fetchHarvesterIPPools, fetchHarvesterNads, fetchHarvesterImages, fetchHarvesterVolumes, fetchHarvesterNodes, fetchHarvesterVmDetail, fetchKubeOvnVpcs, fetchKubeOvnSubnets, fetchHarvesterGpuResources, fetchHarvesterNamespaces, fetchHarvesterStorageClasses, fetchHarvesterCapabilities, fetchHarvesterTemplates, fetchHarvesterClusterNetworks, fetchCloudProviderOvnEips, fetchCloudProviderOvnFips, fetchCloudProviderOvnSnatRules, fetchCloudProviderOvnDnatRules } from '../../../services/harvesterApi';
import VmReconfigureModal from '../Harvester/modals/VmReconfigureModal';
import VmSection from '../Harvester/sections/VmSection';
import TemplatesSection from '../Harvester/sections/TemplatesSection';
import ScheduleVmBackupsSection from '../Harvester/sections/ScheduleVmBackupsSection';
import EipSection from '../Harvester/kube-ovn/EipSection';
import FipSection from '../Harvester/kube-ovn/FipSection';
import MonitoringOverview from '../Harvester/Monitoring/MonitoringOverview';
import MonitoringAlerts from '../Harvester/Monitoring/MonitoringAlerts';
import ResourceStatistics from '../Harvester/Monitoring/ResourceStatistics';
import LogsConfig from '../Harvester/Monitoring/LogsConfig';
import LogOutputs from '../Harvester/Monitoring/LogOutputs';
import LogsFlowConfig from '../Harvester/Monitoring/LogsFlowConfig';
import LogsOutputConfig from '../Harvester/Monitoring/LogsOutputConfig';
import MonitoringPrometheusRules from '../Harvester/Monitoring/MonitoringPrometheusRules';
import MonitoringAlertNotificationPolicy from '../Harvester/Monitoring/MonitoringAlertNotificationPolicy';
import MonitoringAlertNotificationTargets from '../Harvester/Monitoring/MonitoringAlertNotificationTargets';
import { MonitoringProvider } from '../Harvester/Monitoring/context/MonitoringContext';
import SnatSection from '../Harvester/kube-ovn/SnatSection';
import DnatSection from '../Harvester/kube-ovn/DnatSection';

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
const CloudDetailCloudmap: React.FC<{ cloudId: string; defaultProvider?: string }> = ({ cloudId, defaultProvider }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
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
  const [harvesterNamespaces, setHarvesterNamespaces] = useState<any[]>([]); // 命名空间列表
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
      const nadsJson = await fetchHarvesterNads(cloudId, force);
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
  const loadResource = async (key: string, fn: () => Promise<any>, cb: (json: any) => void, force = false) => {
    // 如果非强制刷新且已加载过，直接跳过
    if (!force && loadedRef.current.has(key)) return;
    
    setResourceLoading(prev => ({ ...prev, [key]: true }));
    try {
      const json = await fn();
      cb(json);
      loadedRef.current.add(key);
    } catch (e) {
      console.warn(`Failed to load ${key}`, e);
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

    loadResource('namespaces', () => fetchHarvesterNamespaces(cloudId, force), (json) => {
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
              loadResource('templates', () => fetchHarvesterTemplates(cloudId, force), (json) => {
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
      if (key === 'load_balancers') { loadTabResource('load_balancers'); return; }
      if (key === 'kubeovn_eips') { loadTabResource('eips'); return; }
      if (key === 'kubeovn_fips') { loadTabResource('fips'); return; }
      if (key === 'kubeovn_snat') { loadTabResource('snat'); return; }
      if (key === 'kubeovn_dnat') { loadTabResource('dnat'); return; }
      if (key === 'schedule_vm_backups') { loadTabResource('backups'); return; } // 同时加载备份和策略
      if (key === 'vm_snapshots') { loadTabResource('backups'); return; }

      // 直接匹配的 Key
      loadTabResource(key);
  };
  
  // --- SSE 实时数据更新 Effect ---
  // 建立 EventSource 连接，监听 VM 状态变化
  useEffect(() => {
    try {
      const token = localStorage.getItem('token') || '';
      const url = `${API_BASE_URL}/api/clouds/${cloudId}/resources/ecs/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`;
      const es = new EventSource(url);
      
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
          console.warn('[SSE] Server Logic Error:', json?.message, 'Cause:', json?.cause);
        } catch (e) {
          console.warn('[SSE] Server Logic Error (Raw):', ev);
        }
      });
      
      // 网络连接错误 (浏览器原生触发，无 data 负载)
      es.onerror = (err) => {
        // console.debug('[SSE] Connection lost/refused. Browser will auto-reconnect.');
      };
      
      return () => { try { es.close(); } catch {} };
    } catch {}
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

  const providerRaw = useMemo(() => String(cloud?.config?.provider || defaultProvider || ''), [cloud, defaultProvider]);
  // Always true for Cloudmap component
  const isCloudmap = true;
  const providerName = 'Cloudmap';
  
  const versionText = useMemo(() => {
    const fromConfig = cloud?.config?.harvesterVersion;
    const fromNodes = (harvesterNodes.find((n:any)=> n?.version)?.version) || undefined;
    return fromConfig || fromNodes || '-';
  }, [cloud, harvesterNodes]);
  const hasKubeOvn = useMemo(() => (kubeOvnVpcs.length > 0 || kubeOvnSubnets.length > 0), [kubeOvnVpcs, kubeOvnSubnets]);
  const tlsIgnored = !!(cloud?.config?.ignoreTls);
  const refreshGpu = async () => {
    try {
      const r = await fetchHarvesterGpuResources(cloudId);
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
          <Dropdown
          menu={{
            items: [
              { key: 'refresh', label: '资源刷新' },
              { key: 'toggleLog', label: (showLog ? '隐藏日志' : '显示日志') },
            ],
            onClick: ({ key }) => {
              if (key === 'refresh') { loadAll(true); return; }
              if (key === 'toggleLog') { setShowLog(v => !v); return; }
            },
          }}
        >
          <Button icon={<UnorderedListOutlined />} />
        </Dropdown>
      </Space>
      }
      asCard={false}
      subtitle="Cloudmap云平台详情页，统一纳管与可视化平台资源及网络拓扑"
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
          destroyInactiveTabPane
          defaultActiveKey="overview"
          onChange={handleTabChange}
          items={[
            {
              key: 'Overview',
              label: '资源总览',
              children: (
                <Tabs
                  defaultActiveKey="overview"
                  tabPosition="top"
                  type="line"
                  destroyInactiveTabPane
                  items={[
                    {
                      key: 'overview',
                      label: '概览',
                      children: <MonitoringOverview cloudId={cloudId} />,
                    },
                    {
                      key: 'resource-statistics',
                      label: '资源统计',
                      children: (
                        <ResourceStatistics 
                          vmCount={ecs.length}
                          namespaceCount={harvesterNamespaces.length}
                          imageCount={harvesterImages.length}
                          volumeCount={harvesterVolumes.length}
                          nodeCount={harvesterNodes.length}
                          nadCount={harvesterNads.length}
                          vpcCount={kubeOvnVpcs.length}
                          subnetCount={kubeOvnSubnets.length}
                          storageClassCount={harvesterStorageClasses.length}
                          snapshotCount={harvesterSnapshots.length}
                          backupCount={harvesterBackups.length}
                          scheduleVmBackupCount={harvesterScheduleVmBackups.length}
                          templateCount={harvesterTemplates.length}
                          sshKeyCount={harvesterSshKeys.length}
                          cloudInitCount={harvesterCloudInits.length}
                          ingressCount={harvesterIngresses.length}
                          serviceCount={harvesterServices.length}
                          loadBalancerCount={harvesterLoadBalancers.length}
                          ipPoolCount={harvesterIPPools.length}
                          clusterNetworkCount={harvesterClusterNetworks.length}
                          eipCount={kubeOvnEips.length}
                          fipCount={kubeOvnFips.length}
                          snatCount={kubeOvnSnatRules.length}
                          dnatCount={kubeOvnDnatRules.length}
                          gpuCount={harvesterGpuResources.length}
                        />
                      ),
                    },
                  ]}
                />
              )
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
                    destroyInactiveTabPane
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
                  destroyInactiveTabPane
                  defaultActiveKey="cluster_nodes"
                  onChange={handleTabChange}
                  items={[
                    {
                      key: 'cluster_nodes',
                      label: '物理节点',
                      children: (
                        <>
                          <NodesSection nodes={harvesterNodes} loading={resourceLoading.nodes || nodesLoading} onRefresh={refreshNodes} cloudId={cloudId} />
                          <DebugJSON data={rawNodes} show={showLog} />
                        </>
                      )
                    },
                    {
                      key: 'cluster_services',
                      label: '基础服务 ',
                      children: (
                        <>
                          <ServicesSection cloudId={cloudId} services={harvesterServices} loading={resourceLoading.services} onRefresh={() => loadTabResource('services', true)} />
                          <DebugJSON data={rawServices} show={showLog} />
                        </>
                      )
                    },
                    {
                      key: 'cluster_networks',
                      label: '集群网络',
                      children: (
                        <>
                          <ClusterNetworksSection cloudId={cloudId} clusterNetworks={harvesterClusterNetworks} loading={resourceLoading.clusterNetworks} onRefresh={() => loadTabResource('cluster_networks', true)} />
                          <DebugJSON data={rawClusterNetworks} show={showLog} />
                        </>
                      )
                    },
                    {
                      key: 'namespaces',
                      label: '命名空间',
                      children: <NamespacesTab cloudId={cloudId} namespaces={harvesterNamespaces} loading={resourceLoading.namespaces} onRefresh={() => loadResource('namespaces', () => fetchHarvesterNamespaces(cloudId, true), (json) => setHarvesterNamespaces(json?.data?.items || []), true)} showLog={showLog} raw={rawNamespaces} />
                    },
                    {
                      key: 'storage_classes',
                      label: '存储池',
                      children: (
                        <>
                          <StorageClassesSection cloudId={cloudId} storageClasses={harvesterStorageClasses} loading={resourceLoading.storageClasses} onRefresh={() => loadResource('storageClasses', () => fetchHarvesterStorageClasses(cloudId), (json) => setHarvesterStorageClasses(json?.data?.items || []), true)} />
                          <DebugJSON data={harvesterStorageClasses} show={showLog} />
                        </>
                      )
                    }
                  ].filter((i:any) => {
                      if (i.key === 'cluster_nodes') return checkPerm('clouds.nodes:read');
                      if (i.key === 'cluster_services') return checkPerm('clouds.services:read');
                      if (i.key === 'cluster_networks') return checkPerm('clouds.networks:read');
                      if (i.key === 'namespaces') return checkPerm('clouds.namespaces:read') || checkPerm('clouds:read');
                      if (i.key === 'storage_classes') return checkPerm('clouds.volumes:read');
                      return true;
                   })}
                />
              )
            },
            {
              key: 'compute_group',
              label: '云主机',
              children: (
                <Tabs
                  type="line"
                  destroyInactiveTabPane
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
                                loadResource('namespaces', () => fetchHarvesterNamespaces(cloudId, true), (json) => {
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
                                await deleteCloudProviderEcs(cloudId, iid, deleteVolumes); 
                                message.success('删除成功'); 
                                apiPost(`/api/clouds/${cloudId}/sync`).catch(console.warn).finally(() => refreshVms());
                              } catch(e:any){ message.error(e?.message||'删除失败'); } 
                            }}
                            images={harvesterImages}
                            namespaces={harvesterNamespaces}
                            volumes={harvesterVolumes}
                          />
                          <VmReconfigureModal open={vmReconfOpen} cloudId={cloudId} record={vmReconfTarget} onClose={()=>{ setVmReconfOpen(false); setVmReconfTarget(null); }} onOk={refreshVms} storageClasses={harvesterStorageClasses} images={harvesterImages} gpuResources={harvesterGpuResources} />
                          <DebugJSON data={rawEcs} show={showLog} />
                        </>
                      )
                    },
                    {
                      key: 'templates',
                      label: '云主机模板',
                      children: (
                        <>
                          <TemplatesSection cloudId={cloudId} templates={harvesterTemplates} loading={resourceLoading.templates} onRefresh={() => loadTabResource('templates', true)} />
                          <DebugJSON data={rawTemplates} show={showLog} />
                        </>
                      )
                    },
                    {
                      key: 'ssh_keys',
                      label: 'SSH 密钥',
                      children: (
                        <>
                          <SshKeysSection cloudId={cloudId} sshKeys={harvesterSshKeys} loading={resourceLoading.sshKeys} onRefresh={() => loadTabResource('ssh_keys', true)} />
                          <DebugJSON data={rawSshKeys} show={showLog} />
                        </>
                      )
                    },
                    {
                      key: 'cloud_inits',
                      label: 'Cloud Init',
                      children: (
                        <>
                          <CloudInitsSection cloudId={cloudId} cloudInits={harvesterCloudInits} loading={resourceLoading.cloudInits} onRefresh={() => loadTabResource('cloud_inits', true)} />
                          <DebugJSON data={rawCloudInits} show={showLog} />
                        </>
                      )
                    },
                    {
                      key: 'gpu',
                      label: 'GPU',
                      children: (<GpusSection cloudId={cloudId} resources={harvesterGpuResources} onRefresh={refreshGpu} raw={rawGpu} showLog={showLog} />)
                    }
                  ].filter((i:any) => {
                      if (i.key === 'ecs') return checkPerm('clouds.instances:read');
                      if (i.key === 'templates') return checkPerm('clouds.templates:read');
                      if (i.key === 'ssh_keys') return checkPerm('clouds.sshkeys:read');
                      if (i.key === 'cloud_inits') return checkPerm('clouds.cloudinits:read');
                      if (i.key === 'gpu') return checkPerm('clouds.instances:read');
                      return true;
                  })}
                />
              )
            },
            {
              key: 'storage_group',
              label: '云存储',
              children: (
                <Tabs
                  type="line"
                  destroyInactiveTabPane
                  defaultActiveKey="volumes"
                  onChange={handleTabChange}
                  items={[
                    {
                      key: 'volumes',
                      label: '虚拟云盘',
                      children: (
                        <>
                          <VolumesSection cloudId={cloudId} volumes={harvesterVolumes} loading={resourceLoading.volumes} vms={ecs} storageClasses={harvesterStorageClasses} onRefresh={() => {
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
                      key: 'images',
                      label: '镜像',
                      children: (
                        <>
                          <ImagesSection cloudId={cloudId} images={harvesterImages} loading={resourceLoading.images} onRefresh={() => loadResource('images', () => fetchHarvesterImages(cloudId, true), (json) => setHarvesterImages(json?.data?.items || []), true)} />
                          <DebugJSON data={rawImages} show={showLog} />
                        </>
                      )
                    },
                    {
                      key: 'snapshots',
                      label: '云盘快照',
                      children: (
                        <>
                          <SnapshotsSection cloudId={cloudId} snapshots={harvesterSnapshots} loading={resourceLoading.snapshots} onRefresh={() => loadTabResource('snapshots', true)} />
                          <DebugJSON data={rawSnapshots} show={showLog} />
                        </>
                      )
                    },
                  ].filter((i:any) => {
                      if (i.key === 'volumes') return checkPerm('clouds.volumes:read');
                      if (i.key === 'images') return checkPerm('clouds.images:read');
                      if (i.key === 'snapshots') return checkPerm('clouds.snapshots:read');
                      if (i.key === 'backups_group') return checkPerm('clouds.backups:read');
                      return true;
                  })}
                />
              )
            },
{
              key: 'backups_group',
              label: '云备份',
              children: (
                <Tabs
                  type="line"
                  destroyInactiveTabPane
                  defaultActiveKey="backups"
                  onChange={handleTabChange}
                  items={[
                    {
                      key: 'backups',
                      label: '云主机备份',
                      children: (
                        <>
                          <BackupsSection cloudId={cloudId} backups={harvesterBackups} loading={resourceLoading.backups} onRefresh={() => loadTabResource('backups', true)} namespaces={harvesterNamespaces} vms={ecs} type="backup" />
                          <DebugJSON data={rawBackups} show={showLog} />
                        </>
                      )
                    },
                    {
                      key: 'vm_snapshots',
                      label: '云主机快照',
                      children: (
                        <>
                          <BackupsSection cloudId={cloudId} backups={harvesterBackups} loading={resourceLoading.backups} onRefresh={() => loadTabResource('backups', true)} namespaces={harvesterNamespaces} vms={ecs} type="snapshot" />
                          <DebugJSON data={rawBackups} show={showLog} />
                        </>
                      )
                    },
                    {
                      key: 'schedule_vm_backups',
                      label: '定时策略',
                      children: (
                        <>
                          <ScheduleVmBackupsSection cloudId={cloudId} data={harvesterScheduleVmBackups} loading={resourceLoading.scheduleVmBackups} onRefresh={() => loadTabResource('scheduleVmBackups', true)} vms={ecs} />
                          <DebugJSON data={rawScheduleVmBackups} show={showLog} />
                        </>
                      )
                    }
                  ]}
                />
              )
            },
            {
              key: 'network_group',
              label: '扁平网络',
              children: (
                <Tabs
                  type="line"
                  destroyInactiveTabPane
                  defaultActiveKey="nads"
                  onChange={handleTabChange}
                  items={[
                    {
                      key: 'nads',
                      label: 'VLAN 网络',
                      children: (
                        <>
                          <NadsSection nads={harvesterNads} loading={resourceLoading.nads || nadsLoading} onRefresh={refreshNads} cloudId={cloudId} />
                          <DebugJSON data={rawNads} show={showLog} />
                        </>
                      )
                    },
                    {
                      key: 'ingresses',
                      label: 'Ingress 路由',
                      children: (
                        <>
                          <IngressesSection cloudId={cloudId} ingresses={harvesterIngresses} loading={resourceLoading.ingresses} onRefresh={() => loadTabResource('ingresses', true)} />
                          <DebugJSON data={rawIngresses} show={showLog} />
                        </>
                      )
                    },
                    {
                      key: 'load_balancers',
                      label: '负载均衡',
                      children: (
                        <>
                          <LoadBalancersSection cloudId={cloudId} loadBalancers={harvesterLoadBalancers} loading={resourceLoading.loadBalancers} onRefresh={() => loadTabResource('load_balancers', true)} />
                          <DebugJSON data={rawLoadBalancers} show={showLog} />
                        </>
                      )
                    },
                    {
                      key: 'ippools',
                      label: 'IP 池',
                      children: (
                        <>
                          <IPPoolsSection cloudId={cloudId} ippools={harvesterIPPools} loading={resourceLoading.ippools} onRefresh={() => loadTabResource('ippools', true)} />
                          <DebugJSON data={rawIPPools} show={showLog} />
                        </>
                      )
                    }
                  ].filter((i:any) => {
                      if (i.key === 'nads') return checkPerm('clouds.networks:read');
                      if (i.key === 'ingresses') return checkPerm('clouds.ingresses:read');
                      if (i.key === 'load_balancers') return checkPerm('clouds.loadbalancers:read');
                      if (i.key === 'ippools') return checkPerm('clouds.ippools:read');
                      return true;
                  })}
                />
              )
            },
            {
              key: 'kube_ovn_group',
              label: '虚拟专有云 VPC',
              children: (
                <Tabs
                  type="line"
                  destroyInactiveTabPane
                  defaultActiveKey="vpcs"
                  onChange={handleTabChange}
                  items={[
                    {
                      key: 'vpcs',
                      label: 'VPC网络',
                      children: (
                        <>
                          <KubeOvnVpcsSection vpcs={kubeOvnVpcs} loading={resourceLoading.vpcs} onRefresh={() => loadResource('vpcs', () => fetchKubeOvnVpcs(cloudId, true), (json) => setKubeOvnVpcs(json?.data?.items || []), true)} />
                          <DebugJSON data={rawVpcs} show={showLog} />
                        </>
                      )
                    },
                    {
                      key: 'subnets',
                      label: '子网',
                      children: (
                        <>
                          <KubeOvnSubnetsSection subnets={kubeOvnSubnets} loading={resourceLoading.subnets} onRefresh={() => loadResource('subnets', () => fetchKubeOvnSubnets(cloudId, true), (json) => setKubeOvnSubnets(json?.data?.items || []), true)} />
                          <DebugJSON data={rawSubnets} show={showLog} />
                        </>
                      )
                    },
                    {
                      key: 'kubeovn_eips',
                      label: '弹性公网IP',
                      children: (
                        <>
                          <EipSection cloudId={cloudId} eips={kubeOvnEips} subnets={kubeOvnSubnets} loading={resourceLoading.eips} onRefresh={() => loadTabResource('eips', true)} />
                          <DebugJSON data={rawEips} show={showLog} />
                        </>
                      )
                    },
                    {
                      key: 'kubeovn_fips',
                      label: '浮动IP',
                      children: (
                        <>
                          <FipSection cloudId={cloudId} fips={kubeOvnFips} eips={kubeOvnEips} vpcs={kubeOvnVpcs} loading={resourceLoading.fips} onRefresh={() => loadTabResource('fips', true)} />
                          <DebugJSON data={rawFips} show={showLog} />
                        </>
                      )
                    },
                    {
                      key: 'kubeovn_snat',
                      label: 'SNAT 网关',
                      children: (
                        <>
                          <SnatSection cloudId={cloudId} snatRules={kubeOvnSnatRules} eips={kubeOvnEips} vpcs={kubeOvnVpcs} subnets={kubeOvnSubnets} loading={resourceLoading.snatRules} onRefresh={() => loadTabResource('snat', true)} />
                          <DebugJSON data={rawSnatRules} show={showLog} />
                        </>
                      )
                    },
                    {
                      key: 'kubeovn_dnat',
                      label: 'DNAT 网关',
                      children: (
                        <>
                          <DnatSection cloudId={cloudId} dnatRules={kubeOvnDnatRules} eips={kubeOvnEips} vpcs={kubeOvnVpcs} loading={resourceLoading.dnatRules} onRefresh={() => loadTabResource('dnat', true)} />
                          <DebugJSON data={rawDnatRules} show={showLog} />
                        </>
                      )
                    }
                  ].filter((i:any) => {
                      // 这里简化，只要有 clouds.networks:read 权限即可查看
                      return checkPerm('clouds.networks:read');
                  })}
                />
              )
            },
            {
              key: 'logs-config',
              label: '日志管理',
              children: (
                <Tabs
                  defaultActiveKey="logs-config"
                  tabPosition="top"
                  type="line"
                  destroyInactiveTabPane
                  items={[
                    {
                      key: 'logs-config',
                      label: '集群日志配置',
                      children: <LogsConfig cloudId={cloudId} />,
                    },
                    {
                      key: 'log-outputs',
                      label: '集群日志外发',
                      children: <LogOutputs cloudId={cloudId} />,
                    },
                    {
                      key: 'logs-flow-config',
                      label: '租户日志配置',
                      children: <LogsFlowConfig cloudId={cloudId} />,
                    },
                    {
                      key: 'logs-output-config',
                      label: '租户日志外发',
                      children: <LogsOutputConfig cloudId={cloudId} />,
                    },
                  ]}
                />
              )
            }
          ]}
      />
    </PageDetailContainer>
  );
};

export default CloudDetailCloudmap;
