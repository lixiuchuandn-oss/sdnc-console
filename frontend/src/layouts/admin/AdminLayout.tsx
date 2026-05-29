/**
 * 管理后台主布局：顶栏、侧栏（多平台菜单）、内容区 Outlet、全局搜索等。
 * 样式：`admin-shell.css`（侧栏 + 顶栏图标按钮覆盖）。
 * 检索关键词: AdminLayout layout admin sidebar visibleCenters canAccessPath Ctrl+K
 */

import React, { useCallback, useEffect, useMemo, useRef, useState, Suspense } from 'react';
import {
  App,
  Button,
  Form,
  Input,
  Layout,
  Modal,
  Space,
  Spin,
  Typography,
} from 'antd';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import type { AdminLayoutOutletContext } from './adminLayoutOutletContext';
import {
  CodeOutlined,
  SettingOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { useAuth } from '../../contexts/AuthContext';
import { useLicense } from '../../contexts/LicenseContext';
import { useSettings } from '../../contexts/SettingsContext';
import { getRequiredActionForPath, hasPermissionForAction } from '../../utils/accessMapping';
import type { RouteSpec } from '../../routes/RouteSpec';
import { PLATFORMS, PLATFORM_LABELS, GROUPS } from '../../constants/navigation';
import { routeSpecs } from '../../routes/RouteSpec';
import { isSdnccPagePath } from '../../routes/adminRouteMatch';
import { iconOf } from '../../components/PageContainer';
import { apiRequest } from '../../services/api';
import {
  DEFAULT_ADMIN_PASSWORD_POLICY,
  validateAdminPasswordClient,
} from '../../utils/adminPasswordPolicy';
import {
  CLOUD_RESOURCE_POOLS_CREATE_WRITE,
  CLOUD_RESOURCE_POOLS_READ,
  CLOUD_RESOURCE_POOLS_WRITE,
} from '../../constants/cloudPermissions';
import { type Cloud, isCsmCloud, isMaasPoolCloud, isRancherPoolCloud } from '../../pages/cnmc/pools/lib/poolProviders';
import PoolEdgeWizard from '../../pages/cnmc/pools/modals/CloudWizardeasy';
import AdminSidebar, { type AdminSidebarCenter } from './AdminSidebar';
import {
  parseCloudPoolDetailId,
  buildCloudmapPoolSidebarCenter,
  CLOUD_POOL_SIDEBAR_CENTER_KEY,
  cloudmapPoolSidebarSelectedKey,
} from './cloudmap/cloudPoolSidebar';
import {
  parseCsmPoolDetailId,
  buildCsmPoolSidebarCenter,
  CSM_POOL_SIDEBAR_CENTER_KEY,
  csmPoolSidebarSelectedKey,
} from './csm/csmPoolSidebar';
import {
  parseXinferencePoolDetailId,
  buildXinferencePoolSidebarCenter,
  XINFERENCE_POOL_SIDEBAR_CENTER_KEY,
  xinferencePoolSidebarSelectedKey,
} from './xinference/xinferencePoolSidebar';
import {
  parseMaasPoolDetailId,
  buildMaasPoolSidebarCenter,
  MAAS_POOL_SIDEBAR_CENTER_KEY,
  maasPoolSidebarSelectedKey,
} from './maas/maasPoolSidebar';
import {
  parseRancherClusterWorkspacePath,
  buildRancherClusterSidebarCenter,
  RANCHER_CLUSTER_SIDEBAR_CENTER_KEY,
  normalizeRancherClusterNavParam,
  normalizeRancherClusterSubParam,
  normalizeRancherClusterWorkloadsSubParam,
  normalizeRancherResourceSub,
  type RancherClusterWorkloadsSubKey,
} from './rancher/rancherClusterSidebar';
import './admin-shell.css';
import AdminStandardHeader from './AdminStandardHeader';
import {
  ADMIN_HEADER_HEIGHT_PX,
  buildGroupMenuChildren,
  findMenuOpenKeyChainForPath,
  pickDefaultPoolId,
  resolveDefaultPool,
  sidebarForPath,
  type PageSearchEntry,
} from './lib/adminLayoutNav';
import { useGlobalSearch } from './hooks/useGlobalSearch';
import { useAdminPasswordGate } from './hooks/useAdminPasswordGate';

const { Content } = Layout;

/** 内容区懒加载分包占位：与 Content 同高，避免矮占位 → 池页全高一瞬间跳变 */
function AdminOutletSuspenseFallback() {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: `calc(100vh - ${ADMIN_HEADER_HEIGHT_PX}px)`,
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      <Spin size="large" aria-label="加载中" />
    </div>
  );
}

/** 顶栏底边、侧栏右边线等与导航分割相关的颜色 */
const NAV_DIVIDER_COLOR = 'rgb(200, 207, 218)';

/** 无资源池时强弹向导：本会话用户点「稍后接入」后不再自动弹出 */
const MUST_BIND_POOL_DISMISS_KEY = 'adminLayout.mustBindPoolPromptDismissed';


const AdminLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const userPermissions = useMemo(
    () => (user?.permissions && Array.isArray(user.permissions) ? user.permissions : []),
    [user?.permissions],
  );
  const { hasFeature } = useLicense();
  const { settings, loading: settingsLoading } = useSettings();
  const { message } = App.useApp();

  const [collapsed, setCollapsed] = useState(false);
  const [activeSidebarKey, setActiveSidebarKey] = useState('/admin/cen_compute');
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  /** 仅当选中页/池内菜单签名变化时自动展开分组；避免每次 effect 把用户已折叠的分组强行撑开 */
  const lastSidebarAutoExpandSigRef = useRef<string>('');
  /** 池详情 URL 已有 cloudId 但顶栏列表尚未含该池时，触发一次列表刷新（避免侧栏空白直至手动刷新） */
  const poolNavMissingListRefetchKeyRef = useRef('');
  const {
    changePasswordForm,
    changePasswordOpen,
    setChangePasswordOpen,
    changePasswordSaving,
    adminPwdPolicy,
    forcePasswordChange,
    openChangePassword,
    submitChangePassword,
  } = useAdminPasswordGate();

  const [summaryClouds, setSummaryClouds] = useState<Cloud[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  /** 顶栏云列表是否已完成至少一次拉取；避免在 GET /clouds 返回前把「无池」判成真并自动弹接入向导 */
  const [summaryListHydrated, setSummaryListHydrated] = useState(false);
  /** 顶栏可用区（资源池）选择；列表变更时若当前项失效则回到默认池 */
  const [headerSelectedPoolId, setHeaderSelectedPoolId] = useState<string | undefined>(undefined);
  const [poolWizardOpen, setPoolWizardOpen] = useState(false);
  const [poolWizardEditing, setPoolWizardEditing] = useState<Cloud | null>(null);
  const [poolWizardForceRequired, setPoolWizardForceRequired] = useState(false);
  const poolWizardOpenedByAutoRef = useRef(false);
  /** 顶栏云列表请求世代：新请求开始 +1；仅当完成时 gen 仍等于 ref 才写回 state，避免慢请求覆盖快请求、或登出后旧请求写回 */
  const summaryLoadGenRef = useRef(0);


  /** super_admin 全放行；其余按路径 required action 与 permissions 校验 */
  const canAccessPath = useCallback((p: string): boolean => {
    const pure = String(p || '').split('?')[0];
    if (!user) return false;
    const role = String(user.role || '').toLowerCase();
    // 只有 super_admin 才跳过权限检查，admin 也需要检查权限（与后端保持一致）
    if (role === 'super_admin') return true;
    const act = getRequiredActionForPath(pure);
    const perms = Array.isArray(user.permissions) ? user.permissions : [];
    return hasPermissionForAction(perms, act);
  }, [user]);

  const canReadPools = useMemo(() => {
    if (!user) return false;
    if (String(user.role || '').toLowerCase() === 'super_admin') return true;
    const perms = Array.isArray(user.permissions) ? user.permissions : [];
    return (
      hasPermissionForAction(perms, CLOUD_RESOURCE_POOLS_READ) ||
      hasPermissionForAction(perms, 'clouds:read') ||
      hasPermissionForAction(perms, 'clouds:write')
    );
  }, [user]);

  /** 含「多云管理」授权（资源池列表、侧栏完整池能力等）；默认授权不含此项 */
  const hasPoolManagementLicense = hasFeature('platform.multi-cloud');

  /**
   * 顶栏进入池内总览：有多云管理授权时沿用原 pools 读权限；否则仅要求控制台读权限（与未授权场景一致）。
   */
  const headerPoolOverviewEnabled = useMemo(() => {
    if (!user) return false;
    if (String(user.role || '').toLowerCase() === 'super_admin') return true;
    const perms = Array.isArray(user.permissions) ? user.permissions : [];
    if (hasPoolManagementLicense) {
      return canReadPools;
    }
    return (
      hasPermissionForAction(perms, 'clouds.console:read') ||
      hasPermissionForAction(perms, 'clouds.console:write')
    );
  }, [user, hasPoolManagementLicense, canReadPools]);

  const canWritePools = useMemo(() => {
    if (!user) return false;
    if (String(user.role || '').toLowerCase() === 'super_admin') return true;
    const perms = Array.isArray(user.permissions) ? user.permissions : [];
    return (
      hasPermissionForAction(perms, CLOUD_RESOURCE_POOLS_CREATE_WRITE) ||
      hasPermissionForAction(perms, CLOUD_RESOURCE_POOLS_WRITE) ||
      hasPermissionForAction(perms, 'clouds:write')
    );
  }, [user]);

  const loadSummaryClouds = useCallback(async () => {
    const gen = ++summaryLoadGenRef.current;
    setSummaryLoading(true);
    try {
      const raw = await apiRequest('/api/clouds', { skipCache: true });
      if (gen !== summaryLoadGenRef.current) return;
      const list = Array.isArray(raw) ? raw : (raw?.data || []);
      setSummaryClouds((Array.isArray(list) ? list : []) as Cloud[]);
    } catch {
      if (gen !== summaryLoadGenRef.current) return;
      setSummaryClouds([]);
    } finally {
      if (gen !== summaryLoadGenRef.current) return;
      setSummaryLoading(false);
      setSummaryListHydrated(true);
    }
  }, []);

  /**
   * 侧栏 / 搜索等入口的统一跳转：`/console`（租户资源控制台）始终新标签打开，其余路径当前页路由。
   */
  const navigateToAdminContent = useCallback(
    (path: string) => {
      const pure = String(path || '').split('?')[0];
      if (pure === '/console') {
        const w = window.open(`${window.location.origin}${path}`, '_blank');
        if (w == null) {
          message.warning('无法打开新窗口，请检查浏览器是否拦截了弹出窗口');
        }
        return;
      }
      navigate(path);
    },
    [navigate, message],
  );

  const handleLogout = () => {
    logout();
    navigate('/admin/login');
  };

  const groupIconOf = useCallback((pf: string, grp: string) => {
    const visible = routeSpecs
      .filter(s => s.layout === 'admin' && s.platform === pf && s.group === grp && !s.hidden)
      .sort((a:any, b:any) => Number(a.order ?? 9999) - Number(b.order ?? 9999));

    const all = routeSpecs
      .filter(s => s.layout === 'admin' && s.platform === pf && s.group === grp)
      .sort((a:any, b:any) => Number(a.order ?? 9999) - Number(b.order ?? 9999));

    const list = visible.length > 0 ? visible : all;
    const firstWithIcon = list.find((s) => !!s.icon) || list[0];
    return iconOf(firstWithIcon?.icon);
  }, []);

  const adminSpecs = useMemo(() => routeSpecs.filter((s) => s.layout === 'admin' && !s.hidden), []);
  
  const centers = useMemo(() => PLATFORMS.filter(p => p !== '全部').map((pf: any) => {
    const key =
      pf === 'CNMC'
        ? '/admin/cen_compute'
        : pf === 'TENANTS'
          ? '/admin/cen_tenants'
          : pf === 'SDNCC'
            ? '/admin/cen_sdn'
            : pf === 'CNSOC'
              ? '/admin/cen_secops'
              : '/admin/cen_settings';
    const platformSpecs = adminSpecs.filter(s => s.platform === pf);
    const topLevelSpecs = platformSpecs.filter(s => !s.group);
    const groupedSpecs = platformSpecs.filter(s => !!s.group);
    const topLevelItems = topLevelSpecs
      .sort((a:any, b:any) => Number(a.order ?? 0) - Number(b.order ?? 0))
      .map((s) => ({ key: s.path, label: s.title || s.breadcrumbLabel || s.id, icon: iconOf(s.icon), requiredFeature: s.requiredFeature }));
    const groupItems = Array.from(new Set(groupedSpecs.map(s => String(s.group || ''))))
      .sort((a, b) => {
        const idxA = GROUPS.indexOf(a as any);
        const idxB = GROUPS.indexOf(b as any);
        const safeA = idxA === -1 ? 999 : idxA;
        const safeB = idxB === -1 ? 999 : idxB;
        return safeA - safeB;
      })
      .map((grp) => ({
        key: `${pf}_${grp}`,
        label: grp,
        icon: groupIconOf(pf, grp as string),
        children: buildGroupMenuChildren(groupedSpecs.filter((s) => s.group === grp)),
      }));
    return ({
      key,
      label: PLATFORM_LABELS[pf as keyof typeof PLATFORM_LABELS] || pf,
      icon:
        pf === 'SETTINGS' ? <SettingOutlined /> : pf === 'TENANTS' ? <TeamOutlined /> : <CodeOutlined />,
      // SETTINGS 平台也按 group 构建，确保系统管理侧边栏满足“分组块”展示需求
      items: [...topLevelItems, ...groupItems],
    });
  }), [adminSpecs, groupIconOf]);

  /** 去掉 requiredFeature，避免传入 DOM */
  const cleanMenuItem = useCallback((item: any): any => {
    const { requiredFeature: _requiredFeature, ...rest } = item;
    if (rest.children) {
      return {
        ...rest,
        children: rest.children.map(cleanMenuItem),
      };
    }
    return rest;
  }, []);

  const visibleCenters = useMemo(() => (centers || [])
    .filter((c: any) => {
      if (c.key === '/admin/cen_sdn' && !hasFeature('platform.sdn')) return false;
      if (c.key === '/admin/cen_secops' && !hasFeature('platform.aisoc')) return false;
      return true;
    })
    .map((c:any) => {
      return {
        ...c,
        items: (c.items || [])
          .map((p:any) => {
            if (!p.children) return p;
            return {
              ...p,
              children: (p.children || [])
                .filter((it:any) => 
                  canAccessPath(String(it.key || '')) &&
                  (!it.requiredFeature || hasFeature(it.requiredFeature))
                )
                .map(cleanMenuItem),
            };
          })
          .filter((p:any) => {
            if (p.children) return (p.children || []).length > 0;
            return (
              canAccessPath(String(p.key || '')) &&
              (!p.requiredFeature || hasFeature(p.requiredFeature))
            );
          })
          .map(cleanMenuItem),
      };
    })
    .filter((c:any) => (c.items || []).length > 0), [centers, hasFeature, canAccessPath, cleanMenuItem]);

  /** SDN 控制台内容区：用于表格等组件统一去线框（与 PageContainer 内嵌表默认一致）。 */
  const adminOutletSdnccClassName = useMemo(
    () => (isSdnccPagePath(location.pathname) ? 'admin-outlet-sdncc' : undefined),
    [location.pathname],
  );

  const csmPoolId = useMemo(
    () => parseCsmPoolDetailId(location.pathname),
    [location.pathname],
  );
  const csmPoolCloud = useMemo(
    () =>
      csmPoolId
        ? summaryClouds.find((c) => String(c.id) === String(csmPoolId))
        : undefined,
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

  const maasPoolId = useMemo(
    () => parseMaasPoolDetailId(location.pathname),
    [location.pathname],
  );
  const maasPoolCloud = useMemo(
    () =>
      maasPoolId
        ? summaryClouds.find((c) => String(c.id) === String(maasPoolId))
        : undefined,
    [summaryClouds, maasPoolId],
  );

  const poolCloudId = useMemo(
    () => parseCloudPoolDetailId(location.pathname),
    [location.pathname],
  );
  const poolCloud = useMemo(
    () =>
      poolCloudId
        ? summaryClouds.find((c) => String(c.id) === String(poolCloudId))
        : undefined,
    [summaryClouds, poolCloudId],
  );

  // 从 URL 同步顶栏「可用区」：避免仅改路径时 header 仍显示上一池（与页面 cloudId 不一致）
  useEffect(() => {
    if (!poolCloudId) return;
    const cnmcPools = summaryClouds.filter((c) => !isCsmCloud(c));
    if (!cnmcPools.some((c) => String(c.id) === String(poolCloudId))) return;
    setHeaderSelectedPoolId((prev) => (String(prev) === String(poolCloudId) ? prev : poolCloudId));
  }, [poolCloudId, summaryClouds]);

  useEffect(() => {
    if (!xinferencePoolId) return;
    const cnmcPools = summaryClouds.filter((c) => !isCsmCloud(c));
    if (!cnmcPools.some((c) => String(c.id) === String(xinferencePoolId))) return;
    setHeaderSelectedPoolId((prev) =>
      String(prev) === String(xinferencePoolId) ? prev : xinferencePoolId,
    );
  }, [xinferencePoolId, summaryClouds]);

  useEffect(() => {
    if (!maasPoolId) return;
    const cnmcPools = summaryClouds.filter((c) => !isCsmCloud(c));
    if (!cnmcPools.some((c) => String(c.id) === String(maasPoolId))) return;
    setHeaderSelectedPoolId((prev) =>
      String(prev) === String(maasPoolId) ? prev : maasPoolId,
    );
  }, [maasPoolId, summaryClouds]);

  const rancherClusterCtx = useMemo(
    () => parseRancherClusterWorkspacePath(location.pathname),
    [location.pathname],
  );

  const [rancherWorkloadCounts, setRancherWorkloadCounts] = useState<
    Partial<Record<RancherClusterWorkloadsSubKey, number>>
  >({});

  useEffect(() => {
    if (!rancherClusterCtx) {
      setRancherWorkloadCounts({});
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const j = await apiRequest(
          `/api/clouds/${encodeURIComponent(rancherClusterCtx.poolId)}/rancher/clusters/${encodeURIComponent(rancherClusterCtx.clusterId)}/workloads/counts`,
          { skipCache: true },
        );
        const c = j?.data?.counts;
        if (cancelled || !c || typeof c !== 'object') return;
        setRancherWorkloadCounts(c as Partial<Record<RancherClusterWorkloadsSubKey, number>>);
      } catch {
        if (!cancelled) setRancherWorkloadCounts({});
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [rancherClusterCtx]);

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

  useEffect(() => {
    if (!rancherClusterCtx) return;
    const cnmcPools = summaryClouds.filter((c) => !isCsmCloud(c));
    if (!cnmcPools.some((c) => String(c.id) === String(rancherClusterCtx.poolId))) return;
    setHeaderSelectedPoolId((prev) =>
      String(prev) === String(rancherClusterCtx.poolId) ? prev : rancherClusterCtx.poolId,
    );
  }, [rancherClusterCtx, summaryClouds]);

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
    () => (contextualPoolSidebar ? [contextualPoolSidebar] : visibleCenters),
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
  }, [poolCloudId, rancherClusterCtx?.poolId, rancherClusterCtx?.clusterId, csmPoolId, xinferencePoolId, maasPoolId]);

  useEffect(() => {
    if (!user || summaryLoading) return;
    const poolId = parseCloudPoolDetailId(location.pathname);
    if (!poolId) {
      poolNavMissingListRefetchKeyRef.current = '';
      return;
    }
    if (summaryClouds.some((c) => String(c.id) === String(poolId))) {
      poolNavMissingListRefetchKeyRef.current = '';
      return;
    }
    const key = location.pathname;
    if (poolNavMissingListRefetchKeyRef.current === key) return;
    poolNavMissingListRefetchKeyRef.current = key;
    void loadSummaryClouds();
  }, [user, location.pathname, summaryLoading, summaryClouds, loadSummaryClouds]);

  const autoBindPoolPromptShownRef = useRef(false);

  useEffect(() => {
    if (!user) {
      summaryLoadGenRef.current += 1;
      setSummaryLoading(false);
      setSummaryClouds([]);
      setSummaryListHydrated(false);
      return;
    }
    setSummaryListHydrated(false);
    void loadSummaryClouds();
  }, [user, loadSummaryClouds]);

  useEffect(() => {
    if (!summaryClouds.length) {
      setHeaderSelectedPoolId(undefined);
      return;
    }
    setHeaderSelectedPoolId((prev) => {
      const cnmcPools = summaryClouds.filter((c) => !isCsmCloud(c));
      if (prev && cnmcPools.some((c) => String(c.id) === String(prev))) return prev;
      return pickDefaultPoolId(cnmcPools);
    });
  }, [summaryClouds]);

  useEffect(() => {
    if (!user) return;
    if (!summaryListHydrated) return;
    if (summaryClouds.filter((c) => !isCsmCloud(c)).length > 0) {
      autoBindPoolPromptShownRef.current = false;
      if (poolWizardOpenedByAutoRef.current) {
        setPoolWizardOpen(false);
        setPoolWizardForceRequired(false);
        poolWizardOpenedByAutoRef.current = false;
      }
      return;
    }
    // 注释掉自动弹出接入边缘云弹窗的逻辑
    // if (summaryLoading) return;
    // if (!canWritePools) return;
    // try {
    //   if (window.sessionStorage.getItem(MUST_BIND_POOL_DISMISS_KEY) === '1') return;
    // } catch {
    //   /* ignore */
    // }
    // if (autoBindPoolPromptShownRef.current) return;
    // autoBindPoolPromptShownRef.current = true;
    // poolWizardOpenedByAutoRef.current = true;
    // setPoolWizardForceRequired(true);
    // setPoolWizardEditing(null);
    // setPoolWizardOpen(true);
  }, [user, summaryLoading, summaryClouds, canWritePools, summaryListHydrated]);

  const handlePoolWizardCancel = useCallback(() => {
    setPoolWizardOpen(false);
    setPoolWizardEditing(null);
    setPoolWizardForceRequired(false);
    if (poolWizardOpenedByAutoRef.current) {
      try {
        window.sessionStorage.setItem(MUST_BIND_POOL_DISMISS_KEY, '1');
      } catch {
        /* ignore */
      }
      poolWizardOpenedByAutoRef.current = false;
    }
  }, []);

  const handlePoolWizardSuccess = useCallback(() => {
    setPoolWizardOpen(false);
    setPoolWizardEditing(null);
    setPoolWizardForceRequired(false);
    poolWizardOpenedByAutoRef.current = false;
    void loadSummaryClouds();
  }, [loadSummaryClouds]);

  /** 设定默认资源池：无池=添加；有池=编辑当前默认池（显式 default 或最早创建） */
  const openDefaultPoolWizardAction = useCallback(() => {
    poolWizardOpenedByAutoRef.current = false;
    setPoolWizardForceRequired(false);
    if (!summaryClouds.length) {
      setPoolWizardEditing(null);
    } else {
      const def = resolveDefaultPool(summaryClouds.filter((c) => !isCsmCloud(c)));
      setPoolWizardEditing(def ?? null);
    }
    setPoolWizardOpen(true);
  }, [summaryClouds]);

  const pageSearchEntries = useMemo(() => {
    const opts: PageSearchEntry[] = [];
    (visibleCenters || []).forEach((c: any) => {
      const push = (path: string, label: string, icon: React.ReactNode, group: string, title: string) => {
        if (path && path.startsWith('/')) opts.push({ path, title, icon, label, group });
      };
      if (c.key === '/admin/cen_settings') {
        (c.items || []).forEach((it: any) => {
          push(
            String(it.key || ''),
            String(it.label || ''),
            it.icon,
            String(c.label || ''),
            `${String(it.label || '')} ${String(c.label || '')}`,
          );
        });
      } else {
        (c.items || []).forEach((p: any) => {
          if (!p.children) {
            push(
              String(p.key || ''),
              String(p.label || ''),
              p.icon,
              String(c.label || ''),
              `${String(p.label || '')} ${String(c.label || '')}`,
            );
            return;
          }
          (p.children || []).forEach((it: any) => {
            push(
              String(it.key || ''),
              String(it.label || ''),
              it.icon,
              String(p.label || ''),
              `${String(it.label || '')} ${String(p.label || '')} ${String(c.label || '')}`,
            );
          });
        });
      }
    });
    return opts;
  }, [visibleCenters]);

  const {
    searchOpen,
    setSearchOpen,
    searchText,
    setSearchText,
    searchActiveIndex,
    setSearchActiveIndex,
    filteredSearchList,
  } = useGlobalSearch({ pageSearchEntries, navigateToAdminContent, setActiveSidebarKey });

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
        sidebarCentersForMenu.find((c) => c.key === activeSidebarKey) ||
        sidebarCentersForMenu[0];
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
      sidebarCentersForMenu.find((c) => c.key === activeSidebarKey) ||
      sidebarCentersForMenu[0];
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

  const rootShellStyle = {
    height: '100vh',
    overflow: 'hidden',
    '--admin-nav-divider-color': NAV_DIVIDER_COLOR,
  } as React.CSSProperties;

  return (
    <Layout className="admin-layout-root" style={rootShellStyle}>
      <AdminStandardHeader
        settings={settings}
        settingsLoading={settingsLoading}
        summaryClouds={summaryClouds}
        summaryLoading={summaryLoading}
        visibleCenters={visibleCenters as AdminSidebarCenter[]}
        activeSidebarKey={activeSidebarKey}
        platformDropdownSelectedKeys={platformDropdownSelectedKeys}
        navigateToAdminContent={navigateToAdminContent}
        headerSelectedPoolId={headerSelectedPoolId}
        setHeaderSelectedPoolId={setHeaderSelectedPoolId}
        headerPoolOverviewEnabled={headerPoolOverviewEnabled}
        canWritePools={canWritePools}
        navigate={navigate}
        user={user}
        openChangePassword={openChangePassword}
        handleLogout={handleLogout}
        openDefaultPoolWizardAction={openDefaultPoolWizardAction}
      />
      <>
        <Modal
          title={forcePasswordChange ? '密码已过期，请修改密码' : '修改密码'}
          open={changePasswordOpen}
          onCancel={() => {
            if (!forcePasswordChange) setChangePasswordOpen(false);
          }}
          onOk={submitChangePassword}
          confirmLoading={changePasswordSaving}
          okText="确认修改"
          cancelText="取消"
          closable={!forcePasswordChange}
          maskClosable={!forcePasswordChange}
          destroyOnHidden
        >
          <Form form={changePasswordForm} layout="vertical">
            <Form.Item
              label="原密码"
              name="oldPassword"
              rules={[{ required: true, message: '请输入原密码' }]}
            >
              <Input.Password autoComplete="current-password" />
            </Form.Item>
            <Form.Item
              label="新密码"
              name="newPassword"
              rules={[
                { required: true, message: '请输入新密码' },
                {
                  validator: async (_, v) => {
                    const pol = adminPwdPolicy || DEFAULT_ADMIN_PASSWORD_POLICY;
                    const err = validateAdminPasswordClient(pol, String(v || ''), user?.username);
                    if (err) throw new Error(err);
                  },
                },
              ]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <Form.Item
              label="确认新密码"
              name="confirmPassword"
              dependencies={['newPassword']}
              rules={[
                { required: true, message: '请再次输入新密码' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('newPassword') === value) return Promise.resolve();
                    return Promise.reject(new Error('两次输入的新密码不一致'));
                  },
                }),
              ]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
          </Form>
        </Modal>
        <PoolEdgeWizard
          visible={poolWizardOpen}
          onCancel={handlePoolWizardCancel}
          onSuccess={handlePoolWizardSuccess}
          forceRequired={poolWizardForceRequired}
          editingCloud={poolWizardEditing}
        />
        {/* 全局搜索弹窗 */}
        {/* 检索关键词: search modal dialog 搜索弹窗 */}
        {searchOpen && (
          <div
            onClick={()=> setSearchOpen(false)}
            style={{
              position:'fixed',
              inset:0,
              background:'rgba(0,0,0,0.25)',
              zIndex:3000
            }}
          >
            <div
              onClick={(e)=> e.stopPropagation()}
              style={{
                position:'absolute',
                top:'10%',
                left:'50%',
                transform:'translateX(-50%)',
                width:720,
                background:'#fff',
                borderRadius:12,
                boxShadow:'0 20px 40px rgba(0,0,0,0.2)',
                overflow:'hidden'
              }}
            >
              <div style={{ padding:16, borderBottom:'1px solid #f0f0f0' }}>
                <Input
                  autoFocus
                  value={searchText}
                  onChange={(e)=> { setSearchText(e.target.value); setSearchActiveIndex(0); }}
                  placeholder="搜索页面…  快捷键 Ctrl+K / Esc 关闭"
                  size="large"
                />
              </div>
              <div style={{ maxHeight:360, overflow:'auto' }}>
                {filteredSearchList.length === 0 ? (
                  <div style={{ padding:16 }}>
                    <Typography.Text type="secondary">无匹配结果</Typography.Text>
                  </div>
                ) : (
                  filteredSearchList.map((it: PageSearchEntry, idx: number) => (
                    <div
                      key={it.path}
                      onMouseEnter={()=> setSearchActiveIndex(idx)}
                      onClick={()=> {
                        const path = it.path;
                        const pure = String(path || '').split('?')[0];
                        navigateToAdminContent(path);
                        if (pure !== '/console') {
                          setActiveSidebarKey(sidebarForPath(path));
                        }
                        setSearchOpen(false);
                      }}
                      style={{
                        padding:'12px 16px',
                        display:'flex',
                        alignItems:'center',
                        justifyContent:'space-between',
                        cursor:'pointer',
                        background: idx === searchActiveIndex ? '#f0f7ff' : '#fff',
                        borderBottom:'1px solid #f5f5f5'
                      }}
                    >
                      <Space size={10}>
                        <span style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:24, height:24, borderRadius:6, background:'#f0f5ff' }}>{it.icon}</span>
                        <span style={{ fontSize:14 }}>{it.label}</span>
                      </Space>
                      <Typography.Text type="secondary">{it.group}</Typography.Text>
                    </div>
                  ))
                )}
              </div>
              <div style={{ padding:'10px 16px', background:'#fafafa', borderTop:'1px solid #f0f0f0', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <Typography.Text type="secondary">Enter 打开 · ESC 关闭 · SCROLL 查看更多</Typography.Text>
                <Button type="text" onClick={()=> setSearchOpen(false)}>关闭</Button>
              </div>
            </div>
          </div>
        )}
      </>
      {/* 侧边栏和内容区域 */}
      <Layout>
        {/* 侧边栏菜单：CNMC / SDNCC 等平台侧栏（资源池、控制台等） */}
        <AdminSidebar
          collapsed={collapsed}
          onCollapse={setCollapsed}
          openKeys={openKeys}
          setOpenKeys={setOpenKeys}
          activeSidebarKey={activeSidebarKey}
          visibleCenters={sidebarCentersForMenu as AdminSidebarCenter[]}
          selectedPathname={location.pathname}
          selectedMenuKey={poolSelectedMenuKey}
          navigate={navigateToAdminContent}
          headerOffsetPx={ADMIN_HEADER_HEIGHT_PX}
        />
        <Content
          className={adminOutletSdnccClassName}
          style={{
            background: '#fff',
            height: `calc(100vh - ${ADMIN_HEADER_HEIGHT_PX}px)`,
            overflow: 'auto',
          }}
        >
          <Suspense fallback={<AdminOutletSuspenseFallback />}>
            <Outlet context={{ reloadSummaryClouds: loadSummaryClouds } satisfies AdminLayoutOutletContext} />
          </Suspense>
        </Content>
      </Layout>
    </Layout>
  );
};

export default AdminLayout;
