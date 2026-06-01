/**
 * Harvester 容器路由 — 工作负载（Deployment / StatefulSet / DaemonSet）列表。
 */
import { Router, Response } from 'express';
import { fetchCloudOr404, ensureProvider } from './harvester.cache.helpers';
import { isSystemResource } from '../../../services/clouds/harvester/namespace';
import {
  getAllNamespacedResources,
  getNamespacedResources,
} from './harvester.cache.container-shared';

export const registerHarvesterContainerWorkloadRoutes = (
  router: Router,
  checkAdminPermission: any,
): void => {
  router.get(
    '/:id/resources/harvester/containers/deployments',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { namespace, all } = req.query;

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        let items: any[];
        if (namespace) {
          items = await getNamespacedResources(
            base,
            '/apis/apps/v1/deployments',
            String(namespace),
            token,
            insecure,
          );
        } else {
          items = await getAllNamespacedResources(
            base,
            '/apis/apps/v1/deployments',
            token,
            insecure,
          );
        }

        if (all !== 'true') {
          items = items.filter((item: any) => !isSystemResource(item));
        }

        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({ message: '查询 Deployment 失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/harvester/containers/statefulsets',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { namespace, all } = req.query;

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        let items: any[];
        if (namespace) {
          items = await getNamespacedResources(
            base,
            '/apis/apps/v1/statefulsets',
            String(namespace),
            token,
            insecure,
          );
        } else {
          items = await getAllNamespacedResources(
            base,
            '/apis/apps/v1/statefulsets',
            token,
            insecure,
          );
        }

        if (all !== 'true') {
          items = items.filter((item: any) => !isSystemResource(item));
        }

        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({ message: '查询 StatefulSet 失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/harvester/containers/daemonsets',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { namespace, all } = req.query;

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        let items: any[];
        if (namespace) {
          items = await getNamespacedResources(
            base,
            '/apis/apps/v1/daemonsets',
            String(namespace),
            token,
            insecure,
          );
        } else {
          items = await getAllNamespacedResources(
            base,
            '/apis/apps/v1/daemonsets',
            token,
            insecure,
          );
        }

        if (all !== 'true') {
          items = items.filter((item: any) => !isSystemResource(item));
        }

        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({ message: '查询 DaemonSet 失败', error: error.message });
      }
    },
  );
};
