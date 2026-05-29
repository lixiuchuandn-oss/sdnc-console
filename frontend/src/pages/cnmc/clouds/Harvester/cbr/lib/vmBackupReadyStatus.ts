import {
  harvesterBackupSourceVmName,
  isHarvesterCephVmBackup,
} from '../../../../../../utils/harvesterUtils';

export type InProgressVmBackupInfo = {
  namespace: string;
  name: string;
  itemType: 'backup' | 'snapshot';
  alias?: string;
};

const CEPH_VM_BACKUP_MANAGER_STATUS_KEY = 'hci.manager.system/vmbackup';

function cephVmBackupManagerStatusValue(item: any): string {
  if (!item) return '';
  const meta = item.metadata || {};
  const fromAnn = String(meta.annotations?.[CEPH_VM_BACKUP_MANAGER_STATUS_KEY] || '').trim();
  if (fromAnn) return fromAnn;
  const fromLabel = String(meta.labels?.[CEPH_VM_BACKUP_MANAGER_STATUS_KEY] || '').trim();
  if (fromLabel) return fromLabel;

  const st = item.status || {};
  if (st[CEPH_VM_BACKUP_MANAGER_STATUS_KEY] != null) {
    return String(st[CEPH_VM_BACKUP_MANAGER_STATUS_KEY]).trim();
  }

  const conds = Array.isArray(st.conditions) ? st.conditions : [];
  const hit = conds.find(
    (c: any) => String(c?.type || '').trim() === CEPH_VM_BACKUP_MANAGER_STATUS_KEY,
  );
  if (hit) {
    const reason = String(hit?.reason || '').trim();
    if (reason) return reason;
    const status = String(hit?.status || '').trim();
    if (status === 'True') return 'finished';
    return status;
  }
  return '';
}

function cephVmBackupReady(item: any): boolean {
  return cephVmBackupManagerStatusValue(item).toLowerCase() === 'finished';
}

export function isHarvesterVmBackupReady(item: any): boolean {
  const raw = item?.rawData || item;
  if (!raw) return true;
  if (isHarvesterCephVmBackup(item)) return cephVmBackupReady(raw);
  return raw.status?.readyToUse === true;
}

/** 虚拟机是否存在未就绪的备份或快照（进行中） */
export function findInProgressHarvesterBackupForVm(
  backups: unknown[] | undefined,
  vmNamespace: string,
  vmName: string,
): InProgressVmBackupInfo | null {
  const ns = String(vmNamespace || '').trim();
  const vm = String(vmName || '').trim();
  if (!ns || !vm) return null;

  for (const item of backups || []) {
    const raw = (item as any)?.rawData || item;
    if (!raw || raw.metadata?.deletionTimestamp) continue;
    const backupNs = String(raw.metadata?.namespace || '').trim();
    if (backupNs !== ns) continue;
    if (harvesterBackupSourceVmName(item) !== vm) continue;
    if (isHarvesterVmBackupReady(item)) continue;

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
