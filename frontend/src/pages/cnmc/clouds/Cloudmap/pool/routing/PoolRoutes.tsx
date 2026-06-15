/**
 * 池主内容区路由（`routing/PoolRoutes.tsx`）
 * `admin/clouds/:id/*` 相对路径 `<Routes>`；数据来自 `useCloudmapPoolDetail`。
 */
import React from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import {
  cloudmapPoolBasePath,
  isClusterCephPoolInnerSeg,
} from '../../../../../../layouts/admin/cloudmap/cloudPoolSidebar';
import { Empty } from 'antd';
import { canAccessPoolPage } from '../lib/poolPageReadAccess';
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
  CloudmapStorageRoutePanel,
  ResourceOverviewDatacenterTopologyPanel,
  ResourceOverviewMonitoringPanel,
  ResourceOverviewNetworkTopologyPanel,
} from './lazyPoolPanels';
import { CLOUDMAP_RESOURCE_SUB_KEYS, type CloudmapResourceSubKey } from '../../../../../../layouts/admin/cloudmap/cloudPoolSidebar';
import { useCloudmapPoolDetail } from './PoolDetailContext';

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
        <ResourceOverviewDatacenterTopologyPanel
          cloudId={p.cloudId}
          resourceHubSub="datacenter_topology"
          loadTabResource={p.loadTabResource}
          checkPerm={p.checkPerm}
          resourceLoading={p.resourceLoading}
          datacenterRacks={p.datacenterRacks}
          datacenterNodeMetricsMap={p.datacenterNodeMetricsMap}
          harvesterAswSwitches={p.harvesterAswSwitches}
          harvesterNodes={p.harvesterNodes}
          rawNodes={p.rawNodes}
          harvesterKubeOvnProviderNetworks={p.harvesterKubeOvnProviderNetworks}
          harvesterVlans={p.harvesterVlans}
          kubeOvnSubnets={p.kubeOvnSubnets}
          harvesterClusterNetworks={p.harvesterClusterNetworks}
        />
      ) : (
        <Empty description="无权限访问" style={{ marginTop: 48 }} />
      );
    case 'network_topology':
      return p.canAccessResourceHubSub('network_topology') ? (
        <ResourceOverviewNetworkTopologyPanel
          cloudId={p.cloudId}
          resourceHubSub="network_topology"
          loadTabResource={p.loadTabResource}
          checkPerm={p.checkPerm}
          canViewNetworkTopology={p.canViewNetworkTopology}
          resourceLoading={p.resourceLoading}
          datacenterRacks={p.datacenterRacks}
          datacenterNodeMetricsMap={p.datacenterNodeMetricsMap}
          harvesterAswSwitches={p.harvesterAswSwitches}
          harvesterNodes={p.harvesterNodes}
          rawNodes={p.rawNodes}
          harvesterKubeOvnProviderNetworks={p.harvesterKubeOvnProviderNetworks}
          harvesterVlans={p.harvesterVlans}
          kubeOvnSubnets={p.kubeOvnSubnets}
          harvesterClusterNetworks={p.harvesterClusterNetworks}
        />
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
  const inner = p.poolInnerActive('cluster');
  if (inner && !canAccessPoolPage(p.checkPerm, `cluster/${inner}`)) {
    return <Empty description="无权限访问该页面" style={{ marginTop: 48 }} />;
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
      tenantNamespaces={p.tenantNamespaces}
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
      harvesterOvnMirrors={p.harvesterOvnMirrors}
      rawOvnMirrors={p.rawOvnMirrors}
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
      tenantNamespaces={p.tenantNamespaces}
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

function clusterCephLegacyNavigateTo(
  cloudId: string,
  inner: string | undefined,
): string {
  const base = cloudmapPoolBasePath(cloudId);
  if (inner === 'object_storage') {
    return `${base}/cluster/rgw_s3_buckets`;
  }
  if (inner === 'overview') {
    return `${base}/cluster/harvester_addon?operateTab=overview`;
  }
  if (inner === 'rbd_mirror') {
    return `${base}/cluster/harvester_addon?operateTab=rbd_mirror`;
  }
  if (inner === 'block_storage' || inner === 'storage_pools') {
    return `${base}/cluster/harvester_addon?operateTab=storage_pools`;
  }
  const seg =
    inner && isClusterCephPoolInnerSeg(inner) ? inner : 'harvester_addon';
  return `${base}/cluster/${encodeURIComponent(seg)}`;
}

const StorageCephLegacyRedirect: React.FC = () => {
  const p = useCloudmapPoolDetail();
  return (
    <Navigate to={clusterCephLegacyNavigateTo(p.cloudId, 'overview')} replace />
  );
};

const CephLegacyPoolRedirect: React.FC = () => {
  const p = useCloudmapPoolDetail();
  const { poolInnerSeg } = useParams<{ poolInnerSeg?: string }>();
  const inner = String(poolInnerSeg ?? '').trim();
  return (
    <Navigate
      to={clusterCephLegacyNavigateTo(p.cloudId, inner || undefined)}
      replace
    />
  );
};

const UnifiedStorageLegacyRedirect: React.FC = () => {
  const p = useCloudmapPoolDetail();
  const { poolInnerSeg } = useParams<{ poolInnerSeg?: string }>();
  const inner = String(poolInnerSeg ?? '').trim();
  return (
    <Navigate
      to={clusterCephLegacyNavigateTo(p.cloudId, inner || undefined)}
      replace
    />
  );
};

const ObjectStorageLegacyRedirect: React.FC = () => {
  const p = useCloudmapPoolDetail();
  const { poolInnerSeg } = useParams<{ poolInnerSeg?: string }>();
  const inner = String(poolInnerSeg ?? '').trim();
  return (
    <Navigate
      to={clusterCephLegacyNavigateTo(p.cloudId, inner || undefined)}
      replace
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
      loadTabResource={p.loadTabResource}
      ecs={p.ecs}
      harvesterVolumes={p.harvesterVolumes}
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
  return (
    <Navigate
      to={clusterCephLegacyNavigateTo(p.cloudId, 'storage_pools')}
      replace
    />
  );
};

const NavigateClusterStoragePools: React.FC = () => {
  const p = useCloudmapPoolDetail();
  return (
    <Navigate
      to={clusterCephLegacyNavigateTo(p.cloudId, 'storage_pools')}
      replace
    />
  );
};

const NavigateClusterStorageOverview: React.FC = () => {
  const p = useCloudmapPoolDetail();
  return (
    <Navigate to={clusterCephLegacyNavigateTo(p.cloudId, 'overview')} replace />
  );
};

const NavigateClusterRbdMirror: React.FC = () => {
  const p = useCloudmapPoolDetail();
  return (
    <Navigate to={clusterCephLegacyNavigateTo(p.cloudId, 'rbd_mirror')} replace />
  );
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
      loadTabResource={p.loadTabResource}
      kubeOvnSubnets={p.kubeOvnSubnets}
      rawSubnets={p.rawSubnets}
      kubeOvnFlatEips={p.kubeOvnFlatEips}
      kubeOvnVpcs={p.kubeOvnVpcs}
      kubeOvnEips={p.kubeOvnEips}
      kubeOvnFlatSnatRules={p.kubeOvnFlatSnatRules}
      kubeOvnFlatDnatRules={p.kubeOvnFlatDnatRules}
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
      kubeOvnVpcs={p.kubeOvnVpcs}
      setKubeOvnVpcs={p.setKubeOvnVpcs}
      setRawVpcs={p.setRawVpcs}
      kubeOvnSubnets={p.kubeOvnSubnets}
      setKubeOvnSubnets={p.setKubeOvnSubnets}
      setRawSubnets={p.setRawSubnets}
      kubeOvnEips={p.kubeOvnEips}
      kubeOvnFlatEips={p.kubeOvnFlatEips}
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
        <Route path="storage/rbd_mirror" element={<NavigateClusterRbdMirror />} />
        <Route path="storage/storage_pools" element={<NavigateClusterStoragePools />} />
        <Route path="storage/storage_classes" element={<NavigateClusterStorageClasses />} />
        <Route path="storage/:poolInnerSeg?" element={<StorageRoute />} />
        <Route path="ceph" element={<CephLegacyPoolRedirect />} />
        <Route path="ceph/:poolInnerSeg" element={<CephLegacyPoolRedirect />} />
        <Route path="resource_hub/ceph_storage_overview" element={<NavigateClusterStorageOverview />} />
        <Route path="unified_storage/:poolInnerSeg?" element={<UnifiedStorageLegacyRedirect />} />
        <Route path="object_storage/storage_pools" element={<NavigateClusterStoragePools />} />
        <Route path="object_storage/:poolInnerSeg?" element={<ObjectStorageLegacyRedirect />} />
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
