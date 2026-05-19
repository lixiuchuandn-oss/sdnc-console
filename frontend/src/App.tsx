import 'antd/dist/reset.css';
import React, { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import AdminHomeGate from './components/AdminHomeGate';
import { ConfigProvider, theme as antdTheme, Spin } from 'antd';
import ErrorBoundary from './components/ErrorBoundary';
import { AuthProvider } from './contexts/AuthContext';
import { LicenseProvider } from './contexts/LicenseContext';
import { SettingsProvider, useSettings } from './contexts/SettingsContext';
import AdminRoute from './components/AdminRoute';
import PrivateRoute from './components/PrivateRoute';
import { routeSpecs } from './routes/RouteSpec';
import Login from './pages/auth/Login';
import AdminLogin from './pages/auth/AdminLogin';
import AdminLayout from './layouts/AdminLayout';
import TenantConsoleLayout from './layouts/TenantConsoleLayout';
import { TENANT_CLOUD_CONSOLE_PATH } from './pages/cnmc/console/tenantConsolePaths';

const OverviewDashboard = lazy(() => import('./pages/cnmc/dashboard/OverviewDashboard'));
const Users = lazy(() => import('./pages/tenants/sections/TenantUsersWorkspace'));
const Clouds = lazy(() => import('./pages/cnmc/pools'));
const CloudmapPoolShell = lazy(() => import('./pages/cnmc/clouds/Cloudmap/CloudmapPoolShell'));
const HuaweiPoolShell = lazy(() => import('./pages/cnmc/clouds/Hw/HuaweiPoolShell'));
const AliyunPoolShell = lazy(() => import('./pages/cnmc/clouds/Aliyun/AliyunPoolShell'));
const RancherPoolVendorShell = lazy(() => import('./pages/cnmc/clouds/rancher/RancherPoolVendorShell'));
const CsmPoolRouteShell = lazy(() => import('./pages/sdncc/traffic/CsmPools/CsmPoolRouteShell'));
const RancherClusterWorkspace = lazy(() => import('./pages/cnmc/clouds/rancher/RancherClusterWorkspace'));
const Tenants = lazy(() => import('./pages/tenants/sections/TenantsWorkspace'));
const GeneralSettings = lazy(() => import('./pages/settings/GeneralSettings'));
const AuditLogs = lazy(() => import('./pages/settings/AuditLogs'));
const AdvancedSettings = lazy(() => import('./pages/settings/AdvancedSettings'));

const LicenseSettingsPage = lazy(() => import('./pages/settings/LicenseSettings'));
const OfflineUpgradeSettings = lazy(() => import('./pages/settings/OfflineUpgradeSettings'));
const SRv6Page = lazy(() => import('./pages/sdncc/interconnect/srv6/index'));
const SRv6CreatePage = lazy(() => import('./pages/sdncc/interconnect/srv6/Create'));
const IPsecVPNPage = lazy(() => import('./pages/sdncc/interconnect/ipsec-vpn/index'));
const IPsecVPNWizard = lazy(() => import('./pages/sdncc/interconnect/ipsec-vpn/IPsecVPNWizard'));
const VRPage = lazy(() => import('./pages/sdncc/interconnect/vr/index'));
const AddVRInstance = lazy(() => import('./pages/sdncc/interconnect/vr/AddVRInstance'));
const EditVRConfig = lazy(() => import('./pages/sdncc/interconnect/vr/EditVRConfig'));
const PEWizard = lazy(() => import('./pages/sdncc/interconnect/vr/wizards/PEWizard'));
const CEWizard = lazy(() => import('./pages/sdncc/interconnect/vr/wizards/CEWizard'));
const StandardWizard = lazy(() => import('./pages/sdncc/interconnect/vr/wizards/StandardWizard'));
const SASEWizard = lazy(() => import('./pages/sdncc/interconnect/vr/wizards/SASEWizard'));
const ACLPage = lazy(() => import('./pages/sdncc/interconnect/acl/index'));
const NATPage = lazy(() => import('./pages/sdncc/interconnect/nat/index'));
const SecurityDomainPage = lazy(() => import('./pages/sdncc/sec-mgr-plane/SecurityDomain/index'));
const SecurityDomainDetail = lazy(() => import('./pages/sdncc/sec-mgr-plane/SecurityDomain/Detail'));
const CENPage = lazy(() => import('./pages/sdncc/sec-mgr-plane/cascade-channels/index'));
const CENDetailPage = lazy(() => import('./pages/sdncc/sec-mgr-plane/cascade-channels/detail'));
const ComingSoon = lazy(() => import('./pages/coming-soon'));
const SecurityApps = lazy(() => import('./pages/sdncc/sec-mgr-plane/Applications/index'));
const SecurityServices = lazy(() => import('./pages/sdncc/sec-mgr-plane/SecurityServices/index'));
const AccessRolesPage = lazy(() => import('./pages/settings/Roles/Index'));
const AccessUsersPage = lazy(() => import('./pages/settings/Users/Index'));
const CreateServiceChainWizard = lazy(() => import('./pages/sdncc/traffic/ServiceChains/CreateWizard'));
const CsmPoolsPage = lazy(() => import('./pages/sdncc/traffic/CsmPools/CsmPoolsPage'));
const CsmPoolDetailPage = lazy(() =>
  import('./pages/sdncc/traffic/CsmPools/CloudDetailCsm').then((m) => ({ default: m.CsmPoolDetailPage })),
);
const CloudConsolePage = lazy(() => import('./pages/cnmc/console/CloudConsole'));
const HarvesterVNCPage = lazy(() => import('./pages/cnmc/clouds/Harvester/HarvesterVNC'));
const OrgManagePage = lazy(() => import('./pages/tenants/sections/OrgManageWorkspace'));
const VmCreateWizardModal = lazy(() => import('./pages/cnmc/clouds/Harvester/ecs/modals/VmCreateWizardModal'));
const AiSocPlaceholder = lazy(() => import('./pages/cnsoc/AiSocPlaceholder'));
const AiSocFrame = lazy(() => import('./pages/cnsoc/AiSocFrame'));
const AdminWelcomePage = lazy(() => import('./pages/cnmc/onboarding/AdminWelcomePage'));

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

const AppRoutes: React.FC = () => {
  const location = useLocation();
  const background = (location.state as any)?.backgroundLocation;
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Routes location={background || location}>
        <Route path="/login" element={<Login />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/" element={<Navigate to="/admin" replace />} />
        <Route path="/clouds/:id/instances/create" element={<PrivateRoute><VmCreateWizardModal /></PrivateRoute>} />

        {/* Admin area */}
        <Route path={TENANT_CLOUD_CONSOLE_PATH} element={<AdminRoute><TenantConsoleLayout /></AdminRoute>}>
          <Route index element={<CloudConsolePage />} />
        </Route>

        <Route path="/admin" element={<AdminRoute><AdminLayout /></AdminRoute>}>
          <Route index element={<AdminHomeGate />} />
          <Route path="welcome" element={<AdminWelcomePage />} />
          <Route path="dashboard" element={<OverviewDashboard />} />
          <Route path="clouds" element={<Clouds />} />
          <Route path="clouds/vendor/huawei/:id" element={<HuaweiPoolShell />} />
          <Route path="clouds/vendor/aliyun/:id" element={<AliyunPoolShell />} />
          <Route path="clouds/vendor/rancher/:id" element={<RancherPoolVendorShell />} />
          <Route path="clouds/vendor/csm/:id" element={<CsmPoolRouteShell />} />
          <Route path="clouds/:poolId/clusters/:clusterId" element={<RancherClusterWorkspace />} />
          <Route path="clouds/:id/harvester/vnc" element={<HarvesterVNCPage />} />
          <Route path="clouds/:id/*" element={<CloudmapPoolShell />} />
          <Route path="clouds/ecs" element={<Navigate to={TENANT_CLOUD_CONSOLE_PATH} replace />} />
          <Route path="clouds/console" element={<Navigate to={TENANT_CLOUD_CONSOLE_PATH} replace />} />
          <Route path="tenants" element={<Tenants />} />
          <Route path="tenants/:tenantId/organizations" element={<OrgManagePage />} />
          
          <Route path="tenants/users" element={<Users />} />
          <Route path="interconnect/srv6" element={<SRv6Page />} />
          <Route path="interconnect/srv6/create" element={<SRv6CreatePage />} />
          <Route path="interconnect/ipsec" element={<IPsecVPNPage />} />
          <Route path="interconnect/ipsec/create" element={<IPsecVPNWizard />} />
          <Route path="interconnect/ipsec/:id/edit" element={<IPsecVPNWizard />} />
          <Route path="interconnect/vr" element={<VRPage />} />
          <Route path="interconnect/vr/add" element={<AddVRInstance />} />
          <Route path="interconnect/vr/:uuid/config" element={<EditVRConfig />} />
          <Route path="interconnect/vr/:uuid/role-pe" element={<PEWizard />} />
          <Route path="interconnect/vr/:uuid/role-ce" element={<CEWizard />} />
          <Route path="interconnect/vr/:uuid/role-standard" element={<StandardWizard />} />
          <Route path="interconnect/vr/:uuid/role-sase" element={<SASEWizard />} />
          <Route path="interconnect/acl" element={<ACLPage />} />
          <Route path="interconnect/nat" element={<NATPage />} />
          <Route path="sec-mgr-plane/security-domain" element={<SecurityDomainPage />} />
          <Route
            path="sec-mgr-plane/security-domain/new"
            element={<Navigate to="/admin/sec-mgr-plane/security-domain" replace />}
          />
          <Route path="sec-mgr-plane/security-domain/:id" element={<SecurityDomainDetail />} />
          <Route path="sec-mgr-plane/cascade-channels" element={<CENPage />} />
          <Route path="sec-mgr-plane/cascade-channels/:id" element={<CENDetailPage />} />
          <Route path="sec-mgr-plane/apps" element={<SecurityApps />} />
          <Route path="sec-mgr-plane/security-services" element={<SecurityServices />} />
          {/* AI SOC Integration Placeholders */}
          <Route path="aisoc/situation/overview" element={<AiSocPlaceholder title="AI SOC总览" module="situation_overview" />} />
          <Route path="aisoc/data-source" element={<AiSocFrame path="data-source" />} />
          <Route path="aisoc/raw-logs" element={<AiSocFrame path="raw-logs" />} />
          <Route path="aisoc/preprocess-rule" element={<AiSocFrame path="preprocess-rule" />} />
          <Route path="aisoc/processed-logs" element={<AiSocFrame path="processed-logs" />} />
          
          <Route path="aisoc/analysis/events" element={<AiSocPlaceholder title="威胁事件分析" module="analysis_events" />} />
          <Route path="aisoc/analysis/attack" element={<AiSocPlaceholder title="ATT&CK框架分析" module="analysis_attack" />} />
          
          <Route path="aisoc/report" element={<AiSocFrame path="report" />} />

          <Route path="settings" element={<Navigate to="settings/general" replace />} />
          <Route path="settings/general" element={<GeneralSettings />} />
          <Route path="settings/audit-logs" element={<AuditLogs />} />
          <Route path="settings/advanced" element={<AdvancedSettings />} />

          <Route path="settings/offline-upgrade" element={<OfflineUpgradeSettings />} />
          <Route path="settings/license" element={<LicenseSettingsPage />} />
          
          <Route path="coming-soon" element={<ComingSoon />} />
          <Route path="access/actions" element={<Navigate to="/admin/access/roles" replace />} />
          <Route path="access/roles" element={<AccessRolesPage />} />
          <Route path="access/users" element={<AccessUsersPage />} />
          
          {/* SSLO Traffic Orchestration */}
          <Route path="security/traffic/csm-pools" element={<CsmPoolsPage />} />
          <Route
            path="security/traffic/csm-pools/protected-objects"
            element={<Navigate to="/admin/security/traffic/csm-pools" replace />}
          />
          <Route
            path="security/traffic/csm-pools/:cloudId/service-chains/create"
            element={<CreateServiceChainWizard />}
          />
          <Route path="security/traffic/csm-pools/:cloudId" element={<CsmPoolDetailPage />} />
          <Route
            path="security/traffic/protected-objects"
            element={<Navigate to="/admin/security/traffic/csm-pools" replace />}
          />
          <Route
            path="security/traffic/service-chains"
            element={<Navigate to="/admin/security/traffic/csm-pools" replace />}
          />
          <Route
            path="security/traffic/service-chains/create"
            element={<Navigate to="/admin/security/traffic/csm-pools" replace />}
          />
          <Route
            path="security/traffic/policies"
            element={<Navigate to="/admin/security/traffic/csm-pools" replace />}
          />

          {/* other admin routes ... reuse components */}
        </Route>
        {routeSpecs.filter(s => s.layout === 'default').map(s => {
          const elements: Record<string, JSX.Element> = {
            InstanceWizard: <VmCreateWizardModal />,
            CloudConsolePage: <CloudConsolePage />,
            HarvesterVNCPage: <HarvesterVNCPage />,
          };
          const el = elements[s.element];
          const wrapped = s.guard === 'private' ? (<PrivateRoute>{el}</PrivateRoute>) : el;
          return <Route key={s.id} path={s.path} element={wrapped} />;
        })}
      </Routes>
      {background && (
        <Routes>
          {routeSpecs.filter(s => s.backgroundCapable).map(s => {
            const modalElements: Record<string, JSX.Element> = {
              InstanceWizardModal: <VmCreateWizardModal />,
            };
            const modal = s.modalElement ? modalElements[s.modalElement] : null;
            if (!modal) return null;
            return <Route key={`${s.id}.modal`} path={s.path} element={modal} />;
          })}
        </Routes>
      )}
    </Suspense>
  );
};

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
      <LicenseProvider>
        <Router future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
          <AppRoutes />
        </Router>
      </LicenseProvider>
    </ConfigProvider>
  );
};

const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <SettingsProvider>
          <AppContent />
        </SettingsProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
};

export default App;
