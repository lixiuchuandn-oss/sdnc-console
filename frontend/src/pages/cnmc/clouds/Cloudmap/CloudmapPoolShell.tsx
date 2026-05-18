/**
 * Cloudmap 池：`App` 中 `admin/clouds/:id/*` 的直接挂载组件。
 * 标准分层见 `pool/index.ts` 注释。
 */
import React from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import {
  cloudmapClusterSegmentQueryToPath,
  cloudmapLegacyClusterThreeSegmentToTwo,
  cloudmapLegacyQueryToPath,
  cloudmapPoolBasePath,
  cloudmapStripObsoletePoolQuery,
} from '../../../../layouts/admin/cloudmap/cloudPoolSidebar';
import { PoolDetailPage } from './pool';

type CloudmapPoolShellBodyProps = { cloudId: string };

/**
 * Cloudmap 池路径入口：旧 query 重定向、池根 → 默认子路径，再渲染详情。
 */
const CloudmapPoolShellBody: React.FC<CloudmapPoolShellBodyProps> = ({ cloudId }) => {
  const location = useLocation();
  const base = cloudmapPoolBasePath(cloudId);

  const legacy = cloudmapLegacyQueryToPath(cloudId, location.pathname, location.search);
  if (legacy) {
    return <Navigate to={legacy} replace />;
  }

  const clusterThreeToTwo = cloudmapLegacyClusterThreeSegmentToTwo(
    cloudId,
    location.pathname,
    location.search,
  );
  if (clusterThreeToTwo) {
    return <Navigate to={clusterThreeToTwo} replace />;
  }

  const clusterSegPromoted = cloudmapClusterSegmentQueryToPath(
    cloudId,
    location.pathname,
    location.search,
  );
  if (clusterSegPromoted) {
    return <Navigate to={clusterSegPromoted} replace />;
  }

  const stripped = cloudmapStripObsoletePoolQuery(cloudId, location.pathname, location.search);
  if (stripped) {
    return <Navigate to={stripped} replace />;
  }

  if (location.pathname === base) {
    return <Navigate to={`${base}/resource_hub/overview`} replace />;
  }

  return <PoolDetailPage cloudId={cloudId} />;
};

/**
 * 从路由 `clouds/:id/*` 读取池 id；换池时 `key` 重置子树状态。
 */
const CloudmapPoolShell: React.FC = () => {
  const { id } = useParams();
  if (!id) return null;
  return <CloudmapPoolShellBody key={id} cloudId={id} />;
};

export default CloudmapPoolShell;
