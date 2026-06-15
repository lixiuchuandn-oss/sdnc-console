/**
 * 镜像列表 UI 状态键（与前端 resolveImageListStateKey / shared fixtures 契约一致）。
 * 列表 API 通过 listStateKey 下发；前端可优先信 API 字段。
 */
import { resolveUploadSourceInProgressListStateKey } from '../../../constants/imageUploadChannel';
import {
  isActiveHarvesterVmImageImportInProgress,
  isHarvesterVmImageImportCancelled,
  isHarvesterVmImageImportComplete,
  isHarvesterVmImageImportedTerminalFailure,
  readVmImageImportProgress,
} from './vmImageClusterApi';

function conditionStatusIsTrue(v: unknown): boolean {
  return v === true || v === 'True' || v === 'true';
}

function conditionStatusIsFalse(v: unknown): boolean {
  return v === false || v === 'False' || v === 'false';
}

function getVmImageConditions(r: any): any[] {
  const fromStatus = r?.status?.conditions;
  const top = r?.conditions;
  if (Array.isArray(fromStatus) && fromStatus.length > 0) return fromStatus;
  if (Array.isArray(top) && top.length > 0) return top;
  if (Array.isArray(fromStatus)) return fromStatus;
  if (Array.isArray(top)) return top;
  return [];
}

function importedCondition(r: any): any | undefined {
  return getVmImageConditions(r).find((c: any) => c?.type === 'Imported');
}

function finiteImportProgress(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return value;
}

function mapBackendVmImageState(raw: string): string {
  const k = String(raw || '').trim().toLowerCase();
  if (k === 'active' || k === 'imported') return 'ready';
  if (k === 'failed') return 'failed';
  if (k === 'cancelled') return 'cancelled';
  if (['downloading', 'uploading', 'importing', 'exporting', 'unknown'].includes(k)) return k;
  return k || 'unknown';
}

function resolveInProgressStateKeyBySourceType(sourceType: string, r: any): string {
  if (sourceType === 'upload') return resolveUploadSourceInProgressListStateKey(r);
  if (sourceType === 'download') return 'importing';
  if (sourceType === 'export-from-volume') return 'exporting';
  return 'downloading';
}

function isExplicitUserClusterImportCancel(r: any): boolean {
  const imported = importedCondition(r);
  if (imported && conditionStatusIsFalse(imported?.status)) {
    const msg = String(imported?.message || '').toLowerCase();
    if (
      msg.includes('user cancel') ||
      msg.includes('cancelled by user') ||
      msg.includes('用户取消') ||
      msg.includes('用户中止')
    ) {
      return true;
    }
  }
  const statusMsg = String(r?.status?.message || '').toLowerCase();
  return (
    statusMsg.includes('user cancel') ||
    statusMsg.includes('cancelled by user') ||
    statusMsg.includes('用户取消')
  );
}

function isClusterImportCancelled(r: any): boolean {
  if (isActiveHarvesterVmImageImportInProgress(r) && !isExplicitUserClusterImportCancel(r)) {
    return false;
  }
  if (isHarvesterVmImageImportCancelled(r)) return true;
  const statusStr = String(r?.status?.state ?? r?.state ?? r?.status?.phase ?? '').toLowerCase();
  if (statusStr === 'cancelled') return true;
  const conditions = getVmImageConditions(r);
  const cancelledCondition = conditions.find((c: any) => c?.type === 'Cancelled');
  if (conditionStatusIsTrue(cancelledCondition?.status)) return true;
  const imported = importedCondition(r);
  if (imported && conditionStatusIsFalse(imported?.status)) {
    const reason = String(imported?.reason || '').trim();
    if (['Canceled', 'Cancelled', 'UploadCanceled'].includes(reason)) return true;
    const msg = String(imported?.message || '').toLowerCase();
    if (
      msg.includes('user cancel') ||
      msg.includes('cancelled by user') ||
      msg.includes('用户取消') ||
      msg.includes('用户中止')
    ) {
      return true;
    }
  }
  const statusMsg = String(r?.status?.message || '').toLowerCase();
  if (
    statusMsg.includes('user cancel') ||
    statusMsg.includes('cancelled by user') ||
    statusMsg.includes('用户取消')
  ) {
    return true;
  }
  return false;
}

/** 与前端 resolveImageListStateKey 对齐（不含 __towerUploadVirtual 虚拟行） */
export function resolveHarvesterImageListStateKey(r: any): string {
  if (r?.__towerUploadVirtual) {
    const raw = String(r?.state || '').trim().toLowerCase();
    if (raw === 'cancelled') return 'cancelled';
    if (raw === 'syncing') return 'syncing';
    return 'pending_sync';
  }

  const sourceType = String(r?.sourceType || r?.spec?.sourceType || '').toLowerCase();

  const imported = importedCondition(r);
  if (conditionStatusIsTrue(imported?.status)) return 'ready';

  if (isActiveHarvesterVmImageImportInProgress(r)) {
    return resolveInProgressStateKeyBySourceType(sourceType, r);
  }

  if (conditionStatusIsFalse(imported?.status) && isHarvesterVmImageImportedTerminalFailure(r)) {
    return 'failed';
  }

  if (isClusterImportCancelled(r)) return 'cancelled';

  if (isHarvesterVmImageImportComplete(r)) return 'ready';

  const clusterProgress = finiteImportProgress(readVmImageImportProgress(r));

  if (clusterProgress !== undefined) {
    if (clusterProgress >= 100 && isHarvesterVmImageImportComplete(r)) return 'ready';
    if (clusterProgress > 0 && clusterProgress < 100) {
      return resolveInProgressStateKeyBySourceType(sourceType, r);
    }
  }

  if (sourceType === 'download') return 'importing';
  if (sourceType === 'export-from-volume') return 'exporting';

  const backendMapped = mapBackendVmImageState(String(r?.state || ''));
  if (backendMapped === 'failed' && isHarvesterVmImageImportedTerminalFailure(r)) return 'failed';
  if (backendMapped === 'ready' && isHarvesterVmImageImportComplete(r)) return 'ready';
  if (backendMapped === 'uploading' && sourceType === 'upload') {
    return resolveUploadSourceInProgressListStateKey(r);
  }
  if (backendMapped === 'failed' || backendMapped === 'cancelled') return 'unknown';
  if (['uploading', 'importing', 'exporting', 'downloading'].includes(backendMapped)) {
    return backendMapped;
  }

  return 'unknown';
}
