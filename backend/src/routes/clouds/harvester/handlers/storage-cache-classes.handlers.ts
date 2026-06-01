/**
 * Harvester Storage Classes Handlers
 */

import { Request, Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import { KubevirtStorageClassInventory } from '../../../../entities/kubevirt/KubevirtStorageClassInventory';
import { syncHarvesterStorageClasses } from '../../../../services/clouds/harvester/inventory';

export async function harvesterStorageClassListHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id } = req.params;
    const { force } = req.query;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const repo = AppDataSource.getRepository(KubevirtStorageClassInventory);
    const count = await repo.count({ where: { cloudId: id } });

    if (count === 0 || String(force) === 'true') {
      try {
        await syncHarvesterStorageClasses(cloud, insecure);
      } catch (e: any) {
        console.warn('Sync StorageClasses failed, falling back to empty/stale', e);
        if (count === 0) throw e;
      }
    }

    const dbItems = await repo.find({ where: { cloudId: id } });
    const items = dbItems.map((i) => i.rawData);
    res.json({ message: '查询成功', data: { items } });
  } catch (error: any) {
    if (res.headersSent) return;
    res
      .status(500)
      .json({ message: error.message || '查询存储类失败', error: error.body || error.message });
  }
}
