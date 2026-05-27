/**
 * Cloudmap 池 — 集群 · 存储服务（`cluster/overview` 等）；聚合存储容量、存储池、RBD Mirror 与对象/RGW 能力。
 */
import React, { useEffect, useMemo } from 'react';
import { Empty } from 'antd';
import { CLOUD_CEPH_READ } from '../../../../../../../constants/cloudPermissions';
import CloudmapStorageDashboardByBackend from '../resource_hub/CloudmapStorageDashboardByBackend';
import CephPoolSection from '../../../../Harvester/ceph/sections/CephPoolSection';
import CephHarvesterAddonSection from '../../../../Harvester/ceph/sections/CephHarvesterAddonSection';
import CloudmapStorageCephRbdMirror from '../storage/CloudmapStorageCephRbdMirror';
import CephObjectStorageSection from '../../../../Harvester/ceph/sections/CephObjectStorageSection';
import RgwObjectStoreUsersSection from '../../../../Harvester/ceph/sections/RgwObjectStoreUsersSection';
import RgwS3BucketsSection from '../../../../Harvester/ceph/sections/RgwS3BucketsSection';
import { createCephTabOnRefresh } from '../../loaders/cephRefresh';

export type CloudmapUnifiedStorageRoutePanelProps = {
  cloudId: string;
  checkPerm: (act: string) => boolean;
  innerActiveKey: string;
  loadTabResource: (
    key: string,
    force?: boolean,
    skipSync?: boolean,
  ) => void | Promise<void>;
};

function cephishPerm(checkPerm: (act: string) => boolean): boolean {
  return (
    checkPerm(CLOUD_CEPH_READ) ||
    checkPerm('clouds.disks:read') ||
    checkPerm('clouds.cluster-nodes:read') ||
    checkPerm('clouds:read')
  );
}

function canViewUnifiedStorageInner(key: string, checkPerm: (act: string) => boolean): boolean {
  if (!cephishPerm(checkPerm)) return false;
  return (
    key === 'overview' ||
    key === 'harvester_addon' ||
    key === 'storage_pools' ||
    key === 'rbd_mirror' ||
    key === 'rgw_s3_buckets' ||
    key === 'rgw_users' ||
    key === 'object_gateways' ||
    key === 'cosi'
  );
}

const CloudmapUnifiedStorageRoutePanel: React.FC<CloudmapUnifiedStorageRoutePanelProps> = ({
  cloudId,
  checkPerm,
  innerActiveKey,
  loadTabResource,
}) => {
  useEffect(() => {
    if (!canViewUnifiedStorageInner(innerActiveKey, checkPerm)) return;
    void loadTabResource(innerActiveKey, false);
  }, [checkPerm, cloudId, innerActiveKey, loadTabResource]);

  const cephTabOnRefresh = useMemo(() => {
    const deps = { loadTabResource };
    return {
      overview: createCephTabOnRefresh('overview', deps),
      harvester_addon: createCephTabOnRefresh('harvester_addon', deps),
      storage_pools: createCephTabOnRefresh('storage_pools', deps),
      rbd_mirror: createCephTabOnRefresh('rbd_mirror', deps),
      rgw_s3_buckets: createCephTabOnRefresh('rgw_s3_buckets', deps),
      rgw_users: createCephTabOnRefresh('rgw_users', deps),
      object_gateways: createCephTabOnRefresh('object_gateways', deps),
      cosi: createCephTabOnRefresh('cosi', deps),
    };
  }, [loadTabResource]);

  if (!canViewUnifiedStorageInner(innerActiveKey, checkPerm)) {
    return <Empty description="无权限访问" style={{ marginTop: 48 }} />;
  }

  switch (innerActiveKey) {
    case 'overview':
      return <CloudmapStorageDashboardByBackend cloudId={cloudId} />;
    case 'harvester_addon':
      return (
        <CephHarvesterAddonSection
          cloudId={cloudId}
          onRefresh={cephTabOnRefresh.harvester_addon}
          onDeployed={() => void loadTabResource('storage_pools', true, true)}
        />
      );
    case 'storage_pools':
      return (
        <CephPoolSection
          cloudId={cloudId}
          applicationsScope="cloud"
          onRefresh={cephTabOnRefresh.storage_pools}
        />
      );
    case 'rbd_mirror':
      return (
        <CloudmapStorageCephRbdMirror
          cloudId={cloudId}
          onRefresh={cephTabOnRefresh.rbd_mirror}
        />
      );
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

export default CloudmapUnifiedStorageRoutePanel;
