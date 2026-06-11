/**
 * Harvester 存储卷高级操作直连 Handlers
 * 从 harvester.direct.storage.routes.ts 中提取的卷高级操作（导出镜像、克隆）
 */

import { Request, Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import { HarvesterVmInventory } from '../../../../entities/harvester/HarvesterVmInventory';
import {
  exportImageFromPVC,
  clonePVC,
  getVolumeExportBlockedByRunningVmMessage,
} from '../../../../services/clouds/harvester/client';
import {
  checkTenantAccess,
  fetchCloudOr404,
  ensureProvider,
  isNamespaceAllowed,
} from '../harvester.direct.helpers';

/**
 * [POST] /:id/resources/harvester/volumes/:namespace/:name/export-image
 * 导出卷为镜像
 */
export async function harvesterVolumeExportImageHandler(req: Request, res: Response) {
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

    const vmRepo = AppDataSource.getRepository(HarvesterVmInventory);
    const inventoryVms = await vmRepo.find({ where: { cloudId: id } });
    const exportBlocked = getVolumeExportBlockedByRunningVmMessage(
      inventoryVms.map((vm) => vm.rawData || { metadata: { namespace: vm.namespace } }),
      namespace,
      name,
    );
    if (exportBlocked) {
      return res.status(400).json({ message: exportBlocked });
    }

    const result = await exportImageFromPVC(cloud, namespace, name, req.body, insecure);
    res.json({ message: '导出镜像任务已提交', data: result });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({
      message: '导出镜像失败',
      error: error.body || error.message,
    });
  }
}

/**
 * [POST] /:id/resources/harvester/volumes/:namespace/:name/clone
 * 克隆卷
 */
export async function harvesterVolumeCloneHandler(req: Request, res: Response) {
  try {
    const { id, namespace, name } = req.params;
    const { allowed, namespace: tenantNamespace } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied to this resource pool' });

    if (tenantNamespace && !isNamespaceAllowed(tenantNamespace, namespace)) {
      return res.status(403).json({ message: 'Access denied to source namespace' });
    }

    const targetNs = req.body.targetNamespace || namespace;
    if (tenantNamespace && !isNamespaceAllowed(tenantNamespace, targetNs)) {
      return res.status(403).json({ message: 'Access denied to target namespace' });
    }

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const result = await clonePVC(
      { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure },
      namespace,
      name,
      req.body,
    );
    res.json({ message: '克隆卷任务已提交', data: result });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({
      message: '克隆卷失败',
      error: error.body || error.message,
    });
  }
}

/**
 * [POST] /:id/resources/harvester/volumes/export-image
 * (Legacy) 导出镜像
 */
export async function harvesterVolumeExportImageLegacyHandler(req: Request, res: Response) {
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
    const vmRepo = AppDataSource.getRepository(HarvesterVmInventory);
    const inventoryVms = await vmRepo.find({ where: { cloudId: id } });
    const exportBlocked = getVolumeExportBlockedByRunningVmMessage(
      inventoryVms.map((vm) => vm.rawData || { metadata: { namespace: vm.namespace } }),
      namespace,
      pvcName,
    );
    if (exportBlocked) {
      return res.status(400).json({ message: exportBlocked });
    }

    const data = await exportImageFromPVC(cloud, namespace, pvcName, opts, insecure);
    res.json({ message: '导出镜像成功', data });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({
      message: '导出镜像失败',
      error: error.body || error.message,
    });
  }
}

/**
 * [POST] /:id/resources/harvester/volumes/clone
 * (Legacy) 克隆卷
 */
export async function harvesterVolumeCloneLegacyHandler(req: Request, res: Response) {
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

    const { namespace, pvcName, ...payload } = req.body;
    const data = await clonePVC(
      { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
      namespace,
      pvcName,
      payload,
    );
    res.json({ message: '克隆卷成功', data });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({
      message: '克隆卷失败',
      error: error.body || error.message,
    });
  }
}
