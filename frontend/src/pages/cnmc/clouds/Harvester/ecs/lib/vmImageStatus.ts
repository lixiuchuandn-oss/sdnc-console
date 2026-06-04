/**
 * Harvester 虚拟机镜像列表状态解析（与列表接口 / ImagesSection 语义一致，供变配换盘等复用）
 */

function mapBackendVmImageState(raw: string): string {
  const k = String(raw || '').trim().toLowerCase();
  if (k === 'active') return 'ready';
  if (k === 'imported') return 'ready';
  if (k === 'failed') return 'failed';
  if (k === 'downloading') return 'downloading';
  if (k === 'uploading') return 'uploading';
  if (k === 'importing') return 'importing';
  if (k === 'exporting') return 'exporting';
  if (k === 'cancelled') return 'cancelled';
  if (k === 'unknown') return 'unknown';
  return k || 'unknown';
}

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

/** 集群 status.progress（Harvester UI 上传/导入进度，优先于 Tower 覆盖值） */
export function readClusterVmImageImportProgress(r: any): number | undefined {
  const statusP = Number(r?.status?.progress);
  if (Number.isFinite(statusP)) return statusP;
  const topP = Number(r?.progress);
  if (Number.isFinite(topP)) return topP;
  return undefined;
}

function finiteImportProgress(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return value;
}

/** 底座是否已真正导入完成（Imported 或 progress≥100 且已有 size） */
export function isClusterVmImageImportComplete(r: any): boolean {
  const conditions = getVmImageConditions(r);
  const imported = conditions.find((c: any) => c?.type === 'Imported');
  if (conditionStatusIsTrue(imported?.status)) return true;
  if (conditionStatusIsFalse(imported?.status)) return false;
  const progress = finiteImportProgress(readClusterVmImageImportProgress(r));
  if (progress === undefined) return false;
  if (progress < 100) return false;
  const size = Number(r?.status?.size ?? r?.size);
  return size > 0;
}

/** 与 ImagesSection.resolveImageListStateKey 一致 */
export function resolveImageListStateKey(r: any): string {
  const towerState = String(r?.state || '').trim();
  const clusterProgress = finiteImportProgress(readClusterVmImageImportProgress(r));
  const rowProgress = Number(r?.progress);
  const overlayProgress = Math.max(
    Number.isFinite(rowProgress) ? rowProgress : NaN,
    clusterProgress ?? NaN,
  );

  // 底座 Imported=True 为最终态，优先于 Tower 上传任务 cancelled 覆盖
  const conditionsEarly = getVmImageConditions(r);
  const importedEarly = conditionsEarly.find((c: any) => c?.type === 'Imported');
  if (conditionStatusIsTrue(importedEarly?.status)) {
    return 'ready';
  }
  if (conditionStatusIsFalse(importedEarly?.status)) {
    return 'failed';
  }

  // 集群进度未满：不得以 Active / success 覆盖为已就绪
  if ((clusterProgress ?? 100) < 100) {
    const sourceType = String(r?.sourceType || r?.spec?.sourceType || '').toLowerCase();
    if (towerState === 'syncing' || towerState === 'pending_sync') return towerState;
    if (sourceType === 'upload') return 'uploading';
    if (sourceType === 'download') return 'importing';
    if (sourceType === 'export') return 'exporting';
    return 'downloading';
  }

  // overlay 进度 100% 且集群无相反进度时，可展示已就绪（避免 success 后仍卡在「同步中」）
  if (
    towerState === 'syncing' &&
    Number.isFinite(overlayProgress) &&
    overlayProgress >= 100 &&
    isClusterVmImageImportComplete(r)
  ) {
    return 'ready';
  }

  if (isClusterVmImageImportComplete(r)) {
    return 'ready';
  }

  const conditionsForFailure = getVmImageConditions(r);
  const importedForFailure = conditionsForFailure.find((c: any) => c?.type === 'Imported');
  if (conditionStatusIsFalse(importedForFailure?.status)) {
    return 'failed';
  }
  if (mapBackendVmImageState(towerState) === 'failed') {
    return 'failed';
  }

  if (towerState === 'cancelled' || mapBackendVmImageState(towerState) === 'cancelled') {
    return 'cancelled';
  }

  if (towerState === 'pending_sync' || towerState === 'syncing') return towerState;

  // 优先检查取消状态（用户主动取消应该优先于其他中间态，但不及底座 Imported=False）
  // 检查多个可能的取消状态字段
  const statusStr = String(r?.status?.state ?? r?.state ?? r?.status?.phase ?? '').toLowerCase();
  
  // 检查是否有取消相关的标记
  const isCancelled = (() => {
    // 1. 检查状态字段
    if (statusStr === 'cancelled') return true;
    
    // 2. 检查 Cancelled condition
    const conditions = getVmImageConditions(r);
    const cancelledCondition = conditions.find((c: any) => c?.type === 'Cancelled');
    if (conditionStatusIsTrue(cancelledCondition?.status)) return true;
    
    // 3. 检查 Imported condition 的 message 是否包含取消相关信息
    const importedCondition = conditions.find((c: any) => c?.type === 'Imported');
    if (importedCondition && conditionStatusIsFalse(importedCondition?.status)) {
      const msg = String(importedCondition?.message || '').toLowerCase();
      if (msg.includes('cancel') || msg.includes('cancelled') || msg.includes('user') || msg.includes('中止')) {
        return true;
      }
    }
    
    // 4. 检查其他 condition 的 message
    for (const cond of conditions) {
      const msg = String(cond?.message || '').toLowerCase();
      if (msg.includes('cancel') || msg.includes('cancelled') || msg.includes('user')) {
        return true;
      }
    }
    
    // 5. 检查 status 中的 message 字段
    const statusMsg = String(r?.status?.message || '').toLowerCase();
    if (statusMsg.includes('cancel') || statusMsg.includes('cancelled') || statusMsg.includes('user')) {
      return true;
    }
    
    return false;
  })();
  
  if (isCancelled) return 'cancelled';
  
  // 优先使用后端设置的 state 字段（Active 须配合导入完成，见 isClusterVmImageImportComplete）
  if (typeof r?.state === 'string' && r.state.trim() !== '') {
    const mapped = mapBackendVmImageState(r.state);
    if (mapped === 'ready' && !isClusterVmImageImportComplete(r)) {
      const sourceType = String(r?.sourceType || r?.spec?.sourceType || '').toLowerCase();
      if (sourceType === 'upload') return 'uploading';
      if (sourceType === 'download') return 'importing';
      return 'unknown';
    }
    if (mapped !== 'unknown' || r.state.toLowerCase() === 'unknown') {
      return mapped;
    }
  }

  const conditions = getVmImageConditions(r);
  const imported = conditions.find((c: any) => c?.type === 'Imported');
  if (conditionStatusIsTrue(imported?.status)) {
    return 'ready';
  }
  if (conditionStatusIsFalse(imported?.status)) {
    return 'failed';
  }

  const sourceTypeEarly = String(r?.sourceType || r?.spec?.sourceType || '').toLowerCase();
  if (sourceTypeEarly === 'download' && !isClusterVmImageImportComplete(r)) {
    return 'importing';
  }
  if (sourceTypeEarly === 'upload' && !isClusterVmImageImportComplete(r)) {
    return 'uploading';
  }

  const progress = clusterProgress ?? rowProgress;
  const sourceType = r?.sourceType || r?.spec?.sourceType || '';
  if (Number.isFinite(progress)) {
    if (progress >= 100 && isClusterVmImageImportComplete(r)) return 'ready';
    if (progress > 0 && progress < 100) {
      if (sourceType === 'upload') return 'uploading';
      if (sourceType === 'download') return 'importing';
      if (sourceType === 'export') return 'exporting';
      return 'downloading';
    }
  }

  if (typeof r?.status === 'string' && r.status.trim() !== '') return mapBackendVmImageState(r.status);
  const phase = r?.status?.phase ?? r?.status?.status;
  if (phase != null && String(phase).trim() !== '') return mapBackendVmImageState(String(phase));

  return 'unknown';
}

/** 底座 Imported=False 时的失败原因（镜像列表展示用） */
export function resolveVmImageImportFailureMessage(r: any): string | undefined {
  const conditions = getVmImageConditions(r);
  const imported = conditions.find((c: any) => c?.type === 'Imported');
  if (conditionStatusIsFalse(imported?.status)) {
    const msg = String(imported?.message || imported?.reason || '').trim();
    if (msg) return msg;
  }
  if (resolveImageListStateKey(r) === 'failed') {
    const statusMsg = String(r?.status?.message || '').trim();
    if (statusMsg) return statusMsg;
  }
  return undefined;
}

/** 从 VM CR 解析当前系统盘关联的镜像 ID（ns/name），与 VmSection SafeRead.image 同源逻辑 */
export function getVmRootImageIdFromVm(vm: any): string {
  if (!vm) return '';
  const specImg = vm?.spec?.template?.metadata?.annotations?.['harvesterhci.io/imageId'];
  if (specImg) return String(specImg).trim();
  const metaImg = vm?.metadata?.annotations?.['harvesterhci.io/imageId'];
  if (metaImg) return String(metaImg).trim();
  try {
    const annot = vm?.metadata?.annotations?.['harvesterhci.io/volumeClaimTemplates'];
    if (annot) {
      const arr = JSON.parse(annot);
      for (const item of arr) {
        const img = item?.metadata?.annotations?.['harvesterhci.io/imageId'];
        if (img) return String(img).trim();
      }
    }
  } catch {
    /* ignore */
  }
  return '';
}
