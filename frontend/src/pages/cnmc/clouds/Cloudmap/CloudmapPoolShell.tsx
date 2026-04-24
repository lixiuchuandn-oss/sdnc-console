/**
 * Cloudmap 池：根目录仅保留本入口（供 `CloudDetailGate` 引用）。
 * 标准分层见 `pool/index.ts` 注释。
 */
import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import {
  cloudmapClusterSegmentQueryToPath,
  cloudmapLegacyClusterThreeSegmentToTwo,
  cloudmapLegacyQueryToPath,
  cloudmapPoolBasePath,
  cloudmapStripObsoletePoolQuery,
} from '../../../../layouts/admin/cloudmap/cloudPoolSidebar';
import { PoolDetailPage } from './pool';

/**
 * Cloudmap 池路径入口：旧 query 重定向、池根 → 默认子路径，再渲染详情。
 */
const CloudmapPoolShell: React.FC<{ cloudId: string }> = ({ cloudId }) => {
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

export default CloudmapPoolShell;
