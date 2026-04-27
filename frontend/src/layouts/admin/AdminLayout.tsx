/**
 * 管理后台主布局：顶栏、侧栏（多平台菜单）、内容区 Outlet、全局搜索等。
 * 样式：`admin-shell.css`（侧栏 + 顶栏图标按钮覆盖）。
 * 检索关键词: AdminLayout layout admin sidebar visibleCenters canAccessPath Ctrl+K
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  App,
  Button,
  Dropdown,
  Form,
  Input,
  Layout,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import { Outlet, useNavigate, useLocation, type NavigateFunction } from 'react-router-dom';
import {
  CodeOutlined,
  HomeFilled,
  ApiFilled,
  LogoutOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined,
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
import { apiPost, apiRequest, fetchClouds } from '../../services/api';
import { getPublicAdminPasswordPolicy } from '../../services/systemApi';
import { validateAdminPasswordClient, type AdminPasswordPolicy } from '../../utils/adminPasswordPolicy';
import { renderMarkdownBold } from '../../utils/markdown';
import {
  CLOUD_RESOURCE_POOLS_CREATE_WRITE,
  CLOUD_RESOURCE_POOLS_READ,
  CLOUD_RESOURCE_POOLS_WRITE,
} from '../../constants/cloudPermissions';
import { type Cloud, isCsmCloud, isRancherPoolCloud } from '../../pages/cnmc/pools/poolProviders';
import PoolEdgeWizard from '../../pages/cnmc/pools/CloudWizardeasy';
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
  parseRancherClusterWorkspacePath,
  buildRancherClusterSidebarCenter,
  RANCHER_CLUSTER_SIDEBAR_CENTER_KEY,
  normalizeRancherClusterTabParam,
  normalizeRancherClusterSubParam,
  normalizeRancherClusterWorkloadsSubParam,
  normalizeRancherResourceSub,
  type RancherClusterWorkloadsSubKey,
} from './rancher/rancherClusterSidebar';
import './admin-shell.css';

const { Header, Content } = Layout;

/** 顶栏高度（与 sticky、抽屉 top、侧栏 top 对齐） */
const ADMIN_HEADER_HEIGHT_PX = 64;

/** 顶栏底边、侧栏右边线等与导航分割相关的颜色 */
const NAV_DIVIDER_COLOR = 'rgb(200, 207, 218)';

/** 无资源池时强弹向导：本会话用户点「稍后接入」后不再自动弹出 */
const MUST_BIND_POOL_DISMISS_KEY = 'adminLayout.mustBindPoolPromptDismissed';

/** 顶栏资源池条：外框（与业务逻辑无关的静态样式集中） */
const HEADER_POOL_STRIP_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
  fontSize: 14,
  color: 'rgba(255,255,255,0.92)',
  border: '1px solid rgba(255,255,255,0.38)',
  borderRadius: 8,
  padding: 4,
  background: 'rgba(255,255,255,0.06)',
  boxSizing: 'border-box',
};

function poolOverviewPath(cloudId: string, clouds: Cloud[]): string {
  const c = clouds.find((x) => String(x.id) === String(cloudId));
  if (c && isCsmCloud(c)) {
    return `/admin/security/traffic/csm-pools/${encodeURIComponent(cloudId)}`;
  }
  return `/admin/clouds/${encodeURIComponent(cloudId)}/resource_hub/overview`;
}

function byCloudCreatedAtAsc(a: Cloud, b: Cloud): number {
  const ta = Date.parse(String(a.createdAt || '')) || 0;
  const tb = Date.parse(String(b.createdAt || '')) || 0;
  return ta - tb;
}

/**
 * 默认资源池：显式 config.isDefault；否则按创建时间取「第一个添加的」池。
 */
function pickDefaultPoolId(clouds: Cloud[]): string | undefined {
  if (!clouds.length) return undefined;
  const cfg = (c: Cloud) => Boolean((c.config as Record<string, unknown> | undefined)?.isDefault);
  const flagged = clouds.find(cfg);
  if (flagged) return flagged.id;
  const sorted = [...clouds].sort(byCloudCreatedAtAsc);
  return sorted[0]?.id;
}

function resolveDefaultPool(clouds: Cloud[]): Cloud | undefined {
  const id = pickDefaultPoolId(clouds);
  return id ? clouds.find((c) => c.id === id) : undefined;
}

type PageSearchEntry = {
  path: string;
  title: string;
  icon: React.ReactNode;
  label: string;
  group: string;
};

function firstMenuPathInCenter(center: { items?: unknown[] }): string | null {
  const first = (center.items || [])[0] as { key?: string; children?: { key?: string }[] } | undefined;
  const page = first?.children?.length ? first.children[0] : first;
  const key = page && 'key' in page ? page.key : undefined;
  return typeof key === 'string' && key.startsWith('/') ? key : null;
}

/** 由当前路径解析应高亮的平台侧栏 key */
function sidebarForPath(p: string): string {
  const found = routeSpecs.find((r) => {
    if (r.path === p) return true;
    if (r.path.includes(':')) {
      const base = r.path.split(':')[0];
      return p.startsWith(base);
    }
    return false;
  });

  if (found?.platform) {
    if (found.platform === 'CNMC') return '/admin/cen_compute';
    if (found.platform === 'TENANTS') return '/admin/cen_tenants';
    if (found.platform === 'SDNCC') return '/admin/cen_sdn';
    if (found.platform === 'CNSOC') return '/admin/cen_secops';
    if (found.platform === 'SETTINGS') return '/admin/cen_settings';
  }

  const s = p.toLowerCase();
  if (s.includes('/admin/paas')) {
    return '/admin/cen_compute';
  }
  if (s.includes('/interconnect') || s.includes('/sec-mgr-plane') || s.includes('/security/traffic')) {
    return '/admin/cen_sdn';
  }
  if (s.includes('/alarms') || s.includes('/soc') || s.includes('/aisoc')) {
    return '/admin/cen_secops';
  }
  if (s.includes('/settings')) {
    return '/admin/cen_settings';
  }
  return '/admin/cen_compute';
}

/** 顶栏须为模块级组件：避免在 AdminLayout 内每次渲染新建子组件类型，导致 Select 被卸载、切换不生效 */
type AdminStandardHeaderProps = {
  settings: {
    headerColor?: string;
    headerColorEnd?: string;
    headerIcon?: string;
    headerTitle?: string;
  };
  settingsLoading: boolean;
  summaryClouds: Cloud[];
  summaryLoading: boolean;
  visibleCenters: AdminSidebarCenter[];
  activeSidebarKey: string;
  /** 资源池详情时顶栏「平台」下拉不高亮具体平台 */
  platformDropdownSelectedKeys: string[];
  navigateToAdminContent: (path: string) => void;
  headerSelectedPoolId: string | undefined;
  setHeaderSelectedPoolId: React.Dispatch<React.SetStateAction<string | undefined>>;
  /** 顶栏切换池后是否可进入池内总览（未授权资源池管理时仅依赖控制台读权限） */
  headerPoolOverviewEnabled: boolean;
  canWritePools: boolean;
  navigate: NavigateFunction;
  user: {
    username?: string;
    fullName?: string;
    role?: string;
    tenantName?: string;
    organizationName?: string;
  } | null;
  openChangePassword: () => void;
  handleLogout: () => void;
  openDefaultPoolWizardAction: () => void;
};

function AdminStandardHeader({
  settings,
  settingsLoading,
  summaryClouds,
  summaryLoading,
  visibleCenters,
  activeSidebarKey,
  platformDropdownSelectedKeys,
  navigateToAdminContent,
  headerSelectedPoolId,
  setHeaderSelectedPoolId,
  headerPoolOverviewEnabled,
  canWritePools,
  navigate,
  user,
  openChangePassword,
  handleLogout,
  openDefaultPoolWizardAction,
}: AdminStandardHeaderProps) {
  const headerColor = settings.headerColor;
  const headerColorEnd = settings.headerColorEnd;
  const gradient =
    headerColor && headerColorEnd
      ? `linear-gradient(90deg, ${headerColor} 0%, ${headerColorEnd} 100%)`
      : 'transparent';

  const zoneOptions = [...summaryClouds].filter((c) => !isCsmCloud(c)).sort(byCloudCreatedAtAsc).map((c) => ({
    value: c.id,
    label: c.name,
  }));

  return (
    <Header
      style={{
        background: gradient,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        position: 'sticky',
        top: 0,
        zIndex: 1000,
        height: ADMIN_HEADER_HEIGHT_PX,
        boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
        borderBottom: '1px solid var(--admin-nav-divider-color, rgb(200, 207, 218))',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: ADMIN_HEADER_HEIGHT_PX,
          gap: 12,
          flex: 1,
          minWidth: 0,
        }}
      >
        <Dropdown
          menu={{
            items: visibleCenters.map((c: AdminSidebarCenter) => ({
              key: c.key,
              label: <span style={{ fontWeight: 500 }}>{c.label}</span>,
              onClick: () => {
                const path = firstMenuPathInCenter(c);
                if (path) navigateToAdminContent(path);
              },
            })),
            selectable: true,
            selectedKeys: platformDropdownSelectedKeys,
          }}
          trigger={['click']}
        >
          <button
            type="button"
            className="admin-header-platform-trigger"
            aria-label="切换平台"
            title="切换平台"
          >
            <HomeFilled />
          </button>
        </Dropdown>
        <Space size={8} style={{ height: '100%', alignItems: 'center' }}>
          {settings.headerIcon && (
            <img src={settings.headerIcon} alt="Logo" style={{ height: 28, width: 'auto', display: 'block' }} />
          )}
          <span
            style={{
              fontSize: 18,
              color: '#fff',
              lineHeight: '18px',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {settingsLoading ? '' : renderMarkdownBold(settings.headerTitle ?? '')}
          </span>
        </Space>
        <div role="region" aria-label="可用区与资源池" style={{ ...HEADER_POOL_STRIP_STYLE, gap: 5 }}>
          {summaryLoading ? (
            <Spin size="small" />
          ) : (
            <>
              <Select
                prefix="可用区"
                className="admin-header-zone-select"
                size="small"
                showSearch
                optionFilterProp="label"
                disabled={!zoneOptions.length}
                loading={summaryLoading}
                placeholder={zoneOptions.length ? undefined : '暂无多云资源池'}
                value={headerSelectedPoolId}
                options={zoneOptions}
                style={{ width: 150 }}
                onChange={(id) => {
                  setHeaderSelectedPoolId(id);
                  if (headerPoolOverviewEnabled && id) navigate(poolOverviewPath(String(id), summaryClouds));
                }}
                aria-label="选择资源池（可用区）"
              />
              <button
                type="button"
                className="admin-header-pool-access-btn"
                disabled={!headerPoolOverviewEnabled || !headerSelectedPoolId || !zoneOptions.length}
                title="进入当前资源池总览"
                aria-label="访问当前资源池总览"
                onClick={() => {
                  if (headerPoolOverviewEnabled && headerSelectedPoolId) {
                    navigate(poolOverviewPath(String(headerSelectedPoolId), summaryClouds));
                  }
                }}
              >
                访问
              </button>
              <button
                type="button"
                className="admin-header-pool-icon-btn"
                disabled={!canWritePools}
                title={
                  !summaryClouds.filter((c) => !isCsmCloud(c)).length
                    ? '添加默认资源池'
                    : '编辑当前默认资源池（未显式指定时为最早添加的池）'
                }
                aria-label="设定默认资源池"
                onClick={openDefaultPoolWizardAction}
              >
                <ApiFilled />
              </button>
            </>
          )}
        </div>
      </div>
      <div className="admin-header-actions" style={{ display: 'flex', alignItems: 'center', gap: 16, height: '100%', flexShrink: 0 }}>
        {user && (
          <>
            <div className="admin-header-user-strip" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 12px', maxWidth: 520, minWidth: 0 }}>
              <span className="admin-header-login-user">
                <UserOutlined aria-hidden />
                <span className="admin-header-login-user-name">{String(user.username || '').trim() || '—'}</span>
              </span>
              {user.tenantName && <Tag color="gold">租户: {user.tenantName}</Tag>}
              {user.organizationName && <Tag color="cyan">组织: {user.organizationName}</Tag>}
            </div>
            {user.role !== 'tenant' && (
              <Button
                type="link"
                size="small"
                className="admin-header-change-pwd-link"
                onClick={openChangePassword}
              >
                修改密码
              </Button>
            )}
            <Button
              type="default"
              size="small"
              className="admin-header-logout-btn"
              icon={<LogoutOutlined />}
              onClick={handleLogout}
            />
          </>
        )}
      </div>
    </Header>
  );
}

const AdminLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, refreshUser } = useAuth();
  const userPermissions = user?.permissions && Array.isArray(user.permissions) ? user.permissions : [];
  const { hasFeature } = useLicense();
  const { settings, loading: settingsLoading } = useSettings();
  const { message } = App.useApp();
  const [changePasswordForm] = Form.useForm();

  const [collapsed, setCollapsed] = useState(true);
  const [activeSidebarKey, setActiveSidebarKey] = useState('/admin/cen_compute');
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  /** 仅当选中页/池内菜单签名变化时自动展开分组；避免每次 effect 把用户已折叠的分组强行撑开 */
  const lastSidebarAutoExpandSigRef = useRef<string>('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searchActiveIndex, setSearchActiveIndex] = useState(0);
  const searchActiveIndexRef = useRef(0);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [changePasswordSaving, setChangePasswordSaving] = useState(false);
  const [adminPwdPolicy, setAdminPwdPolicy] = useState<AdminPasswordPolicy | null>(null);

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

  const forcePasswordChange = user?.mustChangePassword === true && user?.role !== 'tenant';

  useEffect(() => {
    getPublicAdminPasswordPolicy().then(setAdminPwdPolicy);
  }, []);

  useEffect(() => {
    if (forcePasswordChange) {
      changePasswordForm.resetFields();
      setChangePasswordOpen(true);
    }
  }, [forcePasswordChange, user?.id, changePasswordForm]);

  const openChangePassword = () => {
    changePasswordForm.resetFields();
    setChangePasswordOpen(true);
  };

  const submitChangePassword = async () => {
    try {
      const values = await changePasswordForm.validateFields();
      setChangePasswordSaving(true);
      await apiPost('/api/users/me/password', {
        oldPassword: String(values.oldPassword || ''),
        newPassword: String(values.newPassword || ''),
      });
      await refreshUser();
      message.success('密码修改成功');
      setChangePasswordOpen(false);
    } catch (e: any) {
      if (Array.isArray(e?.errorFields) && e.errorFields.length > 0) return;
      message.error(e?.message || '修改密码失败');
    } finally {
      setChangePasswordSaving(false);
    }
  };

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

  /** 含「资源池管理」授权（侧栏资源池列表等）；未激活授权时视为 false */
  const hasPoolManagementLicense = hasFeature('platform.default');

  /**
   * 顶栏进入池内总览：有资源池管理授权时沿用原 pools 读权限；否则仅要求控制台读权限（与未授权场景一致）。
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
      const raw = await fetchClouds();
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
        children: groupedSpecs
          .filter(s => s.group === grp)
          .sort((a:any, b:any) => Number(a.order ?? 0) - Number(b.order ?? 0))
          .map((s) => ({ key: s.path, label: s.title || s.breadcrumbLabel || s.id, icon: iconOf(s.icon), requiredFeature: s.requiredFeature })),
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
    const { requiredFeature, ...rest } = item;
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
  }, [rancherClusterCtx?.poolId, rancherClusterCtx?.clusterId]);

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

  /** CSM 安全资源池详情、Cloudmap 池详情、Rancher 集群工作台：侧栏替换为池内 / 集群内导航 */
  const contextualPoolSidebar =
    rancherClusterSidebarCenter || csmPoolSidebarCenter || poolSidebarCenter;
  const sidebarCentersForMenu = contextualPoolSidebar ? [contextualPoolSidebar] : visibleCenters;
  const poolSelectedMenuKey = useMemo(() => {
    if (rancherClusterSidebarCenter && rancherClusterCtx) {
      const sp = new URLSearchParams(location.search);
      const rawTab = sp.get('tab');
      const tab = normalizeRancherClusterTabParam(rawTab);
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
    if (!poolSidebarCenter || !poolCloudId) return undefined;
    return cloudmapPoolSidebarSelectedKey(location.pathname, poolSidebarCenter.items);
  }, [
    rancherClusterSidebarCenter,
    rancherClusterCtx,
    csmPoolSidebarCenter,
    csmPoolId,
    poolSidebarCenter,
    poolCloudId,
    location.pathname,
    location.search,
  ]);
  const platformDropdownSelectedKeys = contextualPoolSidebar ? [] : [activeSidebarKey];

  useEffect(() => {
    if (poolSidebarCenter || rancherClusterSidebarCenter || csmPoolSidebarCenter) {
      setOpenKeys([]);
      lastSidebarAutoExpandSigRef.current = '';
    }
  }, [
    poolSidebarCenter,
    rancherClusterSidebarCenter,
    csmPoolSidebarCenter,
    poolCloudId,
    rancherClusterCtx?.poolId,
    rancherClusterCtx?.clusterId,
  ]);

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
  }, [user?.id, loadSummaryClouds]);

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
    if (summaryLoading) return;
    if (!canWritePools) return;
    try {
      if (window.sessionStorage.getItem(MUST_BIND_POOL_DISMISS_KEY) === '1') return;
    } catch {
      /* ignore */
    }
    if (autoBindPoolPromptShownRef.current) return;
    autoBindPoolPromptShownRef.current = true;
    poolWizardOpenedByAutoRef.current = true;
    setPoolWizardForceRequired(true);
    setPoolWizardEditing(null);
    setPoolWizardOpen(true);
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

  const filteredSearchList = useMemo(() => {
    const kw = String(searchText || '').toLowerCase().trim();
    const base = pageSearchEntries;
    if (!kw) return base.slice(0, 12);
    return base.filter((e) => e.title.toLowerCase().includes(kw));
  }, [pageSearchEntries, searchText]);

  useEffect(() => {
    searchActiveIndexRef.current = searchActiveIndex;
  }, [searchActiveIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
        setSearchText('');
        setSearchActiveIndex(0);
      }
      if (searchOpen) {
        if (e.key === 'Escape') {
          setSearchOpen(false);
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSearchActiveIndex(i => {
            const newIndex = Math.min(i + 1, Math.max(filteredSearchList.length - 1, 0));
            searchActiveIndexRef.current = newIndex;
            return newIndex;
          });
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSearchActiveIndex(i => {
            const newIndex = Math.max(i - 1, 0);
            searchActiveIndexRef.current = newIndex;
            return newIndex;
          });
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          const sel = filteredSearchList[searchActiveIndexRef.current];
          if (sel) {
            const path = sel.path;
            const pure = String(path || '').split('?')[0];
            navigateToAdminContent(path);
            if (pure !== '/console') {
              setActiveSidebarKey(sidebarForPath(path));
            }
            setSearchOpen(false);
          }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchOpen, filteredSearchList, navigateToAdminContent]);

  useEffect(() => {
    if (rancherClusterSidebarCenter) {
      setActiveSidebarKey(RANCHER_CLUSTER_SIDEBAR_CENTER_KEY);
      return;
    }
    if (csmPoolSidebarCenter) {
      setActiveSidebarKey(CSM_POOL_SIDEBAR_CENTER_KEY);
      return;
    }
    if (poolSidebarCenter) {
      setActiveSidebarKey(CLOUD_POOL_SIDEBAR_CENTER_KEY);
      return;
    }
    setActiveSidebarKey(sidebarForPath(location.pathname + location.search));
  }, [location.pathname, location.search, poolSidebarCenter, rancherClusterSidebarCenter, csmPoolSidebarCenter]);

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

    // 查找包含当前路径的分组
    const activeGroup = (center.items || []).find((item: any) => {
      // 如果是分组（有 children），检查其子项是否包含当前路径
      if (item.children && Array.isArray(item.children)) {
        return item.children.some((child: any) => {
          const childPath = String(child.key || '').split('?')[0];
          return childPath === currentPath;
        });
      }
      // 如果是顶级菜单项，检查是否匹配当前路径
      const itemPath = String(item.key || '').split('?')[0];
      return itemPath === currentPath;
    });

    // 如果找到分组，展开它；否则保持当前展开状态
    if (activeGroup && activeGroup.children) {
      const groupKey = activeGroup.key;
      const sig = `path|${activeSidebarKey}|${currentPath}`;
      if (lastSidebarAutoExpandSigRef.current === sig) return;
      lastSidebarAutoExpandSigRef.current = sig;
      setOpenKeys((prev) => {
        if (prev.includes(groupKey)) return prev;

        // 只保留当前平台的展开状态，避免切平台后残留其它平台的 openKeys
        const pfPrefix = String(groupKey).split('_')[0];
        const nextBase = prev.filter((k) => String(k).startsWith(pfPrefix + '_'));

        // 保留其它已展开分组，只新增当前分组到 openKeys，避免“点第一个分组导致其它折叠”
        return [...nextBase, groupKey];
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
                    const pol =
                      adminPwdPolicy || {
                        minLength: 8,
                        maxLength: 64,
                        requireUppercase: false,
                        requireLowercase: false,
                        requireDigit: false,
                        requireSpecial: false,
                        maxPasswordAgeDays: 0,
                        requirePasswordChangeOnFirstLogin: false,
                      };
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
            background: location.pathname.includes('/webssh') ? '#1e1e1e' : '#fff',
            height: `calc(100vh - ${ADMIN_HEADER_HEIGHT_PX}px)`,
            overflow: 'auto',
          }}
        >
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
};

export default AdminLayout;
