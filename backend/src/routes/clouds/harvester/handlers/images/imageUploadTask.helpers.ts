/**
 * 镜像上传任务：跨 staging / reconcile / proxy 共用的 DB 写入、进度与错误格式化。
 */
import { Readable } from 'stream';

import axios from 'axios';

import { AppDataSource } from '../../../../../config/database';
import { ImageUploadTask } from '../../../../../entities/harvester/ImageUploadTask';
import {
  isHarvesterVmImageImportComplete,
  isHarvesterVmImageImportedTerminalFailure,
  readVmImageImportProgress,
  readVmImageVirtualSizeBytes,
  resolveVmImageVirtualSizeFromCluster,
} from '../../../../../services/clouds/harvester/vmImageClusterApi';
import { upsertHarvesterImageInventoryItems } from '../../../../../services/clouds/harvester/inventory';
import {
  vmImageCephHarvesterExtraAnnotations,
  type VmImageStorageProfile,
} from '../../../../../services/clouds/harvester/client';
import { isSqliteTransactionError, withSqliteWriteLock } from '../../../../../utils/sqliteWriteLock';
import { logger } from '../../../../../utils/logger';
import {
  getImageUploadAbortController,
  hasImageUploadProxyRun,
  isUploadTaskTransferInFlight,
  registerImageUploadProxyEnd,
} from '../imageUploadRuntime';

export const imageUploadTaskLog = logger.child('image-upload-task');

/** proxying 且无活跃代传：进度已满或超过此时长视为可收尾/可删 */
export const UPLOAD_TASK_PROXYING_STALE_MS = 3 * 60 * 1000;

export async function withUploadTaskWriteLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  return withSqliteWriteLock(key, fn);
}

function isInternalTowerDbErrorMessage(msg: unknown): boolean {
  const lower = String(msg || '').toLowerCase();
  return (
    lower.includes('sqlite_error') ||
    lower.includes('cannot start a transaction') ||
    lower.includes('cannot commit') ||
    lower.includes('no transaction is active') ||
    lower.includes('no such savepoint') ||
    lower.includes('typeorm')
  );
}

export function isInternalTowerDbError(e: unknown): boolean {
  return (
    isInternalTowerDbErrorMessage((e as { message?: string })?.message || e) ||
    isSqliteTransactionError(e)
  );
}

export function harvesterVmImageUploadTerminalFailure(detail: unknown): string | null {
  if (!isHarvesterVmImageImportedTerminalFailure(detail)) return null;
  const d = detail as {
    status?: {
      conditions?: Array<{ type?: string; status?: string; reason?: string; message?: string }>;
    };
  };
  const imported = (d.status?.conditions || []).find((c) => c?.type === 'Imported');
  const reason = String(imported?.reason || '').trim();
  const msg = String(imported?.message || '').trim();
  return msg || reason || 'Harvester 导入镜像失败';
}

export function harvesterVmImageImportSucceeded(detail: unknown): boolean {
  return isHarvesterVmImageImportComplete(detail);
}

export function harvesterVmImageImportFailure(detail: unknown): string | null {
  if (!isHarvesterVmImageImportedTerminalFailure(detail)) return null;
  const d = detail as {
    status?: {
      conditions?: Array<{ type?: string; status?: string; message?: string; reason?: string }>;
    };
  };
  const conds = Array.isArray(d.status?.conditions) ? d.status!.conditions! : [];
  const imported = conds.find((c) => c?.type === 'Imported');
  return String(imported?.message || imported?.reason || 'Harvester 导入镜像失败');
}

export function clampProgress(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export function buildUploadTaskProgressPatchFromCluster(
  task: Pick<ImageUploadTask, 'proxyProgress' | 'progress'>,
  detail: unknown,
): { progress: number; proxyProgress: number } | null {
  const hp = clampProgress(Number(readVmImageImportProgress(detail) || 0));
  const prevProxy = clampProgress(Number(task.proxyProgress || 0));
  const prevProgress = clampProgress(Number(task.progress || 0));
  const syncRestarted = prevProxy <= 0 && prevProgress <= 0;
  if (syncRestarted && hp > 0) return null;
  if (hp <= prevProxy) return null;
  return { progress: Math.max(prevProgress, hp), proxyProgress: hp };
}

export function formatImageUploadTaskError(e: any): string {
  if (isInternalTowerDbError(e)) {
    return 'Tower 同步状态更新失败，请刷新镜像列表后重试';
  }
  const code = String(e?.code || '');
  const msg = String(e?.message || e || '');
  if (code === 'EPROTO' || /write EPROTO|SSL routines|tlsv1 alert/i.test(msg)) {
    return '与 Harvester 传输镜像数据时 HTTPS/TLS 连接失败。请确认云环境已开启「忽略 TLS 证书校验」，或检查 Harvester 网关/证书配置后重试';
  }
  if (code === 'ECONNRESET' || code === 'EPIPE' || /socket hang up/i.test(msg)) {
    return '与 Harvester 传输镜像数据时连接被中断，请稍后重试';
  }
  if (axios.isAxiosError(e) && e.response) {
    const data = e.response.data;
    const detail =
      typeof data === 'string' ? data : data != null ? JSON.stringify(data) : e.message;
    return `Harvester 上传失败 HTTP ${e.response.status}: ${String(detail).slice(0, 800)}`;
  }
  if (e?.status && e?.body != null) {
    const detail = typeof e.body === 'string' ? e.body : JSON.stringify(e.body);
    return `Harvester API HTTP ${e.status}: ${String(detail).slice(0, 800)}`;
  }
  return String(e?.message || e);
}

export async function updateTaskProgress(
  taskId: string,
  patch: Partial<ImageUploadTask>,
): Promise<ImageUploadTask | null> {
  return withUploadTaskWriteLock(`upload-task:${taskId}`, async () => {
    const repo = AppDataSource.getRepository(ImageUploadTask);
    const t = await repo.findOne({ where: { id: taskId } });
    if (!t) return null;
    Object.assign(t, patch);
    t.updatedAt = new Date();
    return repo.save(t);
  });
}

/** 代传进度写入：SQLite 繁忙时短暂重试，避免 setInterval 未捕获异常拖垮代传 */
export async function safeUpdateTaskProgress(
  taskId: string,
  patch: Partial<ImageUploadTask>,
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await updateTaskProgress(taskId, patch);
      return;
    } catch (e) {
      if (isInternalTowerDbError(e)) {
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 120));
          continue;
        }
        console.warn('[image-upload-task] progress save skipped (db busy)', taskId);
        return;
      }
      throw e;
    }
  }
}

/** 镜像在 Harvester 已导入完成时：拉集群详情（含 virtualSize）写入 Tower 库存 */
export async function upsertVmImageDetailToInventory(
  cloud: { id?: string; secretKey?: string; config?: any; endpoint?: string },
  _origin: string,
  namespace: string,
  name: string,
  insecure: boolean,
  detailHint?: unknown,
): Promise<void> {
  const cloudId = String(cloud.id || '').trim();
  if (!cloudId || !namespace || !name) return;
  const resolved = await resolveVmImageVirtualSizeFromCluster(
    cloud,
    namespace,
    name,
    insecure,
    detailHint,
  );
  const detail = resolved.detail;
  if (!detail || !isHarvesterVmImageImportComplete(detail)) return;
  if (readVmImageVirtualSizeBytes(detail) == null && resolved.virtualSize == null) return;
  await upsertHarvesterImageInventoryItems(cloudId, [detail]);
}

export function harvesterConn(cloud: any) {
  return {
    endpoint: cloud.endpoint,
    token: cloud.secretKey || '',
    insecure: !!(cloud.config as any)?.ignoreTls,
  };
}

export function guessOsTypeFromImageName(name: string): string {
  const n = String(name || '').toLowerCase();
  if (!n) return '';
  if (n.includes('ubuntu')) return 'ubuntu';
  if (n.includes('debian')) return 'debian';
  if (n.includes('centos') || n.includes('rocky') || n.includes('almalinux')) return 'centos';
  if (n.includes('windows') || /win-?(10|11|201|202)/i.test(n)) return 'windows';
  if (n.includes('openeuler')) return 'openeuler';
  if (n.includes('fedora')) return 'fedora';
  if (n.includes('suse') || n.includes('opensuse')) return 'opensuse';
  return '';
}

export function vmImageHarvesterMetadataLikeUi(params: {
  displayName: string;
  imageTypeLabel?: 'iso' | 'disk';
  imageNameForAnnotation: string;
  storageClassName: string;
  storageProfile?: VmImageStorageProfile;
}): { labels: Record<string, string>; annotations: Record<string, string> } {
  const dn = String(params.displayName || '').trim() || 'image';
  const labels: Record<string, string> = {
    'harvesterhci.io/imageDisplayName': dn,
  };
  if (params.imageTypeLabel) {
    labels['harvesterhci.io/image-type'] = params.imageTypeLabel;
  }
  const hint = String(params.imageNameForAnnotation || dn).trim();
  labels['harvesterhci.io/os-type'] = guessOsTypeFromImageName(hint);

  const annotations: Record<string, string> = {
    'harvesterhci.io/storageClassName': params.storageClassName || 'longhorn',
    ...(params.storageProfile?.kind === 'ceph' ? vmImageCephHarvesterExtraAnnotations() : {}),
  };
  if (hint) {
    annotations['harvesterhci.io/image-name'] = hint;
  }
  return { labels, annotations };
}

export function isCancelError(e: any): boolean {
  const code = String(e?.code || '');
  const name = String(e?.name || '');
  const msg = String(e?.message || '');
  return code === 'ERR_CANCELED' || name === 'CanceledError' || msg === 'CANCELLED';
}

export function abortUploadTask(taskId: string) {
  const c = getImageUploadAbortController(taskId);
  if (c && !c.signal.aborted) c.abort();
}

export async function throwIfUploadCancelled(
  taskId: string,
  abortController: AbortController,
): Promise<void> {
  if (abortController.signal.aborted) {
    const err: any = new Error('CANCELLED');
    err.code = 'ERR_CANCELED';
    throw err;
  }
  const t = await AppDataSource.getRepository(ImageUploadTask).findOne({ where: { id: taskId } });
  if (t?.taskStatus === 'cancelled') {
    if (!abortController.signal.aborted) abortController.abort();
    const err: any = new Error('CANCELLED');
    err.code = 'ERR_CANCELED';
    throw err;
  }
}

export function bindClientDisconnectAbort(inbound: Readable, abortController: AbortController): void {
  const abortIfNeeded = () => {
    if (!abortController.signal.aborted) abortController.abort();
  };
  inbound.on('error', abortIfNeeded);
  inbound.on('close', () => {
    if (!inbound.readableEnded) abortIfNeeded();
  });
}

export function bindReadableAbortOnError(readable: Readable, abortController: AbortController): void {
  readable.on('error', () => {
    try {
      abortController.abort();
    } catch {
      /* ignore */
    }
  });
}

export function uploadTaskProgressComplete(task: ImageUploadTask): boolean {
  return (
    Math.max(
      clampProgress(Number(task.progress || 0)),
      clampProgress(Number(task.proxyProgress || 0)),
    ) >= 100
  );
}

export function uploadTaskUpdatedAgeMs(task: ImageUploadTask): number {
  const ts = task.updatedAt ? new Date(task.updatedAt).getTime() : 0;
  return ts > 0 ? Date.now() - ts : Number.POSITIVE_INFINITY;
}

/** 无 inFlight / 无代传协程，且进度已满或长时间未更新的 proxying */
export function isUploadTaskProxyingStale(task: ImageUploadTask): boolean {
  const st = String(task.taskStatus || '').toLowerCase();
  if (st !== 'proxying') return false;
  if (isUploadTaskTransferInFlight(task.id) || hasImageUploadProxyRun(task.id)) return false;
  return (
    uploadTaskProgressComplete(task) || uploadTaskUpdatedAgeMs(task) >= UPLOAD_TASK_PROXYING_STALE_MS
  );
}

export function releaseStaleUploadTaskInFlight(task: ImageUploadTask): void {
  if (!isUploadTaskTransferInFlight(task.id)) return;
  const st = String(task.taskStatus || '').toLowerCase();
  if (['success', 'failed', 'cancelled'].includes(st)) {
    registerImageUploadProxyEnd(task.cloudId, task.id);
    return;
  }
  if (st === 'proxying' && !hasImageUploadProxyRun(task.id) && isUploadTaskProxyingStale(task)) {
    imageUploadTaskLog.info('release stale inFlight flag for proxying task', { taskId: task.id });
    registerImageUploadProxyEnd(task.cloudId, task.id);
  }
}
