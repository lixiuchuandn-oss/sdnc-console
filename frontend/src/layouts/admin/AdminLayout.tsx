import React, { useCallback, useMemo, Suspense } from 'react';
import { App, Layout, Spin } from 'antd';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import type { AdminLayoutOutletContext } from './adminLayoutOutletContext';
import { useAuth } from '../../contexts/AuthContext';
import { useLicense } from '../../contexts/LicenseContext';
import { useSettings } from '../../contexts/SettingsContext';
import { getRequiredActionForPath, hasPermissionForAction } from '../../utils/accessMapping';
import {
  CLOUD_RESOURCE_POOLS_CREATE_WRITE,
  CLOUD_RESOURCE_POOLS_READ,
  CLOUD_RESOURCE_POOLS_WRITE,
} from '../../constants/cloudPermissions';
import PoolEdgeWizard from '../../pages/cnmc/pools/modals/CloudWizardeasy';
import AdminSidebar, { type AdminSidebarCenter } from './AdminSidebar';
import './admin-shell.css';
import AdminStandardHeader from './AdminStandardHeader';
import { ADMIN_HEADER_HEIGHT_PX } from './lib/adminLayoutNav';
import AdminChangePasswordModal from './AdminChangePasswordModal';
import AdminGlobalSearchModal from './AdminGlobalSearchModal';
import { useGlobalSearch } from './hooks/useGlobalSearch';
import { useAdminPasswordGate } from './hooks/useAdminPasswordGate';
import { useAdminPlatformMenu } from './hooks/useAdminPlatformMenu';
import { useHeaderPoolStrip } from './hooks/useHeaderPoolStrip';
import { usePoolWizard } from './hooks/usePoolWizard';
import { useSidebarMenuState } from './hooks/useSidebarMenuState';
import { isSdnccPagePath } from '../../routes/adminRouteMatch';

const { Content } = Layout;

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

  const canAccessPath = useCallback(
    (p: string): boolean => {
      const pure = String(p || '').split('?')[0];
      if (!user) return false;
      if (String(user.role || '').toLowerCase() === 'super_admin') return true;
      const act = getRequiredActionForPath(pure);
      const perms = Array.isArray(user.permissions) ? user.permissions : [];
      return hasPermissionForAction(perms, act);
    },
    [user],
  );

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

  const hasPoolManagementLicense = hasFeature('platform.multi-cloud');

  const headerPoolOverviewEnabled = useMemo(() => {
    if (!user) return false;
    if (String(user.role || '').toLowerCase() === 'super_admin') return true;
    const perms = Array.isArray(user.permissions) ? user.permissions : [];
    if (hasPoolManagementLicense) return canReadPools;
    return (
      hasPermissionForAction(perms, 'clouds.ecs:read') ||
      hasPermissionForAction(perms, 'clouds.ecs:write')
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

  const { visibleCenters, pageSearchEntries } = useAdminPlatformMenu(hasFeature, canAccessPath);

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

  const {
    searchOpen,
    setSearchOpen,
    searchText,
    setSearchText,
    searchActiveIndex,
    setSearchActiveIndex,
    filteredSearchList,
  } = useGlobalSearch({ pageSearchEntries, navigateToAdminContent, setActiveSidebarKey });

  const openGlobalSearch = useCallback(() => {
    setSearchOpen(true);
    setSearchText('');
    setSearchActiveIndex(0);
  }, [setSearchOpen, setSearchText, setSearchActiveIndex]);

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
        onOpenGlobalSearch={openGlobalSearch}
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
      <Layout>
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
