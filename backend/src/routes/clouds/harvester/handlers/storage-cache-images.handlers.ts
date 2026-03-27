/**
 * Harvester Images Handlers
 * 
 * 从 harvester.cache.storage.routes.ts 中提取的 Images 相关业务逻辑
 */

import { Request, Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import path from 'path';
import os from 'os';
import fs from 'fs';
import http from 'http';
import https from 'https';
import { Readable } from 'stream';
import multer from 'multer';
import axios from 'axios';
import { HarvesterImageInventory } from '../../../../entities/harvester/HarvesterImageInventory';
import { ImageUploadTask } from '../../../../entities/harvester/ImageUploadTask';
import { UserSpace } from '../../../../entities/UserSpace';
import { syncHarvesterImages } from '../../../../services/clouds/harvester/inventory';
import { getJsonOnce, requestJson } from '../../../../services/clouds/harvester/utils';

export async function harvesterImageListHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id } = req.params;
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const reqAny = req as any;

    const repo = AppDataSource.getRepository(HarvesterImageInventory);
    let whereCondition: any = { cloudId: id };
    const isTenantUser = reqAny.user?.tenantId && reqAny.user?.role !== 'sase_device';
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
      const us = matches.find((m: any) => m.organizationId === reqAny.user.organizationId) || matches[0];

      if (!us) return res.json({ message: '查询成功', data: { items: [] } });

      if (us.namespace) {
        const allowed = us.namespace.split(',').map(s => s.trim()).filter(Boolean);
        
        if (reqAny.user.organizationId) {
          const orgNs = `ns-${reqAny.user.organizationId}`;
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

        whereCondition = [
          ...allowed.map(ns => ({ cloudId: id, namespace: ns })),
          { cloudId: id, namespace: 'cloud-public' },
          { cloudId: id, namespace: 'Cloud-Public' },
          { cloudId: id, namespace: 'harvester-public' },
          { cloudId: id, namespace: 'default' },
        ];
      } else {
        if (reqAny.user.organizationId) {
          const orgNs = `ns-${reqAny.user.organizationId}`;
          us.namespace = orgNs;
          try {
            await userSpaceRepo.save(us);
            whereCondition = [
              { cloudId: id, namespace: orgNs },
              { cloudId: id, namespace: 'cloud-public' },
              { cloudId: id, namespace: 'Cloud-Public' },
              { cloudId: id, namespace: 'harvester-public' },
              { cloudId: id, namespace: 'default' },
            ];
          } catch (e) {
            console.warn('Failed to auto-update UserSpace namespace', e);
            whereCondition = [
              { cloudId: id, namespace: 'cloud-public' },
              { cloudId: id, namespace: 'Cloud-Public' },
              { cloudId: id, namespace: 'harvester-public' },
              { cloudId: id, namespace: 'default' },
            ];
          }
        } else {
          whereCondition = [
            { cloudId: id, namespace: 'cloud-public' },
            { cloudId: id, namespace: 'Cloud-Public' },
            { cloudId: id, namespace: 'harvester-public' },
            { cloudId: id, namespace: 'default' },
          ];
        }
      }
    }

    const { force, skipSync } = req.query;
    const count = await repo.count({ where: whereCondition });
    const shouldSync = count === 0 || (String(force) === 'true' && String(skipSync) !== 'true');
    
    if (shouldSync) {
      try {
        await syncHarvesterImages(cloud, insecure);
      } catch (e: any) {
        console.warn('Sync Images failed, falling back to empty/stale', e);
        if (count === 0) throw e;
      }
    }

    const items = await repo.find({ where: whereCondition });
    const list = items.map((i: any) => {
      const r = i.rawData || {};
      const name = r.metadata?.name || i.name || '';
      const namespace = r.metadata?.namespace || i.namespace || '';
      const displayName = r.spec?.displayName || i.displayName || name;
      const size = r.status?.size || i.size || 0;
      const progress = r.status?.progress || i.progress || 0;
      const conditions = r.status?.conditions || [];
      let state = 'Unknown';
      const imported = conditions.find((c: any) => c.type === 'Imported');
      if (imported?.status === 'True') state = 'Active';
      else if (imported?.status === 'False') state = 'Failed';
      else if (progress < 100) state = 'Downloading';

      return {
        ...r,
        id: r.metadata?.uid || i.uid,
        name,
        namespace,
        displayName,
        size,
        progress,
        state,
        createdAt: r.metadata?.creationTimestamp,
        conditions,
      };
    });

    res.json({ message: '查询成功', data: { items: list } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询镜像失败', error: error.message });
  }
}

/**
 * GET /:id/resources/harvester/images/:namespace/:name - 获取镜像详情
 */
export async function harvesterImageDetailHandler(req: Request, res: Response) {
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

    // 多路径兼容：不同 Harvester/Rancher 版本返回路径不一致
    const candidates = [
      `${origin}/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(
        namespace,
      )}/virtualmachineimages/${encodeURIComponent(name)}`,
      `${origin}/apis/harvesterhci.io/v1/namespaces/${encodeURIComponent(
        namespace,
      )}/virtualmachineimages/${encodeURIComponent(name)}`,
      `${origin}/k8s/clusters/local/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(
        namespace,
      )}/virtualmachineimages/${encodeURIComponent(name)}`,
      `${origin}/k8s/clusters/local/apis/harvesterhci.io/v1/namespaces/${encodeURIComponent(
        namespace,
      )}/virtualmachineimages/${encodeURIComponent(name)}`,
      `${origin}/v1/harvester/harvesterhci.io.virtualmachineimages/${encodeURIComponent(
        namespace,
      )}/${encodeURIComponent(name)}`,
    ];
    let json: any = null;
    let lastErr: any = null;
    for (const url of candidates) {
      try {
        json = await getJsonOnce(url, cloud.secretKey || '', insecure, true);
        if (json) break;
      } catch (e: any) {
        lastErr = e;
      }
    }
    if (!json && lastErr) throw lastErr;

    res.json({ message: '查询成功', data: json });
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
    const { id } = req.params;
    const {
      namespace,
      name,
      displayName,
      sourceType,
      url,
      diskFormat,
      targetStorageClassName,
      storageClassParameters,
    } = (req.body || {}) as any;
    
    if (!namespace || !(name || displayName))
      return res.status(400).json({ message: '缺少必填参数：namespace、name 或 displayName' });
    
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
    const displayStr = displayName || name || 'image';
    const diskFmtLower = String(diskFormat || '').toLowerCase();
    const imageTypeLabel: 'iso' | 'disk' | undefined =
      diskFmtLower === 'iso' ? 'iso' : diskFmtLower === 'qcow2' || diskFmtLower === 'raw' ? 'disk' : undefined;
    const scName = targetStorageClassName || 'longhorn';
    const { labels: createLabels, annotations: createAnnotations } = vmImageHarvesterMetadataLikeUi({
      displayName: displayStr,
      imageTypeLabel,
      imageNameForAnnotation: displayStr,
      storageClassName: scName,
    });
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
      spec: {
        displayName: displayStr,
        sourceType: sourceType || (url ? 'download' : 'upload'),
        url: url || '',
        ...(diskFormat ? { diskFormat } : {}),
        targetStorageClassName: scName,
        storageClassParameters:
          storageClassParameters && Object.keys(storageClassParameters).length > 0
            ? storageClassParameters
            : DEFAULT_VM_IMAGE_STORAGE_CLASS_PARAMS,
      },
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
          console.log(`[Image-Create] 镜像已更新，cloudId: ${cloud.id}, name: ${json.metadata?.name}`);
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
          console.log(`[Image-Create] 镜像已入库，cloudId: ${cloud.id}, name: ${json.metadata?.name}`);
        }
      } catch (e: any) {
        console.error('[Image-Create] 入库镜像失败:', e?.message || e);
        // 入库失败不影响创建操作的成功返回
      }
    } else if (json && json.metadata && !json.metadata.uid) {
      console.warn(`[Image-Create] 创建成功但返回数据缺少 uid，跳过入库，cloudId: ${cloud.id}, name: ${json.metadata?.name || name}`);
    }
    
    res.json({ message: '创建成功', data: json });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '创建镜像失败', error: error.message });
  }
}

/**
 * PUT /:id/resources/harvester/images/:namespace/:name - 更新镜像
 */
export async function harvesterImageUpdateHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id, namespace, name } = req.params;
    const { displayName, retry, targetStorageClassName, storageClassParameters } = (req.body || {}) as any;
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
    res.json({ message: '删除成功' });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '删除镜像失败', error: error.message });
  }
}

const imageTaskTempRoot = path.join(os.tmpdir(), 'compute-tower', 'image-upload-tasks');
if (!fs.existsSync(imageTaskTempRoot)) {
  fs.mkdirSync(imageTaskTempRoot, { recursive: true });
}
const imageTaskUpload = multer({ dest: imageTaskTempRoot });
const imageUploadInFlight = new Set<string>();

function clampProgress(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** Harvester UI 创建镜像时常用的 Longhorn 参数（与集群默认一致） */
const DEFAULT_VM_IMAGE_STORAGE_CLASS_PARAMS: Record<string, string> = {
  dataLocality: 'disabled',
  migratable: 'true',
  numberOfReplicas: '3',
  staleReplicaTimeout: '30',
};

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

async function updateTaskProgress(
  taskId: string,
  patch: Partial<ImageUploadTask>,
): Promise<ImageUploadTask | null> {
  const repo = AppDataSource.getRepository(ImageUploadTask);
  const t = await repo.findOne({ where: { id: taskId } });
  if (!t) return null;
  Object.assign(t, patch);
  t.updatedAt = new Date();
  return await repo.save(t);
}

async function runImageUploadTask(taskId: string, cloud: any, filePath: string) {
  if (imageUploadInFlight.has(taskId)) return;
  imageUploadInFlight.add(taskId);
  const repo = AppDataSource.getRepository(ImageUploadTask);
  try {
    const task = await repo.findOne({ where: { id: taskId } });
    if (!task) return;

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
    const { labels: uploadLabels, annotations: uploadAnnotations } = vmImageHarvesterMetadataLikeUi({
      displayName: displayLabel,
      imageTypeLabel,
      imageNameForAnnotation: task.filename || displayLabel,
      storageClassName: 'longhorn',
    });
    const payload = {
      apiVersion: 'harvesterhci.io/v1beta1',
      kind: 'VirtualMachineImage',
      metadata: {
        generateName: 'image-',
        namespace: task.namespace,
        labels: uploadLabels,
        annotations: uploadAnnotations,
      },
      spec: {
        displayName: displayLabel,
        sourceType: 'upload',
        ...(uploadDiskFormat ? { diskFormat: uploadDiskFormat } : {}),
        targetStorageClassName: 'longhorn',
        storageClassParameters: DEFAULT_VM_IMAGE_STORAGE_CLASS_PARAMS,
      },
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
    for (const createUrl of createCandidates) {
      try {
        created = await requestJson('POST', createUrl, cloud.secretKey || '', insecure, payload);
        if (created) break;
      } catch (e: any) {
        createLastErr = e;
      }
    }
    if (!created && createLastErr) throw createLastErr;
    let uploadUrl = resolveUploadUrl(created);

    // 兼容不同 Harvester 版本：创建响应可能没有立即返回 upload URL，需要轮询详情
    const createdImageName = created?.metadata?.name || '';
    const createdImageNamespace = created?.metadata?.namespace || task.namespace;
    if (!uploadUrl) {
      const imageName = createdImageName;
      const imageNamespace = created?.metadata?.namespace || task.namespace;
      const directDetailCandidates: string[] = imageName
        ? [
            `${origin}/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(
              imageNamespace,
            )}/virtualmachineimages/${encodeURIComponent(imageName)}`,
            `${origin}/apis/harvesterhci.io/v1/namespaces/${encodeURIComponent(
              imageNamespace,
            )}/virtualmachineimages/${encodeURIComponent(imageName)}`,
            `${origin}/k8s/clusters/local/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(
              imageNamespace,
            )}/virtualmachineimages/${encodeURIComponent(imageName)}`,
            `${origin}/k8s/clusters/local/apis/harvesterhci.io/v1/namespaces/${encodeURIComponent(
              imageNamespace,
            )}/virtualmachineimages/${encodeURIComponent(imageName)}`,
            `${origin}/v1/harvester/harvesterhci.io.virtualmachineimages/${encodeURIComponent(
              imageNamespace,
            )}/${encodeURIComponent(imageName)}`,
          ]
        : [];

      const selfLink = String(created?.links?.self || '').trim();
      if (selfLink) {
        if (/^https?:\/\//i.test(selfLink)) {
          directDetailCandidates.unshift(selfLink);
        } else if (selfLink.startsWith('/')) {
          directDetailCandidates.unshift(`${origin}${selfLink}`);
        }
      }

      // 轮询 20 次（约 20 秒），等待 controller 回填 upload URL
      for (let i = 0; i < 20 && !uploadUrl; i++) {
        for (const detailUrl of directDetailCandidates) {
          try {
            const detail = await getJsonOnce(detailUrl, cloud.secretKey || '', insecure, true);
            uploadUrl = resolveUploadUrl(detail);
            if (uploadUrl) break;
          } catch {
            // ignore, try next candidate
          }
        }
        if (!uploadUrl) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }

    // 兜底：按 uploader 原理，直接构造 action=upload URL
    if (!uploadUrl && createdImageName) {
      uploadUrl = `${origin}/v1/harvester/harvesterhci.io.virtualmachineimages/${encodeURIComponent(
        createdImageNamespace,
      )}/${encodeURIComponent(createdImageName)}?action=upload`;
    }

    if (!uploadUrl) throw new Error('Harvester 未返回 upload URL');

    // 2) 通过 Tower 代传文件到 Harvester upload URL
    const stat = fs.statSync(filePath);
    const total = stat.size || task.fileSize || 0;

    const uploadTarget = /^https?:\/\//i.test(String(uploadUrl || ''))
      ? String(uploadUrl)
      : `${origin}${String(uploadUrl).startsWith('/') ? '' : '/'}${String(uploadUrl)}`;
    const isHttp = uploadTarget.startsWith('http:');
    const httpAgent = new http.Agent({ keepAlive: true });
    const httpsAgent = new https.Agent({ keepAlive: true, rejectUnauthorized: !insecure });

    await updateTaskProgress(taskId, {
      taskStatus: 'proxying',
      phase: 'proxying',
      progress: Math.max(1, task.progress || 1),
      proxyProgress: 0,
    });

    const pollDetailCandidates = [
      `${origin}/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(
        createdImageNamespace,
      )}/virtualmachineimages/${encodeURIComponent(createdImageName)}`,
      `${origin}/apis/harvesterhci.io/v1/namespaces/${encodeURIComponent(
        createdImageNamespace,
      )}/virtualmachineimages/${encodeURIComponent(createdImageName)}`,
      `${origin}/k8s/clusters/local/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(
        createdImageNamespace,
      )}/virtualmachineimages/${encodeURIComponent(createdImageName)}`,
      `${origin}/k8s/clusters/local/apis/harvesterhci.io/v1/namespaces/${encodeURIComponent(
        createdImageNamespace,
      )}/virtualmachineimages/${encodeURIComponent(createdImageName)}`,
      `${origin}/v1/harvester/harvesterhci.io.virtualmachineimages/${encodeURIComponent(
        createdImageNamespace,
      )}/${encodeURIComponent(createdImageName)}`,
    ];

    // action=upload 与 uploader 对齐：使用 multipart/form-data + 字段名 chunk + size 参数
    if (uploadTarget.includes('action=upload')) {
      const padding = total % 512 === 0 ? 0 : 512 - (total % 512);
      const finalSize = total + padding;
      const sep = uploadTarget.includes('?') ? '&' : '?';
      const finalTarget = uploadTarget.includes('size=')
        ? uploadTarget
        : `${uploadTarget}${sep}size=${finalSize}`;

      const boundary = `HarvesterBoundary${Date.now()}${Math.random().toString(16).slice(2)}`;
      const filename = task.filename || path.basename(filePath);
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
      const fileAndPaddingStream =
        padding > 0
          ? Readable.from(
              (async function* () {
                for await (const chunk of fs.createReadStream(filePath) as any) {
                  const n = typeof chunk === 'string' ? Buffer.byteLength(chunk) : (chunk?.length || 0);
                  sent += n;
                  const now = Date.now();
                  if (now - lastUpdateAt > 500) {
                    lastUpdateAt = now;
                    const p = total > 0 ? clampProgress((sent / total) * 100) : 0;
                    await updateTaskProgress(taskId, {
                      bytesUploaded: Math.min(sent, total),
                      proxyProgress: p,
                      // 代理上传阶段占比 0-70
                      progress: clampProgress(1 + Math.floor(p * 0.7)),
                    });
                  }
                  yield chunk;
                }
                yield Buffer.alloc(padding);
              })(),
            )
          : Readable.from(
              (async function* () {
                for await (const chunk of fs.createReadStream(filePath) as any) {
                  const n = typeof chunk === 'string' ? Buffer.byteLength(chunk) : (chunk?.length || 0);
                  sent += n;
                  const now = Date.now();
                  if (now - lastUpdateAt > 500) {
                    lastUpdateAt = now;
                    const p = total > 0 ? clampProgress((sent / total) * 100) : 0;
                    await updateTaskProgress(taskId, {
                      bytesUploaded: Math.min(sent, total),
                      proxyProgress: p,
                      progress: clampProgress(1 + Math.floor(p * 0.7)),
                    });
                  }
                  yield chunk;
                }
              })(),
            );
      const fullBody = Readable.from(
        (async function* () {
          yield header;
          for await (const chunk of fileAndPaddingStream as any) yield chunk;
          yield footer;
        })(),
      );

      await updateTaskProgress(taskId, {
        proxyProgress: 30,
        progress: 30,
      });
      const followHarvesterProgress = async () => {
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
        const hp = clampProgress(Number(detail?.status?.progress || 0));
        const mapped = Math.max(1, Math.min(99, hp));
        await updateTaskProgress(taskId, { progress: mapped });
      };
      const harvesterProgressTimer = setInterval(() => {
        void followHarvesterProgress();
      }, 2000);
      try {
        await axios.post(finalTarget, fullBody, {
          maxBodyLength: Infinity,
          timeout: 0,
          httpAgent: isHttp ? httpAgent : undefined,
          httpsAgent: !isHttp ? httpsAgent : undefined,
          headers: {
            Authorization: `Bearer ${cloud.secretKey || ''}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': contentLength,
          },
          validateStatus: (s) => s >= 200 && s < 300,
        });
      } finally {
        clearInterval(harvesterProgressTimer);
      }
      await updateTaskProgress(taskId, {
        bytesUploaded: total,
        proxyProgress: 100,
        progress: 90,
      });
    } else {
      let sent = 0;
      const readStream = fs.createReadStream(filePath);
      readStream.on('data', async (chunk: any) => {
        const n = typeof chunk === 'string' ? Buffer.byteLength(chunk) : (chunk?.length || 0);
        sent += n;
        const p = total > 0 ? clampProgress((sent / total) * 100) : 0;
        await updateTaskProgress(taskId, {
          bytesUploaded: Math.min(sent, total),
          proxyProgress: p,
          progress: clampProgress(1 + Math.floor(p * 0.7)),
        });
      });
      await axios.put(uploadTarget, readStream, {
        maxBodyLength: Infinity,
        timeout: 0,
        httpAgent: isHttp ? httpAgent : undefined,
        httpsAgent: !isHttp ? httpsAgent : undefined,
        headers: {
          Authorization: `Bearer ${cloud.secretKey || ''}`,
          'Content-Type': 'application/octet-stream',
          'Content-Length': total,
        },
        validateStatus: (s) => s >= 200 && s < 300,
      });
    }

    // 3) 上传动作完成后，继续跟踪 Harvester 导入进度（70-99）
    await updateTaskProgress(taskId, { phase: 'proxying', progress: 70 });
    const importDeadline = Date.now() + 30 * 60 * 1000;
    let imported = false;
    while (Date.now() < importDeadline && !imported) {
      let detail: any = null;
      for (const detailUrl of pollDetailCandidates) {
        try {
          detail = await getJsonOnce(detailUrl, cloud.secretKey || '', insecure, true);
          if (detail) break;
        } catch {
          // try next
        }
      }
      if (detail) {
        const hp = clampProgress(Number(detail?.status?.progress || 0));
        const conds = Array.isArray(detail?.status?.conditions) ? detail.status.conditions : [];
        const importedCond = conds.find((c: any) => c?.type === 'Imported');
        if (importedCond?.status === 'True' || hp >= 100) {
          imported = true;
          break;
        }
        if (importedCond?.status === 'False') {
          throw new Error(importedCond?.message || 'Harvester 导入镜像失败');
        }
        await updateTaskProgress(taskId, {
          progress: Math.max(70, Math.min(99, 70 + Math.floor(hp * 0.29))),
        });
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (!imported) {
      throw new Error('Harvester 导入进度等待超时');
    }

    await updateTaskProgress(taskId, {
      taskStatus: 'success',
      phase: 'finished',
      proxyProgress: 100,
      progress: 100,
      bytesUploaded: total,
      finishedAt: new Date(),
    });
  } catch (e: any) {
    await updateTaskProgress(taskId, {
      taskStatus: 'failed',
      phase: 'finished',
      errorCode: 'UPLOAD_FAILED',
      errorMessage: e?.message || String(e),
      finishedAt: new Date(),
    });
  } finally {
    imageUploadInFlight.delete(taskId);
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {}
  }
}

/**
 * POST /:id/resources/harvester/images/upload-proxy
 * 单次 multipart：namespace、displayName、imageType、file；等价于「创建 upload-task + POST .../file」。
 * tools/uploader 等客户端通过 Tower 代理上传时使用此路径。
 */
export async function harvesterImageUploadProxyHandler(req: Request, res: Response) {
  imageTaskUpload.single('file')(req, res, async (err: any) => {
    try {
      if (err) return res.status(400).json({ message: '文件接收失败', error: err?.message || String(err) });
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

      void runImageUploadTask(saved.id, cloud, file.path);

      res.status(202).json({
        message: '文件已接收，任务执行中',
        data: { taskId: saved.id, status: saved.taskStatus, phase: saved.phase },
      });
    } catch (error: any) {
      if (res.headersSent) return;
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
    const serviceAccountName = (String(saRaw || 'image-uploader').trim() || 'image-uploader') as string;
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
export async function harvesterImageUploadTaskCreateHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { namespace, displayName, imageType } = (req.body || {}) as any;
    if (!namespace) return res.status(400).json({ message: '缺少参数：namespace' });

    const userId = String((req as any)?.user?.id || '');
    if (!userId) return res.status(401).json({ message: '未登录或用户无效' });

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
    res.json({ message: '创建成功', data: sanitizeTask(saved) });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '创建上传任务失败', error: error.message });
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
    if (!isAdmin && task.createdBy !== userId) return res.status(403).json({ message: '无权访问该任务' });
    res.json({ message: '查询成功', data: sanitizeTask(task) });
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
    res.json({ message: '查询成功', data: { items: tasks.map(sanitizeTask) } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询任务列表失败', error: error.message });
  }
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
    const task = await repo.findOne({ where: { id: taskId, cloudId: id } });
    if (!task) return res.status(404).json({ message: '任务不存在' });
    if (!isAdmin && task.createdBy !== userId) return res.status(403).json({ message: '无权删除该任务' });
    if (['pending', 'ingesting', 'proxying'].includes(task.taskStatus) || imageUploadInFlight.has(task.id)) {
      return res.status(409).json({ message: '任务正在执行，暂不允许删除' });
    }
    await repo.delete({ id: task.id });
    return res.json({ message: '删除成功' });
  } catch (error: any) {
    if (res.headersSent) return;
    return res.status(500).json({ message: '删除任务失败', error: error.message });
  }
}

/**
 * POST /:id/resources/harvester/images/upload-tasks/:taskId/file - 上传文件并异步执行
 */
export async function harvesterImageUploadTaskFileHandler(req: Request, res: Response) {
  imageTaskUpload.single('file')(req, res, async (err: any) => {
    try {
      if (err) return res.status(400).json({ message: '文件接收失败', error: err?.message || String(err) });
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
      if (!isAdmin && task.createdBy !== userId) return res.status(403).json({ message: '无权操作该任务' });
      if (!['pending', 'failed'].includes(task.taskStatus)) {
        return res.status(409).json({ message: '任务当前状态不允许上传文件' });
      }

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
      void runImageUploadTask(task.id, cloud, file.path);

      res.status(202).json({
        message: '文件已接收，任务执行中',
        data: { taskId: task.id, status: task.taskStatus, phase: task.phase },
      });
    } catch (error: any) {
      if (res.headersSent) return;
      res.status(500).json({ message: '提交上传任务失败', error: error.message });
    }
  });
}


