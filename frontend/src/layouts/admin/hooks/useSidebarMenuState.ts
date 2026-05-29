/**
 * 侧栏导航状态中枢（L3）：collapsed / activeSidebarKey / openKeys 及其三类副作用。
 *
 * 这三块与「上下文池侧栏」是不可约耦合的：openKeys 自动展开 / 平台检测 / 进入新池重置
 * 都依赖一组由 URL + summaryClouds + 权限/特性派生出的侧栏中枢值。为避免「~12 入参」式
 * 的机械搬运，这里把这些派生值的计算（各资源池 / Rancher 集群侧栏、上下文侧栏选择、
 * 选中菜单 key 等）一并内聚进 hook，仅暴露布局渲染所需的最小出参。
 *
 * 行为与原 AdminLayout 内联实现一致。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { RouteSpec } from '../../../routes/RouteSpec';
import { hasPermissionForAction } from '../../../utils/accessMapping';
import {
  type Cloud,
  isCsmCloud,
  isMaasPoolCloud,
  isRancherPoolCloud,
} from '../../../pages/cnmc/pools/lib/poolProviders';
import type { AdminSidebarCenter } from '../AdminSidebar';
import { findMenuOpenKeyChainForPath, sidebarForPath } from '../lib/adminLayoutNav';
import {
  parseCloudPoolDetailId,
  buildCloudmapPoolSidebarCenter,
  CLOUD_POOL_SIDEBAR_CENTER_KEY,
  cloudmapPoolSidebarSelectedKey,
} from '../cloudmap/cloudPoolSidebar';
import {
  parseCsmPoolDetailId,
  buildCsmPoolSidebarCenter,
  CSM_POOL_SIDEBAR_CENTER_KEY,
  csmPoolSidebarSelectedKey,
} from '../csm/csmPoolSidebar';
import {
  parseXinferencePoolDetailId,
  buildXinferencePoolSidebarCenter,
  XINFERENCE_POOL_SIDEBAR_CENTER_KEY,
  xinferencePoolSidebarSelectedKey,
} from '../xinference/xinferencePoolSidebar';
import {
  parseMaasPoolDetailId,
  buildMaasPoolSidebarCenter,
  MAAS_POOL_SIDEBAR_CENTER_KEY,
  maasPoolSidebarSelectedKey,
} from '../maas/maasPoolSidebar';
import {
  parseRancherClusterWorkspacePath,
  buildRancherClusterSidebarCenter,
  RANCHER_CLUSTER_SIDEBAR_CENTER_KEY,
  normalizeRancherClusterNavParam,
  normalizeRancherClusterSubParam,
  normalizeRancherClusterWorkloadsSubParam,
  normalizeRancherResourceSub,
} from '../rancher/rancherClusterSidebar';
import { useRancherSidebarCounts } from './useRancherSidebarCounts';

type UseSidebarMenuStateArgs = {
  /** 平台级侧栏中枢（已按权限/特性过滤），非池上下文时直接展示 */
  visibleCenters: AdminSidebarCenter[];
  /** 顶栏资源池列表（L6），用于解析 URL 命中的池及其类型 */
  summaryClouds: Cloud[];
  /** 当前用户权限（池内路由可见性判断） */
  userPermissions: string[];
  /** License 特性判定 */
  hasFeature: (feature: string) => boolean;
};

export function useSidebarMenuState({
  visibleCenters,
  summaryClouds,
  userPermissions,
  hasFeature,
}: UseSidebarMenuStateArgs) {
  const location = useLocation();

  const [collapsed, setCollapsed] = useState(false);
  const [activeSidebarKey, setActiveSidebarKey] = useState('/admin/cen_compute');
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  /** 仅当选中页/池内菜单签名变化时自动展开分组；避免每次 effect 把用户已折叠的分组强行撑开 */
  const lastSidebarAutoExpandSigRef = useRef<string>('');

  const csmPoolId = useMemo(() => parseCsmPoolDetailId(location.pathname), [location.pathname]);
  const csmPoolCloud = useMemo(
    () => (csmPoolId ? summaryClouds.find((c) => String(c.id) === String(csmPoolId)) : undefined),
    [summaryClouds, csmPoolId],
  );

  const xinferencePoolId = useMemo(
    () => parseXinferencePoolDetailId(location.pathname),
    [location.pathname],
  );
  const xinferencePoolCloud = useMemo(
    () =>
      xinferencePoolId
        ? summaryClouds.find((c) => String(c.id) === String(xinferencePoolId))
        : undefined,
    [summaryClouds, xinferencePoolId],
  );

  const maasPoolId = useMemo(() => parseMaasPoolDetailId(location.pathname), [location.pathname]);
  const maasPoolCloud = useMemo(
    () =>
      maasPoolId ? summaryClouds.find((c) => String(c.id) === String(maasPoolId)) : undefined,
    [summaryClouds, maasPoolId],
  );

  const poolCloudId = useMemo(
    () => parseCloudPoolDetailId(location.pathname),
    [location.pathname],
  );
  const poolCloud = useMemo(
    () =>
      poolCloudId ? summaryClouds.find((c) => String(c.id) === String(poolCloudId)) : undefined,
    [summaryClouds, poolCloudId],
  );

  const rancherClusterCtx = useMemo(
    () => parseRancherClusterWorkspacePath(location.pathname),
    [location.pathname],
  );

  const rancherWorkloadCounts = useRancherSidebarCounts(rancherClusterCtx);

  const rancherClusterSidebarCenter = useMemo(() => {
    if (!rancherClusterCtx) return null;
    const cloud = summaryClouds.find((c) => String(c.id) === String(rancherClusterCtx.poolId));
    if (summaryClouds.length > 0 && cloud && !isRancherPoolCloud(cloud)) {
      return null;
    }
    return buildRancherClusterSidebarCenter(
      rancherClusterCtx.poolId,
      rancherClusterCtx.clusterId,
      cloud?.name,
      rancherWorkloadCounts,
    );
  }, [rancherClusterCtx, summaryClouds, rancherWorkloadCounts]);

  const cloudmapPoolSidebarOpts = useMemo(
    () => ({
      ovnVpcEnabled: hasFeature('network.ovn.vpc'),
      hasFeature,
      poolRouteAccess: (spec: RouteSpec) => {
        const anyOf = spec.poolPageReadAnyOf;
        if (anyOf?.length) {
          return anyOf.some((act) => hasPermissionForAction(userPermissions, act));
        }
        const page = spec.requiredActions?.page;
        if (!page) return true;
        return hasPermissionForAction(userPermissions, page);
      },
    }),
    [hasFeature, userPermissions],
  );

  const poolSidebarCenter = useMemo(
    () =>
      poolCloud && poolCloudId
        ? buildCloudmapPoolSidebarCenter(poolCloud, poolCloudId, cloudmapPoolSidebarOpts)
        : null,
    [poolCloud, poolCloudId, cloudmapPoolSidebarOpts],
  );

  const csmPoolSidebarCenter = useMemo(() => {
    if (!csmPoolId || !csmPoolCloud) return null;
    if (summaryClouds.length > 0 && !isCsmCloud(csmPoolCloud)) return null;
    return buildCsmPoolSidebarCenter(csmPoolCloud, csmPoolId);
  }, [csmPoolId, csmPoolCloud, summaryClouds.length]);

  const xinferencePoolSidebarCenter = useMemo(() => {
    if (!xinferencePoolId || !xinferencePoolCloud) return null;
    return buildXinferencePoolSidebarCenter(xinferencePoolCloud, xinferencePoolId);
  }, [xinferencePoolId, xinferencePoolCloud]);

  const maasPoolSidebarCenter = useMemo(() => {
    if (!maasPoolId || !maasPoolCloud) return null;
    if (summaryClouds.length > 0 && !isMaasPoolCloud(maasPoolCloud)) return null;
    return buildMaasPoolSidebarCenter(maasPoolCloud, maasPoolId);
  }, [maasPoolId, maasPoolCloud, summaryClouds.length]);

  /** CSM / Xinference / MAAS / Cloudmap 池详情、Rancher 集群工作台：侧栏替换为池内 / 集群内导航 */
  const contextualPoolSidebar =
    rancherClusterSidebarCenter ||
    csmPoolSidebarCenter ||
    xinferencePoolSidebarCenter ||
    maasPoolSidebarCenter ||
    poolSidebarCenter;

  const sidebarCentersForMenu = useMemo(
    () =>
      (contextualPoolSidebar
        ? [contextualPoolSidebar]
        : visibleCenters) as AdminSidebarCenter[],
    [contextualPoolSidebar, visibleCenters],
  );

  const poolSelectedMenuKey = useMemo(() => {
    if (rancherClusterSidebarCenter && rancherClusterCtx) {
      const sp = new URLSearchParams(location.search);
      const rawTab = sp.get('tab');
      const tab = normalizeRancherClusterNavParam(rawTab);
      const base = `/admin/clouds/${encodeURIComponent(rancherClusterCtx.poolId)}/clusters/${encodeURIComponent(rancherClusterCtx.clusterId)}`;
      if (tab === 'cluster') {
        const sub = normalizeRancherClusterSubParam(rawTab, sp.get('sub'), rawTab);
        return `${base}?tab=cluster&sub=${encodeURIComponent(sub)}`;
      }
      if (tab === 'workloads') {
        const sub = normalizeRancherClusterWorkloadsSubParam(sp.get('sub'));
        return `${base}?tab=workloads&sub=${encodeURIComponent(sub)}`;
      }
      if (
        tab === 'apps' ||
        tab === 'service_discovery' ||
        tab === 'storage' ||
        tab === 'policies' ||
        tab === 'more_resources'
      ) {
        const sub = normalizeRancherResourceSub(tab, sp.get('sub'));
        return `${base}?tab=${encodeURIComponent(tab)}&sub=${encodeURIComponent(sub)}`;
      }
      return `${base}?tab=${encodeURIComponent(tab)}`;
    }
    if (csmPoolSidebarCenter && csmPoolId) {
      return csmPoolSidebarSelectedKey(csmPoolId, location.pathname, location.search);
    }
    if (xinferencePoolSidebarCenter && xinferencePoolId) {
      return xinferencePoolSidebarSelectedKey(
        xinferencePoolId,
        location.pathname,
        location.search,
      );
    }
    if (maasPoolSidebarCenter && maasPoolId) {
      return maasPoolSidebarSelectedKey(maasPoolId, location.pathname, location.search);
    }
    if (!poolSidebarCenter || !poolCloudId) return undefined;
    return cloudmapPoolSidebarSelectedKey(location.pathname, poolSidebarCenter.items);
  }, [
    rancherClusterSidebarCenter,
    rancherClusterCtx,
    csmPoolSidebarCenter,
    csmPoolId,
    xinferencePoolSidebarCenter,
    xinferencePoolId,
    maasPoolSidebarCenter,
    maasPoolId,
    poolSidebarCenter,
    poolCloudId,
    location.pathname,
    location.search,
  ]);

  const platformDropdownSelectedKeys = contextualPoolSidebar ? [] : [activeSidebarKey];

  // 仅在「进入另一资源池 / 另一集群上下文」时重置侧栏展开态；勿依赖 poolSidebarCenter 引用（其随权限等重算会变，误清 openKeys 会导致无法折叠分组）
  useEffect(() => {
    setOpenKeys([]);
    lastSidebarAutoExpandSigRef.current = '';
  }, [
    poolCloudId,
    rancherClusterCtx?.poolId,
    rancherClusterCtx?.clusterId,
    csmPoolId,
    xinferencePoolId,
    maasPoolId,
  ]);

  useEffect(() => {
    if (rancherClusterSidebarCenter) {
      setActiveSidebarKey(RANCHER_CLUSTER_SIDEBAR_CENTER_KEY);
      return;
    }
    if (csmPoolSidebarCenter) {
      setActiveSidebarKey(CSM_POOL_SIDEBAR_CENTER_KEY);
      return;
    }
    if (xinferencePoolSidebarCenter) {
      setActiveSidebarKey(XINFERENCE_POOL_SIDEBAR_CENTER_KEY);
      return;
    }
    if (maasPoolSidebarCenter) {
      setActiveSidebarKey(MAAS_POOL_SIDEBAR_CENTER_KEY);
      return;
    }
    if (poolSidebarCenter) {
      setActiveSidebarKey(CLOUD_POOL_SIDEBAR_CENTER_KEY);
      return;
    }
    setActiveSidebarKey(sidebarForPath(location.pathname + location.search));
  }, [
    location.pathname,
    location.search,
    poolSidebarCenter,
    rancherClusterSidebarCenter,
    csmPoolSidebarCenter,
    xinferencePoolSidebarCenter,
    maasPoolSidebarCenter,
  ]);

  useEffect(() => {
    if (collapsed) {
      lastSidebarAutoExpandSigRef.current = '';
      return;
    }

    const expandPoolGroupByMenuKey = (sigPrefix: string, menuKey: string) => {
      const center =
        sidebarCentersForMenu.find((c) => c.key === activeSidebarKey) || sidebarCentersForMenu[0];
      if (!center) return;
      const activeGroup = (center.items || []).find((item: any) =>
        item?.children?.some((child: any) => String(child?.key || '') === menuKey),
      );
      if (activeGroup && activeGroup.key != null) {
        const sig = `${sigPrefix}|${menuKey}`;
        if (lastSidebarAutoExpandSigRef.current === sig) return;
        lastSidebarAutoExpandSigRef.current = sig;
        const gk = String(activeGroup.key);
        setOpenKeys((prev) => (prev.includes(gk) ? prev : [...prev, gk]));
      }
    };

    if (activeSidebarKey === RANCHER_CLUSTER_SIDEBAR_CENTER_KEY && poolSelectedMenuKey) {
      expandPoolGroupByMenuKey('rancher', poolSelectedMenuKey);
      return;
    }

    if (activeSidebarKey === CLOUD_POOL_SIDEBAR_CENTER_KEY && poolSelectedMenuKey) {
      expandPoolGroupByMenuKey('cloudmap-pool', poolSelectedMenuKey);
      return;
    }

    if (activeSidebarKey === CSM_POOL_SIDEBAR_CENTER_KEY && poolSelectedMenuKey) {
      expandPoolGroupByMenuKey('csm-pool', poolSelectedMenuKey);
      return;
    }

    const center =
      sidebarCentersForMenu.find((c) => c.key === activeSidebarKey) || sidebarCentersForMenu[0];
    if (!center) return;

    const currentPath = location.pathname.split('?')[0]; // 移除查询参数

    const chain = findMenuOpenKeyChainForPath(center.items, currentPath);
    if (chain && chain.length > 0) {
      const sig = `path|${activeSidebarKey}|${currentPath}|${chain.join('>')}`;
      if (lastSidebarAutoExpandSigRef.current === sig) return;
      lastSidebarAutoExpandSigRef.current = sig;
      setOpenKeys((prev) => {
        const firstKey = chain[0];
        const pfPrefix = String(firstKey).split('_')[0];
        const nextBase = prev.filter((k) => String(k).startsWith(pfPrefix + '_'));
        const merged = [...nextBase];
        for (const k of chain) {
          if (!merged.includes(k)) merged.push(k);
        }
        return merged;
      });
    }
  }, [collapsed, activeSidebarKey, location.pathname, sidebarCentersForMenu, poolSelectedMenuKey]);

  return {
    collapsed,
    setCollapsed,
    openKeys,
    setOpenKeys,
    activeSidebarKey,
    setActiveSidebarKey,
    sidebarCentersForMenu,
    poolSelectedMenuKey,
    platformDropdownSelectedKeys,
  };
}
