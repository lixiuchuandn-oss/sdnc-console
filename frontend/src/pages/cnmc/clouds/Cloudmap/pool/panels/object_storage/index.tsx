import React from 'react';
import { Empty } from 'antd';
import CephObjectStorageSection from '../../../../Harvester/ceph/sections/CephObjectStorageSection';
import CephPoolSection from '../../../../Harvester/ceph/sections/CephPoolSection';

export type CloudmapObjectStorageGroupTabsProps = {
  cloudId: string;
  checkPerm: (act: string) => boolean;
  innerActiveKey: string;
};

function canViewObjectStorageInner(key: string, checkPerm: (a: string) => boolean): boolean {
  const ok =
    checkPerm('clouds.disks:read') ||
    checkPerm('clouds.cluster-nodes:read') ||
    checkPerm('clouds:read');
  if (!ok) return false;
  return key === 'object_gateways' || key === 'cosi' || key === 'storage_pools';
}

/**
 * Cloudmap 池 — 对象存储：`object_storage/*`；网关/COSI 自拉 bundle，「存储池」经 mgr Dashboard 筛 `rgw` 应用。
 */
const CloudmapObjectStorageGroupTabs: React.FC<CloudmapObjectStorageGroupTabsProps> = ({
  cloudId,
  checkPerm,
  innerActiveKey,
}) => {
  if (!canViewObjectStorageInner(innerActiveKey, checkPerm)) {
    return (
      <div className="cloudmap-object-storage-pane">
        <Empty description="无权限访问" style={{ marginTop: 48 }} />
      </div>
    );
  }

  let body: React.ReactNode;
  switch (innerActiveKey) {
    case 'object_gateways':
      body = <CephObjectStorageSection cloudId={cloudId} embedMode="storesOnly" />;
      break;
    case 'cosi':
      body = <CephObjectStorageSection cloudId={cloudId} embedMode="cosiOnly" />;
      break;
    case 'storage_pools':
      body = <CephPoolSection cloudId={cloudId} applicationsScope="object" />;
      break;
    default:
      body = <Empty description="未知页面" style={{ marginTop: 48 }} />;
  }

  return <div className="cloudmap-object-storage-pane">{body}</div>;
};

export default CloudmapObjectStorageGroupTabs;
