import { useCallback } from 'react';
import { message } from 'antd';
import { confirmHighRiskDelete } from '../../shared/lib/highRiskConfirm';
import { DELETE_RISK_ITEMS } from '../../shared/lib/highRiskOperationPresets';
import {
  deleteHarvesterScheduleVmBackup,
  updateHarvesterScheduleVmBackup,
} from 'services/harvester/cbr';
import {
  runHarvesterSectionRefresh,
  type HarvesterSectionOnRefresh,
} from '../lib/cbrSectionRefresh';
import type {
  ScheduleVmBackupCreatedPayload,
  ScheduleVmBackupListRow,
} from '../lib/scheduleVmBackupsSectionUtils';
import type { useScheduleVmBackupsOptimistic } from './useScheduleVmBackupsOptimistic';

type OptimisticApi = Pick<
  ReturnType<typeof useScheduleVmBackupsOptimistic>,
  'registerCreateSuccess' | 'markRemoved' | 'applySuspendOverride'
>;

export type UseScheduleVmBackupsSectionActionsParams = {
  cloudId: string;
  onRefresh?: HarvesterSectionOnRefresh;
  hasBackupsWrite: boolean;
  ensureBackupsWrite: () => boolean;
  optimistic: OptimisticApi;
  vms?: unknown[];
};

export function useScheduleVmBackupsSectionActions({
  cloudId,
  onRefresh,
  hasBackupsWrite,
  ensureBackupsWrite,
  optimistic,
  vms,
}: UseScheduleVmBackupsSectionActionsParams) {
  const { registerCreateSuccess, markRemoved, applySuspendOverride } = optimistic;

  const handleSuspend = useCallback(
    async (record: ScheduleVmBackupListRow) => {
      if (!ensureBackupsWrite()) return;
      try {
        const newSuspend = !record.suspended;
        await updateHarvesterScheduleVmBackup(cloudId, record.namespace, record.id, {
          suspend: newSuspend,
        });
        message.success(`${newSuspend ? '停用' : '启用'}成功`);
        applySuspendOverride(record, newSuspend);
        void runHarvesterSectionRefresh(onRefresh, { force: true });
      } catch (e: unknown) {
        const err = e as { message?: string };
        message.error(`操作失败: ${err.message || '未知错误'}`);
      }
    },
    [applySuspendOverride, cloudId, ensureBackupsWrite, onRefresh],
  );

  const handleDelete = useCallback(
    (record: ScheduleVmBackupListRow) => {
      if (!ensureBackupsWrite()) return;
      void confirmHighRiskDelete({
        resourceLabel: '定时备份策略',
        name: record.name,
        description: `确定要删除定时备份策略「${record.name}」（${record.id}）吗？此操作不可恢复。`,
        riskItems: DELETE_RISK_ITEMS,
        onConfirm: async () => {
          try {
            await deleteHarvesterScheduleVmBackup(cloudId, record.namespace, record.id);
            message.success('删除成功');
            markRemoved(record);
            void runHarvesterSectionRefresh(onRefresh, { force: true });
          } catch (e: unknown) {
            const err = e as { message?: string };
            message.error(`删除失败: ${err.message || '未知错误'}`);
            throw e;
          }
        },
      }).catch(() => undefined);
    },
    [cloudId, ensureBackupsWrite, markRemoved, onRefresh],
  );

  const handleCreateSuccess = useCallback(
    (created?: ScheduleVmBackupCreatedPayload) => {
      registerCreateSuccess(created, vms);
      void runHarvesterSectionRefresh(onRefresh, { force: true, silent: true });
    },
    [onRefresh, registerCreateSuccess, vms],
  );

  return {
    handleSuspend,
    handleDelete,
    handleCreateSuccess,
    hasBackupsWrite,
  };
}
