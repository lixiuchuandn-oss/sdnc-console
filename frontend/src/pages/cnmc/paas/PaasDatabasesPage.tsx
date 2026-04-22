/**
 * 旧路径 `/admin/paas/databases`：云数据库已并入 Cloudmap 资源池详情一级 Tab（`?tab=paas_databases`）。
 * 保留路由以便书签/外链，进入后重定向到首个 Cloudmap 池（无则回资源池列表）。
 */
import React, { useEffect } from 'react';
import { Spin } from 'antd';
import { useNavigate } from 'react-router-dom';
import { isCloudmapPool } from '../../../layouts/admin/cloudPoolSidebar';
import type { Cloud } from '../pools/poolProviders';
import { fetchClouds } from '../../../services/api';

const PaasDatabasesPage: React.FC = () => {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await fetchClouds();
        const list = Array.isArray(raw) ? raw : (raw as any)?.data || [];
        const arr = Array.isArray(list) ? list : [];
        const cm = arr.filter((c) => isCloudmapPool(c as Cloud));
        if (cancelled) return;
        const id = cm[0]?.id ? String(cm[0].id) : '';
        if (id) {
          navigate(
            `/admin/clouds/${encodeURIComponent(id)}?tab=paas_databases`,
            { replace: true },
          );
        } else {
          navigate('/admin/clouds', { replace: true });
        }
      } catch {
        if (!cancelled) navigate('/admin/clouds', { replace: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: 240,
      }}
    >
      <Spin tip="正在打开云数据库…" />
    </div>
  );
};

export default PaasDatabasesPage;
