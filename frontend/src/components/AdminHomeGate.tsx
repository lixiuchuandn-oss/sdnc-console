import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Spin } from 'antd';
import { useAuth } from '../contexts/AuthContext';
import { fetchAdminDefaultHomeFromApi, isSystemAdminRole } from '../utils/adminHome';

/**
 * `/admin` 索引路由：默认落地页**仅**由 `GET /api/auth/admin-default-home`（后端 `resolveAdminDefaultHome`）决定。
 */
const AdminHomeGate: React.FC = () => {
  const { user, loading } = useAuth();
  const [targetPath, setTargetPath] = useState<string | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);

  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;
    setTargetPath(null);
    setFetchFailed(false);
    (async () => {
      try {
        const data = await fetchAdminDefaultHomeFromApi();
        const p = String(data?.defaultPath || '').trim();
        if (!cancelled) {
          setTargetPath(p || '/admin/coming-soon');
        }
      } catch {
        if (!cancelled) {
          setFetchFailed(true);
          setTargetPath('/admin/coming-soon');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, user]);

  if (loading || !user || targetPath === null) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
          width: '100%',
        }}
      >
        <Spin size="large" tip={isSystemAdminRole(String(user?.role || '')) ? '正在解析默认页…' : '加载中…'} />
      </div>
    );
  }

  try {
    if (typeof window !== 'undefined' && window.localStorage?.getItem('tower.debugHome') === '1') {
      // eslint-disable-next-line no-console
      console.info('[tower.debugHome] AdminHomeGate', {
        role: user?.role,
        targetPath,
        fetchFailed,
      });
    }
  } catch {
    /* ignore */
  }

  return <Navigate to={targetPath} replace />;
};

export default AdminHomeGate;
