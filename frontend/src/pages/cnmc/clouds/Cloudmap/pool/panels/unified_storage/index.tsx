/**
 * Cloudmap 池 — 集群 · 存储服务（`cluster/harvester_addon` 等）；对象/RGW 仍独立侧栏。
 */
import React, { useEffect, useMemo } from 'react';
import { Empty } from 'antd';
import { canViewClusterStorageInner } from '../../lib/clusterPageAccess';
import UnifiedStorageConfigHubSection from '../../../../Harvester/ceph/sections/UnifiedStorageConfigHubSection';
import {
  legacyStorageConfigOperateTab,
  parseStorageConfigFlatTabKey,
} from '../../../../Harvester/ceph/sections/unifiedStorageConfig/unifiedStorageConfigUiConstants';
import { isStorageConfigInnerSeg } from '../../../../Harvester/ceph/lib/storageResourcesNav';
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

function canViewUnifiedStorageInner(key: string, checkPerm: (act: string) => boolean): boolean {
  return canViewClusterStorageInner(key, checkPerm);
}

const CloudmapUnifiedStorageRoutePanel: React.FC<CloudmapUnifiedStorageRoutePanelProps> = ({
  cloudId,
  checkPerm,
  innerActiveKey,
  loadTabResource,
}) => {
  const section = innerActiveKey;

  useEffect(() => {
    if (!canViewUnifiedStorageInner(section, checkPerm)) return;
    if (
      isStorageConfigInnerSeg(section) ||
      section === 'overview' ||
      section === 'rbd_mirror' ||
      section === 'storage_pools'
    ) {
      void loadTabResource('harvester_addon', false);
      return;
    }
    void loadTabResource(section, false);
  }, [checkPerm, cloudId, loadTabResource, section]);

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

  if (!canViewUnifiedStorageInner(section, checkPerm)) {
    return <Empty description="无权限访问" style={{ marginTop: 48 }} />;
  }

  switch (section) {
    case 'harvester_addon':
    case 'overview':
    case 'rbd_mirror':
    case 'storage_pools': {
      const legacyTab = legacyStorageConfigOperateTab(section);
      const initialOperateTab =
        legacyTab ??
        (parseStorageConfigFlatTabKey(section) ? section : undefined);
      return (
        <UnifiedStorageConfigHubSection
          cloudId={cloudId}
          checkPerm={checkPerm}
          loadTabResource={loadTabResource}
          onRefreshAddon={cephTabOnRefresh.harvester_addon}
          onRefreshPools={cephTabOnRefresh.storage_pools}
          onRefreshRbdMirror={cephTabOnRefresh.rbd_mirror}
          onDeployed={() => void loadTabResource('storage_pools', true, true)}
          initialOperateTab={initialOperateTab}
        />
      );
    }
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
