/**
 * Harvester 存储快照直连 Handlers
 * 从 harvester.direct.storage.routes.ts 中提取的快照相关操作
 */

import { Request, Response } from 'express';
import {
  createVolumeSnapshot,
  restoreVolumeSnapshot,
  listHarvesterSnapshotClassesRaw,
} from '../../../../services/clouds/harvester/client';
import {
  checkTenantAccess,
  fetchCloudOr404,
  ensureProvider,
  isNamespaceAllowed,
} from '../harvester.direct.helpers';

/**
 * [POST] /:id/resources/harvester/snapshots/:namespace/:name/restore
 * 从快照恢复卷
 */
export async function harvesterSnapshotRestoreHandler(req: Request, res: Response) {
  try {
    const { id, namespace, name } = req.params;
    const { allowed, namespace: tenantNamespace } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

    if (tenantNamespace && !isNamespaceAllowed(tenantNamespace, namespace)) {
      return res.status(403).json({ message: 'Access denied to this namespace' });
    }

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const result = await restoreVolumeSnapshot(
      { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure },
      namespace,
      name,
      {
        newName: req.body.name,
        storageClassName: req.body.storageClassName,
        size: req.body.size,
        accessModes: req.body.accessModes,
        volumeMode: req.body.volumeMode,
        alias: req.body.alias,
      },
    );
    res.json({ message: '快照恢复任务已提交', data: result });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({
      message: '快照恢复失败',
      error: error.body || error.message,
    });
  }
}

/**
 * [POST] /:id/resources/harvester/volumes/:namespace/:name/snapshots
 * 创建卷快照
 */
export async function harvesterVolumeSnapshotCreateHandler(req: Request, res: Response) {
  try {
    const { id, namespace, name } = req.params;
    const { allowed, namespace: tenantNamespace } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

    if (tenantNamespace && !isNamespaceAllowed(tenantNamespace, namespace)) {
      return res.status(403).json({ message: 'Access denied to this namespace' });
    }

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const result = await createVolumeSnapshot(
      { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure },
      namespace,
      name,
      req.body,
    );
    res.json({ message: '创建快照任务已提交', data: result });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({
      message: '创建快照失败',
      error: error.body || error.message,
    });
  }
}

/**
 * [POST] /:id/resources/harvester/volumes/snapshot
 * (Legacy) 创建快照
 */
export async function harvesterVolumeSnapshotLegacyHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { allowed, namespace: tenantNamespace } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported')) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    if (tenantNamespace) {
      const allowedNs = tenantNamespace.split(',').map((s) => s.trim());
      if (req.body.namespace) {
        if (!allowedNs.includes(req.body.namespace)) {
          return res.status(403).json({ message: 'Access denied to this namespace' });
        }
      } else {
        req.body.namespace = allowedNs[0];
      }
    }

    const { namespace, pvcName, ...opts } = req.body;
    const data = await createVolumeSnapshot(
      { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
      namespace,
      pvcName,
      opts,
    );
    res.json({ message: '创建快照成功', data });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({
      message: '创建快照失败',
      error: error.body || error.message,
    });
  }
}

/**
 * [GET] /:id/resources/harvester/snapshot-classes
 * 查询快照类列表
 */
export async function harvesterSnapshotClassesListHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const data = await listHarvesterSnapshotClassesRaw({
      endpoint: cloud.endpoint,
      token: cloud.secretKey || '',
      insecure,
    });

    res.json({ message: '查询成功', data: { items: data } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({
      message: '查询快照存储类失败',
      error: error.body || error.message,
    });
  }
}
