/**
 * Harvester Snapshots Handlers
 * 
 * 从 harvester.cache.storage.routes.ts 中提取的 Snapshots 相关业务逻辑
 */

import { Request, Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import { HarvesterSnapshotInventory } from '../../../../entities/harvester/HarvesterSnapshotInventory';
import { UserSpace } from '../../../../entities/UserSpace';
import { syncHarvesterSnapshots } from '../../../../services/clouds/harvester/inventory';
import {
  deleteHarvesterVirtualMachineSnapshot,
  deleteHarvesterVolumeSnapshot,
} from '../../../../services/clouds/harvester/storage';

export async function harvesterSnapshotListHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id } = req.params;
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const reqAny = req as any;

    const repo = AppDataSource.getRepository(HarvesterSnapshotInventory);
    let whereCondition: any = { cloudId: id };
    
    const isTenant = reqAny.user?.role === 'tenant' || 
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

      if (reqAny.user.organizationId) {
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

    const { force, skipSync } = req.query;
    const count = await repo.count({ where: whereCondition });
    const shouldSync = count === 0 || (String(force) === 'true' && String(skipSync) !== 'true');
    
    if (shouldSync) {
      try {
        await syncHarvesterSnapshots(cloud, insecure);
      } catch (e: any) {
        console.warn('Sync Snapshots failed, falling back to empty/stale', e);
        if (count === 0) throw e;
      }
    }

    const items = await repo.find({ where: whereCondition });
    const list = items.map((i) => i.rawData);
    res.json({ message: '查询成功', data: { items: list } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询快照失败', error: error.message });
  }
}

/**
 * DELETE /:id/resources/harvester/snapshots/:namespace/:name - 删除快照
 */
export async function harvesterSnapshotDeleteHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id, namespace, name } = req.params;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const opts = {
      endpoint: cloud.endpoint,
      token: cloud.secretKey,
      insecure,
    } as any;

    try {
      await deleteHarvesterVirtualMachineSnapshot(opts, namespace, name);
    } catch (e: any) {
      if (Number(e?.status) === 404 || String(e?.message).includes('404')) {
        try {
          await deleteHarvesterVolumeSnapshot(opts, namespace, name);
        } catch (e2: any) {
          throw e2;
        }
      } else {
        throw e;
      }
    }

    try {
      await syncHarvesterSnapshots(cloud, insecure);
    } catch (e) {
      console.warn('Sync Snapshots after delete failed', e);
    }

    res.json({ message: '删除成功' });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '删除快照失败', error: error.message });
  }
}
