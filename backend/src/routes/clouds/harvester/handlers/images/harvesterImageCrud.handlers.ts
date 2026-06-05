/**
 * Harvester 镜像库存 CRUD（列表 / 详情 / 创建 / 更新 / 删除）。
 */
import { Request, Response } from 'express';
import { FindOptionsWhere } from 'typeorm';

import { AppDataSource } from '../../../../../config/database';
import { HarvesterImageInventory } from '../../../../../entities/harvester/HarvesterImageInventory';
import { ImageUploadTask } from '../../../../../entities/harvester/ImageUploadTask';
import { UserSpace } from '../../../../../entities/UserSpace';
import {
  syncHarvesterImages,
  upsertHarvesterImageInventoryItems,
} from '../../../../../services/clouds/harvester/inventory';
import {
  fetchHarvesterVmImageDetailFromCluster,
  isHarvesterVmImageImportComplete,
  resolveVmImageVirtualSizeFromCluster,
} from '../../../../../services/clouds/harvester/vmImageClusterApi';
import {
  getPublicScenarioNamespaceNames,
  mergePublicScenarioNamespacesFromQuery,
} from '../../../../../services/clouds/harvester/publicNamespaces';
import {
  resolveVmImageStorageProfile,
  buildHarvesterVmImageSpecFields,
} from '../../../../../services/clouds/harvester/client';
import { getJsonOnce, requestJson } from '../../../../../services/clouds/harvester/utils';
import { hasImageUploadProxyInFlightForCloud } from '../imageUploadRuntime';
import { deleteVmImageCdiStorageOrphans } from '../imageUploadCdiCleanup';
import {
  enrichImageListItemsFromUploadTasks,
  mapImageInventoryToListItem,
  persistHarvesterImageInventoryFromClusterCreate,
  refreshInProgressHarvesterImageInventoryFromCluster,
} from './harvesterImageInventory.mapper';
import { harvesterConn, vmImageHarvesterMetadataLikeUi } from './imageUploadTask.helpers';
import { removeImageUploadTaskRecord } from './imageUploadTask.access';
import {
  findVmsReferencingHarvesterImage,
  formatImageDeleteBlockedByVmsMessage,
} from '../../../../../services/clouds/harvester/imageVmUsageService';

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
      count === 0 || (String(force) === 'true' && String(skipSync) !== 'true');

    if (shouldSync) {
      try {
        await syncHarvesterImages(cloud, insecure, { allowDuringUploadProxy: true });
      } catch (e: unknown) {
        console.warn('Sync Images failed, falling back to empty/stale', e);
        if (count === 0) throw e;
      }
    } else if (proxyBusy && String(force) === 'true' && String(skipSync) !== 'true') {
      console.debug(`[images] skip full inventory sync for cloud ${id}: skipSync requested`);
    }

    let items = await repo.find({ where: whereCondition });
    try {
      await refreshInProgressHarvesterImageInventoryFromCluster(cloud, items, insecure);
      items = await repo.find({ where: whereCondition });
    } catch (e: unknown) {
      console.warn('[images] refresh in-progress inventory from cluster failed', e);
    }
    let list = items.map((i) => mapImageInventoryToListItem(i, publicScenarioNsSet));
    try {
      const taskRepo = AppDataSource.getRepository(ImageUploadTask);
      const uploadTasks = await taskRepo.find({
        where: { cloudId: id },
        order: { updatedAt: 'DESC' },
      });
      list = enrichImageListItemsFromUploadTasks(list, uploadTasks);
    } catch (e) {
      console.warn('[images] enrich list size from upload tasks failed', e);
    }

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

    await persistHarvesterImageInventoryFromClusterCreate(cloud.id, json, {
      imageNameHint: String(name || displayStr || ''),
    });

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

function readImageDisplayNameFromInventory(inv: HarvesterImageInventory | null | undefined): string {
  const raw = (inv?.rawData || {}) as {
    spec?: { displayName?: string };
    metadata?: { labels?: Record<string, string> };
  };
  return String(
    raw?.spec?.displayName || raw?.metadata?.labels?.['harvesterhci.io/imageDisplayName'] || '',
  ).trim();
}

async function findLinkedUploadTasksForClusterImageDelete(
  cloudId: string,
  namespace: string,
  imageName: string,
): Promise<ImageUploadTask[]> {
  const ns = String(namespace || '').trim();
  const name = String(imageName || '').trim();
  if (!ns || !name || name.startsWith('tower-upload-')) return [];

  const repo = AppDataSource.getRepository(ImageUploadTask);
  const imageRepo = AppDataSource.getRepository(HarvesterImageInventory);
  const inv = await imageRepo.findOne({ where: { cloudId, namespace: ns, name } });
  const displayName = readImageDisplayNameFromInventory(inv);
  const byId = new Map<string, ImageUploadTask>();

  const exact = await repo.find({
    where: { cloudId, createdImageNamespace: ns, createdImageName: name },
  });
  for (const t of exact) byId.set(t.id, t);

  const nsTasks = await repo.find({
    where: { cloudId, namespace: ns },
    order: { updatedAt: 'DESC' },
    take: 200,
  });
  for (const task of nsTasks) {
    if (byId.has(task.id)) continue;
    const st = String(task.taskStatus || '').toLowerCase();
    if (st === 'cancelled') continue;
    const createdName = String(task.createdImageName || '').trim();
    if (createdName === name) {
      byId.set(task.id, task);
      continue;
    }
    const taskAlias = String(task.displayName || task.filename || '').trim();
    if (displayName && taskAlias && taskAlias === displayName) {
      byId.set(task.id, task);
      continue;
    }
    if (name === `tower-upload-${task.id}`) {
      byId.set(task.id, task);
    }
  }
  return [...byId.values()];
}

async function deleteLinkedImageUploadTasksForClusterImage(
  cloudId: string,
  namespace: string,
  imageName: string,
  cloud: any,
): Promise<string[]> {
  const tasks = await findLinkedUploadTasksForClusterImageDelete(cloudId, namespace, imageName);
  const deletedIds: string[] = [];
  for (const task of tasks) {
    const ok = await removeImageUploadTaskRecord(task, cloud, { force: true });
    if (ok) deletedIds.push(task.id);
  }
  return deletedIds;
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

    const usingVms = await findVmsReferencingHarvesterImage(id, namespace, name);
    if (usingVms.length > 0) {
      return res.status(409).json({
        message: formatImageDeleteBlockedByVmsMessage(usingVms),
        error: formatImageDeleteBlockedByVmsMessage(usingVms),
        code: 'IMAGE_IN_USE',
        data: { vms: usingVms },
      });
    }

    const invRepo = AppDataSource.getRepository(HarvesterImageInventory);
    const invRow = await invRepo.findOne({ where: { cloudId: id, namespace, name } });
    let imageDetail: unknown = invRow?.rawData ?? null;
    if (!imageDetail) {
      try {
        imageDetail = await fetchHarvesterVmImageDetailFromCluster(cloud, namespace, name, insecure);
      } catch {
        imageDetail = null;
      }
    }

    const url = `${origin}/v1/harvester/harvesterhci.io.virtualmachineimages/${encodeURIComponent(
      namespace,
    )}/${encodeURIComponent(name)}`;
    let clusterNotFound = false;
    try {
      await requestJson('DELETE', url, cloud.secretKey || '', insecure, undefined);
    } catch (error: any) {
      const status = Number(error?.status);
      if (status === 404) clusterNotFound = true;
      else throw error;
    }

    try {
      await deleteVmImageCdiStorageOrphans(
        harvesterConn(cloud),
        origin,
        namespace,
        name,
        imageDetail,
      );
    } catch (e: any) {
      console.warn(
        '[images] delete CDI storage orphans after image delete failed',
        namespace,
        name,
        e?.message || e,
      );
    }

    await invRepo.delete({ cloudId: id, namespace, name });

    const deletedUploadTaskIds = await deleteLinkedImageUploadTasksForClusterImage(
      id,
      namespace,
      name,
      cloud,
    );

    res.json({
      message: '删除成功',
      data: { deletedUploadTaskIds, clusterNotFound },
    });
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
