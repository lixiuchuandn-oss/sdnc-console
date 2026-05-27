/**
 * ==============================================================================
 * 模块名称: Harvester Schedule Backups Handlers (定时备份相关)
 * 文件路径: src/routes/clouds/harvester/handlers/schedule-backups.handlers.ts
 * ==============================================================================
 * 功能描述:
 * 本文件包含 Harvester 定时备份相关的 handlers，包括：
 * - 定时备份策略列表查询
 * - 创建定时备份策略
 * - 更新定时备份策略 (PATCH/PUT)
 * - 删除定时备份策略
 *
 * Longhorn VM → ScheduleVMBackup (harvesterhci.io)
 * Ceph VM → ScheduleCephVmBackup (hms.rivercloud.com)
 * ==============================================================================
 */

import { Request, Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import { UserSpace } from '../../../../entities/UserSpace';
import {
  createHarvesterScheduleVmBackup,
  updateHarvesterScheduleVmBackup,
  deleteHarvesterScheduleVmBackup,
  vmShouldUseCephVmBackup,
  createHarvesterScheduleCephVmBackup,
  updateHarvesterScheduleCephVmBackup,
  deleteHarvesterScheduleCephVmBackup,
  isCephScheduleVmBackupResource,
  normalizeCephScheduleVmBackupForInventory,
  scheduleInventoryFieldsFromRaw,
  getHarvesterScheduleCephVmBackup,
} from '../../../../services/clouds/harvester/client';
import { syncHarvesterScheduleVmBackups } from '../../../../services/clouds/harvester/inventory';
import { HarvesterScheduleVmBackupInventory } from '../../../../entities/harvester/HarvesterScheduleVmBackupInventory';
import { fetchCloudOr404, ensureProvider } from '../harvester.cache.helpers';

function harvesterConn(cloud: any, insecure: boolean) {
  return {
    endpoint: cloud.endpoint,
    token: cloud.secretKey,
    insecure,
  } as any;
}

async function resolveScheduleUseCeph(
  cloud: any,
  insecure: boolean,
  namespace: string,
  name: string,
  vmNameForCreate?: string,
): Promise<boolean> {
  if (vmNameForCreate) {
    return vmShouldUseCephVmBackup(harvesterConn(cloud, insecure), namespace, vmNameForCreate);
  }
  const repo = AppDataSource.getRepository(HarvesterScheduleVmBackupInventory);
  const cached = await repo.findOne({ where: { cloudId: cloud.id, namespace, name } });
  if (cached?.rawData && isCephScheduleVmBackupResource(cached.rawData)) return true;
  const ceph = await getHarvesterScheduleCephVmBackup(
    harvesterConn(cloud, insecure),
    namespace,
    name,
  );
  return !!ceph;
}

function persistScheduleVmBackupInventory(
  cloud: any,
  payloadNamespace: string,
  result: any,
) {
  const fields = scheduleInventoryFieldsFromRaw(result);
  const repo = AppDataSource.getRepository(HarvesterScheduleVmBackupInventory);
  const uid = result.metadata?.uid || result.id || '';
  const existing = repo.findOne({ where: { cloudId: cloud.id, uid } });

  return existing.then((row) => {
    const base = {
      cloudId: cloud.id,
      uid,
      name: result.metadata?.name || '',
      namespace: result.metadata?.namespace || payloadNamespace,
      cron: fields.cron,
      vmName: fields.vmName,
      retention: fields.retention,
      status: fields.status,
      maxFailure: fields.maxFailure,
      links: result.links,
      labels: result.metadata?.labels,
      annotations: result.metadata?.annotations,
      rawData: result,
    };
    if (row) {
      Object.assign(row, base);
      return repo.save(row);
    }
    return repo.save(repo.create(base));
  });
}

/**
 * GET /:id/resources/harvester/schedulevmbackups - 查询定时备份策略
 */
export async function harvesterScheduleBackupListHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const repo = AppDataSource.getRepository(HarvesterScheduleVmBackupInventory);

    let whereCondition: any = { cloudId: id };
    const isTenant =
      ((req as any).user?.role === 'tenant') ||
      (((req as any).user?.tenantId) && ((req as any).user?.role !== 'sase_device'));
    if (isTenant) {
      const userSpaceRepo = AppDataSource.getRepository(UserSpace);
      const us = await userSpaceRepo.findOne({
        where: { tenantId: (req as any).user.tenantId, cloudId: id, status: 'active' },
      });
      if (!us) return res.json({ message: '查询成功', data: { items: [] } });

      const allowedNamespaces: string[] = [];
      if (us.namespace) {
        us.namespace.split(',').forEach((ns) => allowedNamespaces.push(ns.trim()));
      }

      if (allowedNamespaces.length > 0) {
        whereCondition = [...allowedNamespaces.map((ns) => ({ cloudId: id, namespace: ns }))];
      }
    }

    const { force, skipSync } = req.query;
    const count = await repo.count({ where: whereCondition });
    const shouldSync = count === 0 || (String(force) === 'true' && String(skipSync) !== 'true');

    if (shouldSync) {
      try {
        await syncHarvesterScheduleVmBackups(cloud, insecure);
        console.log(`[ScheduleVmBackup-Query] 同步完成，cloudId: ${id}`);
      } catch (e: any) {
        console.warn('Sync ScheduleVmBackups failed, falling back to empty/stale', e);
        if (count === 0) throw e;
      }
    } else if (String(skipSync) === 'true') {
      console.log(`[ScheduleVmBackup-Query] 跳过全量同步（创建后刷新），直接查询数据库，cloudId: ${id}`);
    }

    const items = await repo.find({ where: whereCondition });
    const list = items.map((i) => i.rawData);
    res.json({ message: '查询成功', data: { items: list } });
  } catch (error: any) {
    res.status(500).json({ message: '查询定时备份失败', error: error.message });
  }
}

/**
 * POST /:id/resources/harvester/schedulevmbackups - 创建定时备份策略
 */
export async function harvesterScheduleBackupCreateHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const payload = req.body;
    const conn = harvesterConn(cloud, insecure);
    const useCeph = await vmShouldUseCephVmBackup(conn, payload.namespace, payload.vmName);

    let result: any;
    if (useCeph) {
      result = await createHarvesterScheduleCephVmBackup(conn, payload.namespace, payload);
      result = normalizeCephScheduleVmBackupForInventory(result);
    } else {
      result = await createHarvesterScheduleVmBackup(conn, payload.namespace, payload);
    }

    if (result && result.metadata) {
      try {
        await persistScheduleVmBackupInventory(cloud, payload.namespace, result);
        console.log(
          `[ScheduleVmBackup-Create] 定时策略已入库，cloudId: ${cloud.id}, name: ${result.metadata?.name}, backend: ${useCeph ? 'ceph' : 'longhorn'}`,
        );
      } catch (e: any) {
        console.error('[ScheduleVmBackup-Create] 入库定时策略失败:', e?.message || e);
      }
    }

    res.json({ message: '创建定时备份成功', data: result });
  } catch (error: any) {
    res.status(500).json({ message: '创建定时备份失败', error: error.body || error.message });
  }
}

/**
 * PATCH /:id/resources/harvester/schedulevmbackups/:namespace/:name - 更新定时备份策略 (PATCH)
 */
export async function harvesterScheduleBackupUpdateHandler(req: Request, res: Response) {
  try {
    const { id, namespace, name } = req.params;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const payload = req.body;
    const conn = harvesterConn(cloud, insecure);
    const useCeph = await resolveScheduleUseCeph(cloud, insecure, namespace, name);

    if (useCeph) {
      await updateHarvesterScheduleCephVmBackup(conn, namespace, name, payload);
    } else {
      await updateHarvesterScheduleVmBackup(conn, namespace, name, payload);
    }

    try {
      await syncHarvesterScheduleVmBackups(cloud, insecure);
    } catch (e) {
      console.warn('Sync after update failed', e);
    }

    res.json({ message: '更新定时备份成功' });
  } catch (error: any) {
    res.status(500).json({ message: '更新定时备份失败', error: error.body || error.message });
  }
}

/**
 * PUT /:id/resources/harvester/schedulevmbackups/:namespace/:name - 更新定时备份策略 (PUT)
 */
export async function harvesterScheduleBackupPutHandler(req: Request, res: Response) {
  return harvesterScheduleBackupUpdateHandler(req, res);
}

/**
 * DELETE /:id/resources/harvester/schedulevmbackups/:namespace/:name - 删除定时备份策略
 */
export async function harvesterScheduleBackupDeleteHandler(req: Request, res: Response) {
  try {
    const { id, namespace, name } = req.params;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const conn = harvesterConn(cloud, insecure);
    const useCeph = await resolveScheduleUseCeph(cloud, insecure, namespace, name);

    if (useCeph) {
      await deleteHarvesterScheduleCephVmBackup(conn, namespace, name);
    } else {
      await deleteHarvesterScheduleVmBackup(conn, namespace, name);
    }

    try {
      await syncHarvesterScheduleVmBackups(cloud, insecure);
    } catch (e) {
      console.warn('Sync after delete failed', e);
    }

    res.json({ message: '删除定时备份成功' });
  } catch (error: any) {
    res.status(500).json({ message: '删除定时备份失败', error: error.body || error.message });
  }
}
