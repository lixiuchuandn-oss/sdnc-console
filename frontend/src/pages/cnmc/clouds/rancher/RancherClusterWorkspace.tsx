/**
 * Rancher 容器云（CNMC）：资源池根路径跳集群工作台 + 集群内分区（侧栏 + `?tab=&sub=`，与 Cloudmap 池同构）。
 */
import type { CSSProperties } from 'react';
import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Spin } from 'antd';
import { HomeOutlined, ReloadOutlined } from '@ant-design/icons';
import PageDetailContainer from '../../../../components/PageDetailContainer';
import { fetchRancherClustersForPool } from '../../../../services/api';
import {
  normalizeRancherClusterSubParam,
  normalizeRancherClusterNavParam,
  normalizeRancherClusterWorkloadsSubParam,
  normalizeRancherResourceSub,
  type RancherClusterNavKey,
  type RancherClusterSubKey,
  type RancherClusterWorkloadsSubKey,
} from '../../../../layouts/admin/rancher/rancherClusterSidebar';
import './pool/styles/rancher-workspace.css';
import RancherClusterRoutePanel from './pool/panels/RancherClusterRoutePanel';

const RANCHER_HOME_QUERY = 'tab=cluster&sub=projects' as const;

const RESOURCE_NAV_KEYS = new Set<RancherClusterNavKey>([
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

function buildNavSearchSnapshot(search: string) {
  const sp = new URLSearchParams(search);
  const rawTab = sp.get('tab');
  const navKey = normalizeRancherClusterNavParam(rawTab);
  const clusterSub = normalizeRancherClusterSubParam(rawTab, sp.get('sub'), rawTab);
  const workloadsSub = normalizeRancherClusterWorkloadsSubParam(sp.get('sub'));
  const resourceSub =
    navKey !== 'cluster' && navKey !== 'workloads'
      ? normalizeRancherResourceSub(navKey, sp.get('sub'))
      : '';
  return { clusterSub, navKey, resourceSub, sp, workloadsSub };
}

export type RancherPoolHomeRedirectProps = {
  boundClusterId?: string;
  cloudName: string;
  poolId: string;
  providerLabel: string;
};

export function RancherPoolHomeRedirect({
  poolId,
  cloudName,
  providerLabel,
  boundClusterId,
}: RancherPoolHomeRedirectProps): React.ReactElement {
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
        const json = await fetchRancherClustersForPool(poolId);
        const items = (json as { data?: { items?: { id?: string }[] } })?.data?.items;
        const first = Array.isArray(items) && items[0]?.id ? String(items[0].id) : null;
        if (cancelled) return;
        if (!first) {
          setPhase('empty');
          return;
        }
        setTarget(clusterWorkbenchPath(poolId, first));
      } catch (e: unknown) {
        if (cancelled) return;
        setPhase('error');
        setErrorMsg(parseUnknownErrorMessage(e, '加载集群列表失败'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [boundClusterId, poolId]);

  if (target) return <Navigate to={target} replace />;

  if (phase === 'loading') {
    return (
      <PageDetailContainer
        breadcrumbs={poolGateBreadcrumbs(cloudName || providerLabel)}
        title={cloudName || providerLabel}
      >
        <div style={POOL_GATE_LOADING_STYLE}>
          <Spin tip="正在解析 Rancher 集群…" />
        </div>
      </PageDetailContainer>
    );
  }

  if (phase === 'error') {
    return (
      <PageDetailContainer
        breadcrumbs={poolGateBreadcrumbs(cloudName || providerLabel)}
        title={cloudName || providerLabel}
      >
        <Alert
          type="error"
          message="无法进入集群工作台"
          description={errorMsg || '未知错误'}
          action={
            <Button icon={<ReloadOutlined />} onClick={() => window.location.reload()}>
              重试
            </Button>
          }
        />
      </PageDetailContainer>
    );
  }

  return (
    <PageDetailContainer
      breadcrumbs={poolGateBreadcrumbs(cloudName || providerLabel)}
      title={cloudName || providerLabel}
    >
      <Alert
        message="未找到可用集群"
        description="请确认资源池已绑定 Rancher 且存在至少一个集群。"
        type="info"
      />
    </PageDetailContainer>
  );
}

const RancherClusterWorkspace = (): React.ReactElement => {
  const navigate = useNavigate();
  const location = useLocation();
  const { poolId, clusterId } = useParams<{ poolId: string; clusterId: string }>();
  const pid = poolId ? decodeURIComponent(poolId) : '';
  const cid = clusterId ? decodeURIComponent(clusterId) : '';

  const navSnapshot = useMemo(() => buildNavSearchSnapshot(location.search), [location.search]);

  const [activeNavKey, setActiveNavKey] = useState<RancherClusterNavKey>(() =>
    normalizeRancherClusterNavParam(
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
    const nav = normalizeRancherClusterNavParam(rawTab);
    if (nav !== 'workloads') return 'cronjob';
    return normalizeRancherClusterWorkloadsSubParam(sp.get('sub'));
  });

  const [resourceSubKey, setResourceSubKey] = useState<string>(() => {
    if (typeof window === 'undefined') return 'catalog';
    const sp = new URLSearchParams(window.location.search);
    const rawTab = sp.get('tab');
    const nav = normalizeRancherClusterNavParam(rawTab);
    if (nav === 'cluster' || nav === 'workloads') return 'catalog';
    return normalizeRancherResourceSub(nav, sp.get('sub'));
  });

  useEffect(() => {
    const { clusterSub, navKey, resourceSub, sp, workloadsSub } = navSnapshot;

    setActiveNavKey((prev) => (prev === navKey ? prev : navKey));
    if (navKey === 'cluster') setClusterSubKey((prev) => (prev === clusterSub ? prev : clusterSub));
    if (navKey === 'workloads') {
      setWorkloadsSubKey((prev) => (prev === workloadsSub ? prev : workloadsSub));
    }
    if (RESOURCE_NAV_KEYS.has(navKey)) {
      setResourceSubKey((prev) => (prev === resourceSub ? prev : resourceSub));
    }

    const next = new URLSearchParams(location.search);
    next.set('tab', navKey);
    if (navKey === 'cluster') {
      next.set('sub', clusterSub);
    } else if (navKey === 'workloads') {
      next.set('sub', workloadsSub);
    } else if (RESOURCE_NAV_KEYS.has(navKey)) {
      next.set('sub', normalizeRancherResourceSub(navKey, sp.get('sub')));
    } else {
      next.delete('sub');
    }

    const searchStr = next.toString();
    const canon = searchStr ? `${location.pathname}?${searchStr}` : location.pathname;
    const curFull = `${location.pathname}${location.search}`;
    if (canon !== curFull) navigate(canon, { replace: true });
  }, [location.pathname, location.search, navigate, navSnapshot]);

  return (
    <div className="rancher-cluster-workspace">
      <PageDetailContainer
        asCard={false}
        contentWrapperStyle={CLUSTER_WORKSPACE_CONTENT_STYLE}
        hideHeader
        rootStyle={CLUSTER_WORKSPACE_OUTER_STYLE}
      >
        <div className="rancher-cluster-detail-main">
          <RancherClusterRoutePanel
            poolId={pid}
            clusterId={cid}
            navKey={activeNavKey}
            clusterSub={clusterSubKey}
            workloadsSub={workloadsSubKey}
            resourceSub={resourceSubKey}
          />
        </div>
      </PageDetailContainer>
    </div>
  );
};

export default RancherClusterWorkspace;
