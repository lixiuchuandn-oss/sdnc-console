/**
 * Cloudmap 池：资源状态、loadResource / 路径内层按需拉数、路径同步与 Context 值的唯一编排入口。
 * 页面壳 `PoolDetailPage` 只负责布局与 Provider 包裹。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { message } from 'antd';

import type { CloudmapPoolDetailContextValue } from '../routing';
import { runPathResourceLoad, runPoolEssentials } from '../loaders';

import {
  parseCloudmapPoolPath,
  type CloudmapResourceSubKey,
} from '../../../../../../layouts/admin/cloudmap/cloudPoolSidebar';
import { fetchCloudById, fetchHarvesterNads, fetchHarvesterNodes } from '../api';
import { useCloudmapPoolEcs } from './useCloudmapPoolEcs';
import { useCloudmapPoolPermissions } from './useCloudmapPoolPermissions';
import { useCloudmapPoolPathSync } from './useCloudmapPoolPathSync';
import { CLOUD_PROVIDER_NETWORKS_READ } from '../../../../../../constants/cloudPermissions';

const REQUEST_TIMEOUT = 30000;

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

export function useCloudmapPoolDetailEngine(cloudId: string): {
  cloudmapPoolDetailValue: CloudmapPoolDetailContextValue;
  error: string | null;
} {
  const location = useLocation();
  const navigate = useNavigate();

  const {
    checkPerm,
    isTenant,
    canReadVpcSubnets,
    canReadFlatSubnets,
    canReadPublicSubnets,
    canReadNetworkScope,
    canReadLoadBalancers,
    canViewMonitoringTab,
    canViewMonitoringOverview,
    canAccessResourceHubSub,
    resolveResourceHubSubAccess,
    canViewLoggingTab,
    canViewClusterGroup,
    canViewComputeGroup,
    canViewCloudDatabaseTab,
    canViewOniaasNetworkTab,
    canViewContainersGroup,
    canViewStorageGroup,
    canViewObjectStorageGroup,
    canViewCephGroup,
    canViewBackupsGroup,
    canViewFlatNetworkGroup,
    canViewKubeOvnGroup,
    ovnVpcEnabled,
  } = useCloudmapPoolPermissions();

  const [cloud, setCloud] = useState<CloudItem | null>(null);
  const [resourceLoading, setResourceLoading] = useState<
    Record<string, boolean>
  >({});
  const [error] = useState<string | null>(null);

  const { ecs, setEcs, rawEcs, setRawEcs, refreshVms } = useCloudmapPoolEcs({
    cloudId,
    checkPerm,
    setResourceLoading,
  });

  const [harvesterNads, setHarvesterNads] = useState<any[]>([]);
  const [harvesterImages, setHarvesterImages] = useState<any[]>([]);
  const [harvesterVolumes, setHarvesterVolumes] = useState<any[]>([]);
  const [harvesterNodes, setHarvesterNodes] = useState<any[]>([]);
  const [harvesterNamespaces, setHarvesterNamespaces] = useState<any[]>([]);
  const [
    harvesterNamespacesForManagement,
    setHarvesterNamespacesForManagement,
  ] = useState<any[]>([]);
  const [harvesterStorageClasses, setHarvesterStorageClasses] = useState<any[]>(
    [],
  );
  const [capabilities, setCapabilities] = useState<any>(null);

  const [kubeOvnVpcs, setKubeOvnVpcs] = useState<any[]>([]);
  const [kubeOvnSubnets, setKubeOvnSubnets] = useState<any[]>([]);
  const [kubeOvnEips, setKubeOvnEips] = useState<any[]>([]);
  const [kubeOvnSnatRules, setKubeOvnSnatRules] = useState<any[]>([]);
  const [kubeOvnDnatRules, setKubeOvnDnatRules] = useState<any[]>([]);
  const [kubeOvnFlatEips, setKubeOvnFlatEips] = useState<any[]>([]);
  const [kubeOvnFlatSnatRules, setKubeOvnFlatSnatRules] = useState<any[]>([]);
  const [kubeOvnFlatDnatRules, setKubeOvnFlatDnatRules] = useState<any[]>([]);

  const [harvesterSnapshots, setHarvesterSnapshots] = useState<any[]>([]);
  const [harvesterBackups, setHarvesterBackups] = useState<any[]>([]);
  const [harvesterSshKeys, setHarvesterSshKeys] = useState<any[]>([]);
  const [harvesterCloudInits, setHarvesterCloudInits] = useState<any[]>([]);
  const [harvesterVlans, setHarvesterVlans] = useState<any[]>([]);
  const [
    harvesterKubeOvnProviderNetworks,
    setHarvesterKubeOvnProviderNetworks,
  ] = useState<any[]>([]);
  const [harvesterServices, setHarvesterServices] = useState<any[]>([]);
  const [harvesterLoadBalancers, setHarvesterLoadBalancers] = useState<any[]>(
    [],
  );
  const [harvesterIPPools, setHarvesterIPPools] = useState<any[]>([]);
  const [harvesterClusterNetworks, setHarvesterClusterNetworks] = useState<
    any[]
  >([]);
  const [harvesterTemplates, setHarvesterTemplates] = useState<any[]>([]);
  const [harvesterScheduleVmBackups, setHarvesterScheduleVmBackups] = useState<
    any[]
  >([]);
  const [harvesterGpuResources, setHarvesterGpuResources] = useState<any[]>([]);
  const [harvesterUsbDevices, setHarvesterUsbDevices] = useState<any[]>([]);
  const [harvesterPciDevices, setHarvesterPciDevices] = useState<any[]>([]);

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

  const [nsFilter, setNsFilter] = useState<string>('');
  const [nodeFilter, setNodeFilter] = useState<string>('');
  const [showLog] = useState<boolean>(false);
  const [, setActiveTabKey] = useState<string>(() => {
    if (typeof window === 'undefined') return 'resource_hub';
    const p = parseCloudmapPoolPath(window.location.pathname, cloudId);
    return p?.tab || 'resource_hub';
  });
  const [, setResourceHubSubKey] = useState<CloudmapResourceSubKey>(() => {
    if (typeof window === 'undefined') return 'overview';
    const p = parseCloudmapPoolPath(window.location.pathname, cloudId);
    return p?.resourceHubSub || 'overview';
  });

  const [rawNads, setRawNads] = useState<any | null>(null);
  const [rawImages, setRawImages] = useState<any | null>(null);
  const [rawVolumes, setRawVolumes] = useState<any | null>(null);
  const [rawNodes, setRawNodes] = useState<any | null>(null);
  const [rawVpcs, setRawVpcs] = useState<any | null>(null);
  const [rawSubnets, setRawSubnets] = useState<any | null>(null);
  const [rawEips, setRawEips] = useState<any | null>(null);
  const [rawSnatRules, setRawSnatRules] = useState<any | null>(null);
  const [rawDnatRules, setRawDnatRules] = useState<any | null>(null);
  const [rawGpu, setRawGpu] = useState<any | null>(null);
  const [rawUsbDevices, setRawUsbDevices] = useState<any | null>(null);
  const [rawPciDevices, setRawPciDevices] = useState<any | null>(null);
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
  const [aswSwitchSummary, setAswSwitchSummary] = useState<any | null>(null);
  const [rawIngresses, setRawIngresses] = useState<any | null>(null);

  const loadedRef = React.useRef<Set<string>>(new Set());

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

  const [nadsLoading, setNadsLoading] = useState(false);
  const refreshNads = async (force = false, silent = false): Promise<void> => {
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

  const loadResource = React.useCallback(
    async (
      key: string,
      fn: () => Promise<any>,
      cb: (json: any) => void,
      force = false,
    ) => {
      if (!force && loadedRef.current.has(key)) return;

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

  const reloadCloudMeta = React.useCallback(async () => {
    try {
      const c = await fetchCloudById(cloudId, { skipCache: true });
      if (c) setCloud(c as CloudItem);
    } catch {
      /* 忽略 */
    }
  }, [cloudId]);

  const loadEssentials = React.useCallback(
    (force = false) => {
      runPoolEssentials(force, {
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

  const loadTabResource = useCallback(
    async (key: string, force = false, skipSync = false) => {
      await runPathResourceLoad(key, force, skipSync, {
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
        setHarvesterVolumes,
        setRawVolumes,
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
        setHarvesterImages,
        setRawImages,
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
    },
    [
      cloudId,
      checkPerm,
      loadResource,
      canReadLoadBalancers,
      canViewKubeOvnGroup,
      canViewFlatNetworkGroup,
      ovnVpcEnabled,
      harvesterSecrets,
    ],
  );

  const refreshVlans = async (force = false, skipSync = false) => {
    if (
      !checkPerm('clouds.vlans:read') &&
      !checkPerm(CLOUD_PROVIDER_NETWORKS_READ)
    )
      return;
    await loadTabResource('cluster_vlans', force, skipSync);
  };

  useEffect(() => {
    loadedRef.current.clear();
  }, [cloudId]);

  useEffect(() => {
    loadEssentials();
  }, [loadEssentials]);

  const handleTabChange = (key: string) => {
    if (key === '') return;
    if (
      key === 'backups' ||
      key === 'schedule_vm_backups' ||
      key === 'vm_snapshots'
    ) {
      loadTabResource('backups');
      return;
    }
    const shouldForceRefresh =
      key === 'kubeovn_eips' ||
      key === 'kubeovn_fips' ||
      key === 'kubeovn_snat' ||
      key === 'kubeovn_dnat' ||
      key === 'flat_kubeovn_eips' ||
      key === 'flat_kubeovn_fips' ||
      key === 'flat_kubeovn_snat' ||
      key === 'flat_kubeovn_dnat';
    loadTabResource(key, shouldForceRefresh);
  };

  const handleTabChangeRef = React.useRef(handleTabChange);
  handleTabChangeRef.current = handleTabChange;

  const { poolInnerActive } = useCloudmapPoolPathSync({
    cloudId,
    locationPathname: location.pathname,
    navigate,
    canViewClusterGroup,
    canViewComputeGroup,
    resolveResourceHubSubAccess,
    canViewMonitoringTab,
    canViewLoggingTab,
    canViewCloudDatabaseTab,
    canViewOniaasNetworkTab,
    canViewCephGroup,
    canViewObjectStorageGroup,
    setActiveTabKey,
    setResourceHubSubKey,
    handleTabChangeRef,
  });

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

  const cloudmapPoolDetailValue: CloudmapPoolDetailContextValue = {
    cloudId,
    cloudConfig: cloud?.config ?? null,
    isTenant,
    showLog,
    checkPerm,
    canReadPublicSubnets,
    canReadNetworkScope,
    canReadLoadBalancers,
    canReadFlatSubnets,
    canReadVpcSubnets,
    canViewMonitoringTab,
    canViewMonitoringOverview,
    canAccessResourceHubSub,
    canViewClusterGroup,
    canViewComputeGroup,
    canViewCloudDatabaseTab,
    canViewOniaasNetworkTab,
    canViewContainersGroup,
    canViewStorageGroup,
    canViewObjectStorageGroup,
    canViewCephGroup,
    canViewBackupsGroup,
    canViewFlatNetworkGroup,
    canViewKubeOvnGroup,
    canViewLoggingTab,
    ovnVpcEnabled,
    poolInnerActive,
    loadTabResource,
    loadResource,
    reloadCloudMeta,
    resourceLoading,
    setResourceLoading,
    ecs,
    rawEcs,
    setEcs,
    setRawEcs,
    refreshVms,
    harvesterNodes,
    nodesLoading,
    refreshNodes,
    rawNodes,
    harvesterServices,
    setHarvesterServices,
    rawServices,
    harvesterPods,
    setHarvesterPods,
    namespacesOptions,
    nsFilter,
    setNsFilter,
    harvesterClusterNetworks,
    rawClusterNetworks,
    harvesterNads,
    setHarvesterNads,
    nadsLoading,
    refreshNads,
    rawNads,
    harvesterLoadBalancers,
    rawLoadBalancers,
    harvesterIPPools,
    rawIPPools,
    harvesterKubeOvnProviderNetworks,
    harvesterVlans,
    rawVlans,
    rawSubnets,
    setKubeOvnSubnets,
    setRawSubnets,
    refreshVlans,
    harvesterNamespacesForManagement,
    harvesterStorageClasses,
    setHarvesterStorageClasses,
    harvesterGpuResources,
    rawGpu,
    harvesterUsbDevices,
    rawUsbDevices,
    harvesterPciDevices,
    rawPciDevices,
    aswSwitchSummary,
    nodeFilter,
    setNodeFilter,
    nodesOptions,
    harvesterImages,
    harvesterNamespaces,
    harvesterVolumes,
    harvesterTemplates,
    harvesterSshKeys,
    harvesterCloudInits,
    rawImages,
    rawTemplates,
    rawSshKeys,
    rawCloudInits,
    kubeOvnSubnets,
    capabilities,
    setHarvesterImages,
    setHarvesterVolumes,
    setHarvesterNamespaces,
    harvesterDeployments,
    setHarvesterDeployments,
    harvesterStatefulSets,
    setHarvesterStatefulSets,
    harvesterDaemonSets,
    setHarvesterDaemonSets,
    harvesterJobs,
    setHarvesterJobs,
    harvesterCronJobs,
    setHarvesterCronJobs,
    harvesterIngresses,
    setHarvesterIngresses,
    gatewayApiStatus,
    gatewayClasses,
    gateways,
    httpRoutes,
    grpcRoutes,
    harvesterPDBs,
    setHarvesterPDBs,
    harvesterNetworkPolicies,
    setHarvesterNetworkPolicies,
    harvesterConfigMaps,
    setHarvesterConfigMaps,
    harvesterSecrets,
    setHarvesterSecrets,
    harvesterImagePullSecrets,
    setHarvesterImagePullSecrets,
    harvesterSnapshots,
    rawVolumes,
    rawSnapshots,
    harvesterBackups,
    rawBackups,
    harvesterScheduleVmBackups,
    setHarvesterScheduleVmBackups,
    setRawScheduleVmBackups,
    rawScheduleVmBackups,
    kubeOvnFlatEips,
    kubeOvnVpcs,
    kubeOvnFlatSnatRules,
    setKubeOvnFlatSnatRules,
    kubeOvnFlatDnatRules,
    setKubeOvnFlatDnatRules,
    kubeOvnEips,
    kubeOvnSnatRules,
    setKubeOvnSnatRules,
    setRawSnatRules,
    kubeOvnDnatRules,
    setKubeOvnDnatRules,
    setRawDnatRules,
    setKubeOvnVpcs,
    setRawVpcs,
    rawVpcs,
    rawEips,
    rawSnatRules,
    rawDnatRules,
  };

  return { cloudmapPoolDetailValue, error };
}
