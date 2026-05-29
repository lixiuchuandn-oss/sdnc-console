/**
 * 管理后台主布局：顶栏、侧栏（多平台菜单）、内容区 Outlet、全局搜索等。
 * 样式：`admin-shell.css`（侧栏 + 顶栏图标按钮覆盖）。
 * 检索关键词: AdminLayout layout admin sidebar visibleCenters canAccessPath Ctrl+K
 */

import React, { useCallback, useMemo, Suspense } from 'react';
import { App, Layout, Spin } from 'antd';
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
import { PLATFORMS, PLATFORM_LABELS, GROUPS } from '../../constants/navigation';
import { routeSpecs } from '../../routes/RouteSpec';
import { isSdnccPagePath } from '../../routes/adminRouteMatch';
import { iconOf } from '../../utils/iconOf';
import {
  CLOUD_RESOURCE_POOLS_CREATE_WRITE,
  CLOUD_RESOURCE_POOLS_READ,
  CLOUD_RESOURCE_POOLS_WRITE,
} from '../../constants/cloudPermissions';
import PoolEdgeWizard from '../../pages/cnmc/pools/modals/CloudWizardeasy';
import AdminSidebar, { type AdminSidebarCenter } from './AdminSidebar';
import './admin-shell.css';
import AdminStandardHeader from './AdminStandardHeader';
import {
  ADMIN_HEADER_HEIGHT_PX,
  buildGroupMenuChildren,
  type PageSearchEntry,
} from './lib/adminLayoutNav';
import AdminChangePasswordModal from './AdminChangePasswordModal';
import AdminGlobalSearchModal from './AdminGlobalSearchModal';
import { useGlobalSearch } from './hooks/useGlobalSearch';
import { useAdminPasswordGate } from './hooks/useAdminPasswordGate';
import { useHeaderPoolStrip } from './hooks/useHeaderPoolStrip';
import { usePoolWizard } from './hooks/usePoolWizard';
import { useSidebarMenuState } from './hooks/useSidebarMenuState';

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

  const {
    summaryClouds,
    summaryLoading,
    summaryListHydrated,
    headerSelectedPoolId,
    setHeaderSelectedPoolId,
    loadSummaryClouds,
  } = useHeaderPoolStrip(user);


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

  const {
    collapsed,
    setCollapsed,
    openKeys,
    setOpenKeys,
    activeSidebarKey,
    setActiveSidebarKey,
    sidebarCentersForMenu,
    poolSelectedMenuKey,
    platformDropdownSelectedKeys,
  } = useSidebarMenuState({
    visibleCenters: visibleCenters as AdminSidebarCenter[],
    summaryClouds,
    userPermissions,
    hasFeature,
  });

  const {
    poolWizardOpen,
    poolWizardEditing,
    poolWizardForceRequired,
    handlePoolWizardCancel,
    handlePoolWizardSuccess,
    openDefaultPoolWizardAction,
  } = usePoolWizard({
    user,
    summaryClouds,
    summaryListHydrated,
    summaryLoading,
    canWritePools,
    loadSummaryClouds,
  });

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
        <AdminChangePasswordModal
          open={changePasswordOpen}
          forcePasswordChange={forcePasswordChange}
          saving={changePasswordSaving}
          form={changePasswordForm}
          policy={adminPwdPolicy}
          username={user?.username}
          onOk={submitChangePassword}
          onClose={() => setChangePasswordOpen(false)}
        />
        <PoolEdgeWizard
          visible={poolWizardOpen}
          onCancel={handlePoolWizardCancel}
          onSuccess={handlePoolWizardSuccess}
          forceRequired={poolWizardForceRequired}
          editingCloud={poolWizardEditing}
        />
        <AdminGlobalSearchModal
          open={searchOpen}
          setOpen={setSearchOpen}
          searchText={searchText}
          setSearchText={setSearchText}
          searchActiveIndex={searchActiveIndex}
          setSearchActiveIndex={setSearchActiveIndex}
          filteredSearchList={filteredSearchList}
          navigateToAdminContent={navigateToAdminContent}
          setActiveSidebarKey={setActiveSidebarKey}
        />
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
