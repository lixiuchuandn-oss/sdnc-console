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

/** 与 ImagesSection.resolveImageListStateKey 一致 */
export function resolveImageListStateKey(r: any): string {
  // 优先检查取消状态（用户主动取消应该优先于其他状态）
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
  
  // 优先使用后端设置的 state 字段
  if (typeof r?.state === 'string' && r.state.trim() !== '') {
    const mapped = mapBackendVmImageState(r.state);
    // 如果后端明确设置了状态，直接返回映射结果（包括 unknown）
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

  const progress = Number(r?.status?.progress ?? r?.progress);
  const sourceType = r?.sourceType || r?.spec?.sourceType || '';
  if (Number.isFinite(progress)) {
    if (progress >= 100) return 'ready';
    if (progress > 0 && progress < 100) {
      // 根据 sourceType 区分不同的状态
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
