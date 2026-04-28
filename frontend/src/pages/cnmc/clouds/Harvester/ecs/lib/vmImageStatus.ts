/**
 * Harvester 虚拟机镜像列表状态解析（与列表接口 / ImagesSection 语义一致，供变配换盘等复用）
 */

function mapBackendVmImageState(raw: string): string {
  const k = String(raw || '').trim().toLowerCase();
  if (k === 'active') return 'ready';
  if (k === 'imported') return 'ready';
  if (k === 'failed') return 'failed';
  if (k === 'downloading') return 'downloading';
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
  if (typeof r?.state === 'string' && r.state.trim() !== '') {
    const mapped = mapBackendVmImageState(r.state);
    if (mapped !== 'unknown') return mapped;
  }
  const conditions = getVmImageConditions(r);
  const imported = conditions.find((c: any) => c?.type === 'Imported');
  if (conditionStatusIsTrue(imported?.status)) return 'ready';
  if (conditionStatusIsFalse(imported?.status)) return 'failed';

  const progress = Number(r?.status?.progress ?? r?.progress);
  if (Number.isFinite(progress)) {
    if (progress >= 100) return 'ready';
    if (progress > 0 && progress < 100) return 'downloading';
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
