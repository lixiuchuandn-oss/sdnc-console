import { isHarvesterCephVmRestore } from '../../../../../../utils/harvesterUtils';

export type HarvesterRestoreTaskPhase = 'pending' | 'ready' | 'failed';

export type HarvesterRestoreTaskStatus = {
  phase: HarvesterRestoreTaskPhase;
  text: string;
  progress: number;
  cephPhase?: string;
};

const CEPH_RESTORE_PHASE_LABEL: Record<string, string> = {
  Syncing: '同步中',
  Ready: '就绪',
  Stopping: '停止源机',
  WaitingOldCleanup: '等待清理',
  RestoringVolumes: '恢复卷',
  RestoringMetadata: '恢复元数据',
  StartingVM: '启动虚拟机',
  Completed: '完成',
};

const CEPH_RESTORE_PHASE_PROGRESS: Record<string, number> = {
  Syncing: 10,
  Ready: 20,
  Stopping: 30,
  WaitingOldCleanup: 40,
  RestoringVolumes: 55,
  RestoringMetadata: 70,
  StartingVM: 85,
  Completed: 100,
};

const isFailedByConditions = (raw: any) => {
  const phase = String(raw?.status?.phase || '').toLowerCase();
  if (phase === 'failed' || phase === 'error') return true;
  const conds: any[] = Array.isArray(raw?.status?.conditions) ? raw.status.conditions : [];
  return conds.some((c: any) => {
    const type = String(c?.type || '').toLowerCase();
    const status = String(c?.status || '').toLowerCase();
    return status === 'true' && (type === 'failed' || type === 'error');
  });
};

const getCephRestoreStatus = (raw: any): HarvesterRestoreTaskStatus => {
  const phase = String(raw?.status?.phase || '').trim();
  const phaseLower = phase.toLowerCase();
  if (phaseLower === 'failed' || phaseLower === 'error') {
    return { phase: 'failed', text: '失败', progress: 0, cephPhase: phase };
  }
  if (phase === 'Completed') {
    return { phase: 'ready', text: '完成', progress: 100, cephPhase: phase };
  }
  const text = CEPH_RESTORE_PHASE_LABEL[phase] || phase || '进行中';
  const progress = CEPH_RESTORE_PHASE_PROGRESS[phase] ?? 70;
  return { phase: 'pending', text, progress, cephPhase: phase };
};

/** 恢复任务是否进行中（非完成/失败） */
export function getHarvesterRestoreTaskStatus(raw: any): HarvesterRestoreTaskStatus {
  if (isHarvesterCephVmRestore(raw)) return getCephRestoreStatus(raw);
  if (isFailedByConditions(raw)) return { phase: 'failed', text: '失败', progress: 0 };
  const conds: any[] = Array.isArray(raw?.status?.conditions) ? raw.status.conditions : [];
  const ready = conds.some(
    (c: any) => String(c?.type || '').toLowerCase() === 'ready' && String(c?.status || '').toLowerCase() === 'true',
  );
  const completed = conds.some(
    (c: any) => String(c?.type || '').toLowerCase() === 'completed' && String(c?.status || '').toLowerCase() === 'true',
  );
  if (ready || completed) return { phase: 'ready', text: '完成', progress: 100 };

  const rawProgress = typeof raw?.status?.progress === 'number' ? raw.status.progress : undefined;
  const progress = rawProgress !== undefined ? rawProgress : 70;
  return { phase: 'pending', text: '进行中', progress: Math.max(0, Math.min(100, progress)) };
}

/** 排除克隆任务，保留 VM 备份/快照恢复 */
export function isHarvesterRestoreTaskRecord(raw: any): boolean {
  const hasCloneMark =
    !!raw?.metadata?.annotations?.['tower.io/cloneTask'] || !!raw?.metadata?.annotations?.['tower.io/clone'];
  if (hasCloneMark) return false;
  const ann = raw?.metadata?.annotations || {};
  const hasRestoreMark = !!ann['tower.io/restoreTask'];
  const name = String(raw?.metadata?.name || '');
  const looksLikeRestore = name.startsWith('restore-');
  if (isHarvesterCephVmRestore(raw)) {
    return hasRestoreMark || ann['tower.io/restoreBackend'] === 'ceph' || looksLikeRestore;
  }
  return hasRestoreMark || looksLikeRestore;
}

/** 恢复任务是否关联指定备份/快照（namespace + name） */
export function harvesterRestoreReferencesBackup(
  raw: any,
  backupNamespace: string,
  backupName: string,
): boolean {
  const ns = String(backupNamespace || '').trim();
  const name = String(backupName || '').trim();
  if (!ns || !name || !raw) return false;

  const annSource = String(raw?.metadata?.annotations?.['tower.io/restoreSource'] || '').trim();
  if (annSource === `${ns}/${name}`) return true;

  const isCeph = isHarvesterCephVmRestore(raw);
  const refName = isCeph
    ? String(raw?.spec?.backupName || '')
    : String(raw?.spec?.virtualMachineBackupName || '');
  const refNs = isCeph
    ? String(raw?.spec?.targetNamespace || raw?.metadata?.namespace || '')
    : String(raw?.spec?.virtualMachineBackupNamespace || raw?.metadata?.namespace || '');

  return refName === name && refNs === ns;
}

export function findInProgressHarvesterRestoreForBackup(
  restores: any[],
  backupNamespace: string,
  backupName: string,
): { namespace: string; name: string; statusText: string } | null {
  const list = Array.isArray(restores) ? restores : [];
  for (const item of list) {
    const raw = item?.rawData || item;
    if (!isHarvesterRestoreTaskRecord(raw)) continue;
    if (!harvesterRestoreReferencesBackup(raw, backupNamespace, backupName)) continue;
    const status = getHarvesterRestoreTaskStatus(raw);
    if (status.phase !== 'pending') continue;
    return {
      namespace: String(raw?.metadata?.namespace || backupNamespace),
      name: String(raw?.metadata?.name || ''),
      statusText: status.text,
    };
  }
  return null;
}
