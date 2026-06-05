/**
 * 镜像上传任务：访问校验与删除策略（含 removeImageUploadTaskRecord）。
 */
import { Request } from 'express';

import { AppDataSource } from '../../../../../config/database';
import { HarvesterImageInventory } from '../../../../../entities/harvester/HarvesterImageInventory';
import { ImageUploadTask } from '../../../../../entities/harvester/ImageUploadTask';
import {
  destroyImageUploadBodyReadable,
  hasImageUploadProxyRun,
  isUploadTaskTransferInFlight,
  waitForImageUploadProxyIdle,
} from '../imageUploadRuntime';
import {
  abortUploadTask,
  harvesterVmImageImportSucceeded,
  imageUploadTaskLog,
  isUploadTaskProxyingStale,
  releaseStaleUploadTaskInFlight,
} from './imageUploadTask.helpers';
import {
  fetchVmImageDetailForTaskReconcile,
  markUploadTaskSuccessFromCluster,
  reconcileUploadTasksWithInventory,
} from './imageUploadTask.reconcile';
import {
  finalizeImageUploadTaskFilesCleanup,
  scheduleImageUploadTaskFilesCleanup,
} from './imageUploadTask.staging';

export async function assertImageUploadTaskAccess(
  req: Request,
  cloudId: string,
  taskId: string,
): Promise<{ task: ImageUploadTask; isAdmin: boolean } | null> {
  const user = (req as any)?.user;
  const userId = String(user?.id || '');
  const role = String(user?.role || '');
  const isAdmin = ['super_admin', 'admin'].includes(role);
  const repo = AppDataSource.getRepository(ImageUploadTask);
  const task = await repo.findOne({ where: { id: taskId, cloudId } });
  if (!task) return null;
  if (!isAdmin && task.createdBy !== userId) return null;
  return { task, isAdmin };
}

export function isUploadTaskDeleteBlockedByPolicy(task: ImageUploadTask): boolean {
  const st = String(task.taskStatus || '').toLowerCase();
  return (
    st === 'pending' ||
    st === 'ingesting' ||
    st === 'uploaded' ||
    st === 'proxying' ||
    st === 'failed'
  );
}

export function isUploadTaskDeleteBlockedByRuntime(task: ImageUploadTask): boolean {
  releaseStaleUploadTaskInFlight(task);
  if (isUploadTaskTransferInFlight(task.id) || hasImageUploadProxyRun(task.id)) return true;
  const st = String(task.taskStatus || '').toLowerCase();
  if (st === 'pending' || st === 'ingesting') return true;
  if (st === 'proxying') return !isUploadTaskProxyingStale(task);
  return false;
}

/** 删除前：对齐库存，集群已 Imported 则收成 success；僵尸 proxying 允许继续删 */
export async function prepareUploadTaskRecordForDelete(
  task: ImageUploadTask,
  cloud: any,
): Promise<ImageUploadTask> {
  const taskRepo = AppDataSource.getRepository(ImageUploadTask);
  let [current] = await reconcileUploadTasksWithInventory([task], cloud, {
    skipLiveClusterFetch: true,
  });
  releaseStaleUploadTaskInFlight(current);

  const st = String(current.taskStatus || '').toLowerCase();
  if (st !== 'proxying' && st !== 'failed') return current;
  if (isUploadTaskTransferInFlight(current.id) || hasImageUploadProxyRun(current.id)) {
    return current;
  }

  const imgNs = String(current.createdImageNamespace || '').trim();
  const imgName = String(current.createdImageName || '').trim();
  if (!cloud || !imgNs || !imgName) return current;

  try {
    const imageRepo = AppDataSource.getRepository(HarvesterImageInventory);
    const inv = await imageRepo.findOne({
      where: { cloudId: current.cloudId, namespace: imgNs, name: imgName },
    });
    const detail = await fetchVmImageDetailForTaskReconcile(current, cloud, inv?.rawData, {
      skipLiveClusterFetch: true,
    });
    if (harvesterVmImageImportSucceeded(detail)) {
      current = await markUploadTaskSuccessFromCluster(current, cloud, detail, taskRepo);
      releaseStaleUploadTaskInFlight(current);
    }
  } catch (e: any) {
    imageUploadTaskLog.warn('prepareUploadTaskRecordForDelete failed', {
      taskId: current.id,
      err: e?.message || e,
    });
  }
  return current;
}

/** 删除单条上传任务记录（含暂存文件）；force 时中止代传并等待协程结束后再删 */
export async function removeImageUploadTaskRecord(
  task: ImageUploadTask,
  cloud: any,
  opts?: { force?: boolean },
): Promise<boolean> {
  const repo = AppDataSource.getRepository(ImageUploadTask);
  abortUploadTask(task.id);
  destroyImageUploadBodyReadable(task.id);
  let current = await prepareUploadTaskRecordForDelete(task, cloud);
  releaseStaleUploadTaskInFlight(current);
  if (opts?.force) {
    await waitForImageUploadProxyIdle(current.id, 30_000).catch(() => undefined);
    releaseStaleUploadTaskInFlight(current);
  } else if (
    isUploadTaskDeleteBlockedByPolicy(current) ||
    isUploadTaskDeleteBlockedByRuntime(current)
  ) {
    return false;
  }
  if (opts?.force && isUploadTaskDeleteBlockedByRuntime(current)) {
    return false;
  }
  await scheduleImageUploadTaskFilesCleanup(current);
  await finalizeImageUploadTaskFilesCleanup(current.id);
  await repo.delete({ id: current.id });
  return true;
}
