/**
 * 镜像上传任务与 Harvester 库存/集群导入状态的对齐（reconcile）。
 */
import fs from 'fs';

import { AppDataSource } from '../../../../../config/database';
import { HarvesterImageInventory } from '../../../../../entities/harvester/HarvesterImageInventory';
import { ImageUploadTask } from '../../../../../entities/harvester/ImageUploadTask';
import { upsertHarvesterImageInventoryItems } from '../../../../../services/clouds/harvester/inventory';
import {
  fetchHarvesterVmImageDetailFromCluster,
  readVmImageImportProgress,
  isActiveHarvesterVmImageImportInProgress,
  buildHarvesterVmImageDetailUrls,
  resolveHarvesterClusterApiRoots,
} from '../../../../../services/clouds/harvester/vmImageClusterApi';
import { requestJson } from '../../../../../services/clouds/harvester/utils';
import { deleteVmImageCdiStorageOrphans } from '../imageUploadCdiCleanup';
import {
  hasImageUploadProxyRun,
  isUploadTaskTransferInFlight,
} from '../imageUploadRuntime';
import {
  clampProgress,
  formatImageUploadTaskError,
  harvesterConn,
  harvesterVmImageImportSucceeded,
  harvesterVmImageUploadTerminalFailure,
  imageUploadTaskLog,
  isUploadTaskProxyingStale,
  updateTaskProgress,
  upsertVmImageDetailToInventory,
  withUploadTaskWriteLock,
} from './imageUploadTask.helpers';
import {
  collectImageUploadTaskFilePaths,
  purgeImageUploadTaskStagingFiles,
} from './imageUploadTask.staging';

const reconcileLiveFetchAt = new Map<string, number>();
const RECONCILE_LIVE_FETCH_MS = 5000;

export type ReconcileUploadTasksOptions = {
  /** 列表/删除等路径仅用库存对齐，避免对每个任务打集群 live API 导致长时间无响应 */
  skipLiveClusterFetch?: boolean;
  /** 列表查询等热路径跳过 success 任务暂存清扫，避免 fs 阻塞响应 */
  skipStagingPurge?: boolean;
};

type ClusterImportOutcome = 'success' | 'still_importing' | 'terminal_failed' | 'unknown';

function classifyClusterImportOutcome(detail: unknown): ClusterImportOutcome {
  if (!detail) return 'unknown';
  if (harvesterVmImageImportSucceeded(detail)) return 'success';
  if (harvesterVmImageUploadTerminalFailure(detail)) return 'terminal_failed';
  const hp = readVmImageImportProgress(detail);
  if (Number.isFinite(hp)) return 'still_importing';
  return 'unknown';
}

async function fetchClusterImportOutcomeForUploadTask(
  cloud: any,
  namespace: string,
  name: string,
  insecure: boolean,
): Promise<{ outcome: ClusterImportOutcome; detail: unknown }> {
  let detail: unknown = null;
  try {
    detail = await fetchHarvesterVmImageDetailFromCluster(cloud, namespace, name, insecure);
  } catch {
    detail = null;
  }
  return { outcome: classifyClusterImportOutcome(detail), detail };
}

export async function markUploadTaskProxyingFromCluster(
  taskId: string,
  cloud: any,
  detail: unknown,
  cloudId?: string,
): Promise<void> {
  const hp = clampProgress(Number(readVmImageImportProgress(detail) || 0));
  await updateTaskProgress(taskId, {
    taskStatus: 'proxying',
    phase: 'proxying',
    progress: hp,
    proxyProgress: hp,
    errorCode: undefined,
    errorMessage: undefined,
    finishedAt: undefined,
  });
  const cid = String(cloudId || cloud?.id || '').trim();
  if (detail && cid) {
    try {
      await upsertHarvesterImageInventoryItems(cid, [detail]);
    } catch (e: any) {
      imageUploadTaskLog.warn('upsert inventory while deferring to cluster import failed', {
        taskId,
        err: e?.message || e,
      });
    }
  }
}

export async function resolveUploadTaskAfterTowerProxyError(
  taskId: string,
  cloud: any,
  task: ImageUploadTask,
  err: unknown,
  insecure: boolean,
): Promise<'handled' | 'mark_failed'> {
  const imgNs = String(task.createdImageNamespace || '').trim();
  const imgName = String(task.createdImageName || '').trim();
  if (!imgNs || !imgName) return 'mark_failed';

  const { outcome, detail } = await fetchClusterImportOutcomeForUploadTask(
    cloud,
    imgNs,
    imgName,
    insecure,
  );
  if (outcome === 'success' && detail) {
    const taskRepo = AppDataSource.getRepository(ImageUploadTask);
    const current = await taskRepo.findOne({ where: { id: taskId } });
    if (current) {
      await markUploadTaskSuccessFromCluster(current, cloud, detail, taskRepo);
    }
    return 'handled';
  }
  if (outcome === 'still_importing') {
    await markUploadTaskProxyingFromCluster(taskId, cloud, detail, task.cloudId);
    return 'handled';
  }
  if (outcome === 'terminal_failed' && detail) {
    const failMsg = harvesterVmImageUploadTerminalFailure(detail) || formatImageUploadTaskError(err);
    await updateTaskProgress(taskId, {
      taskStatus: 'failed',
      phase: 'finished',
      errorCode: 'IMPORT_FAILED',
      errorMessage: failMsg,
      finishedAt: new Date(),
    });
    return 'handled';
  }
  return 'mark_failed';
}

async function finalizeStaleProxyingUploadTask(
  task: ImageUploadTask,
  cloud: any,
  detail: unknown,
  taskRepo: ReturnType<typeof AppDataSource.getRepository<ImageUploadTask>>,
): Promise<ImageUploadTask> {
  if (harvesterVmImageImportSucceeded(detail)) {
    return markUploadTaskSuccessFromCluster(task, cloud, detail, taskRepo);
  }
  const failMsg = harvesterVmImageUploadTerminalFailure(detail);
  if (failMsg) {
    task.taskStatus = 'failed';
    task.phase = 'finished';
    task.errorCode = 'IMPORT_FAILED';
    task.errorMessage = failMsg;
    task.finishedAt = new Date();
    task.updatedAt = new Date();
    return withUploadTaskWriteLock(`upload-task:${task.id}`, () => taskRepo.save(task));
  }
  if (!detail) {
    task.taskStatus = 'failed';
    task.phase = 'finished';
    task.errorCode = 'SYNC_INTERRUPTED';
    task.errorMessage = '镜像同步已中断，请在镜像列表点击「同步」重试';
    task.finishedAt = new Date();
    task.updatedAt = new Date();
    return withUploadTaskWriteLock(`upload-task:${task.id}`, () => taskRepo.save(task));
  }
  const hp = clampProgress(Number(readVmImageImportProgress(detail) || 0));
  const prevProxy = clampProgress(Number(task.proxyProgress || 0));
  if (hp > prevProxy) {
    task.proxyProgress = hp;
    task.progress = Math.max(clampProgress(Number(task.progress || 0)), hp);
    task.updatedAt = new Date();
    await withUploadTaskWriteLock(`upload-task:${task.id}`, () => taskRepo.save(task));
  }
  try {
    await upsertHarvesterImageInventoryItems(String(task.cloudId), [detail]);
  } catch (e: any) {
    imageUploadTaskLog.warn('stale proxying reconcile upsert inventory failed', {
      taskId: task.id,
      err: e?.message || e,
    });
  }
  return task;
}

export async function fetchVmImageDetailForTaskReconcile(
  task: ImageUploadTask,
  cloud: any,
  invRaw: unknown,
  opts?: ReconcileUploadTasksOptions,
): Promise<unknown> {
  if (harvesterVmImageImportSucceeded(invRaw)) return invRaw;
  if (!cloud || !task.createdImageName || !task.createdImageNamespace) return invRaw;
  if (opts?.skipLiveClusterFetch) return invRaw;

  const insecure = !!(cloud.config as any)?.ignoreTls;
  const fetchLive = async () => {
    try {
      return await fetchHarvesterVmImageDetailFromCluster(
        cloud,
        task.createdImageNamespace!,
        task.createdImageName!,
        insecure,
      );
    } catch {
      return null;
    }
  };

  const st = String(task.taskStatus || '').toLowerCase();
  const reconcileWithLive =
    st === 'proxying' || st === 'failed' || (st === 'uploaded' && !!task.createdImageName);

  if (st === 'proxying') {
    const live = await fetchLive();
    return live || invRaw;
  }

  if (reconcileWithLive) {
    const lastFetch = reconcileLiveFetchAt.get(task.id) || 0;
    if (Date.now() - lastFetch >= RECONCILE_LIVE_FETCH_MS) {
      reconcileLiveFetchAt.set(task.id, Date.now());
      const live = await fetchLive();
      if (live) return live;
    }
  }

  return invRaw;
}

export async function markUploadTaskSuccessFromCluster(
  task: ImageUploadTask,
  cloud: any,
  detail: unknown,
  taskRepo: ReturnType<typeof AppDataSource.getRepository<ImageUploadTask>>,
): Promise<ImageUploadTask> {
  const insecure = !!(cloud?.config as any)?.ignoreTls;
  const imgNs = String(task.createdImageNamespace || '').trim();
  const imgName = String(task.createdImageName || '').trim();
  if (cloud && imgNs && imgName) {
    try {
      await upsertVmImageDetailToInventory(cloud, '', imgNs, imgName, insecure, detail);
    } catch (e: any) {
      imageUploadTaskLog.warn('upsert inventory after finalize failed', {
        taskId: task.id,
        err: e?.message || e,
      });
    }
  }
  task.taskStatus = 'success';
  task.phase = 'finished';
  task.errorCode = undefined;
  task.errorMessage = undefined;
  task.proxyProgress = 100;
  task.progress = 100;
  task.finishedAt = task.finishedAt || new Date();
  task.updatedAt = new Date();
  const saved = await withUploadTaskWriteLock(`upload-task:${task.id}`, () => taskRepo.save(task));
  await purgeImageUploadTaskStagingFiles(saved);
  return saved;
}

/** proxying 任务与库存对齐：底座 Imported=False 时回写 failed，避免列表长期显示同步中 */
export async function reconcileUploadTasksWithInventory(
  tasks: ImageUploadTask[],
  cloud?: any,
  opts?: ReconcileUploadTasksOptions,
): Promise<ImageUploadTask[]> {
  if (!tasks.length) return tasks;
  const imageRepo = AppDataSource.getRepository(HarvesterImageInventory);
  const taskRepo = AppDataSource.getRepository(ImageUploadTask);
  const out: ImageUploadTask[] = [];
  for (let task of tasks) {
    if (task.taskStatus === 'success') {
      if (!opts?.skipStagingPurge) {
        const { mergedAbsPaths } = collectImageUploadTaskFilePaths(task);
        const hasStagingFile = mergedAbsPaths.some((p) => fs.existsSync(p));
        if (task.localFileRelPath || hasStagingFile) {
          try {
            await purgeImageUploadTaskStagingFiles(task);
          } catch (e: any) {
            imageUploadTaskLog.warn('purge staging files for success task failed', {
              taskId: task.id,
              err: e?.message || e,
            });
          }
        }
      }
      out.push(task);
      continue;
    }

    const needsInventoryReconcile =
      (task.taskStatus === 'proxying' ||
        task.taskStatus === 'failed' ||
        task.taskStatus === 'uploaded') &&
      task.createdImageName &&
      task.createdImageNamespace;
    if (!needsInventoryReconcile) {
      out.push(task);
      continue;
    }
    try {
      const inv = await imageRepo.findOne({
        where: {
          cloudId: task.cloudId,
          namespace: task.createdImageNamespace,
          name: task.createdImageName,
        },
      });
      const detail = await fetchVmImageDetailForTaskReconcile(task, cloud, inv?.rawData, opts);
      const insecure = !!(cloud?.config as any)?.ignoreTls;

      if (detail && (task.taskStatus === 'proxying' || task.taskStatus === 'failed')) {
        const hp = clampProgress(Number(readVmImageImportProgress(detail) || 0));
        const prevProxy = clampProgress(Number(task.proxyProgress || 0));
        const prevProgress = clampProgress(Number(task.progress || 0));
        const syncRestarted = prevProxy <= 0 && prevProgress <= 0;
        if (hp > prevProxy && !(syncRestarted && hp > 0)) {
          task.proxyProgress = hp;
          task.progress = Math.max(prevProgress, hp);
          task.updatedAt = new Date();
          await withUploadTaskWriteLock(`upload-task:${task.id}`, () => taskRepo.save(task));
        }
        if (!(syncRestarted && hp > 0)) {
          try {
            await upsertHarvesterImageInventoryItems(String(task.cloudId), [detail]);
          } catch (e: any) {
            imageUploadTaskLog.warn('reconcile upsert inventory progress failed', {
              taskId: task.id,
              err: e?.message || e,
            });
          }
        }
      }

      const inFlight = isUploadTaskTransferInFlight(task.id) || hasImageUploadProxyRun(task.id);

      if (harvesterVmImageImportSucceeded(detail)) {
        task = await markUploadTaskSuccessFromCluster(task, cloud, detail, taskRepo);
      } else {
        const failMsg = harvesterVmImageUploadTerminalFailure(detail);
        if (failMsg && task.taskStatus !== 'cancelled' && !inFlight) {
          if (detail) {
            try {
              await upsertHarvesterImageInventoryItems(String(task.cloudId), [detail]);
            } catch (e: any) {
              imageUploadTaskLog.warn('reconcile upsert inventory terminal failure failed', {
                taskId: task.id,
                err: e?.message || e,
              });
            }
          }
          const alreadyFailed =
            task.taskStatus === 'failed' && String(task.errorMessage || '').trim() === failMsg;
          if (!alreadyFailed) {
            task.taskStatus = 'failed';
            task.phase = 'finished';
            task.errorCode = 'IMPORT_FAILED';
            task.errorMessage = failMsg;
            task.finishedAt = new Date();
            task.updatedAt = new Date();
            await withUploadTaskWriteLock(`upload-task:${task.id}`, () => taskRepo.save(task));
          }
        } else if (
          !failMsg &&
          task.taskStatus === 'failed' &&
          detail &&
          isActiveHarvesterVmImageImportInProgress(detail) &&
          !harvesterVmImageImportSucceeded(detail) &&
          !inFlight
        ) {
          task.taskStatus = 'proxying';
          task.phase = 'proxying';
          task.errorCode = undefined;
          task.errorMessage = undefined;
          task.finishedAt = undefined;
          task.updatedAt = new Date();
          await withUploadTaskWriteLock(`upload-task:${task.id}`, () => taskRepo.save(task));
        } else if (isUploadTaskProxyingStale(task) && !inFlight) {
          task = await finalizeStaleProxyingUploadTask(task, cloud, detail, taskRepo);
        }
      }
    } catch (e: any) {
      imageUploadTaskLog.warn('reconcile upload task with inventory failed', {
        taskId: task.id,
        err: e?.message || e,
      });
    }
    out.push(task);
  }
  return out;
}

/** 重试同步前删除底座失败镜像 CR，并清理 Ceph/CDI 残留 DataVolume/PVC */
async function deleteClusterVmImageBeforeUploadRetry(
  cloud: any,
  origin: string,
  cloudId: string,
  namespace: string,
  name: string,
  insecure: boolean,
  detail?: unknown,
): Promise<void> {
  const ns = String(namespace || '').trim();
  const imgName = String(name || '').trim();
  if (!ns || !imgName) return;
  const roots = resolveHarvesterClusterApiRoots(cloud.endpoint || '', cloud.config);
  const deleteUrls = [
    ...buildHarvesterVmImageDetailUrls(roots, ns, imgName),
    `${origin}/v1/harvester/harvesterhci.io.virtualmachineimages/${encodeURIComponent(
      ns,
    )}/${encodeURIComponent(imgName)}`,
  ];
  const seen = new Set<string>();
  let clusterDeleted = false;
  for (const url of deleteUrls) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    try {
      await requestJson('DELETE', url, cloud.secretKey || '', insecure, undefined);
      clusterDeleted = true;
      break;
    } catch (e: any) {
      const status = Number(e?.status);
      if (status === 404) continue;
      console.warn(
        '[image-upload-task] delete cluster image before retry failed',
        ns,
        imgName,
        url,
        e?.message || e,
      );
    }
  }
  if (!clusterDeleted) {
    console.warn(
      '[image-upload-task] cluster image delete before retry missed all URLs',
      ns,
      imgName,
    );
  }
  try {
    await deleteVmImageCdiStorageOrphans(harvesterConn(cloud), origin, ns, imgName, detail);
  } catch (e: any) {
    console.warn(
      '[image-upload-task] delete CDI storage before retry failed',
      ns,
      imgName,
      e?.message || e,
    );
  }
  try {
    await AppDataSource.getRepository(HarvesterImageInventory).delete({
      cloudId: String(cloudId || cloud?.id || '').trim(),
      namespace: ns,
      name: imgName,
    });
  } catch {
    /* ignore */
  }
}

/** 同步重试开始时清零库存行 progress，避免列表仍展示上一轮失败残留进度 */
async function resetImageInventoryProgressForUploadRetry(
  cloudId: string,
  namespace: string,
  imageName: string,
): Promise<void> {
  const ns = String(namespace || '').trim();
  const name = String(imageName || '').trim();
  if (!ns || !name) return;
  try {
    const imageRepo = AppDataSource.getRepository(HarvesterImageInventory);
    const inv = await imageRepo.findOne({ where: { cloudId, namespace: ns, name } });
    if (!inv) return;
    const raw =
      inv.rawData && typeof inv.rawData === 'object' && !Array.isArray(inv.rawData)
        ? { ...(inv.rawData as Record<string, unknown>) }
        : {};
    const status =
      raw.status && typeof raw.status === 'object' && !Array.isArray(raw.status)
        ? { ...(raw.status as Record<string, unknown>) }
        : {};
    delete status.progress;
    raw.status = status;
    delete raw.progress;
    await imageRepo.update({ cloudId, namespace: ns, name }, { progress: 0, rawData: raw as any });
  } catch (e: any) {
    imageUploadTaskLog.warn('reset inventory progress on sync retry failed', {
      cloudId,
      namespace: ns,
      name,
      err: e?.message || e,
    });
  }
}

export function resolveHarvesterOrigin(cloud: any): string {
  const base = String(cloud?.endpoint || '').replace(/\/+$/, '');
  try {
    const u = new URL(base);
    return `${u.protocol}//${u.host}`;
  } catch {
    return base.replace(/\/v[0-9].*$/, '');
  }
}

/**
 * 同步重试前：删除底座未成功镜像并清库存进度，避免沿用上一轮 CR 的 status.progress。
 * 返回 already_imported 时调用方应直接收成 success。
 */
export async function prepareClusterImageForUploadRetry(
  cloud: any,
  cloudId: string,
  task: ImageUploadTask,
  namespace: string,
  imageName: string,
): Promise<'ready' | 'already_imported'> {
  const ns = String(namespace || '').trim();
  const name = String(imageName || '').trim();
  if (!ns || !name) return 'ready';

  const insecure = !!(cloud?.config as any)?.ignoreTls;
  const origin = resolveHarvesterOrigin(cloud);
  let existingDetail: unknown = null;
  try {
    existingDetail = await fetchHarvesterVmImageDetailFromCluster(cloud, ns, name, insecure);
  } catch {
    existingDetail = null;
  }

  if (existingDetail && harvesterVmImageImportSucceeded(existingDetail)) {
    return 'already_imported';
  }

  if (existingDetail) {
    await deleteClusterVmImageBeforeUploadRetry(
      cloud,
      origin,
      cloudId,
      ns,
      name,
      insecure,
      existingDetail,
    );
  }
  await resetImageInventoryProgressForUploadRetry(cloudId, ns, name);
  task.createdImageName = undefined;
  task.createdImageNamespace = undefined;
  return 'ready';
}
