/**
 * Harvester Cluster Networks Handlers
 * 
 * 从 harvester.cache.network.routes.ts 中提取的 Cluster Networks 相关业务逻辑
 */

import { Request, Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import { HarvesterClusterNetworkInventory } from '../../../../entities/harvester/HarvesterClusterNetworkInventory';
import { HarvesterVlanConfigInventory } from '../../../../entities/harvester/HarvesterVlanConfigInventory';
import { syncHarvesterClusterNetworks } from '../../../../services/clouds/harvester/inventory';

/**
 * GET /:id/resources/cluster-networks - 获取集群网络列表
 */
export async function harvesterClusterNetworkListHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    const { id } = req.params;
    const { force } = req.query;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const repo = AppDataSource.getRepository(HarvesterClusterNetworkInventory);
    const vlanConfigRepo = AppDataSource.getRepository(HarvesterVlanConfigInventory);
    const count = await repo.count({ where: { cloudId: id } });

    // [同步策略] 缓存优先 + 按需同步
    // 如果本地数据库为空，或者用户显式请求 force=true，则触发远程同步。
    if (count === 0 || String(force) === 'true') {
      try {
        await syncHarvesterClusterNetworks(cloud, insecure);
      } catch (e: any) {
        console.warn('Sync ClusterNetworks failed, falling back to empty/stale', e);
        if (count === 0) throw e;
      }
    }

    const [items, vlanConfigs] = await Promise.all([
      repo.find({ where: { cloudId: id } }),
      vlanConfigRepo.find({ where: { cloudId: id } }),
    ]);

    // [资源聚合] 将 ClusterNetwork 与 VlanConfig 进行关联
    const list = items.map((i: any) => {
      const configs = vlanConfigs.filter((c: any) => c.clusterNetwork === i.name);
      return {
        ...(i.rawData || {}),
        view: i.links?.view || i.rawData?.links?.view,
        vlanConfigs: configs.map((c: any) => ({
          ...c,
          ...(c.rawData || {}),
        })),
      };
    });

    res.json({ items: list });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询集群网络失败', error: error.message });
  }
}
