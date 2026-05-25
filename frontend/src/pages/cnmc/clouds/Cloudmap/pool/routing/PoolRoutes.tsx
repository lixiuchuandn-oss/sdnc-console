/**
 * 池主内容区路由（`routing/PoolRoutes.tsx`）
 * `admin/clouds/:id/*` 相对路径 `<Routes>`；数据来自 `useCloudmapPoolDetail`。
 */
import React from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import {
  cloudmapDefaultPoolInnerSeg,
  cloudmapPoolBasePath,
} from '../../../../../../layouts/admin/cloudmap/cloudPoolSidebar';
import { Empty } from 'antd';
import {
  CloudmapBackupsRoutePanel,
  CloudmapCloudDatabaseRoutePanel,
  CloudmapOniaasNetworkRoutePanel,
  CloudmapClusterRoutePanel,
  CloudmapComputeRoutePanel,
  CloudmapContainersRoutePanel,
  CloudmapFlatNetworkRoutePanel,
  CloudmapKubeOvnRoutePanel,
  CloudmapLogsConfigRoutePanel,
  CloudmapMonitoringAlertsRoutePanel,
  CloudmapObjectStorageRoutePanel,
  CloudmapStorageRoutePanel,
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
import CloudmapStorageDashboardByBackend from '../panels/resource_hub/CloudmapStorageDashboardByBackend';

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
      return p.canAccessResourceHubSub('overview') ? (
        <ResourceOverviewMonitoringPanel cloudId={p.cloudId} />
      ) : (
        <Empty description="无权限访问" style={{ marginTop: 48 }} />
      );
    case 'datacenter_topology':
      return p.canAccessResourceHubSub('datacenter_topology') ? (
        <ResourceOverviewDatacenterTopologyPanel cloudId={p.cloudId} checkPerm={p.checkPerm} />
      ) : (
        <Empty description="无权限访问" style={{ marginTop: 48 }} />
      );
    case 'network_topology':
      return p.canAccessResourceHubSub('network_topology') ? (
        <ResourceOverviewNetworkTopologyPanel
          cloudId={p.cloudId}
          canReadNetworkScope={p.canAccessResourceHubSub('network_topology')}
        />
      ) : (
        <Empty description="无权限访问" style={{ marginTop: 48 }} />
      );
    case 'ceph_storage_overview':
      return p.canAccessResourceHubSub('ceph_storage_overview') ? (
        <CloudmapStorageDashboardByBackend cloudId={p.cloudId} />
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
    <CloudmapMonitoringAlertsRoutePanel
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
    <CloudmapClusterRoutePanel
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
      rawNodes={p.rawNodes}
      harvesterClusterNetworks={p.harvesterClusterNetworks}
      rawClusterNetworks={p.rawClusterNetworks}
      harvesterNads={p.harvesterNads}
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
      harvesterNamespacesForManagement={p.harvesterNamespacesForManagement}
      harvesterStorageClasses={p.harvesterStorageClasses}
      harvesterGpuResources={p.harvesterGpuResources}
      rawGpu={p.rawGpu}
      harvesterUsbDevices={p.harvesterUsbDevices}
      rawUsbDevices={p.rawUsbDevices}
      harvesterPciDevices={p.harvesterPciDevices}
      rawPciDevices={p.rawPciDevices}
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
    <CloudmapComputeRoutePanel
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
      harvesterMigrations={p.harvesterMigrations}
      rawMigrations={p.rawMigrations}
    />
  );
};

const PaasDatabasesRoute: React.FC = () => {
  const p = useCloudmapPoolDetail();
  if (!p.canViewCloudDatabaseTab) {
    return <Empty description="无权限访问" style={{ marginTop: 48 }} />;
  }
  return (
    <CloudmapCloudDatabaseRoutePanel
      cloudId={p.cloudId}
      innerActiveKey={p.poolInnerActive('paas_databases')}
      loadTabResource={p.loadTabResource}
      loadResource={p.loadResource}
      checkPerm={p.checkPerm}
      canReadFlatSubnets={p.canReadFlatSubnets}
      canReadVpcSubnets={p.canReadVpcSubnets}
      ecs={p.ecs}
      ecsLoading={!!p.resourceLoading.ecs}
      harvesterImages={p.harvesterImages}
      harvesterStorageClasses={p.harvesterStorageClasses}
      kubeOvnSubnets={p.kubeOvnSubnets}
      harvesterNads={p.harvesterNads}
      setHarvesterImages={p.setHarvesterImages}
      setKubeOvnSubnets={p.setKubeOvnSubnets}
      setHarvesterNads={p.setHarvesterNads}
      setHarvesterStorageClasses={p.setHarvesterStorageClasses}
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
    <CloudmapOniaasNetworkRoutePanel
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
    <CloudmapContainersRoutePanel
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
  let to = `${base}/cluster/storage_pools`;
  if (inner === 'object_storage') {
    to = `${base}/object_storage/${encodeURIComponent(cloudmapDefaultPoolInnerSeg('object_storage'))}`;
  } else if (inner === 'overview') {
    to = `${base}/resource_hub/ceph_storage_overview`;
  } else if (inner === 'storage_pools') {
    to = `${base}/cluster/storage_pools`;
  } else if (inner === 'block_storage') {
    to = `${base}/cluster/storage_pools`;
  }
  return <Navigate to={to} replace />;
};

const ObjectStorageRoute: React.FC = () => {
  const p = useCloudmapPoolDetail();
  if (!p.canViewObjectStorageGroup) {
    return <Empty description="无权限访问" style={{ marginTop: 48 }} />;
  }
  return (
    <CloudmapObjectStorageRoutePanel
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
    <CloudmapStorageRoutePanel
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
  return <Navigate to={`${cloudmapPoolBasePath(p.cloudId)}/cluster/storage_pools`} replace />;
};

const NavigateClusterStoragePools: React.FC = () => {
  const p = useCloudmapPoolDetail();
  return <Navigate to={`${cloudmapPoolBasePath(p.cloudId)}/cluster/storage_pools`} replace />;
};

const NavigateClusterStorageClasses: React.FC = () => {
  const p = useCloudmapPoolDetail();
  return (
    <Navigate to={`${cloudmapPoolBasePath(p.cloudId)}/cluster/storage_classes`} replace />
  );
};

const BackupsRoute: React.FC = () => {
  const p = useCloudmapPoolDetail();
  if (!p.canViewBackupsGroup) {
    return <Empty description="无权限访问" style={{ marginTop: 48 }} />;
  }
  return (
    <CloudmapBackupsRoutePanel
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
    <CloudmapFlatNetworkRoutePanel
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
  if (!p.canViewKubeOvnGroup) {
    return <Empty description="无权限访问" style={{ marginTop: 48 }} />;
  }
  return (
    <CloudmapKubeOvnRoutePanel
      cloudId={p.cloudId}
      showLog={p.showLog}
      checkPerm={p.checkPerm}
      ovnVpcEnabled={p.ovnVpcEnabled}
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
    <CloudmapLogsConfigRoutePanel
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
        <Route path="storage/storage_pools" element={<NavigateClusterStoragePools />} />
        <Route path="storage/storage_classes" element={<NavigateClusterStorageClasses />} />
        <Route path="storage/:poolInnerSeg?" element={<StorageRoute />} />
        <Route path="ceph" element={<CephLegacyPoolRedirect />} />
        <Route path="ceph/:poolInnerSeg" element={<CephLegacyPoolRedirect />} />
        <Route path="object_storage/storage_pools" element={<NavigateClusterStoragePools />} />
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
