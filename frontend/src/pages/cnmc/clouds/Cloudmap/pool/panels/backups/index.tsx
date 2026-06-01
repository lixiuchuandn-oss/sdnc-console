/**
 * Cloudmap 详情 — 云备份（CBR）：侧栏路径驱动，刷新经 `backupsRefresh` → `loadTabResource`。
 */
import React, { useEffect, useMemo } from 'react';
import { Empty } from 'antd';
import BackupsSection from '../../../../Harvester/cbr/sections/BackupsSection';
import ScheduleVmBackupsSection from '../../../../Harvester/cbr/sections/ScheduleVmBackupsSection';
import VmRestoreTasksSection from '../../../../Harvester/cbr/sections/VmRestoreTasksSection';
import { createBackupsTabOnRefresh } from '../../loaders/backupsRefresh';
import {
  canReadBackupSchedules,
  canReadVmBackupSnapshots,
  canReadVmBackups,
} from '../../../../Harvester/cbr/lib/cbrPermissions';

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

const BACKUPS_POOL_TABS = new Set([
  'backups',
  'vm_snapshots',
  'schedule_vm_backups',
]);

export type CloudmapBackupsRoutePanelProps = {
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
  if (key === 'backups') return canReadVmBackups(checkPerm);
  if (key === 'vm_snapshots') return canReadVmBackupSnapshots(checkPerm);
  if (key === 'schedule_vm_backups') return canReadBackupSchedules(checkPerm);
  if (key === 'vm_restores') {
    return checkPerm('clouds.restore-tasks:read') || checkPerm('clouds:read');
  }
  return false;
}

const CloudmapBackupsRoutePanel: React.FC<CloudmapBackupsRoutePanelProps> = (
  props,
) => {
  const {
    cloudId,
    isTenant,
    showLog,
    checkPerm,
    loadTabResource,
    innerActiveKey,
    ecs,
    harvesterBackups,
    harvesterNamespaces,
    harvesterScheduleVmBackups,
    resourceLoading,
    rawBackups,
    rawScheduleVmBackups,
  } = props;

  const backupsTabOnRefresh = useMemo(() => {
    const deps = { loadTabResource };
    return {
      backups: createBackupsTabOnRefresh('backups', deps),
      vm_snapshots: createBackupsTabOnRefresh('vm_snapshots', deps),
      schedule_vm_backups: createBackupsTabOnRefresh(
        'schedule_vm_backups',
        deps,
      ),
    };
  }, [loadTabResource]);

  useEffect(() => {
    if (!BACKUPS_POOL_TABS.has(innerActiveKey)) return;
    void loadTabResource('backups', false);
  }, [innerActiveKey, cloudId, loadTabResource]);

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
          onRefresh={backupsTabOnRefresh.backups}
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
          onRefresh={backupsTabOnRefresh.vm_snapshots}
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
          onRefresh={backupsTabOnRefresh.schedule_vm_backups}
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

export default CloudmapBackupsRoutePanel;
