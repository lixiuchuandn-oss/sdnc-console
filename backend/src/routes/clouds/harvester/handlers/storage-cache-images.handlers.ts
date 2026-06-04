/**
 * Harvester Images Handlers
 *
 * 从 harvester.cache.storage.routes.ts 中提取的 Images 相关业务逻辑
 */

import fs from 'fs';
import crypto from 'crypto';
import http from 'http';
import https from 'https';
import path from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';

import { Request, Response } from 'express';
import multer from 'multer';
import axios from 'axios';
import { FindOptionsWhere } from 'typeorm';

import {
  AppDataSource,
  ensureImageUploadTaskTable,
  ensureImageUploadTaskTableColumns,
} from '../../../../config/database';
import { HarvesterImageInventory } from '../../../../entities/harvester/HarvesterImageInventory';
import { ImageUploadTask } from '../../../../entities/harvester/ImageUploadTask';
import { UserSpace } from '../../../../entities/UserSpace';
import { syncHarvesterImages, upsertHarvesterImageInventoryItems } from '../../../../services/clouds/harvester/inventory';
import {
  fetchHarvesterVmImageDetailFromCluster,
  readVmImageVirtualSizeBytes,
  readVmImageImportProgress,
  isHarvesterVmImageImportComplete,
  resolveVmImageVirtualSizeFromCluster,
  buildHarvesterVmImageDetailUrls,
  resolveHarvesterClusterApiRoots,
} from '../../../../services/clouds/harvester/vmImageClusterApi';
import {
  getPublicScenarioNamespaceNames,
  mergePublicScenarioNamespacesFromQuery,
} from '../../../../services/clouds/harvester/publicNamespaces';
import {
  resolveVmImageStorageProfile,
  buildHarvesterVmImageSpecFields,
  vmImageCephHarvesterExtraAnnotations,
  type VmImageStorageProfile,
} from '../../../../services/clouds/harvester/client';
import { getJsonOnce, requestJson } from '../../../../services/clouds/harvester/utils';
import {
  assertGlobalImageTaskSlot,
  isGlobalImageUploadBusyError,
  respondGlobalImageUploadBusy,
} from './imageUploadGlobalConcurrency';
import { harvesterNativeStreamUpload } from './harvesterImageStreamUpload';
import {
  checkImageUploadDiskSpace,
  ensureImageUploadTempRoot,
  getImageUploadTempRoot,
  imageUploadTaskMergedAbsPath,
} from '../../../../utils/imageUploadStorage';
import { isSqliteTransactionError, withSqliteWriteLock } from '../../../../utils/sqliteWriteLock';
import {
  deleteImageUploadAbortController,
  getImageUploadAbortController,
  getImageUploadInFlightTaskIds,
  hasImageUploadProxyInFlightForCloud,
  isUploadTaskTransferInFlight,
  registerImageUploadProxyEnd,
  registerImageUploadProxyStart,
  setImageUploadAbortController,
} from './imageUploadRuntime';
// ---------------------------------------------------------------------------
// 镜像列表：命名空间条件与公共空间（tower.io/scenario=public）
// ---------------------------------------------------------------------------

type ImageInventoryWhere =
  | FindOptionsWhere<HarvesterImageInventory>
  | FindOptionsWhere<HarvesterImageInventory>[];

function uniqueNamespaceWhere(
  cloudId: string,
  namespaces: string[],
): FindOptionsWhere<HarvesterImageInventory>[] {
  const seen = new Set<string>();
  const out: FindOptionsWhere<HarvesterImageInventory>[] = [];
  for (const raw of namespaces) {
    const ns = String(raw || '').trim();
    if (!ns || seen.has(ns)) continue;
    seen.add(ns);
    out.push({ cloudId, namespace: ns });
  }
  return out;
}

function harvesterVmImageImportFailure(detail: unknown): string | null {
  if (!detail || typeof detail !== 'object') return null;
  const d = detail as { status?: { conditions?: Array<{ type?: string; status?: string; message?: string; reason?: string }> } };
  const conds = Array.isArray(d.status?.conditions) ? d.status!.conditions! : [];
  const imported = conds.find((c) => c?.type === 'Imported');
  if (imported?.status === 'False') {
    return String(imported.message || imported.reason || 'Harvester 导入镜像失败');
  }
  return null;
}

function harvesterVmImageImportSucceeded(detail: unknown): boolean {
  return isHarvesterVmImageImportComplete(detail);
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

function isInternalTowerDbError(e: unknown): boolean {
  return isInternalTowerDbErrorMessage((e as { message?: string })?.message || e) || isSqliteTransactionError(e);
}

const reconcileLiveFetchAt = new Map<string, number>();
const RECONCILE_LIVE_FETCH_MS = 5000;

async function withUploadTaskWriteLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  return withSqliteWriteLock(key, fn);
}

function harvesterVmImageUploadTerminalFailure(detail: unknown): string | null {
  if (!detail || typeof detail !== 'object') return null;
  const d = detail as {
    status?: {
      conditions?: Array<{ type?: string; status?: string; reason?: string; message?: string }>;
    };
  };
  const imported = (d.status?.conditions || []).find((c) => c?.type === 'Imported');
  if (imported?.status !== 'False' && imported?.status !== 'false') return null;

  const reason = String(imported?.reason || '').trim();
  const msg = String(imported?.message || '').trim();
  const terminalReasons = ['UploadFailed', 'ImportFailed', 'Canceled', 'Cancelled'];
  if (terminalReasons.includes(reason)) {
    return msg || reason || 'Harvester 导入镜像失败';
  }
  const lower = `${msg} ${reason}`.toLowerCase();
  if (
    lower.includes('upload failed') ||
    lower.includes('context canceled') ||
    lower.includes('connection refused') ||
    lower.includes('proxy error') ||
    lower.includes(' i/o timeout') ||
    lower.includes('eof')
  ) {
    return msg || reason || 'Harvester 导入镜像失败';
  }
  return null;
}

async function fetchVmImageDetailForTaskReconcile(
  task: ImageUploadTask,
  cloud: any,
  invRaw: unknown,
): Promise<unknown> {
  const terminalFromInv = harvesterVmImageUploadTerminalFailure(invRaw);
  if (terminalFromInv) return invRaw;
  if (harvesterVmImageImportSucceeded(invRaw)) return invRaw;
  if (!cloud || !task.createdImageName || !task.createdImageNamespace) return invRaw;

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

  if (task.taskStatus === 'proxying') {
    const live = await fetchLive();
    return live || invRaw;
  }

  const lastFetch = reconcileLiveFetchAt.get(task.id) || 0;
  if (Date.now() - lastFetch < RECONCILE_LIVE_FETCH_MS) return invRaw;
  reconcileLiveFetchAt.set(task.id, Date.now());
  const live = await fetchLive();
  return live || invRaw;
}

/** proxying 任务与库存对齐：底座 Imported=False 时回写 failed，避免列表长期显示同步中 */
async function reconcileUploadTasksWithInventory(
  tasks: ImageUploadTask[],
  cloud?: any,
): Promise<ImageUploadTask[]> {
  if (!tasks.length) return tasks;
  const imageRepo = AppDataSource.getRepository(HarvesterImageInventory);
  const taskRepo = AppDataSource.getRepository(ImageUploadTask);
  const out: ImageUploadTask[] = [];
  for (const task of tasks) {
    const needsInventoryReconcile =
      (task.taskStatus === 'proxying' ||
        task.taskStatus === 'cancelled' ||
        (task.taskStatus === 'failed' && isInternalTowerDbErrorMessage(task.errorMessage))) &&
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
      const detail = await fetchVmImageDetailForTaskReconcile(task, cloud, inv?.rawData);
      const insecure = !!(cloud?.config as any)?.ignoreTls;

      if (detail && task.taskStatus === 'proxying') {
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
        } catch {
          /* 轮询对齐库存进度失败不阻断 */
        }
      }

      const inFlight = getImageUploadInFlightTaskIds().has(task.id);
      const failMsg = inFlight
        ? harvesterVmImageUploadTerminalFailure(detail)
        : harvesterVmImageImportFailure(detail);
      if (failMsg) {
        if (getImageUploadInFlightTaskIds().has(task.id)) {
          getImageUploadAbortController(task.id)?.abort();
        }
        task.taskStatus = 'failed';
        task.phase = 'finished';
        task.errorCode = 'IMPORT_FAILED';
        task.errorMessage = failMsg;
        task.finishedAt = new Date();
        task.updatedAt = new Date();
        await withUploadTaskWriteLock(`upload-task:${task.id}`, () => taskRepo.save(task));
      } else if (harvesterVmImageImportSucceeded(detail)) {
        const imgNs = String(task.createdImageNamespace || '').trim();
        const imgName = String(task.createdImageName || '').trim();
        if (cloud && imgNs && imgName) {
          try {
            await upsertVmImageDetailToInventory(cloud, '', imgNs, imgName, insecure, detail);
          } catch {
            /* 就绪后写 virtualSize 失败不阻断任务终态 */
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
        await withUploadTaskWriteLock(`upload-task:${task.id}`, () => taskRepo.save(task));
      }
    } catch {
      /* ignore reconcile errors */
    }
    out.push(task);
  }
  return out;
}

function deriveLonghornImageStorageClassFromName(name: string): string | undefined {
  const n = String(name || '').trim();
  const m = /^image-([a-z0-9]+)$/i.exec(n);
  if (m?.[1]) return `longhorn-image-${m[1]}`;
  return undefined;
}

function resolveImageStorageClassName(
  i: HarvesterImageInventory,
  r: Record<string, any>,
): string {
  const name = String(r.metadata?.name || r.name || i.name || '').trim();
  const ann = (r.metadata?.annotations || {}) as Record<string, string>;

  const statusSc = String(r.status?.storageClassName || '').trim();
  if (statusSc) return statusSc;

  const derived = deriveLonghornImageStorageClassFromName(name);
  if (derived) return derived;

  const specSc = String(r.spec?.storageClassName || r.spec?.targetStorageClassName || '').trim();
  if (specSc && specSc !== 'longhorn') return specSc;

  for (const candidate of [
    String(r.storageClassName || '').trim(),
    String(i.storageClassName || '').trim(),
    String(ann['harvesterhci.io/storageClassName'] || '').trim(),
  ]) {
    if (candidate.startsWith('longhorn-image-')) return candidate;
  }

  if (specSc) return specSc;
  if (derived) return derived;

  const annSc = String(ann['harvesterhci.io/storageClassName'] || '').trim();
  const invSc = String(i.storageClassName || r.storageClassName || '').trim();
  if (invSc && invSc !== 'longhorn') return invSc;
  if (annSc && annSc !== 'longhorn') return annSc;
  return annSc || invSc || String(r.storageClassName || '').trim();
}

function resolveImageInventoryDisplayFields(
  i: HarvesterImageInventory,
  r: Record<string, any>,
): { size: number; virtualSize?: number; storageClassName: string } {
  const invSizeNum = Number(i.size);
  const statusSizeRaw = r.status?.size ?? r.status?.downloadedBytes;
  const statusSizeNum = Number(statusSizeRaw);
  const topSizeNum = Number(r.size);
  const size =
    (Number.isFinite(statusSizeNum) && statusSizeNum > 0 ? statusSizeNum : 0) ||
    (Number.isFinite(invSizeNum) && invSizeNum > 0 ? invSizeNum : 0) ||
    (Number.isFinite(topSizeNum) && topSizeNum > 0 ? topSizeNum : 0);

  const virtualSize = readVmImageVirtualSizeBytes(r);

  const storageClassName = resolveImageStorageClassName(i, r);
  return { size, virtualSize, storageClassName };
}

function mapImageInventoryToListItem(
  i: HarvesterImageInventory,
  publicScenarioNsSet: Set<string>,
): Record<string, unknown> {
  const r = (i.rawData || {}) as Record<string, any>;
  const name = r.metadata?.name || i.name || '';
  const namespace = r.metadata?.namespace || i.namespace || '';
  const displayName = r.spec?.displayName || i.displayName || name;
  const { size, virtualSize, storageClassName } = resolveImageInventoryDisplayFields(i, r);
  const rawProgress = Number(r.status?.progress);
  const invProgress = Number(i.progress);
  const progress =
    Number.isFinite(invProgress) && invProgress > 0
      ? invProgress
      : Number.isFinite(rawProgress) && rawProgress > 0
        ? rawProgress
        : invProgress || rawProgress || 0;
  const conditions = (
    Array.isArray(r.status?.conditions)
      ? r.status.conditions
      : Array.isArray(r.conditions)
        ? r.conditions
        : []
  ) as Array<{ type?: string; status?: string }>;
  const sourceType = r.spec?.sourceType || r.sourceType || '';
  const clusterProgress = readVmImageImportProgress(r);
  const effectiveProgress: number =
    typeof clusterProgress === 'number' &&
    Number.isFinite(clusterProgress) &&
    clusterProgress >= 0
      ? clusterProgress
      : progress;
  let state = 'Unknown';
  const imported = conditions.find((c) => c?.type === 'Imported');
  if (imported?.status === 'True' || imported?.status === 'true') state = 'Active';
  else if (imported?.status === 'False') state = 'Failed';
  else if (effectiveProgress > 0 && effectiveProgress < 100) {
    if (sourceType === 'upload') state = 'Uploading';
    else if (sourceType === 'export') state = 'Exporting';
    else if (sourceType === 'download') state = 'Importing';
    else state = 'Downloading';
  } else if (effectiveProgress >= 100 && isHarvesterVmImageImportComplete(r)) state = 'Active';
  else if (sourceType === 'download') state = 'Importing';
  else if (sourceType === 'upload') state = 'Uploading';

  return {
    ...r,
    id: r.metadata?.uid || i.uid,
    name,
    namespace,
    namespacePublicByScenario: publicScenarioNsSet.has(namespace),
    displayName,
    size,
    ...(virtualSize != null ? { virtualSize } : {}),
    storageClassName,
    progress,
    state,
    sourceType,
    createdAt: r.metadata?.creationTimestamp,
    conditions,
    status: {
      ...(r.status && typeof r.status === 'object' && !Array.isArray(r.status) ? r.status : {}),
      ...(size > 0 ? { size } : {}),
      ...(virtualSize != null && virtualSize > 0 ? { virtualSize } : {}),
      ...(storageClassName ? { storageClassName } : {}),
    },
    spec: {
      ...(r.spec && typeof r.spec === 'object' ? r.spec : {}),
      ...(storageClassName ? { storageClassName } : {}),
    },
  };
}

function readVirtualSizeFromVmImage(obj: unknown): number | undefined {
  return readVmImageVirtualSizeBytes(obj);
}

/** 镜像在 Harvester 已导入完成时：拉集群详情（含 virtualSize）写入 Tower 库存 */
async function upsertVmImageDetailToInventory(
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

/**
 * GET …/images — 列表（租户按 UserSpace + 公共场景命名空间过滤；每条带 namespacePublicByScenario）
 */
export async function harvesterImageListHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id } = req.params;
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const reqAny = req as any;

    const repo = AppDataSource.getRepository(HarvesterImageInventory);
    let whereCondition: ImageInventoryWhere = { cloudId: id };
    let publicScenarioNsSet: Set<string>;

    const isTenantUser = Boolean(reqAny.user?.tenantId && reqAny.user?.role !== 'sase_device');
    const isTenantRole = reqAny.user?.role === 'tenant';

    if (isTenantUser || isTenantRole) {
      const tenantId = reqAny.user.tenantId;
      const userSpaceRepo = AppDataSource.getRepository(UserSpace);
      const matches = await userSpaceRepo.find({
        where: [
          { tenantId, cloudId: id, status: 'active', organizationId: reqAny.user.organizationId },
          { tenantId, cloudId: id, status: 'active', organizationId: null },
        ],
      });
      const us = matches.find((m) => m.organizationId === reqAny.user.organizationId) ?? matches[0];

      if (!us) {
        return res.json({ message: '查询成功', data: { items: [] } });
      }

      const mergePublic = mergePublicScenarioNamespacesFromQuery(req);
      const publicNsNames = mergePublic ? await getPublicScenarioNamespaceNames(id) : [];
      publicScenarioNsSet = new Set(publicNsNames);
      const organizationId = reqAny.user.organizationId as string | undefined;

      if (us.namespace) {
        const allowed = us.namespace
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);

        if (organizationId) {
          const orgNs = `ns-${organizationId}`;
          if (!allowed.includes(orgNs)) {
            allowed.push(orgNs);
            us.namespace = allowed.join(',');
            try {
              await userSpaceRepo.save(us);
            } catch (e) {
              console.warn('Failed to auto-update UserSpace namespace', e);
            }
          }
        }

        whereCondition = uniqueNamespaceWhere(
          id,
          mergePublic ? [...allowed, ...publicNsNames] : allowed,
        );
      } else if (organizationId) {
        const orgNs = `ns-${organizationId}`;
        us.namespace = orgNs;
        try {
          await userSpaceRepo.save(us);
          whereCondition = uniqueNamespaceWhere(
            id,
            mergePublic ? [orgNs, ...publicNsNames] : [orgNs],
          );
        } catch (e) {
          console.warn('Failed to auto-update UserSpace namespace', e);
          whereCondition = mergePublic
            ? uniqueNamespaceWhere(id, publicNsNames)
            : uniqueNamespaceWhere(id, []);
        }
      } else {
        whereCondition = mergePublic
          ? uniqueNamespaceWhere(id, publicNsNames)
          : uniqueNamespaceWhere(id, []);
      }
    } else {
      publicScenarioNsSet = new Set(await getPublicScenarioNamespaceNames(id));
    }

    if (Array.isArray(whereCondition) && whereCondition.length === 0) {
      return res.json({ message: '查询成功', data: { items: [] } });
    }

    const { force, skipSync } = req.query;
    const count = await repo.count({ where: whereCondition });
    const proxyBusy = hasImageUploadProxyInFlightForCloud(id);
    const shouldSync =
      !proxyBusy &&
      (count === 0 || (String(force) === 'true' && String(skipSync) !== 'true'));

    if (shouldSync) {
      try {
        await syncHarvesterImages(cloud, insecure);
      } catch (e: unknown) {
        console.warn('Sync Images failed, falling back to empty/stale', e);
        if (count === 0) throw e;
      }
    } else if (proxyBusy && String(force) === 'true' && String(skipSync) !== 'true') {
      console.debug(
        `[images] skip full inventory sync for cloud ${id}: upload proxy in flight`,
      );
    }

    const items = await repo.find({ where: whereCondition });
    const list = items.map((i) => mapImageInventoryToListItem(i, publicScenarioNsSet));

    res.json({ message: '查询成功', data: { items: list } });
  } catch (error: unknown) {
    if (res.headersSent) return;
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ message: '查询镜像失败', error: message });
  }
}

/**
 * GET /:id/resources/harvester/images/:namespace/:name - 获取镜像详情
 */
export async function harvesterImageDetailHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id: _id, namespace, name } = req.params;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const { detail, virtualSize } = await resolveVmImageVirtualSizeFromCluster(
      cloud,
      namespace,
      name,
      insecure,
    );
    if (!detail) return res.status(404).json({ message: '镜像不存在' });

    if (virtualSize != null && isHarvesterVmImageImportComplete(detail)) {
      try {
        await upsertHarvesterImageInventoryItems(_id, [detail]);
      } catch {
        /* 单条 detail 写库存失败不阻断查询 */
      }
    }

    res.json({ message: '查询成功', data: detail });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询镜像详情失败', error: error.message });
  }
}

/**
 * POST /:id/resources/harvester/images - 创建镜像
 */
export async function harvesterImageCreateHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id: _id } = req.params;
    const {
      namespace,
      name,
      displayName,
      sourceType,
      url,
      diskFormat,
      targetStorageClassName,
      _storageClassParameters,
    } = (req.body || {}) as any;

    if (!namespace || !(name || displayName))
      return res.status(400).json({ message: '缺少必填参数：namespace、name 或 displayName' });

    const displayStr = displayName || name || 'image';

    const existingRepo = AppDataSource.getRepository(HarvesterImageInventory);
    const existingImage = await existingRepo.findOne({
      where: {
        cloudId: cloud.id,
        displayName: displayStr,
      },
    });

    if (existingImage) {
      return res
        .status(500)
        .json({ message: `创建镜像失败:镜像名称${displayStr}已存在，请更换镜像名称再试` });
    }

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const base = (cloud.endpoint || '').replace(/\/+$/, '');
    let origin = base;
    try {
      const u = new URL(base);
      origin = `${u.protocol}//${u.host}`;
    } catch {
      origin = base.replace(/\/v[0-9].*$/, '');
    }
    const urlV1beta1 = `${origin}/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(
      namespace,
    )}/virtualmachineimages`;
    const urlV1 = `${origin}/apis/harvesterhci.io/v1/namespaces/${encodeURIComponent(
      namespace,
    )}/virtualmachineimages`;
    const diskFmtLower = String(diskFormat || '').toLowerCase();
    const imageTypeLabel: 'iso' | 'disk' | undefined =
      diskFmtLower === 'iso'
        ? 'iso'
        : diskFmtLower === 'qcow2' || diskFmtLower === 'raw'
          ? 'disk'
          : undefined;
    const storageProfile = await resolveVmImageStorageProfile(
      harvesterConn(cloud),
      targetStorageClassName,
    );
    const scName = storageProfile.storageClassName;
    const { labels: createLabels, annotations: createAnnotations } = vmImageHarvesterMetadataLikeUi(
      {
        displayName: displayStr,
        imageTypeLabel,
        imageNameForAnnotation: displayStr,
        storageClassName: scName,
        storageProfile,
      },
    );
    const body = {
      apiVersion: 'harvesterhci.io/v1beta1',
      kind: 'VirtualMachineImage',
      metadata: {
        name: name || undefined,
        generateName: name ? undefined : 'image-',
        namespace,
        labels: createLabels,
        annotations: createAnnotations,
      },
      spec: buildHarvesterVmImageSpecFields({
        profile: storageProfile,
        displayName: displayStr,
        sourceType: sourceType || (url ? 'download' : 'upload'),
        url: url || '',
        diskFormat,
      }),
    };
    let json: any;
    try {
      json = await requestJson('POST', urlV1beta1, cloud.secretKey || '', insecure, body);
    } catch {
      json = await requestJson('POST', urlV1, cloud.secretKey || '', insecure, body);
    }

    // [数据同步] 创建成功后，直接使用返回的数据入库
    if (json && json.metadata && json.metadata.uid) {
      try {
        const repo = AppDataSource.getRepository(HarvesterImageInventory);
        const uid = json.metadata.uid;
        const existing = await repo.findOne({ where: { cloudId: cloud.id, uid } });

        if (existing) {
          // 更新现有记录
          existing.name = json.metadata?.name || '';
          existing.namespace = json.metadata?.namespace || namespace;
          existing.displayName = json.spec?.displayName || displayName || name;
          existing.progress = json.status?.progress;
          existing.size = String(json.status?.size || json.status?.downloadedBytes || '0');
          existing.storageClassName = json.spec?.storageClassName || targetStorageClassName;
          existing.labels = json.metadata?.labels;
          existing.annotations = json.metadata?.annotations;
          existing.rawData = json;
          await repo.save(existing);
          console.log(
            `[Image-Create] 镜像已更新，cloudId: ${cloud.id}, name: ${json.metadata?.name}`,
          );
        } else {
          // 插入新记录
          const entity = repo.create({
            cloudId: cloud.id,
            uid: uid,
            name: json.metadata?.name || '',
            namespace: json.metadata?.namespace || namespace,
            displayName: json.spec?.displayName || displayName || name,
            progress: json.status?.progress,
            size: String(json.status?.size || json.status?.downloadedBytes || '0'),
            storageClassName: json.spec?.storageClassName || targetStorageClassName,
            labels: json.metadata?.labels,
            annotations: json.metadata?.annotations,
            rawData: json,
          });
          await repo.save(entity);
          console.log(
            `[Image-Create] 镜像已入库，cloudId: ${cloud.id}, name: ${json.metadata?.name}`,
          );
        }
      } catch (e: any) {
        console.error('[Image-Create] 入库镜像失败:', e?.message || e);
        // 入库失败不影响创建操作的成功返回
      }
    } else if (json && json.metadata && !json.metadata.uid) {
      console.warn(
        `[Image-Create] 创建成功但返回数据缺少 uid，跳过入库，cloudId: ${cloud.id}, name: ${json.metadata?.name || name}`,
      );
    }

    res.json({ message: '创建成功', data: json });
  } catch (error: any) {
    if (res.headersSent) return;
    const body = (req.body || {}) as any;
    const displayStr = body.displayName || body.name || 'image';

    console.error('[Image-Create] 创建镜像失败，详细错误:', JSON.stringify(error, null, 2));

    const errorMsg = error.message || String(error);
    const errorBody = error.body
      ? typeof error.body === 'object'
        ? JSON.stringify(error.body)
        : String(error.body)
      : '';
    const combinedError = (errorMsg + ' ' + errorBody).toLowerCase();

    if (
      combinedError.includes('already exists') ||
      combinedError.includes('镜像名称') ||
      (combinedError.includes('name') && combinedError.includes('exist'))
    ) {
      res
        .status(500)
        .json({ message: `创建镜像失败:镜像名称${displayStr}已存在，请更换镜像名称再试` });
    } else {
      res.status(500).json({ message: '创建镜像失败', error: errorMsg });
    }
  }
}

/**
 * PATCH /:id/resources/harvester/images/:namespace/:name/patch - Patch 镜像
 */
export async function harvesterImagePatchHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id, namespace, name } = req.params;
    const payload = req.body;
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const contentType =
      String(req.headers['content-type'] || 'application/merge-patch+json')
        .split(';')[0]
        .trim() || 'application/merge-patch+json';

    const base = (cloud.endpoint || '').replace(/\/+$/, '');
    let origin = base;
    try {
      const u = new URL(base);
      origin = `${u.protocol}//${u.host}`;
    } catch {
      origin = base.replace(/\/v[0-9].*$/, '');
    }

    const patchUrl = `${origin}/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(
      namespace,
    )}/virtualmachineimages/${encodeURIComponent(name)}`;

    const json = await requestJson('PATCH', patchUrl, cloud.secretKey || '', insecure, payload, {
      'Content-Type': contentType,
    });
    try {
      if (json?.metadata?.uid) {
        const repo = AppDataSource.getRepository(HarvesterImageInventory);
        await repo.update(
          { cloudId: id, uid: json.metadata.uid },
          {
            labels: json.metadata?.labels,
            annotations: json.metadata?.annotations,
            rawData: json,
          },
        );
      }
    } catch {}
    res.json({ message: 'Patch 更新成功', data: json });
  } catch (error: any) {
    res.status(500).json({ message: 'Patch 镜像失败', error: error.message });
  }
}

/**
 * PUT /:id/resources/harvester/images/:namespace/:name - 更新镜像
 */
export async function harvesterImageUpdateHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id: _id, namespace, name } = req.params;
    const { displayName, retry, targetStorageClassName, storageClassParameters } = (req.body ||
      {}) as any;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const base = (cloud.endpoint || '').replace(/\/+$/, '');
    let origin = base;
    try {
      const u = new URL(base);
      origin = `${u.protocol}//${u.host}`;
    } catch {
      origin = base.replace(/\/v[0-9].*$/, '');
    }
    const getUrl = `${origin}/apis/harvesterhci.io/v1/namespaces/${encodeURIComponent(
      namespace,
    )}/virtualmachineimages/${encodeURIComponent(name)}`;
    const current = await getJsonOnce(getUrl, cloud.secretKey || '', insecure);
    const next = {
      apiVersion: current?.apiVersion || 'harvesterhci.io/v1beta1',
      kind: current?.kind || 'VirtualMachineImage',
      metadata: { ...(current?.metadata || {}), name, namespace },
      spec: {
        ...(current?.spec || {}),
        ...(displayName ? { displayName } : {}),
        ...(typeof retry === 'number' ? { retry } : {}),
        ...(targetStorageClassName ? { targetStorageClassName } : {}),
        ...(storageClassParameters ? { storageClassParameters } : {}),
      },
    };
    const putUrl = getUrl;
    const json = await requestJson('PUT', putUrl, cloud.secretKey || '', insecure, next);
    res.json({ message: '更新成功', data: json });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '更新镜像失败', error: error.message });
  }
}

/**
 * DELETE /:id/resources/harvester/images/:namespace/:name - 删除镜像
 */
export async function harvesterImageDeleteHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id, namespace, name } = req.params;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const base = (cloud.endpoint || '').replace(/\/+$/, '');
    let origin = base;
    try {
      const u = new URL(base);
      origin = `${u.protocol}//${u.host}`;
    } catch {
      origin = base.replace(/\/v[0-9].*$/, '');
    }
    const url = `${origin}/v1/harvester/harvesterhci.io.virtualmachineimages/${encodeURIComponent(
      namespace,
    )}/${encodeURIComponent(name)}`;
    await requestJson('DELETE', url, cloud.secretKey || '', insecure, undefined);

    const repo = AppDataSource.getRepository(HarvesterImageInventory);
    await repo.delete({ cloudId: id, namespace, name });

    res.json({ message: '删除成功' });
  } catch (error: any) {
    if (res.headersSent) return;
    const status = Number(error?.status);
    const httpStatus = status >= 400 && status < 600 ? status : 500;
    const detail = String(error?.message || '').trim();
    res.status(httpStatus).json({
      message: detail || '删除镜像失败',
      error: detail || undefined,
    });
  }
}

// Harvester 镜像上传任务：multer 落盘目录、并发去重、取消用 AbortController
ensureImageUploadTempRoot();
const imageTaskUpload = multer({ dest: getImageUploadTempRoot() });

function globalImageTaskSlotOpts(excludeTaskId?: string) {
  return { excludeTaskId, inFlightTaskIds: getImageUploadInFlightTaskIds() };
}

/** 浏览器分片上传默认片大小 32MiB（大文件创建任务时会按体积分档） */
export const IMAGE_UPLOAD_DEFAULT_CHUNK_SIZE = 32 * 1024 * 1024;
/** 单片上限 64MiB，需与 raw body limit 一致 */
export const IMAGE_UPLOAD_MAX_CHUNK_SIZE = 64 * 1024 * 1024;

function imageTaskMergedRelPath(taskId: string): string {
  return `${taskId}.merged`;
}

function imageTaskMergedAbsPath(task: ImageUploadTask): string {
  return imageUploadTaskMergedAbsPath(task);
}

/** 创建任务时预分配 .merged，分片按偏移直写，无需末尾再合并 */
async function ensureImageUploadMergedPreallocated(task: ImageUploadTask): Promise<string> {
  const relPath = imageTaskMergedRelPath(task.id);
  const absPath = path.join(getImageUploadTempRoot(), relPath);
  await fs.promises.mkdir(path.dirname(absPath), { recursive: true });
  const size = Math.max(0, Math.floor(Number(task.fileSize) || 0));
  const fh = await fs.promises.open(absPath, 'w');
  try {
    await fh.truncate(size);
  } finally {
    await fh.close();
  }
  return relPath;
}

function chunkWriteOffset(
  chunkSize: number,
  chunkIndex: number,
): number {
  return Math.max(0, Math.floor(chunkSize)) * Math.max(0, Math.floor(chunkIndex));
}

async function writeChunkToMergedFile(
  mergedPath: string,
  offset: number,
  body: Buffer,
): Promise<void> {
  const fh = await fs.promises.open(mergedPath, 'r+');
  try {
    await fh.write(body, 0, body.length, offset);
  } finally {
    await fh.close();
  }
}

function parseReceivedChunkIndices(raw: unknown): number[] {
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => Math.floor(Number(x)))
      .filter((n) => Number.isInteger(n) && n >= 0)
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

function setReceivedChunkIndices(task: ImageUploadTask, indices: number[]): void {
  const uniq = [...new Set(indices.filter((n) => Number.isInteger(n) && n >= 0))].sort(
    (a, b) => a - b,
  );
  task.receivedChunksJson = JSON.stringify(uniq);
}

/** 并行分片上传时串行化 receivedChunksJson 更新，避免读-改-写丢片 */
const imageUploadChunkLockTails = new Map<string, Promise<void>>();

async function withImageUploadChunkLock<T>(
  taskId: string,
  fn: () => Promise<T>,
): Promise<T> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const prev = imageUploadChunkLockTails.get(taskId) ?? Promise.resolve();
  const tail = prev.then(() => gate);
  imageUploadChunkLockTails.set(taskId, tail);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (imageUploadChunkLockTails.get(taskId) === tail) {
      imageUploadChunkLockTails.delete(taskId);
    }
  }
}

function reconcileReceivedChunkIndices(task: ImageUploadTask): number[] {
  return parseReceivedChunkIndices(task.receivedChunksJson);
}

async function persistChunkReceivedIndices(
  taskId: string,
  chunkIndex: number,
): Promise<ImageUploadTask> {
  return withImageUploadChunkLock(taskId, async () => {
    const repo = AppDataSource.getRepository(ImageUploadTask);
    const fresh = await repo.findOne({ where: { id: taskId } });
    if (!fresh) throw new Error('任务不存在');

    const totalChunks = Math.max(0, Math.floor(Number(fresh.totalChunks) || 0));
    const fileSize = Math.max(0, Math.floor(Number(fresh.fileSize) || 0));
    const cs = Math.max(1, Math.floor(Number(fresh.chunkSize) || IMAGE_UPLOAD_DEFAULT_CHUNK_SIZE));
    const received = reconcileReceivedChunkIndices(fresh);
    if (!received.includes(chunkIndex)) received.push(chunkIndex);
    received.sort((a, b) => a - b);
    setReceivedChunkIndices(fresh, received);

    fresh.taskStatus = 'ingesting';
    fresh.phase = 'ingesting';
    fresh.startedAt = fresh.startedAt || new Date();
    fresh.errorCode = undefined;
    fresh.errorMessage = undefined;

    const lastChunkSize = expectedChunkByteSize(fileSize, cs, totalChunks, totalChunks - 1);
    let bytesDone = 0;
    for (const idx of received) {
      bytesDone += idx < totalChunks - 1 ? cs : lastChunkSize;
    }
    fresh.bytesUploaded = Math.min(fileSize, bytesDone);
    fresh.ingestProgress = computeChunkIngestProgress(received.length, totalChunks);
    fresh.progress = roundIngestProgress(fresh.ingestProgress);
    return repo.save(fresh);
  });
}

function computeTotalChunks(fileSize: number, chunkSize: number): number {
  const size = Math.max(0, Math.floor(fileSize));
  const cs = Math.max(1, Math.floor(chunkSize));
  if (size < 1) return 0;
  return Math.ceil(size / cs);
}

/** 某分片 index 应有的字节数（最后一片可能小于 chunkSize） */
function expectedChunkByteSize(
  fileSize: number,
  chunkSize: number,
  totalChunks: number,
  chunkIndex: number,
): number {
  const cs = Math.max(1, Math.floor(chunkSize));
  const total = Math.max(0, Math.floor(totalChunks));
  const idx = Math.floor(chunkIndex);
  if (idx < 0 || idx >= total) return 0;
  if (idx < total - 1) return cs;
  return Math.max(0, Math.floor(fileSize) - cs * Math.max(0, total - 1));
}

function cleanupImageUploadTaskFiles(task: ImageUploadTask): void {
  /* 兼容旧版分片目录 */
  const legacyChunkDir = path.join(getImageUploadTempRoot(), 'chunks', task.id);
  try {
    if (fs.existsSync(legacyChunkDir)) fs.rmSync(legacyChunkDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  const root = getImageUploadTempRoot();
  const rel = String(task.localFileRelPath || '').trim();
  if (rel) {
    try {
      const abs = path.join(root, rel);
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    } catch {
      /* ignore */
    }
  }
  try {
    const defaultMerged = path.join(root, `${task.id}.merged`);
    if (fs.existsSync(defaultMerged)) fs.unlinkSync(defaultMerged);
  } catch {
    /* ignore */
  }
}

async function clearImageUploadTaskLocalFileRelPath(taskId: string): Promise<void> {
  try {
    const repo = AppDataSource.getRepository(ImageUploadTask);
    const task = await repo.findOne({ where: { id: taskId } });
    if (task?.localFileRelPath) {
      task.localFileRelPath = undefined;
      await repo.save(task);
    }
  } catch {
    /* ignore */
  }
}

async function assertImageUploadTaskAccess(
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

function isCancelError(e: any): boolean {
  const code = String(e?.code || '');
  const name = String(e?.name || '');
  const msg = String(e?.message || '');
  return code === 'ERR_CANCELED' || name === 'CanceledError' || msg === 'CANCELLED';
}

function abortUploadTask(taskId: string) {
  const c = getImageUploadAbortController(taskId);
  if (c && !c.signal.aborted) c.abort();
}

async function throwIfUploadCancelled(
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

/** 客户端断开或未完整发送 body 时中止下游 axios，避免挂死 */
function bindClientDisconnectAbort(inbound: Readable, abortController: AbortController): void {
  const abortIfNeeded = () => {
    if (!abortController.signal.aborted) abortController.abort();
  };
  inbound.on('error', abortIfNeeded);
  inbound.on('close', () => {
    if (!inbound.readableEnded) abortIfNeeded();
  });
}

/** 源 Readable 报错时中止整个上传 */
function bindReadableAbortOnError(readable: Readable, abortController: AbortController): void {
  readable.on('error', () => {
    try {
      abortController.abort();
    } catch {
      /* ignore */
    }
  });
}

function destroyReadablePair(a: Readable, b: Readable): void {
  for (const s of [a, b]) {
    try {
      s.destroy();
    } catch {
      /* ignore */
    }
  }
}

function clampProgress(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** 分片 ingest 进度（保留两位小数，避免 TB 级文件长期显示 0%） */
function roundIngestProgress(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v * 100) / 100));
}

function computeChunkIngestProgress(receivedCount: number, totalChunks: number): number {
  if (totalChunks < 1 || receivedCount < 1) return 0;
  return roundIngestProgress((receivedCount / totalChunks) * 100);
}

function formatImageUploadTaskError(e: any): string {
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

function isRetryableHarvesterStreamUploadError(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  const code = String(err?.code || '');
  const msg = String(err?.message || '');
  return (
    code === 'EPROTO' ||
    code === 'ECONNRESET' ||
    code === 'EPIPE' ||
    /write EPROTO|socket hang up|SSL routines/i.test(msg)
  );
}

async function withHarvesterStreamUploadRetry(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (first) {
    if (!isRetryableHarvesterStreamUploadError(first)) throw first;
    await new Promise((r) => setTimeout(r, 1500));
    await run();
  }
}

/** CDI DataVolume 准入：存储容量至少 1MiB（与 datavolume-validate.cdi.kubevirt.io 一致） */
const CDI_MIN_UPLOAD_BYTES = 1024 * 1024;

function resolveImageUploadByteTotal(task: ImageUploadTask, body: ImageUploadBodySource): number {
  const fromBody = Math.max(0, Math.floor(Number(body.byteTotal) || 0));
  if (fromBody > 0) return fromBody;
  const fromTask = Math.max(0, Math.floor(Number(task.fileSize) || 0));
  if (fromTask > 0) return fromTask;
  if (body.unlinkPath) {
    try {
      if (fs.existsSync(body.unlinkPath)) {
        return Math.max(0, fs.statSync(body.unlinkPath).size || 0);
      }
    } catch {
      /* ignore stat errors */
    }
  }
  return 0;
}

function assertCdiCompatibleUploadSize(total: number, profile: VmImageStorageProfile): void {
  if (profile.kind !== 'ceph') return;
  if (total >= CDI_MIN_UPLOAD_BYTES) return;
  throw new Error(
    total > 0
      ? `镜像文件过小（${total} 字节）；Ceph/CDI 要求 DataVolume 容量至少 1MiB，请选择有效镜像文件`
      : '无法确定镜像文件大小（0 字节）。请确认文件已完整上传，或检查 Content-Length / X-File-Size 请求头',
  );
}

/** Longhorn backingimage 需 512 对齐；Ceph/CDI 使用真实文件字节数 */
function computeProxyUploadByteSize(total: number, profile: VmImageStorageProfile): number {
  if (profile.kind === 'ceph') return total;
  const padding = total % 512 === 0 ? 0 : 512 - (total % 512);
  return total + padding;
}

/** 覆盖 upload URL 中已有 size=0 等无效值，避免 CDI 创建 0 容量 DataVolume */
function withUploadSizeQuery(uploadTarget: string, byteSize: number): string {
  if (byteSize < 1) return uploadTarget;
  try {
    const absolute = /^https?:\/\//i.test(uploadTarget);
    const u = new URL(uploadTarget, absolute ? undefined : 'http://upload.local');
    u.searchParams.set('size', String(byteSize));
    if (absolute) return u.href;
    return `${u.pathname}${u.search}`;
  } catch {
    if (/[?&]size=\d+/i.test(uploadTarget)) {
      return uploadTarget.replace(/([?&])size=\d+/i, `$1size=${byteSize}`);
    }
    const sep = uploadTarget.includes('?') ? '&' : '?';
    return `${uploadTarget}${sep}size=${byteSize}`;
  }
}

/** 将 application/octet-stream 请求体落盘（与 multer 路径一致，避免创建镜像轮询期间不读 body） */
async function ingestOctetStreamToTempFile(
  req: Request,
  destPath: string,
  expectedSize: number,
  taskId: string,
  abortController: AbortController,
): Promise<void> {
  bindClientDisconnectAbort(req, abortController);
  let received = 0;
  let lastUpdateAt = 0;
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      if (abortController.signal.aborted) {
        callback(new Error('CANCELLED'));
        return;
      }
      const n = chunk.length || Buffer.byteLength(chunk);
      received += n;
      const now = Date.now();
      if (now - lastUpdateAt > 400) {
        lastUpdateAt = now;
        const ingestProgress =
          expectedSize > 0 ? clampProgress((received / expectedSize) * 100) : 0;
        void updateTaskProgress(taskId, {
          ingestProgress,
          bytesUploaded: received,
          progress: clampProgress(ingestProgress),
        }).catch(() => {
          /* ignore progress DB noise */
        });
      }
      callback(null, chunk);
    },
  });
  await pipeline(req, counter, fs.createWriteStream(destPath));
  await updateTaskProgress(taskId, {
    ingestProgress: 100,
    bytesUploaded: expectedSize > 0 ? Math.min(received, expectedSize) : received,
    progress: 100,
  });
}

function harvesterConn(cloud: any) {
  return {
    endpoint: cloud.endpoint,
    token: cloud.secretKey || '',
    insecure: !!(cloud.config as any)?.ignoreTls,
  };
}

/**
 * 从文件名/展示名猜测 os-type（与 Harvester 控制台展示风格接近；无法识别时为空字符串）
 */
function guessOsTypeFromImageName(name: string): string {
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

/**
 * 对齐 Harvester 控制台创建的 VirtualMachineImage：labels（image-type / imageDisplayName / os-type）与 annotations（image-name / storageClassName）
 */
function vmImageHarvesterMetadataLikeUi(params: {
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

function sanitizeTask(task: ImageUploadTask) {
  return {
    id: task.id,
    cloudId: task.cloudId,
    namespace: task.namespace,
    displayName: task.displayName,
    imageType: task.imageType,
    filename: task.filename,
    fileSize: task.fileSize,
    chunkSize: task.chunkSize,
    totalChunks: task.totalChunks,
    receivedChunks: parseReceivedChunkIndices(task.receivedChunksJson),
    status: task.taskStatus,
    phase: task.phase,
    progress: task.progress,
    ingestProgress: task.ingestProgress,
    proxyProgress: task.proxyProgress,
    bytesUploaded: task.bytesUploaded,
    errorCode: task.errorCode,
    errorMessage: task.errorMessage,
    createdBy: task.createdBy,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    expiresAt: task.expiresAt,
    retryCount: task.retryCount,
    createdImageName: task.createdImageName,
    createdImageNamespace: task.createdImageNamespace,
  };
}

function resolveUploadUrl(payload: any): string | null {
  const candidates = [
    payload?.links?.upload,
    payload?.actions?.upload,
    payload?.status?.uploadUrl,
    payload?.status?.uploadURL,
    payload?.uploadUrl,
    payload?.uploadURL,
    payload?.data?.links?.upload,
    payload?.data?.actions?.upload,
    payload?.data?.status?.uploadUrl,
    payload?.data?.status?.uploadURL,
    payload?.data?.uploadUrl,
    payload?.data?.uploadURL,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return null;
}

async function pollHarvesterVmImageUploadUrl(
  origin: string,
  cloud: { endpoint?: string; secretKey?: string; config?: any },
  namespace: string,
  name: string,
  insecure: boolean,
  opts: {
    created?: any;
    pollMax: number;
    taskId: string;
    abortController: AbortController;
  },
): Promise<string | null> {
  let uploadUrl = resolveUploadUrl(opts.created);
  if (uploadUrl) return uploadUrl;

  const directDetailCandidates = (() => {
    const roots = resolveHarvesterClusterApiRoots(cloud.endpoint || '', cloud.config);
    return [...buildHarvesterVmImageDetailUrls(roots, namespace, name)];
  })();
  const selfLink = String(opts.created?.links?.self || '').trim();
  if (selfLink) {
    if (/^https?:\/\//i.test(selfLink)) {
      directDetailCandidates.unshift(selfLink);
    } else if (selfLink.startsWith('/')) {
      directDetailCandidates.unshift(`${origin}${selfLink}`);
    }
  }

  for (let i = 0; i < opts.pollMax && !uploadUrl; i++) {
    await throwIfUploadCancelled(opts.taskId, opts.abortController);
    for (const detailUrl of directDetailCandidates) {
      try {
        const detail = await getJsonOnce(detailUrl, cloud.secretKey || '', insecure, true);
        uploadUrl = resolveUploadUrl(detail);
        if (uploadUrl) break;
      } catch {
        /* ignore */
      }
    }
    if (!uploadUrl) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  if (!uploadUrl && name) {
    uploadUrl = `${origin}/v1/harvester/harvesterhci.io.virtualmachineimages/${encodeURIComponent(
      namespace,
    )}/${encodeURIComponent(name)}?action=upload`;
  }
  return uploadUrl;
}

function cleanupImageUploadLocalFile(localPath?: string): void {
  if (!localPath) return;
  try {
    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
  } catch {
    /* ignore */
  }
}

async function updateTaskProgress(
  taskId: string,
  patch: Partial<ImageUploadTask>,
): Promise<ImageUploadTask | null> {
  return withUploadTaskWriteLock(`upload-task:${taskId}`, async () => {
    const repo = AppDataSource.getRepository(ImageUploadTask);
    const t = await repo.findOne({ where: { id: taskId } });
    if (!t) return null;
    Object.assign(t, patch);
    t.updatedAt = new Date();
    const saved = await repo.save(t);

    // 代传中进度由 upload-task overlay 展示，勿高频写库存表（减轻 SQLite 争用）
    const progressOnly =
      patch.taskStatus === undefined &&
      patch.phase === undefined &&
      (patch.progress !== undefined || patch.proxyProgress !== undefined);
    if (
      !progressOnly &&
      patch.progress !== undefined &&
      t.cloudId &&
      t.createdImageNamespace &&
      t.createdImageName
    ) {
      try {
        const imageRepo = AppDataSource.getRepository(HarvesterImageInventory);
        await imageRepo.update(
          {
            cloudId: t.cloudId,
            namespace: t.createdImageNamespace,
            name: t.createdImageName,
          },
          { progress: saved.progress },
        );
      } catch (e) {
        console.warn('Failed to update image inventory progress', e);
      }
    }

    return saved;
  });
}

/** 代传进度写入：SQLite 繁忙时跳过，避免 setInterval 未捕获异常拖垮代传 */
async function safeUpdateTaskProgress(
  taskId: string,
  patch: Partial<ImageUploadTask>,
): Promise<void> {
  try {
    await updateTaskProgress(taskId, patch);
  } catch (e) {
    if (isInternalTowerDbError(e)) {
      console.warn('[image-upload-task] progress save skipped (db busy)', taskId);
      return;
    }
    throw e;
  }
}

/** 磁盘文件或 HTTP 请求体 → Harvester 的统一字节源描述 */
type ImageUploadBodySource = {
  byteTotal: number;
  preferredBasename?: string;
  createBodyReadable: () => Readable;
  unlinkPath?: string;
  onProxyComplete?: () => void | Promise<void>;
  bindRequestStream?: Readable;
};

function createHarvesterPutProgressTransform(
  taskId: string,
  total: number,
  abortController: AbortController,
): Transform {
  let sent = 0;
  let lastUpdateAt = 0;
  return new Transform({
    transform(chunk, _encoding, callback) {
      if (abortController.signal.aborted) {
        callback(new Error('CANCELLED'));
        return;
      }
      const n = chunk.length || Buffer.byteLength(chunk);
      sent += n;
      const now = Date.now();
      if (now - lastUpdateAt > 2000) {
        lastUpdateAt = now;
        void updateTaskProgress(taskId, {
          bytesUploaded: Math.min(sent, total),
        }).catch(() => {
          /* ignore DB noise during upload byte tracking */
        });
      }
      callback(null, chunk);
    },
  });
}

async function runImageUploadTaskWithBody(taskId: string, cloud: any, body: ImageUploadBodySource) {
  if (getImageUploadInFlightTaskIds().has(taskId)) return;
  const repo = AppDataSource.getRepository(ImageUploadTask);
  const taskForCloud = await repo.findOne({ where: { id: taskId } });
  const cloudId = String(taskForCloud?.cloudId || cloud?.id || '').trim();
  registerImageUploadProxyStart(cloudId, taskId);
  const abortController = new AbortController();
  setImageUploadAbortController(taskId, abortController);
  let proxyCompleted = false;
  try {
    const task = taskForCloud;
    if (!task) return;
    if (task.taskStatus === 'cancelled') return;

    if (body.bindRequestStream) {
      bindClientDisconnectAbort(body.bindRequestStream, abortController);
    }

    task.startedAt = task.startedAt || new Date();
    task.errorCode = undefined;
    task.errorMessage = undefined;
    await repo.save(task);

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const base = (cloud.endpoint || '').replace(/\/+$/, '');
    let origin = base;
    try {
      const u = new URL(base);
      origin = `${u.protocol}//${u.host}`;
    } catch {
      origin = base.replace(/\/v[0-9].*$/, '');
    }

    // 1) 创建 upload 类型镜像资源，拿到上传 URL
    // 浏览器上传任务里用户选择的镜像类型（iso / disk）必须写入 spec.diskFormat，否则 Harvester 默认按 qcow2 处理
    const uploadDiskFormat =
      String(task.imageType || '').toLowerCase() === 'iso'
        ? 'iso'
        : String(task.imageType || '').toLowerCase() === 'disk'
          ? 'qcow2'
          : undefined;
    const displayLabel = task.displayName || task.filename || 'image-upload-task';
    const imageTypeLabel: 'iso' | 'disk' | undefined =
      uploadDiskFormat === 'iso' ? 'iso' : uploadDiskFormat === 'qcow2' ? 'disk' : undefined;
    const uploadStorageProfile = await resolveVmImageStorageProfile(harvesterConn(cloud));
    const uploadByteTotal = resolveImageUploadByteTotal(task, body);
    assertCdiCompatibleUploadSize(uploadByteTotal, uploadStorageProfile);
    if (uploadByteTotal > 0 && task.fileSize !== uploadByteTotal) {
      task.fileSize = uploadByteTotal;
      await repo.save(task);
    }
    const uploadScName = uploadStorageProfile.storageClassName;
    const { labels: uploadLabels, annotations: uploadAnnotations } = vmImageHarvesterMetadataLikeUi(
      {
        displayName: displayLabel,
        imageTypeLabel,
        imageNameForAnnotation: task.filename || displayLabel,
        storageClassName: uploadScName,
        storageProfile: uploadStorageProfile,
      },
    );
    const payload = {
      apiVersion: 'harvesterhci.io/v1beta1',
      kind: 'VirtualMachineImage',
      metadata: {
        generateName: 'image-',
        namespace: task.namespace,
        labels: uploadLabels,
        annotations: uploadAnnotations,
      },
      spec: buildHarvesterVmImageSpecFields({
        profile: uploadStorageProfile,
        displayName: displayLabel,
        sourceType: 'upload',
        diskFormat: uploadDiskFormat,
      }),
    };
    // 与 uploader 对齐：优先 Steve API 创建，兼容 K8s API
    const createCandidates = [
      `${origin}/v1/harvester/harvesterhci.io.virtualmachineimages`,
      `${origin}/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(
        task.namespace,
      )}/virtualmachineimages`,
      `${origin}/apis/harvesterhci.io/v1/namespaces/${encodeURIComponent(
        task.namespace,
      )}/virtualmachineimages`,
    ];
    let created: any = null;
    let createLastErr: any = null;
    const existingName = String(task.createdImageName || '').trim();
    const existingNs = String(task.createdImageNamespace || task.namespace || '').trim();

    if (existingName && existingNs) {
      const existingDetail = await fetchHarvesterVmImageDetailFromCluster(
        cloud,
        existingNs,
        existingName,
        insecure,
      );
      if (existingDetail) {
        if (harvesterVmImageImportSucceeded(existingDetail)) {
          try {
            await upsertVmImageDetailToInventory(
              cloud,
              origin,
              existingNs,
              existingName,
              insecure,
              existingDetail,
            );
          } catch {
            /* ignore */
          }
          await updateTaskProgress(taskId, {
            taskStatus: 'success',
            phase: 'finished',
            proxyProgress: 100,
            progress: 100,
            finishedAt: new Date(),
          });
          cleanupImageUploadLocalFile(body.unlinkPath);
          void clearImageUploadTaskLocalFileRelPath(taskId);
          void syncHarvesterImages(cloud, insecure, { allowDuringUploadProxy: true }).catch(
            () => undefined,
          );
          return;
        }
        if (!harvesterVmImageImportFailure(existingDetail)) {
          created = existingDetail;
        } else {
          task.createdImageName = undefined;
          task.createdImageNamespace = undefined;
          await repo.save(task);
        }
      }
    }

    if (!created) {
      for (const createUrl of createCandidates) {
        try {
          created = await requestJson('POST', createUrl, cloud.secretKey || '', insecure, payload);
          if (created) break;
        } catch (e: any) {
          createLastErr = e;
        }
      }
      if (!created && createLastErr) {
        throw new Error(formatImageUploadTaskError(createLastErr));
      }
    }

    const createdImageName = created?.metadata?.name || existingName || '';
    const createdImageNamespace =
      created?.metadata?.namespace || existingNs || task.namespace;

    if (createdImageName) {
      task.createdImageName = createdImageName;
      task.createdImageNamespace = createdImageNamespace;
      await repo.save(task);
      try {
        await upsertHarvesterImageInventoryItems(String(cloud.id || task.cloudId), [created]);
      } catch {
        /* 单条增量入库失败不阻断代传 */
      }
    }

    const pollMax = uploadStorageProfile.kind === 'ceph' ? 90 : 20;
    const uploadUrl = await pollHarvesterVmImageUploadUrl(
      origin,
      cloud,
      createdImageNamespace,
      createdImageName,
      insecure,
      { created, pollMax, taskId, abortController },
    );

    if (!uploadUrl) throw new Error('Harvester 未返回 upload URL');

    await throwIfUploadCancelled(taskId, abortController);

    // 2) 通过 Tower 代传文件到 Harvester upload URL
    const total = uploadByteTotal;
    assertCdiCompatibleUploadSize(total, uploadStorageProfile);
    const proxyByteSize = computeProxyUploadByteSize(total, uploadStorageProfile);
    const uploadBasename =
      task.filename ||
      body.preferredBasename ||
      (body.unlinkPath ? path.basename(body.unlinkPath) : 'image');

    const uploadTarget = /^https?:\/\//i.test(String(uploadUrl || ''))
      ? String(uploadUrl)
      : `${origin}${String(uploadUrl).startsWith('/') ? '' : '/'}${String(uploadUrl)}`;

    await updateTaskProgress(taskId, {
      taskStatus: 'proxying',
      phase: 'proxying',
      progress: 0,
      proxyProgress: 0,
    });

    const pollDetailCandidates = (() => {
      const roots = resolveHarvesterClusterApiRoots(cloud.endpoint || '', cloud.config);
      return buildHarvesterVmImageDetailUrls(roots, createdImageNamespace, createdImageName);
    })();

    // action=upload 与 uploader 对齐：使用 multipart/form-data + 字段名 chunk + size 参数
    if (uploadTarget.includes('action=upload')) {
      const finalSize = proxyByteSize;
      const finalTarget = withUploadSizeQuery(uploadTarget, finalSize);
      const padding = Math.max(0, finalSize - total);
      const filename = uploadBasename;

      const followHarvesterProgress = async () => {
        try {
          let detail: any = null;
          for (const detailUrl of pollDetailCandidates) {
            try {
              detail = await getJsonOnce(detailUrl, cloud.secretKey || '', insecure, true);
              if (detail) break;
            } catch {
              // try next
            }
          }
          if (!detail) return;
          const failMsg = harvesterVmImageUploadTerminalFailure(detail);
          if (failMsg) {
            if (!abortController.signal.aborted) abortController.abort();
            await safeUpdateTaskProgress(taskId, {
              taskStatus: 'failed',
              phase: 'finished',
              errorCode: 'IMPORT_FAILED',
              errorMessage: failMsg,
              finishedAt: new Date(),
            });
            return;
          }
          const hp = clampProgress(Number(detail?.status?.progress || 0));
          await safeUpdateTaskProgress(taskId, {
            progress: hp,
            proxyProgress: hp,
          });
        } catch (e) {
          if (!isInternalTowerDbError(e)) {
            console.warn('[image-upload-task] followHarvesterProgress error', taskId, e);
          }
        }
      };

      const runMultipartUploadOnce = async () => {
        const boundary = `HarvesterBoundary${Date.now()}${Math.random().toString(16).slice(2)}`;
        const inboundBody = body.createBodyReadable();
        bindReadableAbortOnError(inboundBody, abortController);
        const header = Buffer.from(
          `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="chunk"; filename="${filename}"\r\n` +
            `Content-Type: application/octet-stream\r\n` +
            `Content-Length: ${finalSize}\r\n` +
            `\r\n`,
        );
        const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
        const contentLength = header.length + finalSize + footer.length;
        let sent = 0;
        let lastUpdateAt = 0;
        let chunkCount = 0;

        await harvesterNativeStreamUpload({
          method: 'POST',
          url: finalTarget,
          insecure,
          signal: abortController.signal,
          headers: {
            Authorization: `Bearer ${cloud.secretKey || ''}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': contentLength,
          },
          async pump(write) {
            await write(header);
            for await (const chunk of inboundBody as AsyncIterable<Buffer | string>) {
              if (++chunkCount % 32 === 0) {
                await throwIfUploadCancelled(taskId, abortController);
              }
              const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
              sent += buf.length;
              const now = Date.now();
              if (now - lastUpdateAt > 2000) {
                lastUpdateAt = now;
                await updateTaskProgress(taskId, {
                  bytesUploaded: Math.min(sent, total),
                });
              }
              await write(buf);
            }
            await throwIfUploadCancelled(taskId, abortController);
            if (padding > 0) await write(Buffer.alloc(padding));
            await write(footer);
          },
        });
      };

      try {
        const harvesterProgressTimer = setInterval(() => {
          void followHarvesterProgress();
        }, 10000);
        try {
          await withHarvesterStreamUploadRetry(runMultipartUploadOnce);
        } finally {
          clearInterval(harvesterProgressTimer);
        }
      } catch (uploadErr: any) {
        throw new Error(formatImageUploadTaskError(uploadErr));
      }
      await updateTaskProgress(taskId, {
        bytesUploaded: total,
      });
    } else {
      if (total < 1) {
        throw new Error(
          '无法确定镜像文件大小，CDI 直传需要有效的 Content-Length（请确认文件已完整落盘）',
        );
      }
      const runPutUploadOnce = async () => {
        const rawIn = body.createBodyReadable();
        bindReadableAbortOnError(rawIn, abortController);
        let sent = 0;
        let lastUpdateAt = 0;
        await harvesterNativeStreamUpload({
          method: 'PUT',
          url: uploadTarget,
          insecure,
          signal: abortController.signal,
          headers: {
            Authorization: `Bearer ${cloud.secretKey || ''}`,
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(total),
          },
          async pump(write) {
            for await (const chunk of rawIn as AsyncIterable<Buffer | string>) {
              await throwIfUploadCancelled(taskId, abortController);
              const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
              sent += buf.length;
              const now = Date.now();
              if (now - lastUpdateAt > 2000) {
                lastUpdateAt = now;
                void updateTaskProgress(taskId, {
                  bytesUploaded: Math.min(sent, total),
                }).catch(() => undefined);
              }
              await write(buf);
            }
          },
        });
      };
      try {
        await withHarvesterStreamUploadRetry(runPutUploadOnce);
      } catch (uploadErr: any) {
        throw new Error(formatImageUploadTaskError(uploadErr));
      }
    }

    if (body.onProxyComplete) {
      await body.onProxyComplete();
      proxyCompleted = true;
    }

    // 3) 代传完成后，继续轮询集群导入进度直至 Imported
    const importDeadline =
      Date.now() +
      Math.max(
        30 * 60 * 1000,
        Math.ceil(total / (50 * 1024 * 1024)) * 10 * 60 * 1000,
      );
    let imported = false;
    while (Date.now() < importDeadline && !imported) {
      await throwIfUploadCancelled(taskId, abortController);
      const detail = await fetchHarvesterVmImageDetailFromCluster(
        cloud,
        createdImageNamespace,
        createdImageName,
        insecure,
      );
      if (detail) {
        const hp = clampProgress(Number(detail?.status?.progress || 0));
        if (isHarvesterVmImageImportComplete(detail)) {
          imported = true;
          break;
        }
        const terminalFail = harvesterVmImageUploadTerminalFailure(detail);
        if (terminalFail) {
          throw new Error(terminalFail);
        }
        const repo = AppDataSource.getRepository(ImageUploadTask);
        const current = await repo.findOne({ where: { id: taskId } });
        const currentProxy = clampProgress(Number(current?.proxyProgress || 0));
        const nextProxy = Math.max(currentProxy, hp);
        if (nextProxy !== currentProxy) {
          await safeUpdateTaskProgress(taskId, {
            progress: nextProxy,
            proxyProgress: nextProxy,
          });
        }
      }
      await new Promise((r) => setTimeout(r, 10000));
    }
    if (!imported) {
      throw new Error('Harvester 导入进度等待超时');
    }

    const imgNs = createdImageNamespace;
    const imgName = createdImageName;
    if (imgNs && imgName) {
      try {
        await upsertVmImageDetailToInventory(cloud, origin, imgNs, imgName, insecure);
      } catch {
        /* 单条 detail 入库失败不阻断 */
      }
    }
    await updateTaskProgress(taskId, {
      taskStatus: 'success',
      phase: 'finished',
      proxyProgress: 100,
      progress: 100,
      bytesUploaded: total,
      finishedAt: new Date(),
    });
    void syncHarvesterImages(cloud, !!(cloud.config as any)?.ignoreTls, {
      allowDuringUploadProxy: true,
    }).catch(() => undefined);
    cleanupImageUploadLocalFile(body.unlinkPath);
    void clearImageUploadTaskLocalFileRelPath(taskId);
  } catch (e: any) {
    if (isCancelError(e)) {
      await updateTaskProgress(taskId, {
        taskStatus: 'cancelled',
        phase: 'finished',
        finishedAt: new Date(),
      });
      if (body.onProxyComplete && !proxyCompleted) throw e;
      return;
    }
    await updateTaskProgress(taskId, {
      taskStatus: 'failed',
      phase: 'finished',
      errorCode: 'UPLOAD_FAILED',
      errorMessage: formatImageUploadTaskError(e),
      finishedAt: new Date(),
    });
    if (body.onProxyComplete && !proxyCompleted) {
      throw new Error(formatImageUploadTaskError(e));
    }
  } finally {
    registerImageUploadProxyEnd(cloudId, taskId);
    deleteImageUploadAbortController(taskId);
  }
}

async function runImageUploadTask(taskId: string, cloud: any, filePath: string) {
  const stat = fs.statSync(filePath);
  await runImageUploadTaskWithBody(taskId, cloud, {
    byteTotal: stat.size || 0,
    preferredBasename: path.basename(filePath),
    createBodyReadable: () => fs.createReadStream(filePath),
    unlinkPath: filePath,
  });
}

/**
 * POST /:id/resources/harvester/images/upload-proxy
 * 单次 multipart：namespace、displayName、imageType、file；等价于「创建 upload-task + POST .../file」。
 * tools/uploader 等客户端通过 Tower 代理上传时使用此路径。
 */
export async function harvesterImageUploadProxyHandler(req: Request, res: Response) {
  imageTaskUpload.single('file')(req, res, async (err: any) => {
    try {
      if (err)
        return res
          .status(400)
          .json({ message: '文件接收失败', error: err?.message || String(err) });
      const { id } = req.params;
      const userId = String((req as any)?.user?.id || '');
      if (!userId) return res.status(401).json({ message: '未登录或用户无效' });

      const namespace = String((req.body as any)?.namespace || '').trim();
      const displayName = String((req.body as any)?.displayName || '').trim();
      const imageType = String((req.body as any)?.imageType || '').trim();
      if (!namespace) return res.status(400).json({ message: '缺少参数：namespace' });

      const cloud = (req as any).cloud;
      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file) return res.status(400).json({ message: '缺少上传文件，字段名应为 file' });

      await assertGlobalImageTaskSlot(globalImageTaskSlotOpts());

      const repo = AppDataSource.getRepository(ImageUploadTask);
      const now = new Date();
      const expires = new Date(now.getTime() + 30 * 60 * 1000);
      const task = repo.create({
        cloudId: id,
        namespace,
        displayName: displayName || undefined,
        imageType: imageType || undefined,
        taskStatus: 'pending',
        phase: 'pending',
        progress: 0,
        ingestProgress: 0,
        proxyProgress: 0,
        bytesUploaded: 0,
        createdBy: userId,
        expiresAt: expires,
        retryCount: 0,
      });
      const saved = await repo.save(task);

      saved.filename = file.originalname;
      saved.fileSize = file.size;
      saved.taskStatus = 'ingesting';
      saved.phase = 'ingesting';
      saved.ingestProgress = 100;
      saved.progress = 1;
      saved.bytesUploaded = 0;
      saved.startedAt = saved.startedAt || new Date();
      saved.errorCode = undefined;
      saved.errorMessage = undefined;
      await repo.save(saved);

      void runImageUploadTask(saved.id, cloud, file.path).catch((err) => {
        console.warn('[image-upload-proxy]', saved.id, err?.message || err);
      });

      res.status(202).json({
        message: '文件已接收，任务执行中',
        data: { taskId: saved.id, status: saved.taskStatus, phase: saved.phase },
      });
    } catch (error: any) {
      if (res.headersSent) return;
      if (isGlobalImageUploadBusyError(error)) {
        respondGlobalImageUploadBusy(res, error);
        return;
      }
      res.status(500).json({ message: '代理上传失败', error: error.message });
    }
  });
}

/**
 * POST /:id/resources/harvester/images/upload-token
 * 为指定命名空间下的 ServiceAccount 签发短期 Token（Kubernetes TokenRequest）。
 * tools/uploader 直连 Harvester 前向 Tower 申请短期凭证时使用。
 */
export async function harvesterImageUploadTokenHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const {
      namespace: nsRaw,
      serviceAccountName: saRaw,
      expirationSeconds: expRaw,
    } = (req.body || {}) as any;
    const namespace = (String(nsRaw || 'default').trim() || 'default') as string;
    const serviceAccountName = (String(saRaw || 'image-uploader').trim() ||
      'image-uploader') as string;
    let expirationSeconds = Math.floor(Number(expRaw) || 300);
    if (expirationSeconds < 60) expirationSeconds = 60;
    if (expirationSeconds > 600) expirationSeconds = 600;

    const base = (cloud.endpoint || '').replace(/\/+$/, '');
    let origin = base;
    try {
      const u = new URL(base);
      origin = `${u.protocol}//${u.host}`;
    } catch {
      origin = base.replace(/\/v[0-9].*$/, '');
    }

    const tokenBody = {
      apiVersion: 'authentication.k8s.io/v1',
      kind: 'TokenRequest',
      spec: {
        expirationSeconds,
        audiences: ['https://kubernetes.default.svc'],
      },
    };

    const candidates = [
      `${origin}/apis/authentication.k8s.io/v1/namespaces/${encodeURIComponent(namespace)}/serviceaccounts/${encodeURIComponent(serviceAccountName)}/token`,
      `${origin}/k8s/clusters/local/apis/authentication.k8s.io/v1/namespaces/${encodeURIComponent(namespace)}/serviceaccounts/${encodeURIComponent(serviceAccountName)}/token`,
    ];

    const isHttp = origin.startsWith('http:');
    const httpAgent = new http.Agent({ keepAlive: true });
    const httpsAgent = new https.Agent({ keepAlive: true, rejectUnauthorized: !insecure });

    let lastErr: any;
    for (const url of candidates) {
      try {
        const r = await axios.post(url, tokenBody, {
          headers: {
            Authorization: `Bearer ${cloud.secretKey || ''}`,
            'Content-Type': 'application/json',
          },
          timeout: 60000,
          httpAgent: isHttp ? httpAgent : undefined,
          httpsAgent: !isHttp ? httpsAgent : undefined,
        });
        const token = r.data?.status?.token;
        if (token) {
          const expTs = r.data?.status?.expirationTimestamp;
          return res.json({
            message: 'ok',
            data: {
              namespace,
              serviceAccountName,
              expirationSeconds,
              token,
              expiresAt: expTs || undefined,
            },
          });
        }
        lastErr = new Error('TokenRequest 响应中无 token');
      } catch (e: any) {
        lastErr = e;
      }
    }
    return res.status(502).json({
      message: '签发上传 Token 失败（请确认集群支持 TokenRequest 且 ServiceAccount 存在）',
      error: lastErr?.response?.data
        ? JSON.stringify(lastErr.response.data)
        : lastErr?.message || String(lastErr),
    });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '签发上传 Token 失败', error: error.message });
  }
}

/**
 * POST /:id/resources/harvester/images/upload-tasks - 创建上传任务
 */
async function saveImageUploadTaskRecord(task: ImageUploadTask): Promise<ImageUploadTask> {
  const repo = AppDataSource.getRepository(ImageUploadTask);
  try {
    return await repo.save(task);
  } catch (first: any) {
    const msg = String(first?.message || first || '');
    if (!/no column named/i.test(msg) && !/has no column/i.test(msg)) {
      throw first;
    }
    await ensureImageUploadTaskTable();
    await ensureImageUploadTaskTableColumns();
    return await repo.save(task);
  }
}

export async function harvesterImageUploadTaskDiskCheckHandler(req: Request, res: Response) {
  try {
    const fileSize = Math.max(0, Math.floor(Number(req.query?.fileSize) || 0));
    if (fileSize < 1) {
      return res.status(400).json({ message: '缺少参数：fileSize' });
    }
    const chunkSize = Math.max(
      0,
      Math.floor(Number(req.query?.chunkSize) || 0),
    );
    const result = await checkImageUploadDiskSpace(
      fileSize,
      chunkSize > 0 ? chunkSize : undefined,
    );
    if (!result.sufficient) {
      return res.status(507).json({ message: result.message, data: result });
    }
    return res.json({ message: result.message, data: result });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '检查磁盘空间失败', error: error.message });
  }
}

export async function harvesterImageUploadTaskCreateHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { namespace, displayName, imageType, filename, fileSize, chunkSize } =
      (req.body || {}) as Record<string, unknown>;
    if (!namespace) return res.status(400).json({ message: '缺少参数：namespace' });
    const size = Math.max(0, Math.floor(Number(fileSize) || 0));
    if (size < 1) {
      return res.status(400).json({ message: '缺少参数：fileSize（分片上传需声明文件大小）' });
    }

    const cs = Math.max(
      1024 * 1024,
      Math.min(
        IMAGE_UPLOAD_MAX_CHUNK_SIZE,
        Math.floor(Number(chunkSize) || IMAGE_UPLOAD_DEFAULT_CHUNK_SIZE),
      ),
    );
    const totalChunks = computeTotalChunks(size, cs);

    const diskCheck = await checkImageUploadDiskSpace(size, cs);
    if (!diskCheck.sufficient) {
      return res.status(507).json({ message: diskCheck.message, data: diskCheck });
    }

    const userId = String((req as any)?.user?.id || '');
    if (!userId) return res.status(401).json({ message: '未登录或用户无效' });

    if (!AppDataSource.isInitialized) {
      return res.status(503).json({ message: '数据库未就绪，请稍后重试' });
    }

    try {
      await ensureImageUploadTaskTable();
      await ensureImageUploadTaskTableColumns();
    } catch (schemaErr: any) {
      const detail = schemaErr?.message || String(schemaErr);
      console.error('[image-upload-task-create] schema init failed:', detail, schemaErr);
      return res.status(500).json({
        message: '上传任务表初始化失败',
        error: detail,
      });
    }

    await assertGlobalImageTaskSlot(globalImageTaskSlotOpts());

    const now = new Date();
    const expires = new Date(now.getTime() + 30 * 60 * 1000);
    const task = AppDataSource.getRepository(ImageUploadTask).create({
      cloudId: id,
      namespace: String(namespace),
      displayName: displayName ? String(displayName) : undefined,
      imageType: imageType ? String(imageType) : undefined,
      filename: filename ? String(filename) : undefined,
      fileSize: size,
      chunkSize: cs,
      totalChunks,
      receivedChunksJson: '[]',
      taskStatus: 'pending',
      phase: 'pending',
      progress: 0,
      ingestProgress: 0,
      proxyProgress: 0,
      bytesUploaded: 0,
      createdBy: userId,
      expiresAt: expires,
      retryCount: 0,
    });
    const saved = await saveImageUploadTaskRecord(task);
    const relPath = await ensureImageUploadMergedPreallocated(saved);
    saved.localFileRelPath = relPath;
    const withMerged = await saveImageUploadTaskRecord(saved);
    res.json({ message: '创建成功', data: sanitizeTask(withMerged) });
  } catch (error: any) {
    if (res.headersSent) return;
    if (isGlobalImageUploadBusyError(error)) {
      respondGlobalImageUploadBusy(res, error);
      return;
    }
    const detail = error?.message || String(error);
    console.error('[image-upload-task-create]', detail, error);
    res.status(500).json({
      message: '创建上传任务失败',
      error: detail,
      hint: /no metadata for/i.test(detail)
        ? '后端未加载 ImageUploadTask 实体，请重新编译并重启服务'
        : /no column named/i.test(detail) || /has no column/i.test(detail)
          ? 'image_upload_tasks 表结构过旧；已尝试自动补列仍失败，请重启后端或执行 ALTER TABLE 补列'
          : undefined,
    });
  }
}

/**
 * GET /:id/resources/harvester/images/upload-tasks/:taskId - 查询单任务
 */
export async function harvesterImageUploadTaskGetHandler(req: Request, res: Response) {
  try {
    const { id, taskId } = req.params;
    const user = (req as any)?.user;
    const userId = String(user?.id || '');
    const role = String(user?.role || '');
    const isAdmin = ['super_admin', 'admin'].includes(role);

    const repo = AppDataSource.getRepository(ImageUploadTask);
    const task = await repo.findOne({ where: { id: taskId, cloudId: id } });
    if (!task) return res.status(404).json({ message: '任务不存在' });
    if (!isAdmin && task.createdBy !== userId)
      return res.status(403).json({ message: '无权访问该任务' });
    const [reconciled] = await reconcileUploadTasksWithInventory([task], (req as any).cloud);
    res.json({ message: '查询成功', data: sanitizeTask(reconciled) });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询任务失败', error: error.message });
  }
}

/**
 * GET /:id/resources/harvester/images/upload-tasks - 查询任务列表
 */
export async function harvesterImageUploadTaskListHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const user = (req as any)?.user;
    const userId = String(user?.id || '');
    const role = String(user?.role || '');
    const isAdmin = ['super_admin', 'admin'].includes(role);
    const limit = Math.max(1, Math.min(100, Number((req.query as any)?.limit || 20)));
    const repo = AppDataSource.getRepository(ImageUploadTask);
    const where = isAdmin ? { cloudId: id } : { cloudId: id, createdBy: userId };
    const tasks = await repo.find({
      where: where as any,
      order: { createdAt: 'DESC' },
      take: limit,
    });
    const reconciled = await reconcileUploadTasksWithInventory(tasks, (req as any).cloud);
    res.json({ message: '查询成功', data: { items: reconciled.map(sanitizeTask) } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询任务列表失败', error: error.message });
  }
}

function releaseStaleUploadTaskInFlight(task: ImageUploadTask): void {
  if (!isUploadTaskTransferInFlight(task.id)) return;
  const st = String(task.taskStatus || '').toLowerCase();
  if (['success', 'failed', 'cancelled'].includes(st)) {
    registerImageUploadProxyEnd(task.cloudId, task.id);
  }
}

function isUploadTaskDeleteBlockedByRuntime(task: ImageUploadTask): boolean {
  releaseStaleUploadTaskInFlight(task);
  if (isUploadTaskTransferInFlight(task.id)) return true;
  const st = String(task.taskStatus || '').toLowerCase();
  // 仅阻止本地分片仍可能写入中的状态；proxying/uploaded 无 in-flight 视为 stale，允许删记录
  return st === 'pending' || st === 'ingesting';
}

/**
 * DELETE /:id/resources/harvester/images/upload-tasks/:taskId - 删除任务记录
 */
export async function harvesterImageUploadTaskDeleteHandler(req: Request, res: Response) {
  try {
    const { id, taskId } = req.params;
    const user = (req as any)?.user;
    const userId = String(user?.id || '');
    const role = String(user?.role || '');
    const isAdmin = ['super_admin', 'admin'].includes(role);
    const repo = AppDataSource.getRepository(ImageUploadTask);
    let task = await repo.findOne({ where: { id: taskId, cloudId: id } });
    if (!task) return res.status(404).json({ message: '任务不存在' });
    if (!isAdmin && task.createdBy !== userId)
      return res.status(403).json({ message: '无权删除该任务' });

    const [reconciled] = await reconcileUploadTasksWithInventory([task], (req as any).cloud);
    task = reconciled;

    if (isUploadTaskDeleteBlockedByRuntime(task)) {
      return res.status(409).json({ message: '任务正在执行，暂不允许删除' });
    }
    cleanupImageUploadTaskFiles(task);
    await repo.delete({ id: task.id });
    return res.json({ message: '删除成功' });
  } catch (error: any) {
    if (res.headersSent) return;
    return res.status(500).json({ message: '删除任务记录失败', error: error.message });
  }
}

/**
 * POST /:id/resources/harvester/images/upload-tasks/:taskId/cancel - 取消上传任务
 * 硬取消：删除已传分片与临时文件，不可断点续传。
 */
export async function harvesterImageUploadTaskCancelHandler(req: Request, res: Response) {
  try {
    const { id, taskId } = req.params;
    const user = (req as any)?.user;
    const userId = String(user?.id || '');
    const role = String(user?.role || '');
    const isAdmin = ['super_admin', 'admin'].includes(role);
    const repo = AppDataSource.getRepository(ImageUploadTask);
    const task = await repo.findOne({ where: { id: taskId, cloudId: id } });
    if (!task) return res.status(404).json({ message: '任务不存在' });
    if (!isAdmin && task.createdBy !== userId)
      return res.status(403).json({ message: '无权操作该任务' });
    if (!['pending', 'ingesting', 'uploaded', 'proxying', 'failed'].includes(task.taskStatus)) {
      return res.status(409).json({ message: '任务当前状态不允许取消' });
    }
    abortUploadTask(task.id);

    cleanupImageUploadTaskFiles(task);
    task.taskStatus = 'cancelled';
    task.phase = 'finished';
    task.finishedAt = new Date();
    task.errorCode = undefined;
    task.errorMessage = undefined;
    task.receivedChunksJson = '[]';
    task.ingestProgress = 0;
    task.progress = 0;
    task.bytesUploaded = 0;
    task.localFileRelPath = undefined;
    await repo.save(task);
    return res.json({ message: '取消成功', data: sanitizeTask(task) });
  } catch (error: any) {
    if (res.headersSent) return;
    return res.status(500).json({ message: '取消任务失败', error: error.message });
  }
}

/**
 * GET /:id/resources/harvester/images/upload-tasks/:taskId/chunks
 * 返回已收到的分片 index 列表（用于断点续传）
 */
export async function harvesterImageUploadTaskChunksListHandler(req: Request, res: Response) {
  try {
    const { id, taskId } = req.params;
    const access = await assertImageUploadTaskAccess(req, id, taskId);
    if (!access) return res.status(404).json({ message: '任务不存在或无权访问' });
    const { task } = access;
    res.json({
      message: '查询成功',
      data: {
        taskId: task.id,
        totalChunks: task.totalChunks,
        chunkSize: task.chunkSize,
        fileSize: task.fileSize,
        receivedChunks: reconcileReceivedChunkIndices(task),
      },
    });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询分片状态失败', error: error.message });
  }
}

/**
 * PUT /:id/resources/harvester/images/upload-tasks/:taskId/chunks/:index
 * 上传单个分片（body 为 application/octet-stream），仅校验分片字节数。
 */
export async function harvesterImageUploadTaskChunkPutHandler(req: Request, res: Response) {
  try {
    const { id, taskId, index: indexRaw } = req.params;
    const access = await assertImageUploadTaskAccess(req, id, taskId);
    if (!access) return res.status(404).json({ message: '任务不存在或无权访问' });
    const { task } = access;

    const chunkIndex = Math.floor(Number(indexRaw));
    const totalChunks = Math.max(0, Math.floor(Number(task.totalChunks) || 0));
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= totalChunks) {
      return res.status(400).json({ message: '无效的分片 index' });
    }
    if (task.taskStatus === 'cancelled') {
      return res.status(409).json({ message: '任务已取消，无法继续上传分片' });
    } else if (!['pending', 'ingesting', 'failed'].includes(task.taskStatus)) {
      return res.status(409).json({ message: '任务当前状态不允许上传分片' });
    }

    await assertGlobalImageTaskSlot(globalImageTaskSlotOpts(task.id));

    const fileSize = Math.max(0, Math.floor(Number(task.fileSize) || 0));
    const cs = Math.max(1, Math.floor(Number(task.chunkSize) || IMAGE_UPLOAD_DEFAULT_CHUNK_SIZE));
    const expectedBytes = expectedChunkByteSize(fileSize, cs, totalChunks, chunkIndex);

    let mergedPath = imageTaskMergedAbsPath(task);
    if (!fs.existsSync(mergedPath)) {
      const relPath = await ensureImageUploadMergedPreallocated(task);
      task.localFileRelPath = relPath;
      const repo = AppDataSource.getRepository(ImageUploadTask);
      await repo.save(task);
      mergedPath = imageTaskMergedAbsPath(task);
    }

    const receivedBefore = reconcileReceivedChunkIndices(task);
    if (receivedBefore.includes(chunkIndex)) {
      const saved = await persistChunkReceivedIndices(task.id, chunkIndex);
      return res.json({
        message: '分片已存在',
        data: sanitizeTask(saved),
      });
    }

    const chunks: Buffer[] = [];
    let byteLen = 0;
    if (Buffer.isBuffer(req.body)) {
      byteLen = req.body.length;
    } else {
      await new Promise<void>((resolve, reject) => {
        req.on('data', (buf) => {
          const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
          byteLen += b.length;
          chunks.push(b);
        });
        req.on('end', () => resolve());
        req.on('error', reject);
      });
    }
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.concat(chunks, byteLen);

    if (expectedBytes > 0 && body.length !== expectedBytes) {
      return res.status(400).json({
        message: '分片大小与声明不符',
        error: `分片 ${chunkIndex} 期望 ${expectedBytes} 字节，实际 ${body.length} 字节`,
      });
    }

    const offset = chunkWriteOffset(cs, chunkIndex);
    await writeChunkToMergedFile(mergedPath, offset, body);

    const saved = await persistChunkReceivedIndices(task.id, chunkIndex);

    res.json({ message: '分片上传成功', data: sanitizeTask(saved) });
  } catch (error: any) {
    if (res.headersSent) return;
    if (isGlobalImageUploadBusyError(error)) {
      respondGlobalImageUploadBusy(res, error);
      return;
    }
    res.status(500).json({ message: '分片上传失败', error: error.message });
  }
}

/**
 * POST /:id/resources/harvester/images/upload-tasks/:taskId/complete-chunks
 * 校验分片齐全与 .merged 文件大小（分片已按偏移直写，无需再合并）
 */
export async function harvesterImageUploadTaskCompleteChunksHandler(req: Request, res: Response) {
  try {
    const { id, taskId } = req.params;
    const access = await assertImageUploadTaskAccess(req, id, taskId);
    if (!access) return res.status(404).json({ message: '任务不存在或无权访问' });
    const { task } = access;

    if (task.taskStatus === 'cancelled') {
      return res.status(409).json({ message: '任务已取消，无法完成合并' });
    }

    const totalChunks = Math.max(0, Math.floor(Number(task.totalChunks) || 0));
    let received = reconcileReceivedChunkIndices(task);
    if (received.length !== totalChunks) {
      return res.status(409).json({
        message: '分片未收齐，无法合并',
        data: {
          received: received.length,
          totalChunks,
          missing: Array.from({ length: totalChunks }, (_, i) => i).filter(
            (i) => !received.includes(i),
          ),
        },
      });
    }
    for (let i = 0; i < totalChunks; i++) {
      if (!received.includes(i)) {
        return res.status(409).json({ message: `缺少分片 ${i}` });
      }
    }

    const jsonOnly = parseReceivedChunkIndices(task.receivedChunksJson);
    if (jsonOnly.length !== received.length) {
      setReceivedChunkIndices(task, received);
      await AppDataSource.getRepository(ImageUploadTask).save(task);
    }

    const relPath =
      String(task.localFileRelPath || '').trim() || imageTaskMergedRelPath(task.id);
    const destPath = path.join(getImageUploadTempRoot(), relPath);
    if (!fs.existsSync(destPath)) {
      return res.status(409).json({ message: '镜像文件尚未就绪，请继续上传分片' });
    }

    const stat = fs.statSync(destPath);
    const mergedSize = Math.max(0, Math.floor(Number(stat.size) || 0));
    const expectedSize = Math.max(0, Math.floor(Number(task.fileSize) || 0));
    if (expectedSize < 1) {
      try {
        fs.unlinkSync(destPath);
      } catch {
        /* ignore */
      }
      return res.status(400).json({ message: '任务缺少 fileSize，无法校验文件' });
    }
    if (mergedSize !== expectedSize) {
      try {
        fs.unlinkSync(destPath);
      } catch {
        /* ignore */
      }
      return res.status(400).json({
        message: '文件大小与上传前不一致',
        error: `期望 ${expectedSize} 字节，实际 ${mergedSize} 字节`,
        code: 'FILE_SIZE_MISMATCH',
      });
    }

    try {
      const legacyChunkDir = path.join(getImageUploadTempRoot(), 'chunks', task.id);
      if (fs.existsSync(legacyChunkDir)) {
        fs.rmSync(legacyChunkDir, { recursive: true, force: true });
      }
    } catch {
      /* ignore */
    }

    const repo = AppDataSource.getRepository(ImageUploadTask);
    task.localFileRelPath = relPath;
    task.taskStatus = 'uploaded';
    task.phase = 'uploaded';
    task.ingestProgress = 100;
    task.progress = 100;
    task.bytesUploaded = mergedSize;
    task.errorCode = undefined;
    task.errorMessage = undefined;
    await repo.save(task);

    res.json({ message: '文件已就绪，等待同步至 Harvester', data: sanitizeTask(task) });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '合并分片失败', error: error.message });
  }
}

/**
 * POST /:id/resources/harvester/images/upload-tasks/:taskId/sync
 * 将已合并的本地文件同步（代传）至 Harvester
 */
export async function harvesterImageUploadTaskSyncHandler(req: Request, res: Response) {
  try {
    const { id, taskId } = req.params;
    const access = await assertImageUploadTaskAccess(req, id, taskId);
    if (!access) return res.status(404).json({ message: '任务不存在或无权访问' });
    const { task } = access;
    const cloud = (req as any).cloud;

    if (!['uploaded', 'failed'].includes(task.taskStatus)) {
      return res.status(409).json({
        message:
          task.taskStatus === 'proxying'
            ? '同步已在进行中'
            : '任务当前状态不允许同步（需为待同步或同步失败）',
      });
    }
    if (getImageUploadInFlightTaskIds().has(task.id)) {
      return res.status(409).json({ message: '同步已在进行中' });
    }

    await assertGlobalImageTaskSlot(globalImageTaskSlotOpts(task.id));

    const absPath = imageTaskMergedAbsPath(task);
    if (!fs.existsSync(absPath)) {
      return res.status(400).json({
        message:
          task.taskStatus === 'failed'
            ? '本地暂存文件已清理，请删除任务后重新上传'
            : '合并文件不存在，请重新上传',
      });
    }

    const repo = AppDataSource.getRepository(ImageUploadTask);
    task.taskStatus = 'proxying';
    task.phase = 'proxying';
    task.progress = 0;
    task.proxyProgress = 0;
    task.startedAt = task.startedAt || new Date();
    task.errorCode = undefined;
    task.errorMessage = undefined;
    task.finishedAt = undefined;
    task.retryCount = (task.retryCount || 0) + 1;
    await repo.save(task);

    void runImageUploadTask(task.id, cloud, absPath).catch((err) => {
      console.warn('[image-upload-task-sync]', task.id, err?.message || err);
    });

    res.status(202).json({
      message: '已开始同步至 Harvester',
      data: sanitizeTask(task),
    });
  } catch (error: any) {
    if (res.headersSent) return;
    if (isGlobalImageUploadBusyError(error)) {
      respondGlobalImageUploadBusy(res, error);
      return;
    }
    res.status(500).json({ message: '启动同步失败', error: error.message });
  }
}

function parseOctetStreamUploadFilename(req: Request): string {
  try {
    const xfn = req.headers['x-file-name'];
    if (xfn != null && String(xfn).trim() !== '') {
      return decodeURIComponent(String(xfn));
    }
  } catch {
    /* 非法百分号编码等 */
  }
  return 'image';
}

function parseOctetStreamUploadSizeHeaders(req: Request): number {
  const xs = Number(req.headers['x-file-size']);
  const cl = Number(req.headers['content-length']);
  const fromMeta = Number.isFinite(xs) && xs > 0 ? xs : 0;
  const fromLen = Number.isFinite(cl) && cl > 0 ? cl : 0;
  return fromMeta || fromLen;
}

/** application/octet-stream：先落盘再异步代传 Harvester（与 multipart file 路径一致） */
async function handleHarvesterImageUploadTaskOctetStream(
  req: Request,
  res: Response,
): Promise<void> {
  const { id, taskId } = req.params;
  const user = (req as any)?.user;
  const userId = String(user?.id || '');
  const role = String(user?.role || '');
  const isAdmin = ['super_admin', 'admin'].includes(role);
  const cloud = (req as any).cloud;

  const filename = parseOctetStreamUploadFilename(req);
  const fileSize = parseOctetStreamUploadSizeHeaders(req);

  const repo = AppDataSource.getRepository(ImageUploadTask);
  const task = await repo.findOne({ where: { id: taskId, cloudId: id } });
  if (!task) {
    res.status(404).json({ message: '任务不存在' });
    return;
  }
  if (!isAdmin && task.createdBy !== userId) {
    res.status(403).json({ message: '无权操作该任务' });
    return;
  }
  if (!['pending', 'failed'].includes(task.taskStatus)) {
    res.status(409).json({ message: '任务当前状态不允许上传文件' });
    return;
  }

  await assertGlobalImageTaskSlot(globalImageTaskSlotOpts(task.id));

  task.filename = filename;
  if (fileSize > 0) task.fileSize = fileSize;
  task.taskStatus = 'ingesting';
  task.phase = 'ingesting';
  task.ingestProgress = 0;
  task.progress = 0;
  task.bytesUploaded = 0;
  task.startedAt = task.startedAt || new Date();
  task.errorCode = undefined;
  task.errorMessage = undefined;
  await repo.save(task);

  const tempPath = path.join(getImageUploadTempRoot(), `${task.id}-${Date.now()}`);
  const ingestAbort = new AbortController();
  try {
    await ingestOctetStreamToTempFile(req, tempPath, fileSize, task.id, ingestAbort);
  } catch (e: any) {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      /* ignore */
    }
    if (isCancelError(e)) return;
    throw new Error(formatImageUploadTaskError(e) || '接收镜像文件失败');
  }

  const writtenSize = fs.statSync(tempPath).size || 0;
  task.fileSize = writtenSize;
  task.ingestProgress = 100;
  task.progress = 100;
  await repo.save(task);

  void runImageUploadTask(task.id, cloud, tempPath).catch((err) => {
    console.warn('[image-upload-task-octet]', task.id, err?.message || err);
  });

  res.status(202).json({
    message: '文件已接收，任务执行中',
    data: { taskId: task.id, status: 'ingesting', phase: 'ingesting' },
  });
}

/**
 * POST /:id/resources/harvester/images/upload-tasks/:taskId/file - 上传文件并异步执行
 * - Content-Type: application/octet-stream：元数据由 X-File-Name / X-File-Size 提供；先落盘再异步代传 Harvester，接收完成后返回 202。
 * - multipart field=file：兼容旧版浏览器 / 桌面工具（multer 落盘后再代传）。
 */
export async function harvesterImageUploadTaskFileHandler(req: Request, res: Response) {
  const rawCt = String(req.headers['content-type'] || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (rawCt === 'application/octet-stream') {
    try {
      await handleHarvesterImageUploadTaskOctetStream(req, res);
    } catch (e: any) {
      if (!res.headersSent) {
        if (isGlobalImageUploadBusyError(e)) {
          respondGlobalImageUploadBusy(res, e);
          return;
        }
        if (isCancelError(e)) return;
        res.status(500).json({
          message: '上传镜像文件失败',
          error: formatImageUploadTaskError(e),
        });
      }
    }
    return;
  }

  imageTaskUpload.single('file')(req, res, async (err: any) => {
    try {
      if (err)
        return res
          .status(400)
          .json({ message: '文件接收失败', error: err?.message || String(err) });
      const { id, taskId } = req.params;
      const user = (req as any)?.user;
      const userId = String(user?.id || '');
      const role = String(user?.role || '');
      const isAdmin = ['super_admin', 'admin'].includes(role);
      const cloud = (req as any).cloud;

      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file) return res.status(400).json({ message: '缺少上传文件，字段名应为 file' });

      const repo = AppDataSource.getRepository(ImageUploadTask);
      const task = await repo.findOne({ where: { id: taskId, cloudId: id } });
      if (!task) return res.status(404).json({ message: '任务不存在' });
      if (!isAdmin && task.createdBy !== userId)
        return res.status(403).json({ message: '无权操作该任务' });
      if (!['pending', 'failed'].includes(task.taskStatus)) {
        return res.status(409).json({ message: '任务当前状态不允许上传文件' });
      }

      await assertGlobalImageTaskSlot(globalImageTaskSlotOpts(task.id));

      task.filename = file.originalname;
      task.fileSize = file.size;
      task.taskStatus = 'ingesting';
      task.phase = 'ingesting';
      task.ingestProgress = 100;
      task.progress = 1;
      task.bytesUploaded = 0;
      task.startedAt = task.startedAt || new Date();
      task.errorCode = undefined;
      task.errorMessage = undefined;
      await repo.save(task);

      // 异步执行，HTTP 快速返回 202，前端通过任务状态轮询
      void runImageUploadTask(task.id, cloud, file.path).catch((err) => {
        console.warn('[image-upload-task]', task.id, err?.message || err);
      });

      res.status(202).json({
        message: '文件已接收，任务执行中',
        data: { taskId: task.id, status: task.taskStatus, phase: task.phase },
      });
    } catch (error: any) {
      if (res.headersSent) return;
      if (isGlobalImageUploadBusyError(error)) {
        respondGlobalImageUploadBusy(res, error);
        return;
      }
      res.status(500).json({ message: '提交上传任务失败', error: error.message });
    }
  });
}
