import 'antd/dist/reset.css';
import React, { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { getDefaultAdminPath, hasPermissionForAction } from './utils/accessMapping';
import { ConfigProvider, Modal, theme as antdTheme, Spin } from 'antd';
import ErrorBoundary from './components/ErrorBoundary';
import { AuthProvider } from './contexts/AuthContext';
import { LicenseProvider, useLicense } from './contexts/LicenseContext';
import { SettingsProvider, useSettings } from './contexts/SettingsContext';
import AdminRoute from './components/AdminRoute';
import PrivateRoute from './components/PrivateRoute';
import { routeSpecs } from './routes/RouteSpec';
import { getSystemSetting } from './services/systemApi';

// ????????????????????
import Login from './pages/Auth/Login';
import AdminLogin from './pages/Auth/AdminLogin';
import AdminLayout from './layouts/AdminLayout';

// ?????????
const OverviewDashboard = lazy(() => import('./pages/Dashboard/OverviewDashboard'));
const Users = lazy(() => import('./pages/Tenants/Users'));
const Clouds = lazy(() => import('./pages/Clouds'));
const CloudDetailGate = lazy(() => import('./pages/Clouds/CloudDetailGate'));
const InstanceDetail = lazy(() => import('./pages/Clouds/InstanceDetail'));
const Tenants = lazy(() => import('./pages/Tenants'));
const GeneralSettings = lazy(() => import('./pages/Settings/GeneralSettings'));
const AuditLogs = lazy(() => import('./pages/Settings/AuditLogs'));
const AdvancedSettings = lazy(() => import('./pages/Settings/AdvancedSettings'));

const LicenseSettingsPage = lazy(() => import('./pages/Settings/LicenseSettings'));
const SRv6Page = lazy(() => import('./pages/InterConnect/SRv6/index'));
const SRv6CreatePage = lazy(() => import('./pages/InterConnect/SRv6/Create'));
const IPsecVPNPage = lazy(() => import('./pages/InterConnect/IPsecVPN/index'));
const IPsecVPNWizard = lazy(() => import('./pages/InterConnect/IPsecVPN/IPsecVPNWizard'));
const VRPage = lazy(() => import('./pages/InterConnect/VR/index'));
const AddVRInstance = lazy(() => import('./pages/InterConnect/VR/AddVRInstance'));
const EditVRConfig = lazy(() => import('./pages/InterConnect/VR/EditVRConfig'));
const PEWizard = lazy(() => import('./pages/InterConnect/VR/PEWizard'));
const CEWizard = lazy(() => import('./pages/InterConnect/VR/CEWizard'));
const StandardWizard = lazy(() => import('./pages/InterConnect/VR/StandardWizard'));
const SASEWizard = lazy(() => import('./pages/InterConnect/VR/SASEWizard'));
const ACLPage = lazy(() => import('./pages/InterConnect/ACL/index'));
const NATPage = lazy(() => import('./pages/InterConnect/NAT/index'));
const SecurityDomainPage = lazy(() => import('./pages/SecMgrPlane/SecurityDomain/index'));
const SecurityDomainWizardPage = lazy(() => import('./pages/SecMgrPlane/SecurityDomain/Wizard'));
const SecurityDomainDetail = lazy(() => import('./pages/SecMgrPlane/SecurityDomain/Detail'));
const CENPage = lazy(() => import('./pages/SecMgrPlane/CascadeChannels/index'));
const CENDetailPage = lazy(() => import('./pages/SecMgrPlane/CascadeChannels/Detail'));
const ComingSoon = lazy(() => import('./pages/ComingSoon'));
const SecurityApps = lazy(() => import('./pages/SecMgrPlane/Applications/index'));
const SecurityServices = lazy(() => import('./pages/SecMgrPlane/SecurityServices/index'));
const AccessRolesPage = lazy(() => import('./pages/Settings/Roles/Index'));
const AccessUsersPage = lazy(() => import('./pages/Settings/Users/Index'));
const ProtectedObjects = lazy(() => import('./pages/Security/TrafficOrchestration/ProtectedObjects'));
const ServiceChains = lazy(() => import('./pages/Security/TrafficOrchestration/ServiceChains'));
const CreateServiceChainWizard = lazy(() => import('./pages/Security/TrafficOrchestration/ServiceChains/CreateWizard'));
const Policies = lazy(() => import('./pages/Security/TrafficOrchestration/Policies'));
const WebSSHPage = lazy(() => import('./pages/Clouds/WebSSH'));
const CloudConsolePage = lazy(() => import('./pages/Clouds/Console/CloudConsole'));
const HarvesterVNCPage = lazy(() => import('./pages/Clouds/Harvester/HarvesterVNC'));
const OrgManagePage = lazy(() => import('./pages/Tenants/OrgManage'));
const VmCreateWizardModal = lazy(() => import('./pages/Clouds/Harvester/modals/VmCreateWizardModal'));
const AiSocPlaceholder = lazy(() => import('./pages/SecOps/AiSocPlaceholder'));
const AiSocFrame = lazy(() => import('./pages/SecOps/AiSocFrame'));

// ?????
const LoadingFallback: React.FC = () => (
  <div style={{ 
    display: 'flex', 
    justifyContent: 'center', 
    alignItems: 'center', 
    minHeight: '400px',
    width: '100%'
  }}>
    <Spin size="large" tip="???...">
      <div style={{ minHeight: 200 }} />
    </Spin>
  </div>
);

const InstanceDetailModal: React.FC = () => {
  const navigate = useNavigate();
  return (
    <Modal
      title="?????"
      open
      destroyOnHidden
      footer={null}
      width={'75vw'}
      centered={false}
      style={{ top: '10vh' }}
      styles={{ body: { height: '80vh', maxHeight: '80vh', overflowY: 'auto', padding: 0 } }}
      onCancel={() => navigate(-1)}
    >
      <InstanceDetail />
    </Modal>
  );
};

const AppRoutes: React.FC = () => {
  const location = useLocation();
  const background = (location.state as any)?.backgroundLocation;
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Routes location={background || location}>
        <Route path="/login" element={<Login />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/" element={<Navigate to="/admin" replace />} />
        <Route path="/admin/clouds/:id/instances/:instanceId" element={<InstanceDetail />} />
        <Route path="/clouds/:id/instances/:instanceId" element={<InstanceDetail />} />
        <Route path="/clouds/:id/instances/create" element={<PrivateRoute><VmCreateWizardModal /></PrivateRoute>} />

        {/* Admin area */}
        <Route path="/admin" element={<AdminRoute><AdminLayout /></AdminRoute>}>
          <Route index element={<AdminIndex />} />
          <Route path="dashboard" element={<OverviewDashboard />} />
          <Route path="clouds" element={<Clouds />} />
          <Route path="clouds/:id" element={<CloudDetailGate />} />
          
          <Route path="clouds/:id/webssh" element={<WebSSHPage />} />
          <Route path="clouds/:id/harvester/vnc" element={<HarvesterVNCPage />} />
          <Route path="clouds/ecs" element={<Navigate to="/admin/clouds/console" replace />} />
          <Route path="clouds/console" element={<CloudConsolePage />} />
          <Route path="tenants" element={<Tenants />} />
          <Route path="tenants/:tenantId/organizations" element={<OrgManagePage />} />
          
          {/* ???????????? AISOC ?????????? */}

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
          <Route path="sec-mgr-plane/security-domain/new" element={<SecurityDomainWizardPage />} />
          <Route path="sec-mgr-plane/security-domain/:id" element={<SecurityDomainDetail />} />
          <Route path="sec-mgr-plane/cascade-channels" element={<CENPage />} />
          <Route path="sec-mgr-plane/cascade-channels/:id" element={<CENDetailPage />} />
          <Route path="sec-mgr-plane/apps" element={<SecurityApps />} />
          <Route path="sec-mgr-plane/security-services" element={<SecurityServices />} />
          {/* AI SOC Integration Placeholders */}
          <Route path="aisoc/situation/overview" element={<AiSocPlaceholder title="AI SOC??" module="situation_overview" />} />
          <Route path="aisoc/data-source" element={<AiSocFrame path="data-source" />} />
          <Route path="aisoc/raw-logs" element={<AiSocFrame path="raw-logs" />} />
          <Route path="aisoc/preprocess-rule" element={<AiSocFrame path="preprocess-rule" />} />
          <Route path="aisoc/processed-logs" element={<AiSocFrame path="processed-logs" />} />
          
          <Route path="aisoc/analysis/events" element={<AiSocPlaceholder title="??????" module="analysis_events" />} />
          <Route path="aisoc/analysis/attack" element={<AiSocPlaceholder title="ATT&CK????" module="analysis_attack" />} />
          
          <Route path="aisoc/report" element={<AiSocFrame path="report" />} />

          <Route path="settings" element={<Navigate to="settings/general" replace />} />
          <Route path="settings/general" element={<GeneralSettings />} />
          <Route path="settings/audit-logs" element={<AuditLogs />} />
          <Route path="settings/advanced" element={<AdvancedSettings />} />

          <Route path="settings/license" element={<LicenseSettingsPage />} />
          
          <Route path="coming-soon" element={<ComingSoon />} />
          <Route path="access/actions" element={<Navigate to="/admin/access/roles" replace />} />
          <Route path="access/roles" element={<AccessRolesPage />} />
          <Route path="access/users" element={<AccessUsersPage />} />
          
          {/* SSLO Traffic Orchestration */}
          <Route path="security/traffic/protected-objects" element={<ProtectedObjects />} />
          <Route path="security/traffic/service-chains" element={<ServiceChains />} />
          <Route path="security/traffic/service-chains/create" element={<CreateServiceChainWizard />} />
          <Route path="security/traffic/policies" element={<Policies />} />

          {/* other admin routes ... reuse components */}
        </Route>
        {routeSpecs.filter(s => s.layout === 'default').map(s => {
          const elements: Record<string, JSX.Element> = {
            InstanceWizard: <VmCreateWizardModal />,
            InstanceDetail: <InstanceDetail />,
            CloudConsolePage: <CloudConsolePage />,
            WebSSHPage: <WebSSHPage />,
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
              InstanceDetailModal: <InstanceDetailModal />,
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

const AdminIndex: React.FC = () => {
  const { user, loading } = useAuth();
  const { hasFeature } = useLicense();
  const perms = Array.isArray(user?.permissions) ? user!.permissions! : [];
  const role = String(user?.role || '').toLowerCase();
  const isAdmin = role === 'super_admin' || role === 'admin';
  const [favoriteCloudId, setFavoriteCloudId] = useState<string>('');
  const [favoriteReady, setFavoriteReady] = useState(false);

  useEffect(() => {
    if (!user) return;
    if (!isAdmin) {
      setFavoriteCloudId('');
      setFavoriteReady(true);
      return;
    }
    setFavoriteReady(false);
    (async () => {
      try {
        const fav = await getSystemSetting('favorite.cloudId');
        setFavoriteCloudId(String(fav?.value || '').trim());
      } catch {
        setFavoriteCloudId('');
      } finally {
        setFavoriteReady(true);
      }
    })();
  }, [user, isAdmin]);

  if (loading || !user || (isAdmin && !favoriteReady)) return <></>;
  // ???? favorite cloud???????????
  if (isAdmin && favoriteCloudId) {
    // ???????????????
    const canAccessClouds = hasPermissionForAction(perms, 'clouds:read') || 
                            hasPermissionForAction(perms, 'clouds.console:read');
    if (canAccessClouds) {
      return <Navigate to={`/admin/clouds/${favoriteCloudId}`} replace />;
    }
  }
  // ???????? getDefaultAdminPath??? admin ???????? requiredFeature
  const target = getDefaultAdminPath(perms, hasFeature);
  return <Navigate to={target} replace />;
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
