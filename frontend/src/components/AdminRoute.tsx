import React from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLicense } from '../contexts/LicenseContext';
import { getRequiredActionForPath, hasPermissionForAction } from '../utils/accessMapping';
import { Spin } from 'antd';
import { routeSpecs } from '../routes/RouteSpec';

interface AdminRouteProps {
  children: React.ReactNode;
}

const AdminRoute: React.FC<AdminRouteProps> = ({ children }) => {
  const { user, loading, logout } = useAuth();
  const { hasFeature } = useLicense();
  const navigate = useNavigate();
  const location = useLocation();

  

  const canAccessPath = (p: string): boolean => {
    if (!user) return false;
    const pure = String(p || '').split('?')[0];
    const role = String(user.role || '').toLowerCase();
    if (role === 'super_admin' || role === 'admin') return true;
    const act = getRequiredActionForPath(pure);
    const perms = Array.isArray(user.permissions) ? user.permissions : [];
    return hasPermissionForAction(perms, act);
  };

  if (loading) {
    return (
      <div style={{ display:'flex',justifyContent:'center',alignItems:'center',height:'100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/admin/login" replace />;
  }

  const currentSpec = (() => {
    const p = String(location.pathname || '');
    const found = routeSpecs.find((r) => {
      if (r.path === p) return true;
      if (r.path.includes(':')) {
        const base = r.path.split(':')[0];
        return p.startsWith(base);
      }
      return false;
    });
    return found;
  })();

  if (currentSpec?.requiredFeature && !hasFeature(currentSpec.requiredFeature)) {
    return (
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100vh', gap:16 }}>
        <div style={{ fontSize:18, color:'#595959' }}>当前授权未包含该功能</div>
        <div style={{ display:'flex', gap:12 }}>
          <button style={{ padding:'6px 12px', border:'1px solid #d9d9d9', borderRadius:6, background:'#fff', cursor:'pointer' }} onClick={()=> navigate('/admin/settings/license')}>查看授权</button>
          <button style={{ padding:'6px 12px', border:'1px solid #d9d9d9', borderRadius:6, background:'#fff', cursor:'pointer' }} onClick={logout}>退出登录</button>
        </div>
      </div>
    );
  }

  

  if (!canAccessPath(location.pathname + location.search)) {
    return (
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100vh', gap:16 }}>
        <div style={{ fontSize:18, color:'#595959' }}>当前账号没有访问该页面的权限</div>
        <div style={{ display:'flex', gap:12 }}>
          <button style={{ padding:'6px 12px', border:'1px solid #d9d9d9', borderRadius:6, background:'#fff', cursor:'pointer' }} onClick={()=> navigate('/admin/clouds')}>返回资源池</button>
          <button style={{ padding:'6px 12px', border:'1px solid #d9d9d9', borderRadius:6, background:'#fff', cursor:'pointer' }} onClick={logout}>退出登录</button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default AdminRoute;
