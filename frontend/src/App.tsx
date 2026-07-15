import 'antd/dist/reset.css';
import React, { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import AdminHomeGate from './components/AdminHomeGate';
import { ConfigProvider, theme as antdTheme, Spin } from 'antd';
import ErrorBoundary from './components/ErrorBoundary';
import { AuthProvider } from './contexts/AuthContext';
import { SettingsProvider, useSettings } from './contexts/SettingsContext';
import AdminRoute from './components/AdminRoute';
import { sdncAdminRouteRedirectElements } from './components/SdncAdminRouteRedirects';
import AdminLogin from './pages/auth/AdminLogin';
import AdminLayout from './layouts/AdminLayout';

const GeneralSettings = lazy(() => import('./pages/settings/GeneralSettings'));
const AuditLogs = lazy(() => import('./pages/settings/AuditLogs'));
const AdvancedSettings = lazy(() => import('./pages/settings/AdvancedSettings'));
const OfflineUpgradeSettings = lazy(() => import('./pages/settings/OfflineUpgradeSettings'));
const SRv6Page = lazy(() => import('./pages/sdncc/ibr/srv6/index'));
const SRv6CreatePage = lazy(() => import('./pages/sdncc/ibr/srv6/Create'));
const SRv6ArchitecturePage = lazy(() => import('./pages/sdncc/ibr/srv6/Architecture'));
const IPsecVPNPage = lazy(() => import('./pages/sdncc/ibr/ipsec-vpn/index'));
const IPsecVPNWizard = lazy(() => import('./pages/sdncc/ibr/ipsec-vpn/IPsecVPNWizard'));
const VRPage = lazy(() => import('./pages/sdncc/ibr/routers/index'));
const IbrHaGroupsPage = lazy(() => import('./pages/sdncc/ibr/ha-groups/index'));
const IbrHaGroupWizard = lazy(() => import('./pages/sdncc/ibr/ha-groups/IbrHaGroupWizard'));
const RrDomainsPage = lazy(() => import('./pages/sdncc/ibr/rr-domains/index'));
const VrConsolePage = lazy(() => import('./pages/sdncc/ibr/routers/console/VrConsolePage'));
const EditVRConfig = lazy(() => import('./pages/sdncc/ibr/routers/EditVRConfig'));
const PEWizard = lazy(() => import('./pages/sdncc/ibr/routers/wizards/PEWizard'));
const CEWizard = lazy(() => import('./pages/sdncc/ibr/routers/wizards/CEWizard'));
const StandardWizard = lazy(() => import('./pages/sdncc/ibr/routers/wizards/StandardWizard'));
const SASEWizard = lazy(() => import('./pages/sdncc/ibr/routers/wizards/SASEWizard'));
const ACLPage = lazy(() => import('./pages/sdncc/ibr/acl/index'));
const NATPage = lazy(() => import('./pages/sdncc/ibr/nat/index'));
const ComingSoon = lazy(() => import('./pages/coming-soon'));
const AccessRolesPage = lazy(() => import('./pages/settings/Roles/Index'));
const AccessUsersPage = lazy(() => import('./pages/settings/Users/Index'));
const IbrEmbedOutlet = lazy(() => import('./pages/sdncc/ibr/lib/IbrEmbedOutlet'));

const LoadingFallback: React.FC = () => (
  <div
    style={{
      position: 'relative',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '400px',
      width: '100%',
    }}
  >
    <Spin size="large" tip="加载中...">
      <div style={{ minHeight: 200, minWidth: 200 }} />
    </Spin>
  </div>
);

const AppRoutes: React.FC = () => (
  <Suspense fallback={<LoadingFallback />}>
    <Routes>
      <Route path="/login" element={<Navigate to="/admin/login" replace />} />
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route path="/" element={<Navigate to="/admin" replace />} />

      {/* IBR 运维控制台：独立全屏窗口，不套 AdminLayout */}
      <Route
        path="/admin/interconnect/vr/:uuid/console"
        element={
          <AdminRoute>
            <VrConsolePage />
          </AdminRoute>
        }
      />

      <Route path="/admin" element={<AdminRoute><AdminLayout /></AdminRoute>}>
        <Route index element={<AdminHomeGate />} />
        <Route path="interconnect/srv6" element={<IbrEmbedOutlet><SRv6Page /></IbrEmbedOutlet>} />
        <Route path="interconnect/srv6/create" element={<SRv6CreatePage />} />
        <Route path="interconnect/srv6/architecture" element={<SRv6ArchitecturePage />} />
        <Route path="interconnect/ipsec" element={<IbrEmbedOutlet><IPsecVPNPage /></IbrEmbedOutlet>} />
        <Route path="interconnect/ipsec/create" element={<IPsecVPNWizard />} />
        <Route path="interconnect/ipsec/:id/edit" element={<IPsecVPNWizard />} />
        <Route path="interconnect/vr" element={<IbrEmbedOutlet><VRPage /></IbrEmbedOutlet>} />
        <Route path="interconnect/ha-groups" element={<IbrEmbedOutlet><IbrHaGroupsPage /></IbrEmbedOutlet>} />
        <Route path="interconnect/ha-groups/create" element={<IbrHaGroupWizard />} />
        <Route path="interconnect/ha-groups/:id/wizard" element={<IbrHaGroupWizard />} />
        <Route path="interconnect/rr-domains" element={<IbrEmbedOutlet><RrDomainsPage /></IbrEmbedOutlet>} />
        <Route path="interconnect/vr/:uuid/config" element={<EditVRConfig />} />
        <Route path="interconnect/vr/:uuid/role-pe" element={<PEWizard />} />
        <Route path="interconnect/vr/:uuid/role-ce" element={<CEWizard />} />
        <Route path="interconnect/vr/:uuid/role-standard" element={<StandardWizard />} />
        <Route path="interconnect/vr/:uuid/role-sase" element={<SASEWizard />} />
        <Route path="interconnect/acl" element={<IbrEmbedOutlet><ACLPage /></IbrEmbedOutlet>} />
        <Route path="interconnect/nat" element={<IbrEmbedOutlet><NATPage /></IbrEmbedOutlet>} />
        <Route path="settings" element={<Navigate to="settings/general" replace />} />
        <Route path="settings/general" element={<GeneralSettings />} />
        <Route path="settings/audit-logs" element={<AuditLogs />} />
        <Route path="settings/advanced" element={<AdvancedSettings />} />
        <Route path="settings/offline-upgrade" element={<OfflineUpgradeSettings />} />
        <Route path="coming-soon" element={<ComingSoon />} />
        <Route path="access/actions" element={<Navigate to="/admin/access/roles" replace />} />
        <Route path="access/roles" element={<AccessRolesPage />} />
        <Route path="access/users" element={<AccessUsersPage />} />
        {sdncAdminRouteRedirectElements()}
      </Route>
    </Routes>
  </Suspense>
);

const AppContent: React.FC = () => {
  const { settings } = useSettings();
  const isDark = settings.theme === 'dark';
  return (
    <ConfigProvider
      theme={{
        algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          ...(settings.primaryColor ? { colorPrimary: settings.primaryColor } : {}),
          borderRadius: 6,
        },
      }}
    >
      <Router future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
          <AppRoutes />
        </Router>
    </ConfigProvider>
  );
};

const App: React.FC = () => (
  <ErrorBoundary>
    <AuthProvider>
      <SettingsProvider>
        <AppContent />
      </SettingsProvider>
    </AuthProvider>
  </ErrorBoundary>
);

export default App;
