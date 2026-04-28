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
    // 只有 super_admin 才跳过权限检查，admin 也需要检查权限（与后端保持一致）
    if (role === 'super_admin') return true;
    // 系统管理员工作台开荒页：不依赖 RBAC 原子权限组合，避免三权等账号无 license 读权限时被挡在管理端外
    if (pure === '/admin/welcome' && role === 'admin') return true;
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
    const needMultiCloudForPools = currentSpec.requiredFeature === 'platform.multi-cloud';
    const canOpenPoolList = hasFeature('platform.multi-cloud');
    return (
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100vh', gap:16 }}>
        <div style={{ fontSize:18, color:'#595959' }}>当前授权未包含该功能</div>
        {needMultiCloudForPools && !canOpenPoolList && (
          <div style={{ fontSize:14, color:'#8c8c8c', maxWidth:420, textAlign:'center' }}>
            默认授权不含多云管理；资源池完整列表与运维能力需开通「多云管理」授权。未开通时可使用顶栏「可用区」进入已绑定池内总览（需控制台读权限）。
          </div>
        )}
        <div style={{ display:'flex', flexWrap:'wrap', justifyContent:'center', gap:12 }}>
          {canOpenPoolList && (
            <button style={{ padding:'6px 12px', border:'1px solid #d9d9d9', borderRadius:6, background:'#fff', cursor:'pointer' }} onClick={()=> navigate('/admin/clouds')}>进入资源池管理</button>
          )}
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
        <div style={{ display:'flex', flexWrap:'wrap', justifyContent:'center', gap:12 }}>
          {hasFeature('platform.multi-cloud') && (
            <button style={{ padding:'6px 12px', border:'1px solid #d9d9d9', borderRadius:6, background:'#fff', cursor:'pointer' }} onClick={()=> navigate('/admin/clouds')}>返回资源池</button>
          )}
          <button style={{ padding:'6px 12px', border:'1px solid #d9d9d9', borderRadius:6, background:'#fff', cursor:'pointer' }} onClick={logout}>退出登录</button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default AdminRoute;
