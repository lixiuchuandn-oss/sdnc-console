import {
  isHarvesterCephVmRestore,
  isSystemNamespace,
} from '../../../../../../utils/harvesterUtils';
import { findHarvesterVmDisplayAlias } from './vmBackupDisplay';

export type RestorePhase = 'pending' | 'ready' | 'failed';

export interface RestoreStatusView {
  phase: RestorePhase;
  text: string;
  progress: number;
  cephPhase?: string;
}

export interface VmRestoreTaskListRow {
  key: string;
  namespace: string;
  restoreBackend: 'ceph' | 'longhorn';
  restoreName: string;
  targetVm: string;
  targetVmAlias: string;
  sourceVm: string;
  sourceVmAlias: string;
  backupName: string;
  restoreMode: string;
  resourceType: string;
  restoreRaw: unknown;
  backupRaw: unknown | null;
  restoreStatus: RestoreStatusView;
  creationTimestamp: string;
}

export function vmLineDisplay(alias: string | undefined, technical: string): string {
  const id = String(technical || '').trim();
  const a = String(alias || '').trim();
  if (!id || id === '-') return a || '-';
  if (!a || a === '-') return id;
  if (a === id) return id;
  if (a.includes(id)) return a;
  return `${a} (${id})`;
}

const isFailedByConditions = (raw: any) => {
  const phase = String(raw?.status?.phase || '').toLowerCase();
  if (phase === 'failed' || phase === 'error') return true;
  const conds: any[] = Array.isArray(raw?.status?.conditions) ? raw.status.conditions : [];
  return conds.some((c: any) => {
    const type = String(c?.type || '').toLowerCase();
    const status = String(c?.status || '').toLowerCase();
    if (status === 'true' && (type === 'failed' || type === 'error')) return true;
    return false;
  });
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

const getCephRestoreStatus = (raw: any): RestoreStatusView => {
  const phase = String(raw?.status?.phase || '').trim();
  const phaseLower = phase.toLowerCase();
  if (phaseLower === 'failed' || phaseLower === 'error') {
    return { phase: 'failed', text: '失败', progress: 0, cephPhase: phase };
  }
  if (phase === 'Completed') {
    return { phase: 'ready', text: '完成', progress: 100, cephPhase: phase };
  }
  const text = (CEPH_RESTORE_PHASE_LABEL[phase] || phase || '进行中') as string;
  const progress = CEPH_RESTORE_PHASE_PROGRESS[phase] ?? 70;
  return { phase: 'pending', text, progress, cephPhase: phase };
};

export function getRestoreStatus(raw: any): RestoreStatusView {
  if (isHarvesterCephVmRestore(raw)) return getCephRestoreStatus(raw);
  const failed = isFailedByConditions(raw);
  if (failed) return { phase: 'failed' as const, text: '失败' as const, progress: 0 };
  const conds: any[] = Array.isArray(raw?.status?.conditions) ? raw.status.conditions : [];
  const ready = conds.some(
    (c: any) =>
      String(c?.type || '').toLowerCase() === 'ready' &&
      String(c?.status || '').toLowerCase() === 'true',
  );
  const completed = conds.some(
    (c: any) =>
      String(c?.type || '').toLowerCase() === 'completed' &&
      String(c?.status || '').toLowerCase() === 'true',
  );
  if (ready || completed) return { phase: 'ready', text: '完成', progress: 100 };

  const rawProgress = typeof raw?.status?.progress === 'number' ? raw.status.progress : undefined;
  const progress = rawProgress !== undefined ? rawProgress : 70;
  return {
    phase: 'pending',
    text: '进行中',
    progress: Math.max(0, Math.min(100, progress)),
  };
}

export function isRestoreTaskRecord(raw: any): boolean {
  const hasCloneMark =
    !!raw?.metadata?.annotations?.['tower.io/cloneTask'] ||
    !!raw?.metadata?.annotations?.['tower.io/clone'];
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

export function buildBackupIndex(backups: unknown[] | undefined): Map<string, unknown> {
  const index = new Map<string, unknown>();
  (backups || []).forEach((b: unknown) => {
    const item = b as Record<string, unknown> & { rawData?: Record<string, unknown> };
    const raw = item.rawData || item;
    const meta = (raw as any)?.metadata || {};
    const ns = String(meta.namespace || '');
    const name = String(meta.name || '');
    if (ns && name) index.set(`${ns}/${name}`, raw);
  });
  return index;
}

export function buildVmRestoreTaskRows(
  restores: unknown[] | undefined,
  backupIndex: Map<string, unknown>,
  vms: unknown[] | undefined,
): VmRestoreTaskListRow[] {
  const list = Array.isArray(restores) ? restores : [];
  return list
    .map((r: unknown) => {
      const item = r as Record<string, unknown> & { rawData?: Record<string, unknown> };
      return item.rawData || item;
    })
    .filter(isRestoreTaskRecord)
    .map((r: any): VmRestoreTaskListRow => {
      const isCeph = isHarvesterCephVmRestore(r);
      const ns = String(r?.metadata?.namespace || '');
      const name = String(r?.metadata?.name || '');
      const target = isCeph
        ? String(r?.spec?.targetVmName || '')
        : String(r?.spec?.target?.name || '');
      const backupName = isCeph
        ? String(r?.spec?.backupName || '')
        : String(r?.spec?.virtualMachineBackupName || '');
      const backupNs = isCeph
        ? String(r?.spec?.targetNamespace || ns)
        : String(r?.spec?.virtualMachineBackupNamespace || ns);
      const backup = backupName ? backupIndex.get(`${backupNs}/${backupName}`) : null;
      const sourceVm = isCeph
        ? String(r?.spec?.sourceVm || (backup as any)?.spec?.source?.name || (backup as any)?.spec?.sourceVm || '')
        : String((backup as any)?.spec?.source?.name || (backup as any)?.spec?.sourceVm || '');
      const annRestoreMode = r?.metadata?.annotations?.['tower.io/restoreMode'];
      const restoreMode =
        annRestoreMode ||
        (isCeph
          ? String(r?.spec?.restoreType || '') === 'replace'
            ? 'replace'
            : 'new'
          : r?.spec?.newVM
            ? 'new'
            : 'replace');
      const resourceType = isCeph
        ? r?.spec?.type || (backup as any)?.spec?.type || 'backup'
        : (backup as any)?.spec?.type || 'backup';
      const restoreStatus = getRestoreStatus(r);
      const ann = (r?.metadata?.annotations || {}) as Record<string, string>;
      const annSourceAlias = String(ann['tower.io/restoreSourceVmAlias'] || '').trim();
      const annTargetDisp = String(ann['tower.io/restoreTargetDisplayName'] || '').trim();
      const sourceVmAlias =
        annSourceAlias ||
        (sourceVm && sourceVm !== '-'
          ? findHarvesterVmDisplayAlias(vms as any[], ns, sourceVm)
          : '-');
      const targetVmAlias =
        annTargetDisp ||
        (target && target !== '-'
          ? findHarvesterVmDisplayAlias(vms as any[], ns, target)
          : '-');

      return {
        key: r?.metadata?.uid || `${isCeph ? 'ceph' : 'vmr'}-${ns}/${name}`,
        namespace: ns,
        restoreBackend: isCeph ? 'ceph' : 'longhorn',
        restoreName: name,
        targetVm: target || '-',
        targetVmAlias,
        sourceVm: sourceVm || '-',
        sourceVmAlias,
        backupName: backupName || '-',
        restoreMode: restoreMode === 'new' ? '新建' : '替换',
        resourceType: resourceType === 'snapshot' ? '快照' : '备份',
        restoreRaw: r,
        backupRaw: backup,
        restoreStatus,
        creationTimestamp: r?.metadata?.creationTimestamp || '',
      };
    })
    .sort((a, b) => {
      const parseTs = (t: unknown) => {
        if (!t) return 0;
        const n = Date.parse(String(t));
        return Number.isFinite(n) ? n : 0;
      };
      return parseTs(b.creationTimestamp) - parseTs(a.creationTimestamp);
    });
}

export type VmRestoreTaskFilterParams = {
  keyword: string;
  statusFilter: string;
  namespaceFilter: string;
  isTenant?: boolean;
  isPublicNamespace: (ns: string) => boolean;
};

export function filterVmRestoreTasksForTable(
  dataSource: VmRestoreTaskListRow[],
  params: VmRestoreTaskFilterParams,
): VmRestoreTaskListRow[] {
  let d = dataSource;
  if (params.isTenant) {
    d = d.filter((x) => {
      const ns = String(x.namespace || '').toLowerCase();
      return !params.isPublicNamespace(ns) && !isSystemNamespace(ns);
    });
  }
  if (params.statusFilter) {
    d = d.filter((x) => {
      const rsSt = x.restoreStatus || { phase: 'pending' as const };
      if (params.statusFilter === 'pending') return rsSt.phase === 'pending';
      if (params.statusFilter === 'failed') return rsSt.phase === 'failed';
      if (params.statusFilter === 'ready') return rsSt.phase === 'ready';
      return true;
    });
  }
  if (params.namespaceFilter) {
    d = d.filter((x) => String(x.namespace || '') === params.namespaceFilter);
  }
  if (params.keyword) {
    const k = params.keyword.toLowerCase();
    d = d.filter(
      (x) =>
        String(x.namespace || '').toLowerCase().includes(k) ||
        String(x.sourceVm || '').toLowerCase().includes(k) ||
        String(x.sourceVmAlias || '').toLowerCase().includes(k) ||
        String(x.targetVm || '').toLowerCase().includes(k) ||
        String(x.targetVmAlias || '').toLowerCase().includes(k) ||
        String(x.backupName || '').toLowerCase().includes(k) ||
        String(x.restoreName || '').toLowerCase().includes(k),
    );
  }
  return d;
}

export function buildVmRestoreTaskNamespaceOptions(
  dataSource: VmRestoreTaskListRow[],
  params: Pick<VmRestoreTaskFilterParams, 'isTenant' | 'isPublicNamespace'>,
): Array<{ value: string; label: string }> {
  const set = new Set<string>();
  dataSource.forEach((x) => {
    const ns = String(x.namespace || '').trim();
    if (!ns) return;
    if (isSystemNamespace(ns)) return;
    if (params.isTenant && params.isPublicNamespace(ns)) return;
    set.add(ns);
  });
  return Array.from(set)
    .sort()
    .map((v) => ({ value: v, label: v }));
}

export function hasPendingRestoreTasks(rows: VmRestoreTaskListRow[]): boolean {
  return rows.some((x) => (x.restoreStatus || { phase: 'pending' }).phase === 'pending');
}
