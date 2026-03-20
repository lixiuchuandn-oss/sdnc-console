/**
 * Harvester Images Handlers
 * 
 * 从 harvester.cache.storage.routes.ts 中提取的 Images 相关业务逻辑
 */

import { Request, Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import { HarvesterImageInventory } from '../../../../entities/harvester/HarvesterImageInventory';
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

    // 尝试 v1beta1 和 v1 两个版本的 API
    const url = `${origin}/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(
      namespace,
    )}/virtualmachineimages/${encodeURIComponent(name)}`;
    let json: any = null;
    try {
      json = await getJsonOnce(url, cloud.secretKey || '', insecure, true);
    } catch {
      const urlV1 = `${origin}/apis/harvesterhci.io/v1/namespaces/${encodeURIComponent(
        namespace,
      )}/virtualmachineimages/${encodeURIComponent(name)}`;
      json = await getJsonOnce(urlV1, cloud.secretKey || '', insecure, true);
    }

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
    const body = {
      apiVersion: 'harvesterhci.io/v1beta1',
      kind: 'VirtualMachineImage',
      metadata: {
        name: name || undefined,
        generateName: name ? undefined : 'image-',
        namespace,
      },
      spec: {
        displayName: displayName || name || 'image',
        sourceType: sourceType || (url ? 'download' : 'upload'),
        url: url || '',
        ...(diskFormat ? { diskFormat } : {}),
        targetStorageClassName: targetStorageClassName || 'longhorn',
        storageClassParameters: storageClassParameters || {},
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
