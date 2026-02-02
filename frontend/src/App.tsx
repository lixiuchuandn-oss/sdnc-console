import 'antd/dist/reset.css';
import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { getDefaultAdminPath } from './utils/accessMapping';
import { ConfigProvider, Modal } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import Login from './pages/Auth/Login';
import AdminLogin from './pages/Auth/AdminLogin';
import AdminLayout from './layouts/AdminLayout';
import Dashboard from './pages/Dashboard';
import Users from './pages/Tenants/Users';
import Clouds from './pages/Clouds';
import CloudDetail from './pages/Clouds/CloudDetail';
import InstanceDetail from './pages/Clouds/InstanceDetail';
import Tenants from './pages/Tenants';
import { AuthProvider } from './contexts/AuthContext';
import AdminRoute from './components/AdminRoute';
import PrivateRoute from './components/PrivateRoute';
import Settings from './pages/Settings/index';
import Alarms from './pages/Alarms/index';
import SRv6Page from './pages/InterConnect/SRv6/index';
import SRv6CreatePage from './pages/InterConnect/SRv6/Create';
import IPsecVPNPage from './pages/InterConnect/IPsecVPN/index';
import IPsecVPNWizard from './pages/InterConnect/IPsecVPN/IPsecVPNWizard';
import VRPage from './pages/InterConnect/VR/index';
import AddVRInstance from './pages/InterConnect/VR/AddVRInstance';
import EditVRConfig from './pages/InterConnect/VR/EditVRConfig';
import PEWizard from './pages/InterConnect/VR/PEWizard';
import CEWizard from './pages/InterConnect/VR/CEWizard';
import StandardWizard from './pages/InterConnect/VR/StandardWizard';
import SASEWizard from './pages/InterConnect/VR/SASEWizard';
import ACLPage from './pages/InterConnect/ACL/index';
import NATPage from './pages/InterConnect/NAT/index';
import SecurityDomainPage from './pages/SecMgrPlane/SecurityDomain/index';
import SecurityDomainWizardPage from './pages/SecMgrPlane/SecurityDomain/Wizard';
import SecurityDomainDetail from './pages/SecMgrPlane/SecurityDomain/Detail';
import CENPage from './pages/SecMgrPlane/CascadeChannels/index';
import CENDetailPage from './pages/SecMgrPlane/CascadeChannels/Detail';
import ComingSoon from './pages/ComingSoon';
import SecurityApps from './pages/SecMgrPlane/Applications/index';
import SecurityServices from './pages/SecMgrPlane/SecurityServices/index';
import AccessPoliciesPage from './pages/Access/Policies/index';
import AccessRolesPage from './pages/Access/Roles/index';
import AccessActionsPage from './pages/Access/Actions/index';
import AccessUsersPage from './pages/Access/Users/index';
import ProtectedObjects from './pages/Security/TrafficOrchestration/ProtectedObjects';
import ServiceChains from './pages/Security/TrafficOrchestration/ServiceChains';
import CreateServiceChainWizard from './pages/Security/TrafficOrchestration/ServiceChains/CreateWizard';
import Policies from './pages/Security/TrafficOrchestration/Policies';
import WebSSHPage from './pages/Clouds/WebSSH';
import CloudConsolePage from './pages/Clouds/Console/CloudConsole';
import HarvesterVNCPage from './pages/Clouds/Harvester/HarvesterVNC';
import TenantLeasedLinesPage from './pages/Tenants/LeasedLines';
import OrgManagePage from './pages/Tenants/OrgManage';
import ApiDocs from './pages/ApiDocs';
import { routeSpecs } from './routes/RouteSpec';
import VmCreateWizardModal from './pages/Clouds/Harvester/modals/VmCreateWizardModal';
import AiSocPlaceholder from './pages/SecOps/AiSocPlaceholder';
import AiSocFrame from './pages/SecOps/AiSocFrame';


  

const InstanceDetailModal: React.FC = () => {
  const navigate = useNavigate();
  return (
    <Modal
      title="云主机详情"
      open
      destroyOnClose
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
    <>
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
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="clouds" element={<Clouds />} />
          <Route path="clouds/:id" element={<CloudDetail />} />
          
          <Route path="clouds/:id/webssh" element={<WebSSHPage />} />
          <Route path="clouds/:id/harvester/vnc" element={<HarvesterVNCPage />} />
          <Route path="clouds/ecs" element={<Navigate to="/admin/clouds/console" replace />} />
          <Route path="clouds/console" element={<CloudConsolePage />} />
          <Route path="tenants" element={<Tenants />} />
          <Route path="tenants/:tenantId/organizations" element={<OrgManagePage />} />
          
          {/* Moved to AI SOC -> Report Management */}
          <Route path="aisoc/leased-lines" element={<TenantLeasedLinesPage />} />
          <Route path="aisoc/leased-lines/list" element={<TenantLeasedLinesPage />} />
          <Route path="aisoc/leased-lines/tasks" element={<TenantLeasedLinesPage />} />
          <Route path="aisoc/leased-lines/logs" element={<TenantLeasedLinesPage />} />

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
          <Route path="alarms" element={<Alarms />} />
          <Route path="api-docs" element={<ApiDocs />} />
          {/* AI SOC Integration Placeholders */}
          <Route path="aisoc/situation/overview" element={<AiSocPlaceholder title="AI SOC总览" module="situation_overview" />} />
          <Route path="aisoc/data-source" element={<AiSocFrame path="data-source" />} />
          <Route path="aisoc/raw-logs" element={<AiSocFrame path="raw-logs" />} />
          <Route path="aisoc/preprocess-rule" element={<AiSocFrame path="preprocess-rule" />} />
          <Route path="aisoc/processed-logs" element={<AiSocFrame path="processed-logs" />} />
          
          <Route path="aisoc/analysis/events" element={<AiSocPlaceholder title="威胁事件分析" module="analysis_events" />} />
          <Route path="aisoc/analysis/attack" element={<AiSocPlaceholder title="ATT&CK框架分析" module="analysis_attack" />} />
          
          <Route path="aisoc/report" element={<AiSocFrame path="report" />} />

          <Route path="settings" element={<Settings />} />
          <Route path="coming-soon" element={<ComingSoon />} />
          <Route path="access/policies" element={<AccessPoliciesPage />} />
          <Route path="access/actions" element={<AccessActionsPage />} />
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
    </>
  );
};

const AdminIndex: React.FC = () => {
  const { user, loading } = useAuth();
  const perms = Array.isArray(user?.permissions) ? user!.permissions! : [];
  if (loading || !user) return <></>;
  const role = String(user.role || '').toLowerCase();
  const target = (role === 'super_admin' || role === 'admin') ? '/admin/dashboard' : getDefaultAdminPath(perms);
  return <Navigate to={target} replace />;
};

  const App: React.FC = () => {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#1677ff',
          borderRadius: 6,
        },
      }}
    >
      <AuthProvider>
        <Router>
          <AppRoutes />
        </Router>
      </AuthProvider>
    </ConfigProvider>
  );
};

export default App;
