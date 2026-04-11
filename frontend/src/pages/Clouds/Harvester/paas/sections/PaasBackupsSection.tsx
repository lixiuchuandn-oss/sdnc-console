/**
 * 云数据库实例（tower.io/rds）维度的备份 / 快照 / 定时策略。
 * 复用 CBR 列表组件，按目标 VM 是否为云数据库实例过滤；创建备份时 VM 下拉仅展示该类实例。
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Tabs } from 'antd';
import BackupsSection from '../../cbr/BackupsSection';
import ScheduleVmBackupsSection from '../../cbr/ScheduleVmBackupsSection';

export type PaasBackupsSectionProps = {
  cloudId: string;
  vms: any[];
  backups: any[];
  scheduleVmBackups: any[];
  backupsLoading: boolean;
  scheduleLoading: boolean;
  namespaces: any[];
  /** 与云备份 Tab 一致：拉取 VM 备份 + 定时策略 */
  onRefresh: (force?: boolean, silent?: boolean) => void | Promise<void>;
  /** 与 Cloudmap handleTabChange 对齐，用于内层 Tab 切换时按需拉数 */
  onInnerTabChange?: (key: string) => void;
  isTenant?: boolean;
  mode?: 'standard' | 'ops';
};

const PaasBackupsSection: React.FC<PaasBackupsSectionProps> = ({
  cloudId,
  vms,
  backups,
  scheduleVmBackups,
  backupsLoading,
  scheduleLoading,
  namespaces,
  onRefresh,
  onInnerTabChange,
  isTenant,
  mode = 'standard',
}) => {
  const [activeKey, setActiveKey] = useState('rds_db_backup');

  const paasVms = useMemo(
    () => (vms || []).filter((vm) => vm?.metadata?.labels?.['tower.io/rds'] === 'true'),
    [vms],
  );

  const targetVmPredicate = useMemo(() => {
    const keys = new Set(
      paasVms.map((vm: any) => {
        const ns = String(vm?.metadata?.namespace || vm?.namespace || '');
        const name = String(vm?.metadata?.name || vm?.name || '');
        return `${ns}/${name}`;
      }),
    );
    return (namespace: string, vmName: string) =>
      keys.has(`${String(namespace)}/${String(vmName)}`);
  }, [paasVms]);

  const handleTabChange = useCallback(
    (key: string) => {
      setActiveKey(key);
      onInnerTabChange?.(key);
    },
    [onInnerTabChange],
  );

  return (
    <Tabs
      type="line"
      destroyOnHidden
      activeKey={activeKey}
      onChange={handleTabChange}
      items={[
        {
          key: 'rds_db_backup',
          label: '备份',
          children: (
            <BackupsSection
              cloudId={cloudId}
              backups={backups}
              loading={backupsLoading}
              onRefresh={onRefresh}
              namespaces={namespaces}
              vms={paasVms}
              restoreVms={vms}
              type="backup"
              targetVmPredicate={targetVmPredicate}
              mode={mode}
              isTenant={isTenant}
            />
          ),
        },
        {
          key: 'rds_db_snapshot',
          label: '快照',
          children: (
            <BackupsSection
              cloudId={cloudId}
              backups={backups}
              loading={backupsLoading}
              onRefresh={onRefresh}
              namespaces={namespaces}
              vms={paasVms}
              restoreVms={vms}
              type="snapshot"
              targetVmPredicate={targetVmPredicate}
              mode={mode}
              isTenant={isTenant}
            />
          ),
        },
        {
          key: 'rds_db_schedule',
          label: '定时策略',
          children: (
            <ScheduleVmBackupsSection
              cloudId={cloudId}
              data={scheduleVmBackups}
              loading={scheduleLoading}
              onRefresh={onRefresh}
              vms={paasVms}
              targetVmPredicate={targetVmPredicate}
              mode={mode}
              isTenant={isTenant}
            />
          ),
        },
      ]}
    />
  );
};

export default PaasBackupsSection;
