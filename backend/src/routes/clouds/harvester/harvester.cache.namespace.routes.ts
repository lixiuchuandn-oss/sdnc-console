import { Router, Response } from 'express';
import { AppDataSource } from '../../../config/database';
import { HarvesterNamespaceInventory } from '../../../entities/harvester/HarvesterNamespaceInventory';
import { HarvesterNamespace } from '../../../entities/harvester/HarvesterNamespace';
import { UserSpace } from '../../../entities/UserSpace';
import { syncHarvesterNamespaces } from '../../../services/clouds/harvester/inventory';
import { requestJson } from '../../../services/clouds/harvester/utils';
import { fetchCloudOr404, ensureProvider } from './harvester.cache.helpers';

export const registerHarvesterNamespaceRoutes = (
  router: Router,
  checkAdminPermission: any,
) => {
  router.get(
    '/:id/resources/harvester/namespaces',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { force } = req.query;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(HarvesterNamespaceInventory);

        let whereCondition: any = { cloudId: id };
        const isTenant =
          (req.user as any)?.role === 'tenant' ||
          ((req.user as any)?.tenantId &&
            (req.user as any)?.role !== 'sase_device');
        if (isTenant) {
          const userSpaceRepo = AppDataSource.getRepository(UserSpace);
          const where: any = {
            tenantId: (req as any).user.tenantId,
            cloudId: id,
            status: 'active',
          };
          if ((req.user as any).organizationId) {
            where.organizationId = (req.user as any).organizationId;
          }
          const us = await userSpaceRepo.findOne({ where });
          if (!us)
            return res.json({ message: '查询成功', data: { items: [] } });
          if (us.namespace) whereCondition.namespace = us.namespace;
        }

        const count = await repo.count({ where: whereCondition });

        if (count === 0 || String(force) === 'true') {
          try {
            await syncHarvesterNamespaces(cloud, insecure);
          } catch (e: any) {
            console.warn(
              'Sync Namespaces failed, falling back to empty/stale',
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
          .json({ message: '查询命名空间失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/harvester/namespaces/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, name } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;

        const repo = AppDataSource.getRepository(HarvesterNamespaceInventory);
        const item = await repo.findOne({
          where: { cloudId: id, name },
        });

        if (!item || !item.rawData) {
          return res
            .status(404)
            .json({ message: '命名空间不存在或未同步到本地数据库' });
        }

        res.json({ message: '查询成功', data: item.rawData });
      } catch (error: any) {
        res
          .status(500)
          .json({ message: '查询命名空间详情失败', error: error.message });
      }
    },
  );

  router.patch(
    '/:id/resources/harvester/namespaces/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, name } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源更新')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }

        const candidates = [
          `${origin}/api/v1/namespaces/${name}`,
          `${origin}/v1/core.v1.namespaces/${name}`,
          `${origin}/v1/harvester/core.v1.namespaces/${name}`,
          `${origin}/k8s/clusters/local/api/v1/namespaces/${name}`,
        ];

        let json: any = null;
        let lastErr: any = null;
        let success = false;
        const patchBody =
          req.body && Object.keys(req.body).length > 0
            ? req.body
            : { metadata: { labels: {} } };

        for (const url of candidates) {
          try {
            json = await requestJson(
              'PATCH',
              url,
              cloud.secretKey || '',
              insecure,
              patchBody,
              { 'Content-Type': 'application/merge-patch+json' },
            );
            success = true;
            break;
          } catch (e: any) {
            lastErr = e;
          }
        }

        if (!success && lastErr) {
          const status = Number(lastErr?.status || 0);
          const lower = String(lastErr?.message || '').toLowerCase();
          let msg = '更新命名空间失败';
          if (status === 403 || lower.includes('forbidden'))
            msg = '更新失败：权限不足（403）';
          else if (status === 404 || lower.includes('not found'))
            msg = '更新失败：命名空间不存在（404）';
          else if (status === 422 || lower.includes('invalid'))
            msg = '更新失败：参数非法（422）';
          return res
            .status(500)
            .json({ message: msg, error: lastErr?.message });
        }

        res.json({ message: '更新成功', data: json });
      } catch (error: any) {
        res
          .status(500)
          .json({ message: '更新命名空间失败', error: error.message });
      }
    },
  );

  router.post(
    '/:id/resources/harvester/namespaces',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源创建')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }

        const candidates = [
          `${origin}/api/v1/namespaces`,
          `${origin}/v1/core.v1.namespaces`,
          `${origin}/v1/harvester/core.v1.namespaces`,
          `${origin}/k8s/clusters/local/api/v1/namespaces`,
        ];

        let json: any = null;
        let lastErr: any = null;
        let success = false;

        for (const url of candidates) {
          try {
            json = await requestJson(
              'POST',
              url,
              cloud.secretKey || '',
              insecure,
              req.body,
            );
            success = true;
            break;
          } catch (e: any) {
            lastErr = e;
          }
        }

        if (!success && lastErr) {
          const status = Number(lastErr?.status || 0);
          const lower = String(lastErr?.message || '').toLowerCase();
          let msg = '创建命名空间失败';
          if (status === 403 || lower.includes('forbidden'))
            msg = '创建失败：权限不足（403）';
          else if (status === 409 || lower.includes('already exists'))
            msg = '创建失败：命名空间已存在（409）';
          else if (status === 422 || lower.includes('invalid'))
            msg = '创建失败：参数非法（422）';
          return res
            .status(500)
            .json({ message: msg, error: lastErr?.message });
        }
        res.json({ message: '创建成功', data: json });
      } catch (error: any) {
        res
          .status(500)
          .json({ message: '创建命名空间失败', error: error.message });
      }
    },
  );

  router.delete(
    '/:id/resources/harvester/namespaces/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, name } = req.params;
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源删除')) return;
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const base = (cloud.endpoint || '').replace(/\/+$/, '');
        let origin = base;
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }
        const candidates = [
          `${origin}/api/v1/namespaces/${name}`,
          `${origin}/v1/core.v1.namespaces/${name}`,
          `${origin}/v1/harvester/core.v1.namespaces/${name}`,
          `${origin}/k8s/clusters/local/api/v1/namespaces/${name}`,
        ];
        let json: any = null;
        let lastErr: any = null;
        let success = false;
        for (const url of candidates) {
          try {
            json = await requestJson(
              'DELETE',
              url,
              cloud.secretKey || '',
              insecure,
            );
            success = true;
            break;
          } catch (e: any) {
            lastErr = e;
            if (Number(e?.status) === 404) {
              success = true;
              break;
            }
          }
        }
        if (!success && lastErr) {
          return res
            .status(500)
            .json({ message: '删除命名空间失败', error: lastErr?.message });
        }
        res.json({ message: '删除成功', data: json });
      } catch (error: any) {
        res
          .status(500)
          .json({ message: '删除命名空间失败', error: error.message });
      }
    },
  );
};
