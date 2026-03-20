/**
 * ==============================================================================
 * 模块名称: Harvester Backups Handlers (备份相关)
 * 文件路径: src/routes/clouds/harvester/handlers/backups.handlers.ts
 * ==============================================================================
 * 功能描述:
 * 本文件包含 Harvester 备份相关的 handlers，包括：
 * - 备份列表查询
 * - 创建 VM 备份/快照
 * - 删除 VM 备份
 * 
 * 从 harvester.cache.storage.routes.ts 中提取的业务逻辑
 * ==============================================================================
 */

import { Request, Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import { UserSpace } from '../../../../entities/UserSpace';
import {
  createHarvesterVirtualMachineBackup,
  deleteHarvesterVirtualMachineBackup,
} from '../../../../services/clouds/harvester/client';
import { syncHarvesterBackups } from '../../../../services/clouds/harvester/inventory';
import { HarvesterBackupInventory } from '../../../../entities/harvester/HarvesterBackupInventory';
import { fetchCloudOr404, ensureProvider } from '../harvester.cache.helpers';
import { checkTenantAccess } from '../harvester.direct.helpers';

/**
 * GET /:id/resources/harvester/backups - 查询备份列表
 */
export async function harvesterBackupListHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { force, skipSync } = req.query;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const repo = AppDataSource.getRepository(HarvesterBackupInventory);

    let whereCondition: any = { cloudId: id };
    const reqAny = req as any;
    const isTenant =
      reqAny.user?.role === 'tenant' ||
      (reqAny.user?.tenantId && reqAny.user?.role !== 'sase_device');
    if (isTenant) {
      const userSpaceRepo = AppDataSource.getRepository(UserSpace);
      const us = await userSpaceRepo.findOne({
        where: { tenantId: reqAny.user.tenantId, cloudId: id, status: 'active' },
      });
      if (!us) return res.json({ message: '查询成功', data: { items: [] } });

      const allowedNamespaces: string[] = [];
      if (us.namespace) {
        us.namespace.split(',').forEach((ns) => allowedNamespaces.push(ns.trim()));
      }

      if (reqAny.user?.organizationId) {
        const orgNs = `ns-${reqAny.user.organizationId}`;
        if (!allowedNamespaces.includes(orgNs)) {
          allowedNamespaces.push(orgNs);
          us.namespace = allowedNamespaces.join(',');
          try {
            await userSpaceRepo.save(us);
          } catch (e) {
            console.warn('Failed to auto-update UserSpace namespace', e);
          }
        }
      }

      if (allowedNamespaces.length === 0) {
        return res.json({ message: '查询成功', data: { items: [] } });
      }
      whereCondition = allowedNamespaces.map((ns) => ({ cloudId: id, namespace: ns }));
    }
    const count = await repo.count({ where: whereCondition });
    // [同步策略] 缓存优先 + 按需同步
    // skipSync=true 表示创建后刷新，数据已入库，只需查询数据库，无需全量同步
    const shouldSync = count === 0 || (String(force) === 'true' && String(skipSync) !== 'true');
    if (shouldSync) {
      try {
        await syncHarvesterBackups(cloud, insecure);
      } catch (e: any) {
        console.warn('Sync Backups failed, falling back to empty/stale', e);
        if (count === 0) throw e;
      }
    } else if (String(skipSync) === 'true') {
      console.log(`[Backup-Refresh] 跳过全量同步（创建后刷新），直接查询数据库`);
    }

    const items = await repo.find({ where: whereCondition });
    const list = items.map((i) => i.rawData);
    res.json({ message: '查询成功', data: { items: list } });
  } catch (error: any) {
    res.status(500).json({ message: '查询备份失败', error: error.message });
  }
}

/**
 * POST /:id/resources/harvester/virtualmachinebackups/:namespace - 创建 VM 备份或快照
 */
export async function harvesterBackupCreateHandler(req: Request, res: Response) {
  try {
    const { id, namespace } = req.params;
    const { allowed, namespace: tenantNamespace } = await checkTenantAccess(req, id);
    if (!allowed) {
      return res.status(403).json({ message: 'Access denied to this resource pool' });
    }

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    // 租户命名空间隔离
    if (tenantNamespace) {
      const allowedNs = tenantNamespace.split(',').map((s) => s.trim());
      if (!allowedNs.includes(namespace)) {
        return res.status(403).json({ message: 'Access denied to this namespace' });
      }
    }

    const { name, vmName, type, alias } = req.body;
    if (!name || !vmName || !type) {
      return res.status(400).json({ message: 'Missing required fields: name, vmName, type' });
    }
    if (type !== 'backup' && type !== 'snapshot') {
      return res.status(400).json({ message: 'Invalid type: must be "backup" or "snapshot"' });
    }

    const result = await createHarvesterVirtualMachineBackup(
      { endpoint: cloud.endpoint, token: cloud.secretKey, insecure } as any,
      namespace,
      { name, vmName, type, alias },
    );

    // [数据同步] 创建成功后，直接使用返回的数据入库（标准做法：使用返回的数据，无需延迟和全量同步）
    if (result && result.metadata) {
      try {
        const repo = AppDataSource.getRepository(HarvesterBackupInventory);
        const uid = result.metadata?.uid || result.id || '';
        const existing = await repo.findOne({ where: { cloudId: cloud.id, uid } });

        if (existing) {
          // 更新现有记录
          existing.name = result.metadata?.name || '';
          existing.namespace = result.metadata?.namespace || namespace;
          existing.sourceVm = result.spec?.source?.name;
          existing.status = result.status?.readyToUse ? 'Ready' : undefined;
          existing.type = result.spec?.type;
          existing.target = result.status?.target ? JSON.stringify(result.status.target) : undefined;
          existing.labels = result.metadata?.labels;
          existing.annotations = result.metadata?.annotations;
          existing.rawData = result;
          await repo.save(existing);
          console.log(`[Backup-Create] 备份已更新，cloudId: ${cloud.id}, name: ${result.metadata?.name}`);
        } else {
          // 插入新记录
          const entity = repo.create({
            cloudId: cloud.id,
            uid: uid,
            name: result.metadata?.name || '',
            namespace: result.metadata?.namespace || namespace,
            sourceVm: result.spec?.source?.name,
            status: result.status?.readyToUse ? 'Ready' : undefined,
            type: result.spec?.type,
            target: result.status?.target ? JSON.stringify(result.status.target) : undefined,
            labels: result.metadata?.labels,
            annotations: result.metadata?.annotations,
            rawData: result,
          });
          await repo.save(entity);
          console.log(`[Backup-Create] 备份已入库，cloudId: ${cloud.id}, name: ${result.metadata?.name}`);
        }
      } catch (e: any) {
        console.error('[Backup-Create] 入库备份失败:', e?.message || e);
        // 入库失败不影响创建操作的成功返回
      }
    }

    res.json({ message: '创建成功', data: result });
  } catch (error: any) {
    res.status(500).json({ message: '创建失败', error: error.body || error.message });
  }
}

/**
 * DELETE /:id/resources/harvester/backups/:namespace/:name - 删除 VM 备份
 */
export async function harvesterBackupDeleteHandler(req: Request, res: Response) {
  try {
    const { id, namespace, name } = req.params;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const result = await deleteHarvesterVirtualMachineBackup(
      { endpoint: cloud.endpoint, token: cloud.secretKey, insecure } as any,
      namespace,
      name,
    );

    try {
      await syncHarvesterBackups(cloud, insecure);
    } catch (e) {
      console.warn('Sync after delete failed', e);
    }

    res.json({ message: '删除成功', data: result });
  } catch (error: any) {
    res.status(500).json({ message: '删除失败', error: error.body || error.message });
  }
}
