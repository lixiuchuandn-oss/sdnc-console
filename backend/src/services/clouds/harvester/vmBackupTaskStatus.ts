import {
  cephVmBackupReady,
  isCephVmBackupResource,
  resolveCephBackupSourceVm,
} from './cephVmBackup';

export type InProgressVmBackupInfo = {
  namespace: string;
  name: string;
  itemType: 'backup' | 'snapshot';
  alias?: string;
};

export function isHarvesterVmBackupReady(raw: any): boolean {
  if (!raw) return true;
  if (isCephVmBackupResource(raw)) return cephVmBackupReady(raw);
  return raw.status?.readyToUse === true;
}

export function harvesterVmBackupSourceVm(raw: any): string {
  return resolveCephBackupSourceVm(null, raw);
}

/** 虚拟机是否存在未就绪的备份或快照（进行中） */
export function findInProgressHarvesterBackupForVm(
  backups: any[],
  vmNamespace: string,
  vmName: string,
): InProgressVmBackupInfo | null {
  const ns = String(vmNamespace || '').trim();
  const vm = String(vmName || '').trim();
  if (!ns || !vm) return null;

  const list = Array.isArray(backups) ? backups : [];
  for (const item of list) {
    const raw = item?.rawData || item;
    if (!raw || raw.metadata?.deletionTimestamp) continue;
    const backupNs = String(raw.metadata?.namespace || '').trim();
    if (backupNs !== ns) continue;
    if (harvesterVmBackupSourceVm(raw) !== vm) continue;
    if (isHarvesterVmBackupReady(raw)) continue;

    const itemType = String(raw.spec?.type || 'backup') === 'snapshot' ? 'snapshot' : 'backup';
    const alias = raw.metadata?.annotations?.['tower.io/alias'];
    return {
      namespace: backupNs,
      name: String(raw.metadata?.name || ''),
      itemType,
      alias: alias ? String(alias) : undefined,
    };
  }
  return null;
}

export function buildVmBackupCreateBlockedMessage(blocking: InProgressVmBackupInfo): string {
  const label = blocking.itemType === 'snapshot' ? '快照' : '备份';
  const display = blocking.alias || blocking.name;
  return `该虚拟机已有进行中的${label}任务（${blocking.namespace}/${display}），请等待就绪后再创建新的备份或快照`;
}
