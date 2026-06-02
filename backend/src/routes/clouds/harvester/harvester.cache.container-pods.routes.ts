/**
 * Harvester 容器路由 — Pod 列表、详情、日志与 Events。
 */
import { Router, Response } from 'express';
import { fetchCloudOr404, ensureProvider } from './harvester.cache.helpers';
import { getJsonOnce } from '../../../services/clouds/harvester/utils';
import { isSystemResource } from '../../../services/clouds/harvester/namespace';
import {
  buildK8sUrl,
  getAllNamespacedResources,
  getCached,
  getNamespacedResources,
  setCache,
} from './harvester.cache.container-shared';

export const registerHarvesterContainerPodRoutes = (
  router: Router,
  checkAdminPermission: any,
): void => {
  router.get(
    '/:id/resources/harvester/containers/pods',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { namespace, force, labelSelector, all } = req.query;

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        const cacheKey = `pods:${id}:${namespace || 'all'}:${labelSelector || 'all'}:${all || 'false'}`;

        let items = force === 'true' ? null : getCached<any[]>(cacheKey);

        if (!items) {
          const selector = labelSelector ? String(labelSelector) : undefined;
          if (namespace) {
            items = await getNamespacedResources(
              base,
              '/api/v1/pods',
              String(namespace),
              token,
              insecure,
              selector,
            );
          } else {
            items = await getAllNamespacedResources(
              base,
              '/api/v1/pods',
              token,
              insecure,
              selector,
            );
          }

          if (all !== 'true') {
            items = items.filter((item: any) => !isSystemResource(item));
          }

          setCache(cacheKey, items);
        }

        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({ message: '查询 Pod 失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/harvester/containers/pods/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params;

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        const url = buildK8sUrl(base, '/api/v1/pods', namespace, name);
        const result = await getJsonOnce(url, token, insecure, true);

        res.json({ message: '查询成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '查询 Pod 详情失败', error: error.message });
      }
    },
  );

  router.get(
    '/:id/resources/harvester/containers/pods/:namespace/:name/log',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params;
        const { container, tailLines, follow } = req.query;

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        let url = buildK8sUrl(base, '/api/v1/pods', namespace, name) + '/log?';
        if (container) url += `container=${encodeURIComponent(String(container))}&`;
        if (tailLines) url += `tailLines=${tailLines}&`;
        if (follow) url += `follow=${follow}&`;

        console.log(`[Container Log] Fetching logs from: ${url}`);

        const result = await getJsonOnce(url, token, insecure, false);
        console.log(
          `[Container Log] Result type: ${typeof result}, length: ${result?.length || 0}`,
        );

        res.type('text/plain').send(result);
      } catch (error: any) {
        console.error(`[Container Log] Error:`, error);
        const errorMsg = error?.body || error?.message || '获取 Pod 日志失败';
        res
          .status(error?.status || 500)
          .type('text/plain')
          .send(errorMsg);
      }
    },
  );

  router.get(
    '/:id/resources/harvester/containers/pods/:namespace/:name/events',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params;

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        const url =
          buildK8sUrl(base, '/api/v1/events', namespace) +
          `?fieldSelector=involvedObject.name=${encodeURIComponent(name)},involvedObject.kind=Pod`;

        console.log(`[Pod Events] Fetching events from: ${url}`);

        const result = await getJsonOnce(url, token, insecure, true);
        const items = result?.items || [];

        items.sort((a: any, b: any) => {
          const timeA = new Date(a?.lastTimestamp || a?.eventTime || 0).getTime();
          const timeB = new Date(b?.lastTimestamp || b?.eventTime || 0).getTime();
          return timeB - timeA;
        });

        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        console.error(`[Pod Events] Error:`, error);
        res.status(500).json({ message: '获取 Pod 事件失败', error: error.message });
      }
    },
  );
};
