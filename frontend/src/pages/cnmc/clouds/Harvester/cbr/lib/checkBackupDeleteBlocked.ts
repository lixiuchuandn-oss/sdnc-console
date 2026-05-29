import { fetchHarvesterVmRestoreTaskList } from 'services/harvester/cbr';
import { findInProgressHarvesterRestoreForBackup } from './vmRestoreTaskStatus';

export type RestoreBlockingInfo = {
  namespace: string;
  name: string;
  statusText: string;
};

export function buildRestoreBlockingDeleteMessage(
  blocking: RestoreBlockingInfo,
  resourceType: 'backup' | 'snapshot',
): string {
  const label = resourceType === 'snapshot' ? '快照' : '备份';
  return `该${label}已有进行中的恢复任务（${blocking.namespace}/${blocking.name}，${blocking.statusText}），请等待完成后再删除`;
}

export async function findRestoreBlockingBackupDelete(
  cloudId: string,
  backupNamespace: string,
  backupName: string,
): Promise<RestoreBlockingInfo | null> {
  const restores = await fetchHarvesterVmRestoreTaskList(cloudId, true);
  return findInProgressHarvesterRestoreForBackup(restores, backupNamespace, backupName);
}
