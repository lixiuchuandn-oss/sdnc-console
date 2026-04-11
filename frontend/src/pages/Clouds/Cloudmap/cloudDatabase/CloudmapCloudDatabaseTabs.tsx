/**
 * Cloudmap 详情页 —「云数据库」分组（实例列表 + 数据备份等子 Tab）。
 * 从 CloudDetailCloudmap 拆出，减轻主文件体积；数据与刷新仍由父组件持有。
 */
import React from 'react';
import { Tabs } from 'antd';
import { PaasSection, PaasBackupsSection } from '../../Harvester/paas';

export type CloudmapCloudDatabaseTabsProps = {
  cloudId: string;
  onTabChange: (key: string) => void;
  showBackupsTab: boolean;

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

  harvesterBackups: any[];
  harvesterScheduleVmBackups: any[];
  backupsLoading: boolean;
  scheduleVmBackupsLoading: boolean;
  harvesterNamespaces: any[];
  onRefreshBackups: () => void | Promise<void>;

  isTenant: boolean;
  mode: 'standard' | 'ops';
  namespacesOptions?: string[];
};

const CloudmapCloudDatabaseTabs: React.FC<CloudmapCloudDatabaseTabsProps> = ({
  cloudId,
  onTabChange,
  showBackupsTab,
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
  harvesterBackups,
  harvesterScheduleVmBackups,
  backupsLoading,
  scheduleVmBackupsLoading,
  harvesterNamespaces,
  onRefreshBackups,
  isTenant,
  mode,
  namespacesOptions = [],
}) => (
  <Tabs
    type="line"
    destroyOnHidden
    defaultActiveKey="rds"
    onChange={onTabChange}
    items={[
      {
        key: 'rds',
        label: '云数据库实例',
        children: (
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
            mode={mode}
            namespacesOptions={namespacesOptions}
          />
        ),
      },
      ...(showBackupsTab
        ? [
            {
              key: 'rds_data_backups',
              label: '数据备份',
              children: (
                <PaasBackupsSection
                  cloudId={cloudId}
                  vms={ecs}
                  backups={harvesterBackups}
                  scheduleVmBackups={harvesterScheduleVmBackups}
                  backupsLoading={backupsLoading}
                  scheduleLoading={scheduleVmBackupsLoading}
                  namespaces={harvesterNamespaces}
                  onRefresh={onRefreshBackups}
                  onInnerTabChange={onTabChange}
                  isTenant={isTenant}
                  mode={mode}
                />
              ),
            },
          ]
        : []),
    ]}
  />
);

export default CloudmapCloudDatabaseTabs;
