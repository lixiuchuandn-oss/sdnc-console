/**
 * Cloudmap 详情 — 云数据库：侧栏路径驱动（当前仅实例列表）。
 */
import React from 'react';
import { Empty } from 'antd';
import { PaasSection } from '../../../../Harvester/cloud-database';

export type CloudmapCloudDatabaseTabsProps = {
  cloudId: string;
  innerActiveKey: string;

  ecs: any[];
  ecsLoading: boolean;
  onRefreshVms: () => void | Promise<void>;
  onForceRefreshVms: () => void | Promise<void>;

  harvesterImages: any[];
  harvesterStorageClasses: any[];
  kubeOvnSubnets: any[];
  harvesterNads: any[];
  onReloadImages?: () => void | Promise<void>;
  onReloadSubnets?: () => void | Promise<void>;
  onReloadNads?: () => void | Promise<void>;
  onReloadStorageClasses?: () => void | Promise<void>;

  isTenant: boolean;
  namespacesOptions?: string[];
  /** 与 `runPoolEssentials` 中 capabilities 一致，供 RDS 创建时匹配 machine.type */
  capabilities?: any;
};

const CloudmapCloudDatabaseTabs: React.FC<CloudmapCloudDatabaseTabsProps> = ({
  cloudId,
  innerActiveKey,
  ecs,
  ecsLoading,
  onRefreshVms,
  onForceRefreshVms,
  harvesterImages,
  harvesterStorageClasses,
  kubeOvnSubnets,
  harvesterNads,
  onReloadImages,
  onReloadSubnets,
  onReloadNads,
  onReloadStorageClasses,
  isTenant,
  namespacesOptions = [],
  capabilities,
}) => {
  if (innerActiveKey === 'rds') {
    return (
      <PaasSection
        vms={ecs}
        loading={ecsLoading}
        cloudId={cloudId}
        onRefresh={onRefreshVms}
        onForceRefresh={onForceRefreshVms}
        images={harvesterImages}
        storageClasses={harvesterStorageClasses}
        kubeSubnets={kubeOvnSubnets}
        harvesterNads={harvesterNads}
        onReloadImages={onReloadImages}
        onReloadSubnets={onReloadSubnets}
        onReloadNads={onReloadNads}
        onReloadStorageClasses={onReloadStorageClasses}
        isTenant={isTenant}
        namespacesOptions={namespacesOptions}
        clusterCapabilities={capabilities}
      />
    );
  }
  return <Empty description="未知页面" style={{ marginTop: 48 }} />;
};

export default CloudmapCloudDatabaseTabs;
