import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Tabs } from 'antd';
import PageDetailContainer from '../../../../components/PageDetailContainer';
import {
  RANCHER_CLUSTER_TAB_KEYS,
  RANCHER_CLUSTER_TAB_LABEL,
  normalizeRancherClusterSubParam,
  normalizeRancherClusterTabParam,
  normalizeRancherClusterWorkloadsSubParam,
  normalizeRancherResourceSub,
  resolveRancherK8sListKey,
  type RancherClusterSubKey,
  type RancherClusterTabKey,
  type RancherClusterWorkloadsSubKey,
} from '../../../../layouts/admin/rancher/rancherClusterSidebar';
import type { RancherK8sListKind } from '../../../../services/rancherClusterApi';
import '../Cloudmap/pool/styles/layout.css';
import './pool/styles/rancher-workspace.css';
import ClusterProjectsPanel from './pool/panels/cluster/ClusterProjectsPanel';
import ClusterNamespacesPanel from './pool/panels/cluster/ClusterNamespacesPanel';
import ClusterNodesPanel from './pool/panels/cluster/ClusterNodesPanel';
import ClusterMembersPanel from './pool/panels/cluster/ClusterMembersPanel';
import ClusterEventsPanel from './pool/panels/cluster/ClusterEventsPanel';
import ClusterToolsPanel from './pool/panels/cluster/ClusterToolsPanel';
import RancherWorkloadsPanel from './pool/panels/workloads/RancherWorkloadsPanel';
import RancherK8sListPanel from './pool/panels/k8s/RancherK8sListPanel';

const placeholder = (text: string) => (
  <div style={{ color: 'rgba(0,0,0,0.45)', margin: '16px 0' }}>{text}</div>
);

function ClusterSectionPanel({
  sub,
  poolId,
  clusterId,
}: {
  sub: RancherClusterSubKey;
  poolId: string;
  clusterId: string;
}) {
  switch (sub) {
    case 'projects':
      return <ClusterProjectsPanel poolId={poolId} clusterId={clusterId} />;
    case 'namespaces':
      return <ClusterNamespacesPanel poolId={poolId} clusterId={clusterId} />;
    case 'nodes':
      return <ClusterNodesPanel poolId={poolId} clusterId={clusterId} />;
    case 'members':
      return <ClusterMembersPanel poolId={poolId} clusterId={clusterId} />;
    case 'events':
      return <ClusterEventsPanel poolId={poolId} clusterId={clusterId} />;
    case 'cluster_tools':
      return <ClusterToolsPanel poolId={poolId} clusterId={clusterId} />;
    default:
      return <ClusterProjectsPanel poolId={poolId} clusterId={clusterId} />;
  }
}

const RESOURCE_TABS: RancherClusterTabKey[] = [
  'apps',
  'service_discovery',
  'storage',
  'policies',
  'more_resources',
];

const RancherClusterWorkspace: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { poolId, clusterId } = useParams<{ poolId: string; clusterId: string }>();
  const pid = poolId ? decodeURIComponent(poolId) : '';
  const cid = clusterId ? decodeURIComponent(clusterId) : '';

  const [activeTabKey, setActiveTabKey] = useState<RancherClusterTabKey>(() =>
    normalizeRancherClusterTabParam(
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('tab')
        : null,
    ),
  );

  const [clusterSubKey, setClusterSubKey] = useState<RancherClusterSubKey>(() => {
    if (typeof window === 'undefined') return 'projects';
    const sp = new URLSearchParams(window.location.search);
    const rawTab = sp.get('tab');
    return normalizeRancherClusterSubParam(rawTab, sp.get('sub'), rawTab);
  });

  const [workloadsSubKey, setWorkloadsSubKey] = useState<RancherClusterWorkloadsSubKey>(() => {
    if (typeof window === 'undefined') return 'cronjob';
    const sp = new URLSearchParams(window.location.search);
    const rawTab = sp.get('tab');
    const tab = normalizeRancherClusterTabParam(rawTab);
    if (tab !== 'workloads') return 'cronjob';
    return normalizeRancherClusterWorkloadsSubParam(sp.get('sub'));
  });

  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    const rawTab = sp.get('tab');
    const tab = normalizeRancherClusterTabParam(rawTab);
    const clusterSub = normalizeRancherClusterSubParam(rawTab, sp.get('sub'), rawTab);
    const workloadsSub = normalizeRancherClusterWorkloadsSubParam(sp.get('sub'));

    setActiveTabKey(tab);
    if (tab === 'cluster') {
      setClusterSubKey(clusterSub);
    }
    if (tab === 'workloads') {
      setWorkloadsSubKey(workloadsSub);
    }

    const next = new URLSearchParams(location.search);
    next.set('tab', tab);
    if (tab === 'cluster') {
      next.set('sub', clusterSub);
    } else if (tab === 'workloads') {
      next.set('sub', workloadsSub);
    } else if (RESOURCE_TABS.includes(tab)) {
      next.set('sub', normalizeRancherResourceSub(tab, sp.get('sub')));
    } else {
      next.delete('sub');
    }

    const searchStr = next.toString();
    const canon = searchStr ? `${location.pathname}?${searchStr}` : location.pathname;
    const curFull = `${location.pathname}${location.search}`;
    if (canon !== curFull) {
      navigate(canon, { replace: true });
    }
  }, [location.search, location.pathname, navigate]);

  const outerTabItems = useMemo(
    () =>
      (RANCHER_CLUSTER_TAB_KEYS as readonly RancherClusterTabKey[]).map((key) => ({
        key,
        label: RANCHER_CLUSTER_TAB_LABEL[key],
        children: (() => {
          if (key === 'cluster') {
            return <ClusterSectionPanel sub={clusterSubKey} poolId={pid} clusterId={cid} />;
          }
          if (key === 'workloads') {
            return <RancherWorkloadsPanel poolId={pid} clusterId={cid} kind={workloadsSubKey} />;
          }
          if (RESOURCE_TABS.includes(key)) {
            const sp = new URLSearchParams(location.search);
            const sub = normalizeRancherResourceSub(key, sp.get('sub'));
            const listKind = resolveRancherK8sListKey(key, sub) as RancherK8sListKind | null;
            if (listKind) {
              return <RancherK8sListPanel poolId={pid} clusterId={cid} listKind={listKind} />;
            }
          }
          return placeholder('该分区暂无可用视图');
        })(),
      })),
    [clusterSubKey, workloadsSubKey, cid, pid, location.search],
  );

  return (
    <div className="rancher-cluster-workspace">
      <PageDetailContainer
        hideHeader
        asCard={false}
        rootStyle={{
          height: '100%',
          maxHeight: '100%',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxSizing: 'border-box',
        }}
        contentWrapperStyle={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <Tabs
        type="line"
        destroyOnHidden
        className="cloudmap-detail-outer-tabs"
        tabBarStyle={{ display: 'none', margin: 0, height: 0, minHeight: 0, padding: 0 }}
        activeKey={activeTabKey}
        onChange={(key) => {
          const k = key as RancherClusterTabKey;
          setActiveTabKey(k);
          const sp = new URLSearchParams();
          sp.set('tab', k);
          if (k === 'cluster') {
            sp.set('sub', clusterSubKey);
          } else if (k === 'workloads') {
            sp.set('sub', workloadsSubKey);
          } else if (RESOURCE_TABS.includes(k)) {
            sp.set('sub', normalizeRancherResourceSub(k, null));
          }
          navigate(`${location.pathname}?${sp.toString()}`, { replace: true });
        }}
        items={outerTabItems}
      />
      </PageDetailContainer>
    </div>
  );
};

export default RancherClusterWorkspace;
