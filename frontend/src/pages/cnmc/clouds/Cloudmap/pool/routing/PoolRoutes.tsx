/**
 * 池主内容区路由（`routing/PoolRoutes.tsx`）
 * `admin/clouds/:id/*` 相对路径 `<Routes>`；数据来自 `useCloudmapPoolDetail`。
 */
import React from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { cloudmapPoolBasePath } from '../../../../../../layouts/admin/cloudmap/cloudPoolSidebar';
import { Empty } from 'antd';
import {
  CloudmapBackupsGroupTabs,
  CloudmapCloudDatabaseTabs,
  CloudmapOniaasNetworkTabs,
  CloudmapClusterTabs,
  CloudmapComputeGroupTabs,
  CloudmapContainersTabs,
  CloudmapFlatNetworkGroupTabs,
  CloudmapKubeOvnGroupTabs,
  CloudmapLogsConfigTab,
  CloudmapMonitoringAlertsTab,
  CloudmapObjectStorageGroupTabs,
  CloudmapStorageGroupTabs,
  ResourceOverviewDatacenterTopologyPanel,
  ResourceOverviewMonitoringPanel,
  ResourceOverviewNetworkTopologyPanel,
} from '../panels';
import { CLOUDMAP_RESOURCE_SUB_KEYS, type CloudmapResourceSubKey } from '../../../../../../layouts/admin/cloudmap/cloudPoolSidebar';
import {
  fetchHarvesterImages,
  fetchHarvesterNads,
  fetchHarvesterStorageClasses,
  fetchKubeOvnSubnets,
} from '../api';
import { useCloudmapPoolDetail } from './PoolDetailContext';
import CephStorageSection from '../../../Harvester/ceph/sections/CephStorageSection';

const RESOURCE_SUB_SET = new Set<string>(CLOUDMAP_RESOURCE_SUB_KEYS);

const ResourceHubRoute: React.FC = () => {
  const { resourceHubSub } = useParams<{ resourceHubSub: string }>();
  const p = useCloudmapPoolDetail();
  const sub = resourceHubSub as CloudmapResourceSubKey | undefined;
  if (!sub || !RESOURCE_SUB_SET.has(sub)) {
    return <Empty description="未知页面" style={{ marginTop: 48 }} />;
  }
  switch (sub) {
    case 'overview':
      return <ResourceOverviewMonitoringPanel cloudId={p.cloudId} />;
    case 'datacenter_topology':
      return p.canViewClusterGroup ? (
        <ResourceOverviewDatacenterTopologyPanel cloudId={p.cloudId} checkPerm={p.checkPerm} />
      ) : (
        <Empty description="无权限访问" style={{ marginTop: 48 }} />
      );
    case 'network_topology':
      return (
        <ResourceOverviewNetworkTopologyPanel
          cloudId={p.cloudId}
          canReadNetworkScope={p.canReadNetworkScope}
        />
      );
    case 'ceph_storage_overview':
      return p.canViewCephGroup ? (
        <CephStorageSection cloudId={p.cloudId} />
      ) : (
        <Empty description="无权限访问" style={{ marginTop: 48 }} />
      );
    default:
      return <Empty description="未知页面" style={{ marginTop: 48 }} />;
  }
};

const MonitoringAlertsRoute: React.FC = () => {
  const p = useCloudmapPoolDetail();
  if (!p.canViewMonitoringTab) {
    return <Empty description="无权限访问" style={{ marginTop: 48 }} />;
  }
  return (
    <CloudmapMonitoringAlertsTab
      cloudId={p.cloudId}
      checkPerm={p.checkPerm}
      innerActiveKey={p.poolInnerActive('monitoring_alerts')}
    />
  );
};

const ClusterRoute: React.FC = () => {
  const p = useCloudmapPoolDetail();
  if (!p.canViewClusterGroup) {
    return <Empty description="无权限访问" style={{ marginTop: 48 }} />;
  }
  return (
    <CloudmapClusterTabs
      cloudId={p.cloudId}
      isTenant={p.isTenant}
      showLog={p.showLog}
      checkPerm={p.checkPerm}
      canReadPublicSubnets={p.canReadPublicSubnets}
      canReadNetworkScope={p.canReadNetworkScope}
      canReadLoadBalancers={p.canReadLoadBalancers}
      innerActiveKey={p.poolInnerActive('cluster')}
      loadTabResource={p.loadTabResource}
      loadResource={p.loadResource}
      harvesterNodes={p.harvesterNodes}
      nodesLoading={p.nodesLoading}
      refreshNodes={p.refreshNodes}
      rawNodes={p.rawNodes}
      harvesterServices={p.harvesterServices}
      rawServices={p.rawServices}
      harvesterPods={p.harvesterPods}
      namespacesOptions={p.namespacesOptions}
      nsFilter={p.nsFilter}
      setNsFilter={p.setNsFilter}
      harvesterClusterNetworks={p.harvesterClusterNetworks}
      rawClusterNetworks={p.rawClusterNetworks}
      harvesterNads={p.harvesterNads}
      nadsLoading={p.nadsLoading}
      refreshNads={p.refreshNads}
      rawNads={p.rawNads}
      harvesterLoadBalancers={p.harvesterLoadBalancers}
      rawLoadBalancers={p.rawLoadBalancers}
      harvesterIPPools={p.harvesterIPPools}
      rawIPPools={p.rawIPPools}
      harvesterKubeOvnProviderNetworks={p.harvesterKubeOvnProviderNetworks}
      harvesterVlans={p.harvesterVlans}
      rawVlans={p.rawVlans}
      rawSubnets={p.rawSubnets}
      setKubeOvnSubnets={p.setKubeOvnSubnets}
      setRawSubnets={p.setRawSubnets}
      refreshVlans={p.refreshVlans}
      harvesterNamespacesForManagement={p.harvesterNamespacesForManagement}
      rawNamespaces={p.rawNamespaces}
      harvesterStorageClasses={p.harvesterStorageClasses}
      harvesterGpuResources={p.harvesterGpuResources}
      rawGpu={p.rawGpu}
      harvesterUsbDevices={p.harvesterUsbDevices}
      rawUsbDevices={p.rawUsbDevices}
      harvesterPciDevices={p.harvesterPciDevices}
      rawPciDevices={p.rawPciDevices}
      aswSwitchSummary={p.aswSwitchSummary}
      cloudConfig={p.cloudConfig}
      onReloadCloudMeta={p.reloadCloudMeta}
      resourceLoading={p.resourceLoading}
    />
  );
};

const ComputeRoute: React.FC = () => {
  const p = useCloudmapPoolDetail();
  if (!p.canViewComputeGroup) {
    return <Empty description="无权限访问" style={{ marginTop: 48 }} />;
  }
  return (
    <CloudmapComputeGroupTabs
      cloudId={p.cloudId}
      isTenant={p.isTenant}
      showLog={p.showLog}
      checkPerm={p.checkPerm}
      canReadFlatSubnets={p.canReadFlatSubnets}
      canReadVpcSubnets={p.canReadVpcSubnets}
      innerActiveKey={p.poolInnerActive('compute')}
      loadResource={p.loadResource}
      loadTabResource={p.loadTabResource}
      resourceLoading={p.resourceLoading}
      ecs={p.ecs}
      rawEcs={p.rawEcs}
      namespacesOptions={p.namespacesOptions}
      nodesOptions={p.nodesOptions}
      nsFilter={p.nsFilter}
      setNsFilter={p.setNsFilter}
      nodeFilter={p.nodeFilter}
      setNodeFilter={p.setNodeFilter}
      harvesterStorageClasses={p.harvesterStorageClasses}
      kubeOvnSubnets={p.kubeOvnSubnets}
      harvesterNads={p.harvesterNads}
      capabilities={p.capabilities}
      setKubeOvnSubnets={p.setKubeOvnSubnets}
      setHarvesterImages={p.setHarvesterImages}
      setHarvesterVolumes={p.setHarvesterVolumes}
      setHarvesterNamespaces={p.setHarvesterNamespaces}
      refreshVms={p.refreshVms}
      harvesterImages={p.harvesterImages}
      harvesterNamespaces={p.harvesterNamespaces}
      harvesterVolumes={p.harvesterVolumes}
      harvesterTemplates={p.harvesterTemplates}
      harvesterSshKeys={p.harvesterSshKeys}
      harvesterCloudInits={p.harvesterCloudInits}
      harvesterGpuResources={p.harvesterGpuResources}
      harvesterUsbDevices={p.harvesterUsbDevices}
      rawImages={p.rawImages}
      rawTemplates={p.rawTemplates}
      rawSshKeys={p.rawSshKeys}
      rawCloudInits={p.rawCloudInits}
    />
  );
};

const PaasDatabasesRoute: React.FC = () => {
  const p = useCloudmapPoolDetail();
  if (!p.canViewCloudDatabaseTab) {
    return <Empty description="无权限访问" style={{ marginTop: 48 }} />;
  }
  return (
    <CloudmapCloudDatabaseTabs
      cloudId={p.cloudId}
      innerActiveKey={p.poolInnerActive('paas_databases')}
      ecs={p.ecs}
      ecsLoading={!!p.resourceLoading.ecs}
      onRefreshVms={() => p.refreshVms(true)}
      onForceRefreshVms={() => p.refreshVms(true)}
      harvesterImages={p.harvesterImages}
      harvesterStorageClasses={p.harvesterStorageClasses}
      kubeOvnSubnets={p.kubeOvnSubnets}
      harvesterNads={p.harvesterNads}
      onReloadImages={
        p.checkPerm('clouds.images:read') || p.checkPerm('clouds.ecs:read')
          ? () =>
              p.loadResource(
                'images',
                () => fetchHarvesterImages(p.cloudId, true),
                (json: any) => p.setHarvesterImages((json as any)?.data?.items || []),
                true,
              )
          : undefined
      }
      onReloadSubnets={
        p.canReadFlatSubnets ||
        p.canReadVpcSubnets ||
        p.checkPerm('clouds.networks:read')
          ? () =>
              p.loadResource(
                'subnets',
                () => fetchKubeOvnSubnets(p.cloudId, true),
                (json) => p.setKubeOvnSubnets((json as any)?.data?.items || []),
                true,
              )
          : undefined
      }
      onReloadNads={
        p.checkPerm('clouds.networks:read')
          ? () =>
              p.loadResource(
                'nads',
                () => fetchHarvesterNads(p.cloudId, true),
                (json: any) => p.setHarvesterNads((json as any)?.data?.items || []),
                true,
              )
          : undefined
      }
      onReloadStorageClasses={
        p.checkPerm('clouds.disks:read') || p.checkPerm('clouds.ecs:read')
          ? () =>
              p.loadResource(
                'storageClasses',
                () => fetchHarvesterStorageClasses(p.cloudId, true),
                (json: any) => p.setHarvesterStorageClasses((json as any)?.data?.items || []),
                true,
              )
          : undefined
      }
      isTenant={p.isTenant}
      namespacesOptions={p.namespacesOptions}
      capabilities={p.capabilities}
    />
  );
};

const OniaasNetworkRoute: React.FC = () => {
  const p = useCloudmapPoolDetail();
  if (!p.canViewOniaasNetworkTab) {
    return <Empty description="无权限访问" style={{ marginTop: 48 }} />;
  }
  return (
    <CloudmapOniaasNetworkTabs
      cloudId={p.cloudId}
      innerActiveKey={p.poolInnerActive('oniaas_network')}
      ecs={p.ecs}
      ecsLoading={!!p.resourceLoading.ecs}
      onRefreshVms={() => p.refreshVms(true)}
      onForceRefreshVms={() => p.refreshVms(true)}
      canReadLoadBalancers={p.canReadLoadBalancers}
      isTenant={p.isTenant}
      harvesterLoadBalancers={p.harvesterLoadBalancers}
      loadTabResource={p.loadTabResource}
      resourceLoading={p.resourceLoading}
      namespacesForLb={p.harvesterNamespaces}
      checkPerm={p.checkPerm}
      canReadFlatSubnets={p.canReadFlatSubnets}
      canReadVpcSubnets={p.canReadVpcSubnets}
      harvesterImages={p.harvesterImages}
      harvesterStorageClasses={p.harvesterStorageClasses}
      kubeOvnSubnets={p.kubeOvnSubnets}
      harvesterNads={p.harvesterNads}
      loadResource={p.loadResource}
      setHarvesterImages={p.setHarvesterImages}
      setKubeOvnSubnets={p.setKubeOvnSubnets}
      setHarvesterNads={p.setHarvesterNads}
      setHarvesterStorageClasses={p.setHarvesterStorageClasses}
      namespacesOptions={p.namespacesOptions}
      harvesterNamespaces={p.harvesterNamespaces}
      capabilities={p.capabilities}
    />
  );
};

const ContainersRoute: React.FC = () => {
  const p = useCloudmapPoolDetail();
  if (!p.canViewContainersGroup) {
    return <Empty description="无权限访问" style={{ marginTop: 48 }} />;
  }
  return (
    <CloudmapContainersTabs
      cloudId={p.cloudId}
      isTenant={p.isTenant}
      checkPerm={p.checkPerm}
      innerActiveKey={p.poolInnerActive('containers')}
      loadTabResource={p.loadTabResource}
      loadResource={p.loadResource}
      resourceLoading={p.resourceLoading}
      namespacesOptions={p.namespacesOptions}
      nodesOptions={p.nodesOptions}
      nsFilter={p.nsFilter}
      setNsFilter={p.setNsFilter}
      nodeFilter={p.nodeFilter}
      setNodeFilter={p.setNodeFilter}
      harvesterDeployments={p.harvesterDeployments}
      setHarvesterDeployments={p.setHarvesterDeployments}
      harvesterStatefulSets={p.harvesterStatefulSets}
      setHarvesterStatefulSets={p.setHarvesterStatefulSets}
      harvesterDaemonSets={p.harvesterDaemonSets}
      setHarvesterDaemonSets={p.setHarvesterDaemonSets}
      harvesterPods={p.harvesterPods}
      setHarvesterPods={p.setHarvesterPods}
      harvesterJobs={p.harvesterJobs}
      setHarvesterJobs={p.setHarvesterJobs}
      harvesterCronJobs={p.harvesterCronJobs}
      setHarvesterCronJobs={p.setHarvesterCronJobs}
      harvesterServices={p.harvesterServices}
      setHarvesterServices={p.setHarvesterServices}
      harvesterIngresses={p.harvesterIngresses}
      setHarvesterIngresses={p.setHarvesterIngresses}
      gatewayApiStatus={p.gatewayApiStatus}
      gatewayClasses={p.gatewayClasses}
      gateways={p.gateways}
      httpRoutes={p.httpRoutes}
      grpcRoutes={p.grpcRoutes}
      harvesterPDBs={p.harvesterPDBs}
      setHarvesterPDBs={p.setHarvesterPDBs}
      harvesterNetworkPolicies={p.harvesterNetworkPolicies}
      setHarvesterNetworkPolicies={p.setHarvesterNetworkPolicies}
      harvesterConfigMaps={p.harvesterConfigMaps}
      setHarvesterConfigMaps={p.setHarvesterConfigMaps}
      harvesterSecrets={p.harvesterSecrets}
      setHarvesterSecrets={p.setHarvesterSecrets}
      harvesterImagePullSecrets={p.harvesterImagePullSecrets}
      setHarvesterImagePullSecrets={p.setHarvesterImagePullSecrets}
      harvesterVolumes={p.harvesterVolumes}
    />
  );
};

const StorageCephLegacyRedirect: React.FC = () => {
  const p = useCloudmapPoolDetail();
  return (
    <Navigate to={`${cloudmapPoolBasePath(p.cloudId)}/resource_hub/ceph_storage_overview`} replace />
  );
};

const CephLegacyPoolRedirect: React.FC = () => {
  const p = useCloudmapPoolDetail();
  const { poolInnerSeg } = useParams<{ poolInnerSeg?: string }>();
  const inner = String(poolInnerSeg ?? '').trim();
  const base = cloudmapPoolBasePath(p.cloudId);
  let to = `${base}/storage/storage_pools`;
  if (inner === 'object_storage') {
    to = `${base}/object_storage/object_gateways`;
  } else if (inner === 'overview') {
    to = `${base}/resource_hub/ceph_storage_overview`;
  } else if (inner === 'storage_pools') {
    to = `${base}/storage/storage_pools`;
  } else if (inner === 'block_storage') {
    to = `${base}/storage/storage_pools`;
  }
  return <Navigate to={to} replace />;
};

const ObjectStorageRoute: React.FC = () => {
  const p = useCloudmapPoolDetail();
  if (!p.canViewObjectStorageGroup) {
    return <Empty description="无权限访问" style={{ marginTop: 48 }} />;
  }
  return (
    <CloudmapObjectStorageGroupTabs
      cloudId={p.cloudId}
      checkPerm={p.checkPerm}
      innerActiveKey={p.poolInnerActive('object_storage')}
    />
  );
};

const StorageRoute: React.FC = () => {
  const p = useCloudmapPoolDetail();
  if (!p.canViewStorageGroup) {
    return <Empty description="无权限访问" style={{ marginTop: 48 }} />;
  }
  return (
    <CloudmapStorageGroupTabs
      cloudId={p.cloudId}
      isTenant={p.isTenant}
      showLog={p.showLog}
      checkPerm={p.checkPerm}
      innerActiveKey={p.poolInnerActive('storage')}
      loadResource={p.loadResource}
      loadTabResource={p.loadTabResource}
      ecs={p.ecs}
      setEcs={p.setEcs}
      setRawEcs={p.setRawEcs}
      harvesterVolumes={p.harvesterVolumes}
      setHarvesterVolumes={p.setHarvesterVolumes}
      harvesterStorageClasses={p.harvesterStorageClasses}
      harvesterSnapshots={p.harvesterSnapshots}
      harvesterNamespaces={p.harvesterNamespaces}
      resourceLoading={p.resourceLoading}
      rawVolumes={p.rawVolumes}
      rawSnapshots={p.rawSnapshots}
    />
  );
};

const StorageLonghornLegacyRedirect: React.FC = () => {
  const p = useCloudmapPoolDetail();
  return <Navigate to={`${cloudmapPoolBasePath(p.cloudId)}/storage/storage_pools`} replace />;
};

const BackupsRoute: React.FC = () => {
  const p = useCloudmapPoolDetail();
  if (!p.canViewBackupsGroup) {
    return <Empty description="无权限访问" style={{ marginTop: 48 }} />;
  }
  return (
    <CloudmapBackupsGroupTabs
      cloudId={p.cloudId}
      isTenant={p.isTenant}
      showLog={p.showLog}
      checkPerm={p.checkPerm}
      loadTabResource={p.loadTabResource}
      innerActiveKey={p.poolInnerActive('backups')}
      setResourceLoading={p.setResourceLoading}
      ecs={p.ecs}
      harvesterBackups={p.harvesterBackups}
      harvesterNamespaces={p.harvesterNamespaces}
      harvesterScheduleVmBackups={p.harvesterScheduleVmBackups}
      setHarvesterScheduleVmBackups={p.setHarvesterScheduleVmBackups}
      setRawScheduleVmBackups={p.setRawScheduleVmBackups}
      resourceLoading={p.resourceLoading}
      rawBackups={p.rawBackups}
      rawScheduleVmBackups={p.rawScheduleVmBackups}
    />
  );
};

const FlatNetworkRoute: React.FC = () => {
  const p = useCloudmapPoolDetail();
  if (!p.canViewFlatNetworkGroup) {
    return <Empty description="无权限访问" style={{ marginTop: 48 }} />;
  }
  return (
    <CloudmapFlatNetworkGroupTabs
      cloudId={p.cloudId}
      showLog={p.showLog}
      checkPerm={p.checkPerm}
      canReadFlatSubnets={p.canReadFlatSubnets}
      innerActiveKey={p.poolInnerActive('flat_network')}
      loadResource={p.loadResource}
      loadTabResource={p.loadTabResource}
      setResourceLoading={p.setResourceLoading}
      kubeOvnSubnets={p.kubeOvnSubnets}
      setKubeOvnSubnets={p.setKubeOvnSubnets}
      setRawSubnets={p.setRawSubnets}
      rawSubnets={p.rawSubnets}
      kubeOvnFlatEips={p.kubeOvnFlatEips}
      kubeOvnVpcs={p.kubeOvnVpcs}
      kubeOvnFlatSnatRules={p.kubeOvnFlatSnatRules}
      setKubeOvnFlatSnatRules={p.setKubeOvnFlatSnatRules}
      kubeOvnFlatDnatRules={p.kubeOvnFlatDnatRules}
      setKubeOvnFlatDnatRules={p.setKubeOvnFlatDnatRules}
      resourceLoading={p.resourceLoading}
    />
  );
};

const KubeOvnRoute: React.FC = () => {
  const p = useCloudmapPoolDetail();
  if (!p.ovnVpcEnabled || !p.canViewKubeOvnGroup) {
    return <Empty description="无权限访问" style={{ marginTop: 48 }} />;
  }
  return (
    <CloudmapKubeOvnGroupTabs
      cloudId={p.cloudId}
      showLog={p.showLog}
      checkPerm={p.checkPerm}
      canReadVpcSubnets={p.canReadVpcSubnets}
      innerActiveKey={p.poolInnerActive('kube_ovn')}
      loadResource={p.loadResource}
      loadTabResource={p.loadTabResource}
      setResourceLoading={p.setResourceLoading}
      kubeOvnVpcs={p.kubeOvnVpcs}
      setKubeOvnVpcs={p.setKubeOvnVpcs}
      setRawVpcs={p.setRawVpcs}
      kubeOvnSubnets={p.kubeOvnSubnets}
      setKubeOvnSubnets={p.setKubeOvnSubnets}
      setRawSubnets={p.setRawSubnets}
      kubeOvnEips={p.kubeOvnEips}
      kubeOvnSnatRules={p.kubeOvnSnatRules}
      setKubeOvnSnatRules={p.setKubeOvnSnatRules}
      setRawSnatRules={p.setRawSnatRules}
      kubeOvnDnatRules={p.kubeOvnDnatRules}
      setKubeOvnDnatRules={p.setKubeOvnDnatRules}
      setRawDnatRules={p.setRawDnatRules}
      resourceLoading={p.resourceLoading}
      rawVpcs={p.rawVpcs}
      rawSubnets={p.rawSubnets}
      rawEips={p.rawEips}
      rawSnatRules={p.rawSnatRules}
      rawDnatRules={p.rawDnatRules}
    />
  );
};

const LogsConfigRoute: React.FC = () => {
  const p = useCloudmapPoolDetail();
  if (!p.canViewLoggingTab) {
    return <Empty description="无权限访问" style={{ marginTop: 48 }} />;
  }
  return (
    <CloudmapLogsConfigTab
      cloudId={p.cloudId}
      checkPerm={p.checkPerm}
      innerActiveKey={p.poolInnerActive('logs_config')}
    />
  );
};

/**
 * 须在 `CloudmapPoolDetailProvider` 内渲染；路由路径相对于资源池根 `/admin/clouds/:id/`。
 */
const CloudmapPoolRoutes: React.FC = () => {
  return (
    <div className="cloudmap-detail-main">
      <Routes>
        <Route index element={<Navigate to="resource_hub/overview" replace relative="path" />} />
        <Route path="resource_hub/:resourceHubSub" element={<ResourceHubRoute />} />
        <Route path="monitoring_alerts/:poolInnerSeg?" element={<MonitoringAlertsRoute />} />
        <Route path="cluster/:poolInnerSeg?" element={<ClusterRoute />} />
        <Route path="compute/:poolInnerSeg?" element={<ComputeRoute />} />
        <Route path="paas_databases/:poolInnerSeg?" element={<PaasDatabasesRoute />} />
        <Route path="oniaas_network/:poolInnerSeg?" element={<OniaasNetworkRoute />} />
        <Route path="containers/:poolInnerSeg?" element={<ContainersRoute />} />
        <Route path="storage/ceph" element={<StorageCephLegacyRedirect />} />
        <Route path="storage/longhorn" element={<StorageLonghornLegacyRedirect />} />
        <Route path="storage/:poolInnerSeg?" element={<StorageRoute />} />
        <Route path="ceph" element={<CephLegacyPoolRedirect />} />
        <Route path="ceph/:poolInnerSeg" element={<CephLegacyPoolRedirect />} />
        <Route path="object_storage/:poolInnerSeg?" element={<ObjectStorageRoute />} />
        <Route path="backups/:poolInnerSeg?" element={<BackupsRoute />} />
        <Route path="flat_network/:poolInnerSeg?" element={<FlatNetworkRoute />} />
        <Route path="kube_ovn/:poolInnerSeg?" element={<KubeOvnRoute />} />
        <Route path="logs_config/:poolInnerSeg?" element={<LogsConfigRoute />} />
        <Route path="*" element={<Empty description="未知页面" style={{ marginTop: 48 }} />} />
      </Routes>
    </div>
  );
};

export default CloudmapPoolRoutes;
