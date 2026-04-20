import React from 'react';
import { Tabs } from 'antd';
import BackupsSection from '../../../Harvester/cbr/sections/BackupsSection';
import ScheduleVmBackupsSection from '../../../Harvester/cbr/sections/ScheduleVmBackupsSection';
import VmRestoreTasksSection from '../../../Harvester/cbr/sections/VmRestoreTasksSection';
import { apiPost, fetchHarvesterScheduleVmBackups } from '../../runtime/api';

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
  mode: 'standard' | 'ops';
  isTenant: boolean;
  showLog: boolean;
  checkPerm: (act: string) => boolean;
  handleTabChange: (key: string) => void;
  loadTabResource: (
    key: string,
    force?: boolean,
    skipSync?: boolean,
  ) => Promise<void>;
  backupsGroupActiveKey: string;
  setBackupsGroupActiveKey: (key: string) => void;
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

const CloudmapBackupsGroupTabs: React.FC<CloudmapBackupsGroupTabsProps> = (
  props,
) => {
  const {
    cloudId,
    mode,
    isTenant,
    showLog,
    checkPerm,
    handleTabChange,
    loadTabResource,
    backupsGroupActiveKey,
    setBackupsGroupActiveKey,
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

  return (
    <Tabs
      type="line"
      destroyOnHidden
      activeKey={backupsGroupActiveKey}
      onChange={(key) => {
        setBackupsGroupActiveKey(key);
        handleTabChange(key);
      }}
      items={[
        {
          key: 'backups',
          label: '虚拟机备份',
          children: (
            <>
              <BackupsSection
                cloudId={cloudId}
                backups={harvesterBackups}
                loading={resourceLoading.backups}
                onRefresh={() => loadTabResource('backups', true)}
                namespaces={harvesterNamespaces}
                vms={ecs}
                type="backup"
                mode={mode}
              />
              <DebugJSON data={rawBackups} show={showLog} />
            </>
          ),
        },
        {
          key: 'vm_snapshots',
          label: '虚拟机快照',
          children: (
            <>
              <BackupsSection
                cloudId={cloudId}
                backups={harvesterBackups}
                loading={resourceLoading.backups}
                onRefresh={() => loadTabResource('backups', true)}
                namespaces={harvesterNamespaces}
                vms={ecs}
                type="snapshot"
                mode={mode}
              />
              <DebugJSON data={rawBackups} show={showLog} />
            </>
          ),
        },
        {
          key: 'schedule_vm_backups',
          label: '定时备份',
          children: (
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
                    setHarvesterScheduleVmBackups(
                      Array.isArray(list) ? list : [],
                    );
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
                mode={mode}
              />
              <DebugJSON data={rawScheduleVmBackups} show={showLog} />
            </>
          ),
        },
        {
          key: 'vm_restores',
          label: '恢复任务',
          children: (
            <VmRestoreTasksSection
              cloudId={cloudId}
              isTenant={isTenant}
              mode={mode}
            />
          ),
        },
      ].filter((i: any) => {
        if (i.key === 'backups')
          return (
            checkPerm('clouds.backups:read') || checkPerm('clouds:read')
          );
        if (i.key === 'vm_snapshots')
          return (
            checkPerm('clouds.backups:read') || checkPerm('clouds:read')
          );
        if (i.key === 'schedule_vm_backups')
          return (
            checkPerm('clouds.backups:read') || checkPerm('clouds:read')
          );
        if (i.key === 'vm_restores')
          return (
            checkPerm('clouds.restore-tasks:read') ||
            checkPerm('clouds.backups:read') ||
            checkPerm('clouds:read')
          );
        return true;
      })}
    />
  );
};

export default CloudmapBackupsGroupTabs;
