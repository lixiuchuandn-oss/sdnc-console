/**
 * 侧栏导航状态中枢（L3）：collapsed / activeSidebarKey / openKeys 及其三类副作用。
 *
 * 这三块与「上下文池侧栏」是不可约耦合的：openKeys 自动展开 / 平台检测 / 进入新池重置
 * 都依赖一组由 URL + summaryClouds + 权限/特性派生出的侧栏中枢值。为避免「~12 入参」式
 * 的机械搬运，这里把这些派生值的计算（各资源池 / Rancher 集群侧栏、上下文侧栏选择、
 * 选中菜单 key 等）一并内聚进 hook，仅暴露布局渲染所需的最小出参。
 *
 * 分发方式：遍历 `poolSidebarRegistry` 查表得到当前池的上下文侧栏（替代历史的
 * `if (xxxPoolSidebarCenter)…` 硬编码分支），自动覆盖含华为 / 阿里云在内的全部池。
 * 行为与原 AdminLayout / 历史 hook 内联实现一致。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { RouteSpec } from '../../../routes/RouteSpec';
import { hasPermissionForAction } from '../../../utils/accessMapping';
import { type Cloud } from '../../../pages/cnmc/pools/lib/poolProviders';
import type { AdminSidebarCenter } from '../AdminSidebar';
import { findMenuOpenKeyChainForPath, sidebarForPath } from '../lib/adminLayoutNav';
import {
  poolSidebarRegistry,
  resolvePoolSidebarForPath,
} from '../poolSidebar/registry';
import type { PoolSidebarCenterOpts } from '../poolSidebar/types';
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

  /** 查表：当前 pathname 命中的池 spec 与池上下文（rancher 额外含 clusterId）。 */
  const resolvedPool = useMemo(
    () => resolvePoolSidebarForPath(poolSidebarRegistry, location.pathname),
    [location.pathname],
  );

  /** 命中池在顶栏池列表中的云实例（用于类型校验、侧栏标题等）。 */
  const poolCloud = useMemo(
    () =>
      resolvedPool
        ? summaryClouds.find((c) => String(c.id) === String(resolvedPool.context.poolId))
        : undefined,
    [resolvedPool, summaryClouds],
  );

  /** Rancher 集群工作台上下文：用于拉取工作负载计数（其余池为 null，不触发请求）。 */
  const rancherClusterCtx = useMemo(
    () =>
      resolvedPool?.spec.type === 'rancher' && resolvedPool.context.clusterId
        ? { poolId: resolvedPool.context.poolId, clusterId: resolvedPool.context.clusterId }
        : null,
    [resolvedPool],
  );

  const rancherWorkloadCounts = useRancherSidebarCounts(rancherClusterCtx);

  /** Cloudmap 等按 RBAC / 特性过滤侧栏叶子所需的选项（其余池忽略 buildOpts）。 */
  const poolSidebarBuildOpts = useMemo<PoolSidebarCenterOpts>(
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

  /** 当前池的上下文侧栏 center（不满足 cloud 必需性 / 类型校验时为 null）。 */
  const contextualPoolSidebar = useMemo(
    () =>
      resolvedPool
        ? resolvedPool.spec.buildSidebarCenter({
            context: resolvedPool.context,
            cloud: poolCloud,
            summaryCloudCount: summaryClouds.length,
            buildOpts: poolSidebarBuildOpts,
            extra: { rancherWorkloadCounts },
          })
        : null,
    [resolvedPool, poolCloud, summaryClouds.length, poolSidebarBuildOpts, rancherWorkloadCounts],
  );

  const sidebarCentersForMenu = useMemo(
    () =>
      (contextualPoolSidebar
        ? [contextualPoolSidebar]
        : visibleCenters) as AdminSidebarCenter[],
    [contextualPoolSidebar, visibleCenters],
  );

  const poolSelectedMenuKey = useMemo(() => {
    if (!resolvedPool || !contextualPoolSidebar) return undefined;
    return resolvedPool.spec.selectedKey({
      context: resolvedPool.context,
      pathname: location.pathname,
      search: location.search,
      center: contextualPoolSidebar,
    });
  }, [resolvedPool, contextualPoolSidebar, location.pathname, location.search]);

  const platformDropdownSelectedKeys = contextualPoolSidebar ? [] : [activeSidebarKey];

  /** 进入「另一资源池 / 另一集群上下文」时重置侧栏展开态（同池内 tab/sub 切换不重置）。 */
  const poolContextSig = resolvedPool
    ? `${resolvedPool.spec.type}:${resolvedPool.context.poolId}:${resolvedPool.context.clusterId ?? ''}`
    : '';

  useEffect(() => {
    setOpenKeys([]);
    lastSidebarAutoExpandSigRef.current = '';
  }, [poolContextSig]);

  useEffect(() => {
    if (contextualPoolSidebar && resolvedPool) {
      setActiveSidebarKey(resolvedPool.spec.centerKey);
      return;
    }
    setActiveSidebarKey(sidebarForPath(location.pathname + location.search));
  }, [location.pathname, location.search, contextualPoolSidebar, resolvedPool]);

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

    // 含分组 / 子菜单的池（Cloudmap / Rancher / CSM）：按选中 menuKey 反查父分组展开
    if (
      resolvedPool?.spec.autoExpandByMenuKey &&
      poolSelectedMenuKey &&
      activeSidebarKey === resolvedPool.spec.centerKey
    ) {
      expandPoolGroupByMenuKey(
        resolvedPool.spec.autoExpandSigPrefix || resolvedPool.spec.type,
        poolSelectedMenuKey,
      );
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
  }, [collapsed, activeSidebarKey, location.pathname, sidebarCentersForMenu, poolSelectedMenuKey, resolvedPool]);

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
