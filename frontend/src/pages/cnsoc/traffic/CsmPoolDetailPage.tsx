import React from 'react';
import { useParams } from 'react-router-dom';
import CloudDetailCsm from '../../cnmc/clouds/Csm/CloudDetailCsm';
import { routeSpecs } from '../../../routes/RouteSpec';

const trafficCsmPoolsListSpec = routeSpecs.find((s) => s.id === 'traffic-csm-pools');

/**
 * SDN / 流量编排 — CSM 资源池详情（路由归属流量编排，不复用 `/admin/clouds/:id`）。
 */
const CsmPoolDetailPage: React.FC = () => {
  const { cloudId } = useParams();
  if (!cloudId) return null;
  const listPath = trafficCsmPoolsListSpec?.path ?? '/admin/security/traffic/csm-pools';
  const listLabel =
    trafficCsmPoolsListSpec?.breadcrumbLabel || trafficCsmPoolsListSpec?.title || '安全资源池';
  return (
    <CloudDetailCsm
      cloudId={decodeURIComponent(cloudId)}
      backListPath={listPath}
      backListLabel={listLabel}
    />
  );
};

export default CsmPoolDetailPage;
