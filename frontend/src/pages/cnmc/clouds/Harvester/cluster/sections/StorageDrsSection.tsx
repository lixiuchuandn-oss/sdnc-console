/**
 * 集群 · 存储 DRS（SDRS）— 已并入「统一存储配置」页内 Tab；本 Section 保留供历史路由重定向前的兼容引用。
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Tabs } from 'antd';
import PageDetailSection from 'components/PageDetailSection';
import {
  CLOUD_STORAGE_ADDON_READ,
  CLOUD_STORAGE_ADDON_WRITE,
  LEGACY_CLOUD_STORAGE_DRS_READ,
  LEGACY_CLOUD_STORAGE_DRS_WRITE,
} from 'constants/unifiedStoragePermissions';
import { useStorageDrsData } from '../hooks/useStorageDrsData';
import StorageDrsPolicyPanel from './storageDrs/StorageDrsPolicyPanel';
import StorageDrsTasksPanel from './storageDrs/StorageDrsTasksPanel';

export type StorageDrsSectionProps = {
  cloudId: string;
  checkPerm: (act: string) => boolean;
};

const StorageDrsSection: React.FC<StorageDrsSectionProps> = ({ cloudId, checkPerm }) => {
  const canRead =
    checkPerm(CLOUD_STORAGE_ADDON_READ) ||
    checkPerm(LEGACY_CLOUD_STORAGE_DRS_READ) ||
    checkPerm('clouds.unified-storage:read');
  const canWrite =
    checkPerm(CLOUD_STORAGE_ADDON_WRITE) ||
    checkPerm(LEGACY_CLOUD_STORAGE_DRS_WRITE) ||
    checkPerm('clouds.unified-storage:write');

  const { loading, overview, error, reload } = useStorageDrsData(cloudId, canRead);
  const [activeTab, setActiveTab] = useState('policy');

  const tasks = useMemo(() => overview?.tasksRecent ?? [], [overview?.tasksRecent]);

  const handleRefresh = useCallback(() => {
    void reload(true);
  }, [reload]);

  const tabItems = useMemo(
    () => [
      {
        key: 'policy',
        label: 'SDRS 策略',
        children: (
          <StorageDrsPolicyPanel
            cloudId={cloudId}
            canWrite={canWrite}
            loading={loading}
            overview={overview}
            onRefresh={handleRefresh}
          />
        ),
      },
      {
        key: 'tasks',
        label: `任务日志 (${tasks.length})`,
        children: (
          <StorageDrsTasksPanel
            cloudId={cloudId}
            canWrite={canWrite}
            loading={loading}
            tasks={tasks}
            onRefresh={handleRefresh}
          />
        ),
      },
    ],
    [canWrite, cloudId, handleRefresh, loading, overview, tasks],
  );

  if (!canRead) {
    return (
      <PageDetailSection title="存储智能调度">
        <Alert type="warning" showIcon message="无权限查看存储配置（SDRS）" />
      </PageDetailSection>
    );
  }

  return (
    <PageDetailSection asCard={false}>
      {error ? (
        <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />
      ) : null}
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
    </PageDetailSection>
  );
};

export default StorageDrsSection;
