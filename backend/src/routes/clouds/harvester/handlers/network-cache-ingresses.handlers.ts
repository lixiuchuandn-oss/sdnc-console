/**
 * Harvester Ingresses Handlers
 * 
 * 从 harvester.cache.network.routes.ts 中提取的 Ingresses 相关业务逻辑
 */

import { Request, Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import { KubeOvnIngressInventory } from '../../../../entities/kubeovn/KubeOvnIngressInventory';
import { UserSpace } from '../../../../entities/UserSpace';
import { syncHarvesterIngresses } from '../../../../services/clouds/harvester/inventory';

/**
 * GET /:id/resources/harvester/ingresses - 获取 Ingress 列表
 */
export async function harvesterIngressListHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id } = req.params;
    const { force, skipSync } = req.query;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const repo = AppDataSource.getRepository(KubeOvnIngressInventory);

    let whereCondition: any = { cloudId: id };
    const reqAny = req as any;
    const isTenant =
      reqAny.user?.role === 'tenant' ||
      (reqAny.user?.tenantId && reqAny.user?.role !== 'sase_device');
    
    // [租户过滤] 命名空间隔离
    // 租户仅能查看其 UserSpace 中定义命名空间下的 Ingress 资源。
    if (isTenant) {
      const userSpaceRepo = AppDataSource.getRepository(UserSpace);
      const us = await userSpaceRepo.findOne({
        where: { tenantId: reqAny.user.tenantId, cloudId: id, status: 'active' },
      });
      if (!us) return res.json({ message: '查询成功', data: { items: [] } });
      if (us.namespace) whereCondition.namespace = us.namespace;
    }

    const count = await repo.count({ where: whereCondition });
    
    // [缓存策略] 自动同步逻辑
    // 触发条件: 1. 本地无数据 (count === 0) 2. 显式强制刷新 (force === 'true' 且 skipSync !== 'true')
    // skipSync=true 表示创建后刷新，数据已直接入库，只需查询数据库，无需全量同步
    const shouldSync = count === 0 || (String(force) === 'true' && String(skipSync) !== 'true');
    
    if (shouldSync) {
      try {
        await syncHarvesterIngresses(cloud, insecure);
        console.log(`[Ingress-Query] 同步完成，cloudId: ${id}`);
      } catch (e: any) {
        console.warn('Sync Ingresses failed, falling back to empty/stale', e);
        if (count === 0) throw e;
      }
    } else if (String(skipSync) === 'true') {
      console.log(`[Ingress-Query] 跳过全量同步（创建后刷新），直接查询数据库，cloudId: ${id}`);
    }

    const items = await repo.find({ where: whereCondition });
    const list = items.map((i) => i.rawData);
    res.json({ message: '查询成功', data: { items: list } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询路由(Ingress)失败', error: error.message });
  }
}
