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

/** Imported=True 或 progress≥100 且已有 size（不判终态失败，供进行中闸门） */
function isClusterVmImageImportCompleteForProgressGate(r: any): boolean {
  const imported = importedCondition(r);
  if (conditionStatusIsTrue(imported?.status)) return true;
  const progress = finiteImportProgress(readClusterVmImageImportProgress(r));
  if (progress === undefined || progress < 100) return false;
  const size = Number(r?.status?.size ?? r?.size);
  return size > 0;
}

/** CDI 收尾高进度段：此区间内 Imported=False 的 Failed/Cancelled 多为瞬态 */
const CLUSTER_IMPORT_FINALIZE_PROGRESS_MIN = 95;

/**
 * 底座处于导入收尾：progress≥95 且未就绪，或 100% 但 Imported 未 True / size 未就绪。
 * 仅覆盖收尾窗口，避免 60% 等中途真失败被误判为进行中。
 */
export function isActiveClusterVmImageImportInProgress(r: any): boolean {
  const progress = finiteImportProgress(readClusterVmImageImportProgress(r));
  if (progress === undefined) return false;
  if (progress >= 100 && !isClusterVmImageImportCompleteForProgressGate(r)) return true;
  if (progress >= CLUSTER_IMPORT_FINALIZE_PROGRESS_MIN && progress < 100) return true;
  return false;
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



function importedCondition(r: any): any | undefined {

  return getVmImageConditions(r).find((c: any) => c?.type === 'Imported');

}



/** Imported=False 是否为底座已确认的终态失败（与后端 isHarvesterVmImageImportedTerminalFailure 对齐） */

export function isVmImageImportedTerminalFailure(r: any): boolean {

  const imported = importedCondition(r);

  if (!conditionStatusIsFalse(imported?.status)) return false;

  if (isActiveClusterVmImageImportInProgress(r)) return false;

  const reason = String(imported?.reason || '').trim();

  const msg = String(imported?.message || '').trim();

  const terminalReasons = ['UploadFailed', 'ImportFailed', 'Canceled', 'Cancelled', 'UploadCanceled'];

  if (terminalReasons.includes(reason)) return true;



  const lower = `${msg} ${reason}`.toLowerCase();

  if (

    lower.includes('context canceled') ||

    lower.includes('context cancelled') ||

    lower.includes('operation canceled') ||

    lower.includes('operation cancelled')

  ) {

    return false;

  }

  if (

    lower.includes('upload failed') ||

    lower.includes('import failed') ||

    lower.includes('connection refused') ||

    lower.includes('proxy error') ||

    lower.includes(' i/o timeout') ||

    lower.includes('eof') ||

    lower.includes('larger than the reported available storage') ||

    lower.includes('larger pvc is required')

  ) {

    return true;

  }

  if (

    lower.includes('user cancel') ||

    lower.includes('cancelled by user') ||

    lower.includes('用户取消') ||

    lower.includes('用户中止')

  ) {

    return false;

  }



  const progress = finiteImportProgress(readClusterVmImageImportProgress(r));

  if (progress !== undefined && progress < 100) return false;



  return false;

}



/** 底座是否已真正导入完成（Imported 或 progress≥100 且已有 size） */

export function isClusterVmImageImportComplete(r: any): boolean {

  const conditions = getVmImageConditions(r);

  const imported = conditions.find((c: any) => c?.type === 'Imported');

  if (conditionStatusIsTrue(imported?.status)) return true;

  if (conditionStatusIsFalse(imported?.status) && isVmImageImportedTerminalFailure(r)) {
    return false;
  }

  const progress = finiteImportProgress(readClusterVmImageImportProgress(r));

  if (progress === undefined) return false;

  if (progress < 100) return false;

  const size = Number(r?.status?.size ?? r?.size);

  return size > 0;

}



function resolveInProgressStateKeyBySourceType(sourceType: string): string {
  // 本地上传镜像在列表点「同步」后，底座导入阶段展示为同步中（非浏览器上传到 Tower）
  if (sourceType === 'upload') return 'syncing';
  if (sourceType === 'download') return 'importing';
  if (sourceType === 'export') return 'exporting';
  return 'downloading';
}

/** 底座 CR 是否为用户/系统取消 */
function isClusterImportCancelled(r: any): boolean {
  if (isActiveClusterVmImageImportInProgress(r) && !isExplicitUserClusterImportCancel(r)) {
    return false;
  }

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

/**
 * 镜像列表状态：仅依据底座 VirtualMachineImage（及无 CR 时的 Tower 本地虚拟行 pending_sync）。
 * 上传任务不参与状态/进度覆盖。
 */
export function resolveImageListStateKey(r: any): string {
  const fromApi = String(r?.listStateKey || '').trim().toLowerCase();
  if (fromApi && fromApi !== 'unknown' && !r?.__towerUploadVirtual) {
    return fromApi;
  }

  if (r?.__towerUploadVirtual) {
    const raw = String(r?.state || '').trim().toLowerCase();
    if (raw === 'cancelled') return 'cancelled';
    if (raw === 'syncing') return 'syncing';
    return 'pending_sync';
  }

  const sourceType = String(r?.sourceType || r?.spec?.sourceType || '').toLowerCase();

  const imported = importedCondition(r);
  if (conditionStatusIsTrue(imported?.status)) return 'ready';

  if (isActiveClusterVmImageImportInProgress(r)) {
    return resolveInProgressStateKeyBySourceType(sourceType);
  }

  if (conditionStatusIsFalse(imported?.status) && isVmImageImportedTerminalFailure(r)) {
    return 'failed';
  }

  if (isClusterImportCancelled(r)) return 'cancelled';

  if (isClusterVmImageImportComplete(r)) return 'ready';

  const clusterProgress = finiteImportProgress(readClusterVmImageImportProgress(r));

  if (clusterProgress !== undefined) {
    if (clusterProgress >= 100 && isClusterVmImageImportComplete(r)) return 'ready';
    if (clusterProgress > 0 && clusterProgress < 100) {
      return resolveInProgressStateKeyBySourceType(sourceType);
    }
  }

  if (sourceType === 'download') return 'importing';
  if (sourceType === 'export') return 'exporting';

  const backendMapped = mapBackendVmImageState(String(r?.state || ''));
  if (backendMapped === 'failed' && isVmImageImportedTerminalFailure(r)) return 'failed';
  if (backendMapped === 'ready' && isClusterVmImageImportComplete(r)) return 'ready';
  if (backendMapped === 'uploading' && sourceType === 'upload') return 'syncing';
  if (backendMapped === 'failed' || backendMapped === 'cancelled') {
    return 'unknown';
  }
  if (['uploading', 'importing', 'exporting', 'downloading'].includes(backendMapped)) {
    return backendMapped;
  }

  return 'unknown';
}



/** 底座 Imported=False 时的失败原因（镜像列表展示用） */

export function resolveVmImageImportFailureMessage(r: any): string | undefined {

  if (!isVmImageImportedTerminalFailure(r)) return undefined;

  const imported = importedCondition(r);

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


