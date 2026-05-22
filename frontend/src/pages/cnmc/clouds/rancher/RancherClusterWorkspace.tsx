/**
 * Rancher 容器云（CNMC）：资源池根路径跳集群工作台 + 集群内 Tab 分区。
 * `RancherPoolVendorShell`（`clouds/vendor/rancher/:id`）挂载 `RancherPoolHomeRedirect`；`clouds/:poolId/clusters/:clusterId` 使用本文件 default。
 * 分区实现见 `./pool/`。
 */
import type { CSSProperties } from 'react';
import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Space, Spin, Tabs } from 'antd';
import { CloudUploadOutlined, HomeOutlined, ReloadOutlined } from '@ant-design/icons';
import PageDetailContainer from '../../../../components/PageDetailContainer';
import { fetchRancherClustersForPool } from '../../../../services/api';
import type { RancherK8sListKind } from '../../../../services/rancherClusterApi';
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
import '../Cloudmap/pool/styles/layout.css';
import './pool/styles/rancher-workspace.css';
import ClusterEventsPanel from './pool/panels/cluster/ClusterEventsPanel';
import ClusterMembersPanel from './pool/panels/cluster/ClusterMembersPanel';
import ClusterNamespacesPanel from './pool/panels/cluster/ClusterNamespacesPanel';
import ClusterNodesPanel from './pool/panels/cluster/ClusterNodesPanel';
import ClusterProjectsPanel from './pool/panels/cluster/ClusterProjectsPanel';
import ClusterToolsPanel from './pool/panels/cluster/ClusterToolsPanel';
import RancherK8sListPanel from './pool/panels/k8s/RancherK8sListPanel';
import RancherWorkloadsPanel from './pool/panels/workloads/RancherWorkloadsPanel';

// --- 常量与纯函数 ---------------------------------------------------------------------------

const RANCHER_HOME_QUERY = 'tab=cluster&sub=projects' as const;

const RESOURCE_TAB_KEYS = new Set<RancherClusterTabKey>([
  'apps',
  'service_discovery',
  'storage',
  'policies',
  'more_resources',
]);

const POOL_GATE_LOADING_STYLE: CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  justifyContent: 'center',
  minHeight: 320,
  width: '100%',
};

const CLUSTER_WORKSPACE_OUTER_STYLE: CSSProperties = {
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  maxHeight: '100%',
  minHeight: 0,
  overflow: 'hidden',
};

const CLUSTER_WORKSPACE_CONTENT_STYLE: CSSProperties = {
  display: 'flex',
  flex: 1,
  flexDirection: 'column',
  minHeight: 0,
  overflow: 'hidden',
};

function clusterWorkbenchPath(poolId: string, clusterId: string): string {
  return `/admin/clouds/${encodeURIComponent(poolId)}/clusters/${encodeURIComponent(clusterId)}?${RANCHER_HOME_QUERY}`;
}

function parseUnknownErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string' && e) return e;
  return fallback;
}

function poolGateBreadcrumbs(titleText: string) {
  return [
    { title: <HomeOutlined />, href: '/' },
    { title: '资源池管理' },
    { title: '资源池管理', href: '/admin/clouds' },
    { title: titleText },
  ];
}

// --- 资源池根路径（导出供 `RancherPoolVendorShell`）---------------------------------------

export type RancherPoolHomeRedirectProps = {
  boundClusterId?: string;
  cloudName: string;
  poolId: string;
  providerLabel: string;
};

/** 解析集群列表后 Navigate 至工作台首页。 */
export function RancherPoolHomeRedirect({
  poolId,
  cloudName,
  providerLabel,
  boundClusterId,
}: RancherPoolHomeRedirectProps): React.ReactElement {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<'loading' | 'error' | 'empty'>('loading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(() =>
    boundClusterId ? clusterWorkbenchPath(poolId, boundClusterId) : null,
  );

  useEffect(() => {
    if (boundClusterId) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await fetchRancherClustersForPool(poolId);
        if (cancelled) return;
        if (!list.length) {
          setPhase('empty');
          return;
        }
        setTarget(clusterWorkbenchPath(poolId, list[0].id));
      } catch (e: unknown) {
        if (cancelled) return;
        setErrorMsg(parseUnknownErrorMessage(e, '加载集群列表失败'));
        setPhase('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [poolId, boundClusterId]);

  if (target) return <Navigate to={target} replace />;

  const titleText = `${providerLabel} ${cloudName || '-'}`;

  if (phase === 'loading') {
    return (
      <div style={POOL_GATE_LOADING_STYLE}>
        <Spin size="large" tip="正在进入 Rancher 集群工作台…" />
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <PageDetailContainer
        asCard={false}
        backTooltip="返回列表"
        breadcrumbs={poolGateBreadcrumbs(titleText)}
        icon={<CloudUploadOutlined style={{ color: '#1890ff', fontSize: 24 }} />}
        onBack={() => navigate('/admin/clouds')}
        title={titleText}
        titleLevel={3}
      >
        <Alert
          action={
            <Space>
              <Button onClick={() => navigate('/admin/clouds')}>返回列表</Button>
              <Button icon={<ReloadOutlined />} type="primary" onClick={() => window.location.reload()}>
                重试
              </Button>
            </Space>
          }
          description={errorMsg}
          message="无法进入集群工作台"
          showIcon
          type="warning"
        />
      </PageDetailContainer>
    );
  }

  return (
    <PageDetailContainer
      asCard={false}
      backTooltip="返回列表"
      breadcrumbs={poolGateBreadcrumbs(titleText)}
      icon={<CloudUploadOutlined style={{ color: '#1890ff', fontSize: 24 }} />}
      onBack={() => navigate('/admin/clouds')}
      title={titleText}
      titleLevel={3}
    >
      <Alert
        action={
          <Button type="primary" onClick={() => navigate('/admin/clouds')}>
            返回资源池列表
          </Button>
        }
        description="请在 Rancher 中导入集群或检查 API 令牌权限后，从资源池列表再次进入。"
        message="该 Rancher 资源池下暂无下游集群"
        showIcon
        type="info"
      />
    </PageDetailContainer>
  );
}

// --- 集群工作台 -----------------------------------------------------------------------------

function EmptyTabHint({ text }: { text: string }): React.ReactElement {
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
      return <ClusterProjectsPanel clusterId={clusterId} poolId={poolId} />;
    default:
      return <ClusterProjectsPanel clusterId={clusterId} poolId={poolId} />;
  }
}

function buildTabSearchSnapshot(search: string) {
  const sp = new URLSearchParams(search);
  const rawTab = sp.get('tab');
  const tab = normalizeRancherClusterTabParam(rawTab);
  const clusterSub = normalizeRancherClusterSubParam(rawTab, sp.get('sub'), rawTab);
  const workloadsSub = normalizeRancherClusterWorkloadsSubParam(sp.get('sub'));
  return { clusterSub, sp, tab, workloadsSub };
}

const RancherClusterWorkspace = (): React.ReactElement => {
  const navigate = useNavigate();
  const location = useLocation();
  const { poolId, clusterId } = useParams<{ poolId: string; clusterId: string }>();
  const pid = poolId ? decodeURIComponent(poolId) : '';
  const cid = clusterId ? decodeURIComponent(clusterId) : '';

  const tabSnapshot = useMemo(() => buildTabSearchSnapshot(location.search), [location.search]);

  const [activeTabKey, setActiveTabKey] = useState<RancherClusterTabKey>(() =>
    normalizeRancherClusterTabParam(
      typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('tab') : null,
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
    const { clusterSub, sp, tab, workloadsSub } = tabSnapshot;

    setActiveTabKey((prev) => (prev === tab ? prev : tab));
    if (tab === 'cluster') setClusterSubKey((prev) => (prev === clusterSub ? prev : clusterSub));
    if (tab === 'workloads') setWorkloadsSubKey((prev) => (prev === workloadsSub ? prev : workloadsSub));

    const next = new URLSearchParams(location.search);
    next.set('tab', tab);
    if (tab === 'cluster') {
      next.set('sub', clusterSub);
    } else if (tab === 'workloads') {
      next.set('sub', workloadsSub);
    } else if (RESOURCE_TAB_KEYS.has(tab)) {
      next.set('sub', normalizeRancherResourceSub(tab, sp.get('sub')));
    } else {
      next.delete('sub');
    }

    const searchStr = next.toString();
    const canon = searchStr ? `${location.pathname}?${searchStr}` : location.pathname;
    const curFull = `${location.pathname}${location.search}`;
    if (canon !== curFull) navigate(canon, { replace: true });
  }, [location.pathname, location.search, navigate, tabSnapshot]);

  const outerTabItems = useMemo(() => {
    const { sp } = tabSnapshot;
    return (RANCHER_CLUSTER_TAB_KEYS as readonly RancherClusterTabKey[]).map((key) => ({
      children: (() => {
        if (key === 'cluster') {
          return <ClusterSectionPanel clusterId={cid} poolId={pid} sub={clusterSubKey} />;
        }
        if (key === 'workloads') {
          return <RancherWorkloadsPanel clusterId={cid} kind={workloadsSubKey} poolId={pid} />;
        }
        if (RESOURCE_TAB_KEYS.has(key)) {
          const sub = normalizeRancherResourceSub(key, sp.get('sub'));
          const listKind = resolveRancherK8sListKey(key, sub) as RancherK8sListKind | null;
          if (listKind) return <RancherK8sListPanel clusterId={cid} listKind={listKind} poolId={pid} />;
        }
        return <EmptyTabHint text="该分区暂无可用视图" />;
      })(),
      key,
      label: RANCHER_CLUSTER_TAB_LABEL[key],
    }));
  }, [clusterSubKey, workloadsSubKey, cid, pid, tabSnapshot]);

  return (
    <div className="rancher-cluster-workspace">
      <PageDetailContainer
        asCard={false}
        contentWrapperStyle={CLUSTER_WORKSPACE_CONTENT_STYLE}
        hideHeader
        rootStyle={CLUSTER_WORKSPACE_OUTER_STYLE}
      >
        <Tabs
          activeKey={activeTabKey}
          className="cloudmap-detail-outer-tabs"
          destroyOnHidden
          items={outerTabItems}
          onChange={(key) => {
            const k = key as RancherClusterTabKey;
            setActiveTabKey(k);
            const sp = new URLSearchParams();
            sp.set('tab', k);
            if (k === 'cluster') {
              sp.set('sub', clusterSubKey);
            } else if (k === 'workloads') {
              sp.set('sub', workloadsSubKey);
            } else if (RESOURCE_TAB_KEYS.has(k)) {
              sp.set('sub', normalizeRancherResourceSub(k, null));
            }
            navigate(`${location.pathname}?${sp.toString()}`, { replace: true });
          }}
          tabBarStyle={{ display: 'none', height: 0, margin: 0, minHeight: 0, padding: 0 }}
          type="line"
        />
      </PageDetailContainer>
    </div>
  );
};

export default RancherClusterWorkspace;
