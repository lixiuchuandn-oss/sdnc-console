import { useCallback, useState } from 'react';
import { message } from 'antd';
import { confirmHighRiskDelete } from '../../shared/lib/highRiskConfirm';
import { DELETE_RISK_ITEMS } from '../../shared/lib/highRiskOperationPresets';
import { deleteHarvesterBackup } from 'services/harvester/cbr';
import { isHarvesterCephVmBackup } from '../../../../../../utils/harvesterUtils';
import { resolveHarvesterSteveViewLink } from '../../shared/lib/harvesterSteveViewLink';
import {
  runHarvesterSectionRefresh,
  type HarvesterSectionOnRefresh,
} from '../lib/cbrSectionRefresh';
import type { BackupListRow, BackupListType } from '../lib/backupsSectionUtils';
import {
  buildRestoreBlockingDeleteMessage,
  findRestoreBlockingBackupDelete,
} from '../lib/checkBackupDeleteBlocked';

export type UseBackupsSectionActionsParams = {
  cloudId: string;
  type: BackupListType;
  hasBackupsWrite: boolean;
  onRefresh?: HarvesterSectionOnRefresh;
};

export function useBackupsSectionActions({
  cloudId,
  type,
  hasBackupsWrite,
  onRefresh,
}: UseBackupsSectionActionsParams) {
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [restoreModalVisible, setRestoreModalVisible] = useState(false);
  const [currentSnapshot, setCurrentSnapshot] = useState<BackupListRow | null>(null);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [drawerRecord, setDrawerRecord] = useState<any>(null);
  const [drawerActiveTab, setDrawerActiveTab] = useState('detail');

  const handleDelete = useCallback(
    async (record: BackupListRow) => {
      if (!hasBackupsWrite) {
        message.error('无权限执行该操作');
        return;
      }
      try {
        const blocking = await findRestoreBlockingBackupDelete(
          cloudId,
          record.namespace,
          record.name,
        );
        if (blocking) {
          message.warning(buildRestoreBlockingDeleteMessage(blocking, type));
          return;
        }
      } catch {
        // 恢复任务列表拉取失败时仍允许打开确认框，由后端删除接口兜底校验
      }
      const resourceLabel = type === 'backup' ? '备份' : '快照';
      void confirmHighRiskDelete({
        resourceLabel,
        name: record.name,
        description: `确定要删除${resourceLabel}「${record.alias || record.name}」吗？请仔细核对名称与影响范围。`,
        riskItems: DELETE_RISK_ITEMS,
        onConfirm: async () => {
          try {
            const blocking = await findRestoreBlockingBackupDelete(
              cloudId,
              record.namespace,
              record.name,
            );
            if (blocking) {
              message.warning(buildRestoreBlockingDeleteMessage(blocking, type));
              throw new Error(buildRestoreBlockingDeleteMessage(blocking, type));
            }
            await deleteHarvesterBackup(cloudId, record.namespace, record.name);
            message.success('删除成功');
            void runHarvesterSectionRefresh(onRefresh, { force: true });
          } catch (e: unknown) {
            const err = e as { message?: string };
            if (err?.message && !String(err.message).includes('用户取消')) {
              message.error(`删除失败: ${err.message || '未知错误'}`);
            }
            throw e;
          }
        },
      }).catch(() => undefined);
    },
    [cloudId, hasBackupsWrite, onRefresh, type],
  );

  const handleOpenYaml = useCallback((record: BackupListRow) => {
    const rawRecord = (record.raw || record) as Record<string, unknown>;
    const isCeph = isHarvesterCephVmBackup(rawRecord);
    const kind = isCeph ? 'CephVmBackup' : 'VirtualMachineBackup';
    const view = resolveHarvesterSteveViewLink({ ...rawRecord, kind });
    setDrawerRecord({
      ...rawRecord,
      kind,
      links: {
        ...((rawRecord.links as Record<string, unknown>) || {}),
        ...(view ? { view } : {}),
      },
    });
    setDrawerVisible(true);
  }, []);

  const handleRestore = useCallback(
    (record: BackupListRow) => {
      if (!hasBackupsWrite) {
        message.error('无权限执行该操作');
        return;
      }
      setCurrentSnapshot(record);
      setRestoreModalVisible(true);
    },
    [hasBackupsWrite],
  );

  const handleCreateSuccess = useCallback(() => {
    setCreateModalVisible(false);
    void runHarvesterSectionRefresh(onRefresh, { force: true, silent: true });
    window.setTimeout(
      () => void runHarvesterSectionRefresh(onRefresh, { force: true, silent: true }),
      2500,
    );
  }, [onRefresh]);

  return {
    createModalVisible,
    setCreateModalVisible,
    restoreModalVisible,
    setRestoreModalVisible,
    currentSnapshot,
    drawerVisible,
    setDrawerVisible,
    drawerRecord,
    drawerActiveTab,
    setDrawerActiveTab,
    handleDelete,
    handleOpenYaml,
    handleRestore,
    handleCreateSuccess,
  };
}
