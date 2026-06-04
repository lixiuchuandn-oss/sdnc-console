import { Response } from 'express';
import { In } from 'typeorm';

import { AppDataSource } from '../../../../config/database';
import { ImageUploadTask } from '../../../../entities/harvester/ImageUploadTask';

export class GlobalImageUploadBusyError extends Error {
  readonly code = 'IMAGE_UPLOAD_GLOBAL_BUSY';

  constructor(
    public readonly busyKind: 'upload' | 'sync',
    public readonly busyTask: Pick<
      ImageUploadTask,
      'id' | 'cloudId' | 'displayName' | 'filename' | 'taskStatus'
    >,
  ) {
    super(formatGlobalImageUploadBusyMessage(busyKind, busyTask));
    this.name = 'GlobalImageUploadBusyError';
  }
}

export function formatGlobalImageUploadBusyMessage(
  kind: 'upload' | 'sync',
  task: Pick<ImageUploadTask, 'displayName' | 'filename' | 'id'>,
): string {
  const label = String(task.displayName || task.filename || task.id).trim();
  if (kind === 'sync') {
    return `全平台已有进行中的镜像同步任务（${label}），请等待完成或取消后再试`;
  }
  return `全平台已有进行中的镜像上传任务（${label}），请等待完成或取消后再试`;
}

export function isGlobalImageUploadBusyError(e: unknown): e is GlobalImageUploadBusyError {
  return e instanceof GlobalImageUploadBusyError;
}

export function respondGlobalImageUploadBusy(res: Response, e: GlobalImageUploadBusyError): void {
  res.status(409).json({
    message: e.message,
    code: e.code,
    data: {
      busyKind: e.busyKind,
      taskId: e.busyTask.id,
      cloudId: e.busyTask.cloudId,
      taskStatus: e.busyTask.taskStatus,
    },
  });
}

const UPLOAD_ACTIVE_STATUSES = ['pending', 'ingesting'] as const;
const SYNC_ACTIVE_STATUSES = ['proxying'] as const;

async function findOtherActiveUploadTask(
  excludeTaskId?: string,
): Promise<ImageUploadTask | null> {
  const repo = AppDataSource.getRepository(ImageUploadTask);
  const tasks = await repo.find({
    where: { taskStatus: In([...UPLOAD_ACTIVE_STATUSES]) },
    order: { updatedAt: 'DESC' },
    take: 20,
  });
  return tasks.find((t) => t.id !== excludeTaskId) ?? null;
}

async function findActiveSyncTask(
  excludeTaskId: string | undefined,
  inFlightTaskIds: ReadonlySet<string>,
): Promise<ImageUploadTask | null> {
  const repo = AppDataSource.getRepository(ImageUploadTask);
  const proxying = await repo.find({
    where: { taskStatus: In([...SYNC_ACTIVE_STATUSES]) },
    order: { updatedAt: 'DESC' },
    take: 20,
  });
  for (const t of proxying) {
    if (t.id !== excludeTaskId) return t;
  }
  for (const id of inFlightTaskIds) {
    if (id === excludeTaskId) continue;
    const t = await repo.findOne({ where: { id } });
    if (!t) continue;
    if (['cancelled', 'success', 'failed'].includes(t.taskStatus)) continue;
    return t;
  }
  return null;
}

/**
 * 全资源池互斥：同时仅允许一个上传（pending/ingesting）与一个同步（proxying），且二者不可并行。
 * @param excludeTaskId 当前任务自身（续传/分片/重试同步时不与自己冲突）
 */
export async function assertGlobalImageTaskSlot(opts?: {
  excludeTaskId?: string;
  inFlightTaskIds?: ReadonlySet<string>;
}): Promise<void> {
  const excludeTaskId = opts?.excludeTaskId;
  const inFlightTaskIds = opts?.inFlightTaskIds ?? new Set<string>();

  const syncBusy = await findActiveSyncTask(excludeTaskId, inFlightTaskIds);
  if (syncBusy) {
    throw new GlobalImageUploadBusyError('sync', syncBusy);
  }

  const uploadBusy = await findOtherActiveUploadTask(excludeTaskId);
  if (uploadBusy) {
    throw new GlobalImageUploadBusyError('upload', uploadBusy);
  }
}
