import React from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getRequiredActionForPath, hasPermissionForAction } from '../utils/accessMapping';
import { Spin } from 'antd';
import { fetchAdminDefaultHomeFromApi } from '../utils/adminHome';
import {
  canAccessAdminPath,
  findFirstAccessibleAdminPath,
  normalizeAdminPath,
} from '../utils/adminAccessFallback';
import { isTenantAccount, resolveTenantConsolePath } from '../utils/accountType';

interface AdminRouteProps {
  children: React.ReactNode;
}

const AdminRoute: React.FC<AdminRouteProps> = ({ children }) => {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [accessResolveState, setAccessResolveState] = React.useState<'ok' | 'resolving' | 'denied'>('ok');
  const redirectOnceRef = React.useRef<string | null>(null);

  const canAccessPath = (p: string): boolean => {
    if (!user) return false;
    const pure = String(p || '').split('?')[0];
    const role = String(user.role || '').toLowerCase();
    if (role === 'super_admin') return true;
    if (pure === '/admin/welcome' && role === 'admin') return true;
    const act = getRequiredActionForPath(pure);
    const perms = Array.isArray(user.permissions) ? user.permissions : [];
    return hasPermissionForAction(perms, act);
  };

  const currentPath = normalizeAdminPath(location.pathname);
  const pathAccessible = user
    ? canAccessAdminPath(location.pathname + location.search, user)
    : false;

  React.useEffect(() => {
    redirectOnceRef.current = null;
  }, [currentPath]);

  React.useEffect(() => {
    if (loading || !user) {
      setAccessResolveState('ok');
      return;
    }
    if (pathAccessible) {
      setAccessResolveState('ok');
      return;
    }
    if (redirectOnceRef.current === currentPath) {
      setAccessResolveState('denied');
      return;
    }

    let cancelled = false;
    setAccessResolveState('resolving');

    void (async () => {
      let target: string | null = null;
      try {
        const home = await fetchAdminDefaultHomeFromApi();
        const apiPath = normalizeAdminPath(home?.defaultPath || '');
        if (apiPath && apiPath !== currentPath && canAccessAdminPath(apiPath, user)) {
          target = apiPath;
        }
      } catch {
        // ignore and use local fallback
      }

      if (!target) {
        const local = normalizeAdminPath(findFirstAccessibleAdminPath(user));
        if (local && local !== currentPath && canAccessAdminPath(local, user)) {
          target = local;
        }
      }

      if (cancelled) return;
      if (target && normalizeAdminPath(target) !== currentPath) {
        redirectOnceRef.current = currentPath;
        navigate(target, { replace: true });
        return;
      }

      redirectOnceRef.current = currentPath;
      setAccessResolveState('denied');
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, user, pathAccessible, currentPath, navigate]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/admin/login" replace />;
  }

  if (isTenantAccount(user)) {
    return <Navigate to={resolveTenantConsolePath()} replace />;
  }

  if (!pathAccessible && accessResolveState === 'resolving') {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" tip="正在跳转到可访问的页面…" />
      </div>
    );
  }

  if (!canAccessPath(location.pathname + location.search) && accessResolveState === 'denied') {
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
        <div style={{ fontSize: 18, color: '#595959' }}>当前账号没有访问该页面的权限</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12 }}>
          <button
            style={{
              padding: '6px 12px',
              border: '1px solid #d9d9d9',
              borderRadius: 6,
              background: '#fff',
              cursor: 'pointer',
            }}
            onClick={() => navigate('/admin')}
          >
            返回首页
          </button>
          <button
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

export default AdminRoute;
