import React from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button, Space, Spin } from 'antd';
import { useAuth } from '../contexts/AuthContext';
import { canAccessTenantConsole, isTenantAccount } from '../utils/accountType';

interface TenantConsoleRouteProps {
  children: React.ReactNode;
}

/** 租户云资源控制台路由守卫：/console 仅 tenant 账号类型可进入 */
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
        <Space wrap>
          {!isTenantAccount(user) && (
            <Button onClick={() => navigate('/admin')}>返回管理后台</Button>
          )}
          <Button onClick={logout}>退出登录</Button>
        </Space>
      </div>
    );
  }

  return <>{children}</>;
};

export default TenantConsoleRoute;
