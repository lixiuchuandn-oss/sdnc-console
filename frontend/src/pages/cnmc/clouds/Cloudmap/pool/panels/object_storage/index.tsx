import React from 'react';
import { Empty } from 'antd';
import { CLOUD_CEPH_READ } from '../../../../../../../constants/cloudPermissions';
import CephObjectStorageSection from '../../../../Harvester/ceph/sections/CephObjectStorageSection';
import RgwObjectStoreUsersSection from '../../../../Harvester/ceph/sections/RgwObjectStoreUsersSection';
import RgwS3BucketsSection from '../../../../Harvester/ceph/sections/RgwS3BucketsSection';

export type CloudmapObjectStorageRoutePanelProps = {
  cloudId: string;
  checkPerm: (act: string) => boolean;
  innerActiveKey: string;
};

function canViewObjectStorageInner(key: string, checkPerm: (a: string) => boolean): boolean {
  const ok =
    checkPerm(CLOUD_CEPH_READ) ||
    checkPerm('clouds.disks:read') ||
    checkPerm('clouds.cluster-nodes:read') ||
    checkPerm('clouds:read');
  if (!ok) return false;
  return (
    key === 'rgw_s3_buckets' ||
    key === 'rgw_users' ||
    key === 'object_gateways' ||
    key === 'cosi'
  );
}

/**
 * Cloudmap 池 — 对象存储：`object_storage/*`；网关/COSI 自拉 bundle。
 * 布局与各区块样式对齐云存储「虚拟云盘」等池内一级页（`PageDetailSection` + `std-table`）。
 */
const CloudmapObjectStorageRoutePanel: React.FC<CloudmapObjectStorageRoutePanelProps> = ({
  cloudId,
  checkPerm,
  innerActiveKey,
}) => {
  if (!canViewObjectStorageInner(innerActiveKey, checkPerm)) {
    return <Empty description="无权限访问" style={{ marginTop: 48 }} />;
  }

  switch (innerActiveKey) {
    case 'rgw_s3_buckets':
      return <RgwS3BucketsSection cloudId={cloudId} checkPerm={checkPerm} />;
    case 'rgw_users':
      return <RgwObjectStoreUsersSection cloudId={cloudId} checkPerm={checkPerm} />;
    case 'object_gateways':
      return <CephObjectStorageSection cloudId={cloudId} embedMode="storesOnly" checkPerm={checkPerm} />;
    case 'cosi':
      return <CephObjectStorageSection cloudId={cloudId} embedMode="cosiOnly" />;
    default:
      return <Empty description="未知页面" style={{ marginTop: 48 }} />;
  }
};

export default CloudmapObjectStorageRoutePanel;
