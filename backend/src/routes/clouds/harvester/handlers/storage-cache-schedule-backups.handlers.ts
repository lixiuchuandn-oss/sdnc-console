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
 * 从 harvester.cache.storage.routes.ts 中提取的业务逻辑
 * ==============================================================================
 */

import { Request, Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import { UserSpace } from '../../../../entities/UserSpace';
import {
  createHarvesterScheduleVmBackup,
  updateHarvesterScheduleVmBackup,
  deleteHarvesterScheduleVmBackup,
} from '../../../../services/clouds/harvester/client';
import { syncHarvesterScheduleVmBackups } from '../../../../services/clouds/harvester/inventory';
import { HarvesterScheduleVmBackupInventory } from '../../../../entities/harvester/HarvesterScheduleVmBackupInventory';
import { fetchCloudOr404, ensureProvider } from '../harvester.cache.helpers';

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

    // [缓存策略] 自动同步逻辑
    // 触发条件: 1. 本地无数据 (count === 0) 2. 显式强制刷新 (force === 'true' 且 skipSync !== 'true')
    // skipSync=true 表示创建后刷新，数据已直接入库，只需查询数据库，无需全量同步
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

    const result = await createHarvesterScheduleVmBackup(
      {
        endpoint: cloud.endpoint,
        token: cloud.secretKey,
        insecure,
      } as any,
      payload.namespace,
      payload,
    );

    // [数据同步] 创建成功后，直接使用返回的数据入库（标准做法：使用返回的数据，无需延迟和全量同步）
    if (result && result.metadata) {
      try {
        const repo = AppDataSource.getRepository(HarvesterScheduleVmBackupInventory);
        const uid = result.metadata?.uid || result.id || '';
        const existing = await repo.findOne({ where: { cloudId: cloud.id, uid } });

        if (existing) {
          // 更新现有记录
          existing.name = result.metadata?.name || '';
          existing.namespace = result.metadata?.namespace || payload.namespace;
          existing.cron = result.spec?.cron;
          existing.vmName = result.spec?.vmbackup?.source?.name;
          existing.retention = String(result.spec?.retain || '');
          existing.status = result.spec?.suspend ? 'Suspended' : 'Active';
          existing.maxFailure = result.spec?.maxFailure;
          existing.links = result.links;
          existing.labels = result.metadata?.labels;
          existing.annotations = result.metadata?.annotations;
          existing.rawData = result;
          await repo.save(existing);
          console.log(`[ScheduleVmBackup-Create] 定时策略已更新，cloudId: ${cloud.id}, name: ${result.metadata?.name}`);
        } else {
          // 插入新记录
          const entity = repo.create({
            cloudId: cloud.id,
            uid: uid,
            name: result.metadata?.name || '',
            namespace: result.metadata?.namespace || payload.namespace,
            cron: result.spec?.cron,
            vmName: result.spec?.vmbackup?.source?.name,
            retention: String(result.spec?.retain || ''),
            status: result.spec?.suspend ? 'Suspended' : 'Active',
            maxFailure: result.spec?.maxFailure,
            links: result.links,
            labels: result.metadata?.labels,
            annotations: result.metadata?.annotations,
            rawData: result,
          });
          await repo.save(entity);
          console.log(`[ScheduleVmBackup-Create] 定时策略已入库，cloudId: ${cloud.id}, name: ${result.metadata?.name}`);
        }
      } catch (e: any) {
        console.error('[ScheduleVmBackup-Create] 入库定时策略失败:', e?.message || e);
        // 入库失败不影响创建操作的成功返回
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

    await updateHarvesterScheduleVmBackup(
      {
        endpoint: cloud.endpoint,
        token: cloud.secretKey,
        insecure,
      } as any,
      namespace,
      name,
      payload,
    );

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
  try {
    const { id, namespace, name } = req.params;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const payload = req.body;

    await updateHarvesterScheduleVmBackup(
      {
        endpoint: cloud.endpoint,
        token: cloud.secretKey,
        insecure,
      } as any,
      namespace,
      name,
      payload,
    );

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
 * DELETE /:id/resources/harvester/schedulevmbackups/:namespace/:name - 删除定时备份策略
 */
export async function harvesterScheduleBackupDeleteHandler(req: Request, res: Response) {
  try {
    const { id, namespace, name } = req.params;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    await deleteHarvesterScheduleVmBackup(
      {
        endpoint: cloud.endpoint,
        token: cloud.secretKey,
        insecure,
      } as any,
      namespace,
      name,
    );

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
