/**
 * Harvester Migrations Handlers (Cache Route)
 *
 * 从 harvester.cache.routes.ts 中提取的 Migrations 相关业务逻辑
 * 缓存路由：从数据库查询 VirtualMachineInstanceMigration 资源列表
 */

import { Request, Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import { HarvesterMigrationInventory } from '../../../../entities/harvester/HarvesterMigrationInventory';
import { syncKubevirtMigrations } from '../../../../services/clouds/harvester/inventory';
import { fetchCloudOr404, ensureProvider } from '../harvester.cache.helpers';

/**
 * GET /:id/resources/harvester/migrations - 查询虚拟机迁移记录
 *
 * [同步策略]
 * 1. 检查本地数据库是否已有记录
 * 2. 如果无记录或请求参数 force=true，调用 syncKubevirtMigrations 同步最新数据
 * 3. 如果同步失败且本地无数据，抛出异常；否则降级返回旧数据
 */
export async function harvesterMigrationListHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { force } = req.query;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const repo = AppDataSource.getRepository(HarvesterMigrationInventory);
    const count = await repo.count({ where: { cloudId: id } });
    if (String(force) === 'true' || count === 0) {
      try {
        await syncKubevirtMigrations(cloud, insecure);
      } catch (e: any) {
        if (count === 0) throw e;
      }
    }
    const items = await repo.find({ where: { cloudId: id } });
    res.json({ message: '查询成功', data: { items } });
  } catch (error: any) {
    res.status(500).json({
      message: '查询迁移记录失败',
      error: error.body || error.message || error,
    });
  }
}
