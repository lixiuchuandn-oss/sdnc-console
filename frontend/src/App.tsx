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
import Topology from './pages/Topology';
import Tenants from './pages/Tenants';
import { AuthProvider } from './contexts/AuthContext';
import AdminRoute from './components/AdminRoute';
import PrivateRoute from './components/PrivateRoute';
import Settings from './pages/Settings/index';
import Alarms from './pages/Alarms/index';
import SRv6Page from './pages/InterConnect/SRv6/index';
import SRv6CreatePage from './pages/InterConnect/SRv6/Create';
import VRPage from './pages/InterConnect/VR/index';
import AddVRInstance from './pages/InterConnect/VR/AddVRInstance';
import EditVRConfig from './pages/InterConnect/VR/EditVRConfig';
import RoleWizard from './pages/InterConnect/VR/RoleWizard';
import InfoDomainPage from './pages/SecMgrPlane/InfoDomain/index';
import InfoDomainWizardPage from './pages/SecMgrPlane/InfoDomain/Wizard';
import CENPage from './pages/SecMgrPlane/SmpInstance/index';
import ComingSoon from './pages/ComingSoon';
import SecurityApps from './pages/SecMgrPlane/Applications/index';
import AccessPoliciesPage from './pages/Access/Policies/index';
import AccessRolesPage from './pages/Access/Roles/index';
import AccessActionsPage from './pages/Access/Actions/index';
import AccessUsersPage from './pages/Access/Users/index';
import WebSSHPage from './pages/Clouds/WebSSH';
import CloudConsolePage from './pages/Clouds/CloudConsole';
import HarvesterVNCPage from './pages/Clouds/Harvester/HarvesterVNC';
import TenantLeasedLinesPage from './pages/Tenants/LeasedLines';
import { routeSpecs } from './routes/RouteSpec';
import VmCreateWizardModal from './pages/Clouds/Harvester/modals/VmCreateWizardModal';

  

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
      bodyStyle={{ height: '80vh', maxHeight: '80vh', overflowY: 'auto', padding: 0 }}
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
          <Route path="tenants/leased-lines" element={<TenantLeasedLinesPage />} />
          <Route path="tenants/leased-lines/list" element={<TenantLeasedLinesPage />} />
          <Route path="tenants/leased-lines/tasks" element={<TenantLeasedLinesPage />} />
          <Route path="tenants/leased-lines/logs" element={<TenantLeasedLinesPage />} />
          <Route path="tenants/users" element={<Users />} />
          <Route path="topology" element={<Topology />} />
          <Route path="interconnect/srv6" element={<SRv6Page />} />
          <Route path="interconnect/srv6/create" element={<SRv6CreatePage />} />
          <Route path="interconnect/vr" element={<VRPage />} />
          <Route path="interconnect/vr/add" element={<AddVRInstance />} />
          <Route path="interconnect/vr/:uuid/config" element={<EditVRConfig />} />
          <Route path="interconnect/vr/:uuid/role" element={<RoleWizard />} />
          <Route path="sec-mgr-plane/info-domain" element={<InfoDomainPage />} />
          <Route path="sec-mgr-plane/info-domain/new" element={<InfoDomainWizardPage />} />
          <Route path="sec-mgr-plane/instances" element={<CENPage />} />
          <Route path="alarms" element={<Alarms />} />
          <Route path="settings" element={<Settings />} />
          <Route path="coming-soon" element={<ComingSoon />} />
          <Route path="sec-mgr-plane/apps" element={<SecurityApps />} />
          <Route path="access/policies" element={<AccessPoliciesPage />} />
          <Route path="access/actions" element={<AccessActionsPage />} />
          <Route path="access/roles" element={<AccessRolesPage />} />
          <Route path="access/users" element={<AccessUsersPage />} />
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
          <Route path="/admin/clouds/:id/instances/:instanceId" element={<InstanceDetailModal />} />
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
