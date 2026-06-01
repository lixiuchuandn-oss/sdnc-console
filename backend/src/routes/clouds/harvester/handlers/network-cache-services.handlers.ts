/**
 * Harvester Services Handlers (Cache Route)
 *
 * 从 harvester.cache.network.routes.ts 中提取的 Services 相关业务逻辑
 * 缓存路由：从数据库查询服务列表
 */

import { Request, Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import { HarvesterServiceInventory } from '../../../../entities/harvester/HarvesterServiceInventory';
import { UserSpace } from '../../../../entities/UserSpace';
import { syncHarvesterServices } from '../../../../services/clouds/harvester/inventory';

/**
 * GET /:id/resources/harvester/services - 获取服务列表（缓存路由）
 */
export async function harvesterServiceCacheListHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id } = req.params;
    const { force } = req.query;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const repo = AppDataSource.getRepository(HarvesterServiceInventory);
    const whereCondition: any = { cloudId: id };

    const reqAny = req as any;
    // [租户过滤] 检查租户权限
    // 如果是租户用户，必须先确认其 UserSpace 是否存在且激活。
    if (reqAny.user?.role === 'tenant') {
      const userSpaceRepo = AppDataSource.getRepository(UserSpace);
      const us = await userSpaceRepo.findOne({
        where: { tenantId: reqAny.user.tenantId, cloudId: id, status: 'active' },
      });
      if (!us) return res.json({ message: '查询成功', data: { items: [] } });
    }

    const count = await repo.count({ where: whereCondition });

    // [同步策略] 缓存优先 + 按需同步
    if (count === 0 || String(force) === 'true') {
      try {
        await syncHarvesterServices(cloud, insecure);
      } catch (e: any) {
        console.warn('Sync Services failed, falling back', e);
        if (count === 0) throw e;
      }
    }

    const items = await repo.find({ where: whereCondition });
    let list = items.map((i) => i.rawData);

    if (reqAny.user?.role === 'tenant') {
      const userSpaceRepo = AppDataSource.getRepository(UserSpace);
      const us = await userSpaceRepo.findOne({
        where: { tenantId: reqAny.user.tenantId, cloudId: id, status: 'active' },
      });
      if (us?.namespace) {
        const allowed = us.namespace.split(',').map((s) => s.trim());
        list = list.filter((svc: any) => allowed.includes(svc?.metadata?.namespace));
      }
    }

    res.json({ message: '查询成功', data: { items: list } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询服务失败', error: error.message });
  }
}
