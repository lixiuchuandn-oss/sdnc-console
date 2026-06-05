/**
 * 集群 · 存储配置（Cloudmap `cluster/harvester_addon`）。
 * 扁平 Tab：存储概览 · 配置详情 · 存储池 · … · RBD Mirror（单权限 `clouds.storage-addon:read`）
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Form, Tabs } from 'antd';
import { useSearchParams } from 'react-router-dom';
import PageDetailSection from 'components/PageDetailSection';
import { canReadStorageConfigPage } from 'constants/unifiedStoragePermissions';
import type { HarvesterSectionOnRefresh } from '../lib/cephSectionRefresh';
import { useHarvesterAddonSectionData } from '../hooks/useHarvesterAddonSectionData';
import { useStorageDrsData } from '../../cluster/hooks/useStorageDrsData';
import type { HarvesterAddonFormValues } from '../hooks/harvesterAddonFormTypes';
import CloudmapStorageDashboardByBackend from '../../../Cloudmap/pool/panels/resource_hub/CloudmapStorageDashboardByBackend';
import CloudmapStorageCephRbdMirror from '../../../Cloudmap/pool/panels/storage/CloudmapStorageCephRbdMirror';
import CephHarvesterAddonSection from './CephHarvesterAddonSection';
import AddonStatusOverview from './harvesterAddon/AddonStatusOverview';
import type { HarvesterAddonOperateTabKey } from './harvesterAddon/addonUiConstants';
import {
  isStorageConfigAddonTabKey,
  resolveStorageConfigFlatTab,
  STORAGE_CONFIG_TAB_LOAD_KEY,
  type StorageConfigFlatTabKey,
} from './unifiedStorageConfig/unifiedStorageConfigUiConstants';

export type UnifiedStorageConfigHubSectionProps = {
  cloudId: string;
  checkPerm: (act: string) => boolean;
  loadTabResource: (key: string, force?: boolean, skipSync?: boolean) => void | Promise<void>;
  onRefreshAddon?: HarvesterSectionOnRefresh;
  onRefreshPools?: HarvesterSectionOnRefresh;
  onRefreshRbdMirror?: HarvesterSectionOnRefresh;
  onDeployed?: () => void;
  initialOperateTab?: string;
};

const UnifiedStorageConfigHubSection: React.FC<UnifiedStorageConfigHubSectionProps> = ({
  cloudId,
  checkPerm,
  loadTabResource,
  onRefreshAddon,
  onRefreshPools,
  onRefreshRbdMirror,
  onDeployed,
  initialOperateTab,
}) => {
  const canRead = canReadStorageConfigPage(checkPerm);

  const [placeholderForm] = Form.useForm<HarvesterAddonFormValues>();
  const { status, statusLoading, isRunningCluster } = useHarvesterAddonSectionData({
    cloudId,
    form: placeholderForm,
    onRefresh: onRefreshAddon,
    onDeployed,
  });

  const { overview: sdrsOverview } = useStorageDrsData(cloudId, canRead && isRunningCluster);
  const sdrsTaskCount = sdrsOverview?.tasksRecent?.length ?? 0;

  const [searchParams] = useSearchParams();
  const operateTabFromQuery = searchParams.get('operateTab');
  const [activeTabKey, setActiveTabKey] = useState<StorageConfigFlatTabKey>(() =>
    resolveStorageConfigFlatTab(initialOperateTab ?? operateTabFromQuery),
  );

  useEffect(() => {
    setActiveTabKey(resolveStorageConfigFlatTab(initialOperateTab ?? operateTabFromQuery));
  }, [cloudId, initialOperateTab, operateTabFromQuery]);

  const tabMeta = useMemo((): { key: StorageConfigFlatTabKey; label: string }[] => {
    const items: { key: StorageConfigFlatTabKey; label: string }[] = [
      { key: 'overview', label: '存储概览' },
    ];
    if (isRunningCluster) {
      items.push(
        { key: 'config', label: '配置详情' },
        { key: 'storage_pools', label: '存储池' },
        { key: 'expand', label: '扩容存储' },
        { key: 'storage_network', label: '变更存储网' },
        { key: 'sdrs_policy', label: 'SDRS 策略' },
        { key: 'sdrs_tasks', label: `任务日志 (${sdrsTaskCount})` },
      );
    }
    items.push({ key: 'rbd_mirror', label: 'RBD Mirror' });
    return items;
  }, [isRunningCluster, sdrsTaskCount]);

  useEffect(() => {
    if (!tabMeta.some((item) => item.key === activeTabKey)) {
      setActiveTabKey(tabMeta[0]?.key ?? 'overview');
    }
  }, [activeTabKey, tabMeta]);

  useEffect(() => {
    const loadKey = STORAGE_CONFIG_TAB_LOAD_KEY[activeTabKey];
    if (!loadKey) return;
    void loadTabResource(loadKey, false);
  }, [activeTabKey, cloudId, loadTabResource]);

  const tabContent = (key: StorageConfigFlatTabKey): React.ReactNode => {
    if (key === 'overview') {
      return <CloudmapStorageDashboardByBackend cloudId={cloudId} />;
    }
    if (key === 'rbd_mirror') {
      return <CloudmapStorageCephRbdMirror cloudId={cloudId} onRefresh={onRefreshRbdMirror} />;
    }
    if (isStorageConfigAddonTabKey(key)) {
      return (
        <CephHarvesterAddonSection
          cloudId={cloudId}
          checkPerm={checkPerm}
          embedInHub
          flatMode
          onRefresh={onRefreshAddon}
          poolsOnRefresh={onRefreshPools}
          onDeployed={onDeployed}
          initialOperateTab={key as HarvesterAddonOperateTabKey}
        />
      );
    }
    return null;
  };

  if (!canRead) {
    return (
      <PageDetailSection contentPadding={16}>
        <Alert type="warning" showIcon message="无权限查看存储配置" />
      </PageDetailSection>
    );
  }

  return (
    <PageDetailSection contentPadding={16} autoStyleInputs={false}>
      <AddonStatusOverview
        status={status}
        loading={statusLoading}
        isRunningCluster={isRunningCluster}
      />
      <Tabs
        activeKey={activeTabKey}
        onChange={(key) => setActiveTabKey(key as StorageConfigFlatTabKey)}
        items={tabMeta.map(({ key, label }) => ({
          key,
          label,
          children: tabContent(key),
        }))}
      />
      {!isRunningCluster ? (
        <div style={{ marginTop: 16 }}>
          <CephHarvesterAddonSection
            cloudId={cloudId}
            checkPerm={checkPerm}
            embedInHub
            wizardOnly
            onRefresh={onRefreshAddon}
            onDeployed={onDeployed}
          />
        </div>
      ) : null}
    </PageDetailSection>
  );
};

export default UnifiedStorageConfigHubSection;
