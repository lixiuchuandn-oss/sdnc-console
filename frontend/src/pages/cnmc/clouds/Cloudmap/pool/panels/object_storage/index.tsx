/**
 * Cloudmap 池 — 对象存储：`object_storage/*`；列表 Section 自拉 Rook/S3，池层注入 `cephTabOnRefresh`。
 */
import React, { useEffect, useMemo } from 'react';
import { Empty } from 'antd';
import { canViewClusterStorageInner } from '../../lib/clusterPageAccess';
import CephObjectStorageSection from '../../../../Harvester/ceph/sections/CephObjectStorageSection';
import RgwObjectStoreUsersSection from '../../../../Harvester/ceph/sections/RgwObjectStoreUsersSection';
import RgwS3BucketsSection from '../../../../Harvester/ceph/sections/RgwS3BucketsSection';
import { createCephTabOnRefresh } from '../../loaders/cephRefresh';

export type CloudmapObjectStorageRoutePanelProps = {
  cloudId: string;
  checkPerm: (act: string) => boolean;
  innerActiveKey: string;
  loadTabResource: (
    key: string,
    force?: boolean,
    skipSync?: boolean,
  ) => void | Promise<void>;
};

function canViewObjectStorageInner(key: string, checkPerm: (a: string) => boolean): boolean {
  return (
    key === 'rgw_s3_buckets' ||
    key === 'rgw_users' ||
    key === 'object_gateways' ||
    key === 'cosi'
  ) && canViewClusterStorageInner(key, checkPerm);
}

const CloudmapObjectStorageRoutePanel: React.FC<CloudmapObjectStorageRoutePanelProps> = ({
  cloudId,
  checkPerm,
  innerActiveKey,
  loadTabResource,
}) => {
  useEffect(() => {
    if (!canViewObjectStorageInner(innerActiveKey, checkPerm)) return;
    void loadTabResource(innerActiveKey, false);
  }, [checkPerm, cloudId, innerActiveKey, loadTabResource]);

  const cephTabOnRefresh = useMemo(() => {
    const deps = { loadTabResource };
    return {
      rgw_s3_buckets: createCephTabOnRefresh('rgw_s3_buckets', deps),
      rgw_users: createCephTabOnRefresh('rgw_users', deps),
      object_gateways: createCephTabOnRefresh('object_gateways', deps),
      cosi: createCephTabOnRefresh('cosi', deps),
    };
  }, [loadTabResource]);

  if (!canViewObjectStorageInner(innerActiveKey, checkPerm)) {
    return <Empty description="无权限访问" style={{ marginTop: 48 }} />;
  }

  switch (innerActiveKey) {
    case 'rgw_s3_buckets':
      return (
        <RgwS3BucketsSection
          cloudId={cloudId}
          checkPerm={checkPerm}
          onRefresh={cephTabOnRefresh.rgw_s3_buckets}
        />
      );
    case 'rgw_users':
      return (
        <RgwObjectStoreUsersSection
          cloudId={cloudId}
          checkPerm={checkPerm}
          onRefresh={cephTabOnRefresh.rgw_users}
        />
      );
    case 'object_gateways':
      return (
        <CephObjectStorageSection
          cloudId={cloudId}
          embedMode="storesOnly"
          checkPerm={checkPerm}
          onRefresh={cephTabOnRefresh.object_gateways}
        />
      );
    case 'cosi':
      return (
        <CephObjectStorageSection
          cloudId={cloudId}
          embedMode="cosiOnly"
          onRefresh={cephTabOnRefresh.cosi}
        />
      );
    default:
      return <Empty description="未知页面" style={{ marginTop: 48 }} />;
  }
};

export default CloudmapObjectStorageRoutePanel;
