import { Router, Response } from 'express';
import { AppDataSource } from '../../../config/database';
import {
  HarvesterGpuInventory,
} from '../../../entities/harvester/HarvesterGpuInventory';
import {
  HarvesterUsbInventory,
} from '../../../entities/harvester/HarvesterUsbInventory';
import {
  syncHarvesterGpus,
  syncHarvesterUsbResources,
} from '../../../services/clouds/harvester/inventory';
import { fetchCloudOr404, ensureProvider } from './harvester.cache.helpers';

/**
 * ==============================================================================
 * 组件名称: Harvester 硬件外设管理 (Harvester Peripherals Management)
 * 文件路径: backend/src/routes/clouds/harvester/harvester.cache.peripherals.routes.ts
 * ==============================================================================
 * 
 * [功能描述]
 * 负责 Harvester 节点硬件外设资源 (GPU, USB) 的库存查询。
 * 主要用于虚拟机透传配置时的资源发现。
 * 
 * [核心逻辑]
 * 1. [库存同步]: 
 *    - 采用 "Cache-First" 策略，优先返回数据库缓存。
 *    - 当数据库为空或显式指定 force=true 时，触发远程同步 (syncHarvesterGpus/Usb)。
 * 2. [数据标准化]: 
 *    - USB 设备接口会对原始数据进行精简，提取 vendorId, productId 等关键信息。
 * 
 * ------------------------------------------------------------------------------
 * [API 接口说明]
 * ------------------------------------------------------------------------------
 * 1. GET /:id/resources/harvester/gpus
 *    - 获取集群内可用的 PCI/vGPU 设备列表。
 * 
 * 2. GET /:id/resources/harvester/usb-devices
 *    - 获取集群内可用的 USB 透传设备列表。
 * ==============================================================================
 */
export const registerHarvesterPeripheralsRoutes = (
  router: Router,
  checkAdminPermission: any,
) => {
  router.get(
    '/:id/resources/harvester/gpus',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(HarvesterGpuInventory);
        const count = await repo.count({ where: { cloudId: id } });

        // [同步策略] 缓存优先 + 按需同步
        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterGpus(cloud, insecure);
          } catch (e: any) {
            console.warn('Sync GPUs failed, falling back to empty/stale', e);
            if (count === 0) throw e;
          }
        }

        const items = await repo.find({ where: { cloudId: id } });
        const list = items.map((i) => i.rawData);

        res.json({ message: '查询成功', data: { items: list } });
      } catch (error: any) {
        res
          .status(500)
          .json({ message: '查询GPU资源失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/harvester/usb-devices',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(HarvesterUsbInventory);
        const count = await repo.count({ where: { cloudId: id } });

        // [同步策略] 缓存优先 + 按需同步
        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterUsbResources(cloud, insecure);
          } catch (e: any) {
            console.warn('Sync USBs failed, falling back to empty/stale', e);
            if (count === 0) throw e;
          }
        }

        const dbItems = await repo.find({ where: { cloudId: id } });
        const items = dbItems.map((i) => ({
          resourceName: i.resourceName,
          name: i.name,
          description: i.description,
          vendorId: i.vendorId,
          productId: i.productId,
          raw: i.rawData,
        }));

        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res
          .status(500)
          .json({ message: '查询USB资源失败', error: error.message });
      }
    },
  );
};
