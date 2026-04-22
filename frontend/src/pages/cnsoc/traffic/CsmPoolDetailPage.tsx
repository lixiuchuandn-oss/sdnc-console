import React from 'react';
import { useParams } from 'react-router-dom';
import CloudDetailCsm from '../../cnmc/clouds/Csm/CloudDetailCsm';

/**
 * SDN / 流量编排 — CSM 资源池详情（路由归属流量编排，不复用 `/admin/clouds/:id`）。
 */
const CsmPoolDetailPage: React.FC = () => {
  const { cloudId } = useParams();
  if (!cloudId) return null;
  return (
    <CloudDetailCsm
      cloudId={decodeURIComponent(cloudId)}
      backListPath="/admin/security/traffic/csm-pools"
      backListLabel="CSM 安全资源池"
    />
  );
};

export default CsmPoolDetailPage;
