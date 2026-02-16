import { Router, Response } from 'express';
import { AppDataSource } from '../../../config/database';
import { UserSpace } from '../../../entities/UserSpace';
import {
  HarvesterSshKeyInventory,
} from '../../../entities/harvester/HarvesterSshKeyInventory';
import {
  HarvesterCloudInitInventory,
} from '../../../entities/harvester/HarvesterCloudInitInventory';
import {
  HarvesterTemplateInventory,
} from '../../../entities/harvester/HarvesterTemplateInventory';
import {
  syncHarvesterSshKeys,
  syncHarvesterCloudInits,
  syncHarvesterTemplates,
} from '../../../services/clouds/harvester/inventory';
import { fetchCloudOr404, ensureProvider } from './harvester.cache.helpers';

export const registerHarvesterMetaRoutes = (
  router: Router,
  checkAdminPermission: any,
) => {
  router.get(
    '/:id/resources/harvester/sshkeys',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(HarvesterSshKeyInventory);

        let whereCondition: any = { cloudId: id };
        const isTenant =
          (req.user as any)?.role === 'tenant' ||
          ((req.user as any)?.tenantId &&
            (req.user as any)?.role !== 'sase_device');
        if (isTenant) {
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const us = await userSpaceRepo.findOne({
            where: {
              tenantId: (req as any).user.tenantId,
              cloudId: id,
              status: 'active',
            },
          });
          if (!us)
            return res.json({ message: '查询成功', data: { items: [] } });
          if (us.namespace) whereCondition.namespace = us.namespace;
        }

        const count = await repo.count({ where: whereCondition });
        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterSshKeys(cloud, insecure);
          } catch (e: any) {
            console.warn(
              'Sync SSH Keys failed, falling back to empty/stale',
              e,
            );
            if (count === 0) throw e;
          }
        }

        const items = await repo.find({ where: whereCondition });
        const list = items.map((i) => i.rawData);
        res.json({ message: '查询成功', data: { items: list } });
      } catch (error: any) {
        res
          .status(500)
          .json({ message: '查询SSH密钥失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/harvester/cloud-inits',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(HarvesterCloudInitInventory);

        let whereCondition: any = { cloudId: id };
        const isTenant =
          (req.user as any)?.role === 'tenant' ||
          ((req.user as any)?.tenantId &&
            (req.user as any)?.role !== 'sase_device');
        if (isTenant) {
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const us = await userSpaceRepo.findOne({
            where: {
              tenantId: (req as any).user.tenantId,
              cloudId: id,
              status: 'active',
            },
          });
          if (!us)
            return res.json({ message: '查询成功', data: { items: [] } });
          if (us.namespace) whereCondition.namespace = us.namespace;
        }

        const count = await repo.count({ where: whereCondition });
        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterCloudInits(cloud, insecure);
          } catch (e: any) {
            console.warn(
              'Sync Cloud Inits failed, falling back to empty/stale',
              e,
            );
            if (count === 0) throw e;
          }
        }

        const items = await repo.find({ where: whereCondition });
        const list = items.map((i) => i.rawData);
        res.json({ message: '查询成功', data: { items: list } });
      } catch (error: any) {
        res
          .status(500)
          .json({ message: '查询Cloud Init模板失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/harvester/templates',
    checkAdminPermission,
    async (req: any, res: Response, next: any) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询', next)) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(HarvesterTemplateInventory);

        let whereCondition: any = { cloudId: id };
        const isTenantUser =
          (req.user as any)?.tenantId &&
          (req.user as any)?.role !== 'sase_device';
        const isTenantRole = (req.user as any)?.role === 'tenant';
        const isTenant = isTenantUser || isTenantRole;

        if (isTenant) {
          const tenantId = (req as any).user.tenantId;
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const matches = await userSpaceRepo.find({
            where: [
              {
                tenantId,
                cloudId: id,
                status: 'active',
                organizationId: (req.user as any).organizationId,
              },
              {
                tenantId,
                cloudId: id,
                status: 'active',
                organizationId: null,
              },
            ],
          });
          const us =
            matches.find(
              (m) => m.organizationId === (req.user as any).organizationId,
            ) || matches[0];

          if (!us)
            return res.json({ message: '查询成功', data: { items: [] } });

          if (us.namespace) {
            whereCondition = [
              { cloudId: id, namespace: us.namespace },
              { cloudId: id, namespace: 'cloud-public' },
              { cloudId: id, namespace: 'harvester-public' },
            ];
          } else {
            whereCondition = [
              { cloudId: id, namespace: 'cloud-public' },
              { cloudId: id, namespace: 'harvester-public' },
            ];
          }
        }

        const count = await repo.count({ where: whereCondition });

        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterTemplates(cloud, insecure);
          } catch (e: any) {
            console.warn(
              'Sync Templates failed, falling back to empty/stale',
              e,
            );
            if (count === 0) throw e;
          }
        }

        const items = await repo.find({ where: whereCondition });
        const list = items.map((i) => i.rawData);

        res.json({ message: '查询成功', data: { items: list } });
      } catch (error: any) {
        if (res.headersSent) return;
        res.status(500).json({ message: '查询模板失败', error: error.message });
      }
    },
  );
};
