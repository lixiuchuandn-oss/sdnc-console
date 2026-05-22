/**
 * CNMC：`admin/clouds/vendor/csm/:id` → 流量编排控制台 CSM 池详情路径。
 */
import React from 'react';
import { Navigate, useParams } from 'react-router-dom';

const CsmPoolRouteShell: React.FC = () => {
  const { id } = useParams();
  if (!id) return null;
  return <Navigate replace to={`/admin/security/traffic/csm-pools/${encodeURIComponent(id)}`} />;
};

export default CsmPoolRouteShell;
