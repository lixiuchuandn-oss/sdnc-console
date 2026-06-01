/**
 * Cloudmap 池 RoutePanel 按需加载：避免 PoolRoutes 静态拉取全部 Harvester 域 Tab。
 */
import React, { Suspense } from 'react';
import { Spin } from 'antd';

const panelFallback = (
  <div style={{ display: 'flex', justifyContent: 'center', padding: 48, minHeight: 200 }}>
    <Spin size="large" tip="加载中..." />
  </div>
);

function lazyPanel(factory: () => Promise<{ default: React.ComponentType<any> }>) {
  const Lazy = React.lazy(factory);
  const Wrapped: React.FC<any> = (props) => (
    <Suspense fallback={panelFallback}>
      <Lazy {...props} />
    </Suspense>
  );
  return Wrapped;
}

export const CloudmapBackupsRoutePanel = lazyPanel(() => import('../panels/backups'));
export const CloudmapCloudDatabaseRoutePanel = lazyPanel(() => import('../panels/paas_databases'));
export const CloudmapOniaasNetworkRoutePanel = lazyPanel(() => import('../panels/oniaas_network'));
export const CloudmapClusterRoutePanel = lazyPanel(() => import('../panels/cluster'));
export const CloudmapComputeRoutePanel = lazyPanel(() => import('../panels/compute'));
export const CloudmapContainersRoutePanel = lazyPanel(() => import('../panels/containers'));
export const CloudmapFlatNetworkRoutePanel = lazyPanel(() => import('../panels/flat_network'));
export const CloudmapKubeOvnRoutePanel = lazyPanel(() => import('../panels/kube_ovn'));
export const CloudmapLogsConfigRoutePanel = lazyPanel(() => import('../panels/logs_config'));
export const CloudmapMonitoringAlertsRoutePanel = lazyPanel(() => import('../panels/monitoring_alerts'));
export const CloudmapStorageRoutePanel = lazyPanel(() => import('../panels/storage'));

export const ResourceOverviewMonitoringPanel = lazyPanel(
  () => import('../../../Harvester/monitoring/MonitoringOverview'),
);

export const ResourceOverviewDatacenterTopologyPanel = lazyPanel(() =>
  import('../panels/resource_hub/CloudmapResourceHubTopologyPanels').then((m) => ({
    default: m.CloudmapDatacenterTopologyPanel,
  })),
);

export const ResourceOverviewNetworkTopologyPanel = lazyPanel(() =>
  import('../panels/resource_hub/CloudmapResourceHubTopologyPanels').then((m) => ({
    default: m.CloudmapNetworkTopologyPanel,
  })),
);
