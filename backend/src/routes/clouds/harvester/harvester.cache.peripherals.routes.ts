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
