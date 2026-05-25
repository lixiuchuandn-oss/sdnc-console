/**
 * Rancher 集群工作台主内容：侧栏 + URL `?tab=&sub=` 驱动，与 Cloudmap `*RoutePanel` 同模式（非 antd Tabs）。
 */
import React from 'react';
import type { RancherK8sListKind } from '../../../../../../services/rancherClusterApi';
import {
  normalizeRancherResourceSub,
  resolveRancherK8sListKey,
  type RancherClusterNavKey,
  type RancherClusterSubKey,
  type RancherClusterWorkloadsSubKey,
} from '../../../../../../layouts/admin/rancher/rancherClusterSidebar';
import ClusterEventsPanel from './cluster/ClusterEventsPanel';
import ClusterMembersPanel from './cluster/ClusterMembersPanel';
import ClusterNamespacesPanel from './cluster/ClusterNamespacesPanel';
import ClusterNodesPanel from './cluster/ClusterNodesPanel';
import ClusterProjectsPanel from './cluster/ClusterProjectsPanel';
import ClusterToolsPanel from './cluster/ClusterToolsPanel';
import RancherK8sListPanel from './k8s/RancherK8sListPanel';
import RancherWorkloadsPanel from './workloads/RancherWorkloadsPanel';

const RESOURCE_NAV_KEYS = new Set<RancherClusterNavKey>([
  'apps',
  'service_discovery',
  'storage',
  'policies',
  'more_resources',
]);

export type RancherClusterRoutePanelProps = {
  poolId: string;
  clusterId: string;
  /** 侧栏一级导航，对应 URL `tab` */
  navKey: RancherClusterNavKey;
  clusterSub: RancherClusterSubKey;
  workloadsSub: RancherClusterWorkloadsSubKey;
  /** 资源类分区的 `sub`（已规范化） */
  resourceSub: string;
};

function EmptyNavHint({ text }: { text: string }): React.ReactElement {
  return <div style={{ color: 'rgba(0,0,0,0.45)', margin: '16px 0' }}>{text}</div>;
}

function ClusterSectionPanel({
  clusterId,
  poolId,
  sub,
}: {
  clusterId: string;
  poolId: string;
  sub: RancherClusterSubKey;
}) {
  switch (sub) {
    case 'cluster_tools':
      return <ClusterToolsPanel clusterId={clusterId} poolId={poolId} />;
    case 'events':
      return <ClusterEventsPanel clusterId={clusterId} poolId={poolId} />;
    case 'members':
      return <ClusterMembersPanel clusterId={clusterId} poolId={poolId} />;
    case 'namespaces':
      return <ClusterNamespacesPanel clusterId={clusterId} poolId={poolId} />;
    case 'nodes':
      return <ClusterNodesPanel clusterId={clusterId} poolId={poolId} />;
    case 'projects':
    default:
      return <ClusterProjectsPanel clusterId={clusterId} poolId={poolId} />;
  }
}

const RancherClusterRoutePanel: React.FC<RancherClusterRoutePanelProps> = ({
  poolId,
  clusterId,
  navKey,
  clusterSub,
  workloadsSub,
  resourceSub,
}) => {
  if (navKey === 'cluster') {
    return <ClusterSectionPanel clusterId={clusterId} poolId={poolId} sub={clusterSub} />;
  }
  if (navKey === 'workloads') {
    return <RancherWorkloadsPanel clusterId={clusterId} kind={workloadsSub} poolId={poolId} />;
  }
  if (RESOURCE_NAV_KEYS.has(navKey)) {
    const sub = normalizeRancherResourceSub(navKey, resourceSub);
    const listKind = resolveRancherK8sListKey(navKey, sub) as RancherK8sListKind | null;
    if (listKind) {
      return <RancherK8sListPanel clusterId={clusterId} listKind={listKind} poolId={poolId} />;
    }
  }
  return <EmptyNavHint text="该分区暂无可用视图" />;
};

export default RancherClusterRoutePanel;
