import React from 'react';
import { Empty } from 'antd';
import BackupsSection from '../../../../Harvester/cbr/sections/BackupsSection';
import ScheduleVmBackupsSection from '../../../../Harvester/cbr/sections/ScheduleVmBackupsSection';
import VmRestoreTasksSection from '../../../../Harvester/cbr/sections/VmRestoreTasksSection';
import { apiPost, fetchHarvesterScheduleVmBackups } from '../../api';

const DebugJSON: React.FC<{ data: any; show: boolean }> = ({ data, show }) => {
  if (!show) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <pre
        style={{
          background: '#f7f7f7',
          padding: 12,
          borderRadius: 8,
          maxHeight: 300,
          overflow: 'auto',
        }}
      >
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
};

export type CloudmapBackupsGroupTabsProps = {
  cloudId: string;
  isTenant: boolean;
  showLog: boolean;
  checkPerm: (act: string) => boolean;
  loadTabResource: (
    key: string,
    force?: boolean,
    skipSync?: boolean,
  ) => Promise<void>;
  innerActiveKey: string;
  setResourceLoading: React.Dispatch<
    React.SetStateAction<Record<string, boolean>>
  >;
  ecs: any[];
  harvesterBackups: any[];
  harvesterNamespaces: any[];
  harvesterScheduleVmBackups: any[];
  setHarvesterScheduleVmBackups: (v: any[]) => void;
  setRawScheduleVmBackups: (v: any) => void;
  resourceLoading: Record<string, boolean>;
  rawBackups: any;
  rawScheduleVmBackups: any;
};

function canViewBackupsInner(key: string, checkPerm: (a: string) => boolean): boolean {
  if (key === 'backups' || key === 'vm_snapshots' || key === 'schedule_vm_backups') {
    return checkPerm('clouds.backups:read') || checkPerm('clouds:read');
  }
  if (key === 'vm_restores') {
    return (
      checkPerm('clouds.restore-tasks:read') ||
      checkPerm('clouds.backups:read') ||
      checkPerm('clouds:read')
    );
  }
  return false;
}

const CloudmapBackupsGroupTabs: React.FC<CloudmapBackupsGroupTabsProps> = (
  props,
) => {
  const {
    cloudId,
    isTenant,
    showLog,
    checkPerm,
    loadTabResource,
    innerActiveKey,
    setResourceLoading,
    ecs,
    harvesterBackups,
    harvesterNamespaces,
    harvesterScheduleVmBackups,
    setHarvesterScheduleVmBackups,
    setRawScheduleVmBackups,
    resourceLoading,
    rawBackups,
    rawScheduleVmBackups,
  } = props;

  if (!canViewBackupsInner(innerActiveKey, checkPerm)) {
    return <Empty description="无权限访问" style={{ marginTop: 48 }} />;
  }

  if (innerActiveKey === 'backups') {
    return (
      <>
        <BackupsSection
          cloudId={cloudId}
          backups={harvesterBackups}
          loading={resourceLoading.backups}
          onRefresh={() => loadTabResource('backups', true)}
          namespaces={harvesterNamespaces}
          vms={ecs}
          type="backup"
        />
        <DebugJSON data={rawBackups} show={showLog} />
      </>
    );
  }
  if (innerActiveKey === 'vm_snapshots') {
    return (
      <>
        <BackupsSection
          cloudId={cloudId}
          backups={harvesterBackups}
          loading={resourceLoading.backups}
          onRefresh={() => loadTabResource('backups', true)}
          namespaces={harvesterNamespaces}
          vms={ecs}
          type="snapshot"
        />
        <DebugJSON data={rawBackups} show={showLog} />
      </>
    );
  }
  if (innerActiveKey === 'schedule_vm_backups') {
    return (
      <>
        <ScheduleVmBackupsSection
          cloudId={cloudId}
          data={harvesterScheduleVmBackups}
          loading={resourceLoading.scheduleVmBackups}
          onRefresh={async (force = true, silent = false) => {
            const skipSync = false;
            if (!checkPerm('clouds.backups:read')) return;
            if (!silent)
              setResourceLoading((prev) => ({
                ...prev,
                scheduleVmBackups: true,
              }));
            try {
              if (force && !skipSync) {
                try {
                  await apiPost(`/api/clouds/${cloudId}/sync`);
                } catch {}
              }
              const json = await fetchHarvesterScheduleVmBackups(
                cloudId,
                force,
                skipSync,
              );
              const list: any[] = Array.isArray((json as any)?.data?.items)
                ? (json as any).data.items
                : [];
              setHarvesterScheduleVmBackups(Array.isArray(list) ? list : []);
              setRawScheduleVmBackups(json || null);
            } catch (e) {
              console.warn('Failed to load schedule vm backups', e);
            } finally {
              if (!silent)
                setResourceLoading((prev) => ({
                  ...prev,
                  scheduleVmBackups: false,
                }));
            }
          }}
          vms={ecs}
        />
        <DebugJSON data={rawScheduleVmBackups} show={showLog} />
      </>
    );
  }
  if (innerActiveKey === 'vm_restores') {
    return (
      <VmRestoreTasksSection cloudId={cloudId} isTenant={isTenant} vms={ecs} />
    );
  }
  return <Empty description="未知页面" style={{ marginTop: 48 }} />;
};

export default CloudmapBackupsGroupTabs;
