import React from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Spin } from 'antd';
import { useAuth } from '../contexts/AuthContext';
import { canAccessTenantConsole, isTenantAccount } from '../utils/accountType';

interface TenantConsoleRouteProps {
  children: React.ReactNode;
}

/**
 * 租户云资源控制台路由守卫：入口按账号类型（tenant）或系统侧 clouds.console 权限放行，
 * 不再依赖 AdminRoute 对 clouds.console:read 的统一路径映射。
 */
const TenantConsoleRoute: React.FC<TenantConsoleRouteProps> = ({ children }) => {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!canAccessTenantConsole(user)) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          gap: 16,
        }}
      >
        <div style={{ fontSize: 18, color: '#595959' }}>当前账号无权访问租户控制台</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12 }}>
          {!isTenantAccount(user) && (
            <button
              type="button"
              style={{
                padding: '6px 12px',
                border: '1px solid #d9d9d9',
                borderRadius: 6,
                background: '#fff',
                cursor: 'pointer',
              }}
              onClick={() => navigate('/admin')}
            >
              返回管理后台
            </button>
          )}
          <button
            type="button"
            style={{
              padding: '6px 12px',
              border: '1px solid #d9d9d9',
              borderRadius: 6,
              background: '#fff',
              cursor: 'pointer',
            }}
            onClick={logout}
          >
            退出登录
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default TenantConsoleRoute;
