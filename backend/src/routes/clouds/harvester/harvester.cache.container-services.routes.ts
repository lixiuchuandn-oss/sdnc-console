/**
 * Harvester 容器路由 — Service / Ingress 列表与 CRUD。
 */
import { Router, Response } from 'express';
import { fetchCloudOr404, ensureProvider } from './harvester.cache.helpers';
import { getJsonOnce, requestJson } from '../../../services/clouds/harvester/utils';
import {
  syncHarvesterIngresses,
  syncHarvesterServices,
} from '../../../services/clouds/harvester/inventory';
import { isSystemResource } from '../../../services/clouds/harvester/namespace';
import {
  buildCreateUrl,
  buildK8sUrl,
  getAllNamespacedResources,
  getCached,
  getNamespacedResources,
  setCache,
} from './harvester.cache.container-shared';

export const registerHarvesterContainerServiceRoutes = (
  router: Router,
  checkAdminPermission: any,
): void => {
  router.get(
    '/:id/resources/harvester/containers/services',
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
            '/api/v1/services',
            String(namespace),
            token,
            insecure,
          );
        } else {
          items = await getAllNamespacedResources(base, '/api/v1/services', token, insecure);
        }

        // all !== 'true' 时过滤系统命名空间
        if (all !== 'true') {
          items = items.filter((item: any) => !isSystemResource(item));
        }

        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({ message: '查询 Service 失败', error: error.message });
      }
    },
  );

  /**
   * [API] 获取 Ingress 列表
   * GET /:id/resources/harvester/containers/ingresses
   * Query: namespace, force, all
   * 说明: Ingress 是 Kubernetes 网络资源，用于 HTTP/HTTPS 路由
   * K8s API: /apis/networking.k8s.io/v1/namespaces/{ns}/ingresses 或 /apis/networking.k8s.io/v1/ingresses
   */
  router.get(
    '/:id/resources/harvester/containers/ingresses',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { namespace, force, all } = req.query;

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        // 尝试从缓存获取（force=true 时跳过缓存）
        const cacheKey = `ingresses:${id}:${namespace || 'all'}:${all || 'false'}`;
        let items: any[] | null = null;
        if (force !== 'true' && force !== '1') {
          items = getCached<any[]>(cacheKey);
        }

        if (!items) {
          if (namespace) {
            items = await getNamespacedResources(
              base,
              '/apis/networking.k8s.io/v1/ingresses',
              String(namespace),
              token,
              insecure,
            );
          } else {
            items = await getAllNamespacedResources(
              base,
              '/apis/networking.k8s.io/v1/ingresses',
              token,
              insecure,
            );
          }

          // all !== 'true' 时过滤系统命名空间
          if (all !== 'true') {
            items = items.filter((item: any) => !isSystemResource(item));
          }

          // 缓存结果（30秒）
          setCache(cacheKey, items);
        }

        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({ message: '查询 Ingress 失败', error: error.message });
      }
    },
  );

  // ============================================================
  // [Service 操作] 详情/创建/更新/删除
  // ============================================================

  /**
   * [API] 获取 Service 详情
   * GET /:id/resources/harvester/containers/services/:namespace/:name
   */
  router.get(
    '/:id/resources/harvester/containers/services/:namespace/:name',
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

        const url = buildK8sUrl(base, '/api/v1/services', namespace, name);
        const result = await getJsonOnce(url, token, insecure, true);

        res.json({ message: '查询成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '查询 Service 详情失败', error: error.message });
      }
    },
  );

  /**
   * [API] 创建 Service
   * POST /:id/resources/harvester/containers/services
   * Body: { namespace, body }
   */
  router.post(
    '/:id/resources/harvester/containers/services',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { namespace, body } = req.body;

        if (!namespace || !body) {
          return res.status(400).json({ message: '缺少必要参数: namespace, body' });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        // 确保 body.metadata.namespace 存在
        if (body.metadata) {
          body.metadata.namespace = namespace;
        }

        const url = buildCreateUrl(base, '/api/v1/services', namespace);
        console.log('[Service 创建] URL:', url);

        const result = await requestJson('POST', url, token, insecure, body);

        // 创建成功后同步数据库缓存
        try {
          await syncHarvesterServices(cloud, insecure);
        } catch (syncError) {
          console.warn('[Service 创建] 同步缓存失败:', syncError);
        }

        res.json({ message: '创建 Service 成功', data: result });
      } catch (error: any) {
        console.error('[Service 创建] 错误:', error);
        const errorMsg = error?.body || error?.message || '创建 Service 失败';
        res.status(error?.status || 500).json({ message: '创建 Service 失败', error: errorMsg });
      }
    },
  );

  /**
   * [API] 更新 Service
   * PUT /:id/resources/harvester/containers/services/:namespace/:name
   * Body: Service 完整对象
   */
  router.put(
    '/:id/resources/harvester/containers/services/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params;
        const body = req.body;

        if (!body) {
          return res.status(400).json({ message: '缺少请求体' });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        const url = buildK8sUrl(base, '/api/v1/services', namespace, name);

        const maxRetries = 3;
        let lastError: any;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            const current = await getJsonOnce(url, token, insecure, true);
            if (current?.metadata?.resourceVersion) {
              body.metadata = body.metadata || {};
              body.metadata.resourceVersion = current.metadata.resourceVersion;
            }
          } catch {}

          try {
            const result = await requestJson('PUT', url, token, insecure, body);
            res.json({ message: '更新 Service 成功', data: result });
            return;
          } catch (putError: any) {
            lastError = putError;
            if (putError?.status !== 409) throw putError;
          }
        }

        throw lastError;
      } catch (error: any) {
        res.status(500).json({ message: '更新 Service 失败', error: error.message });
      }
    },
  );

  /**
   * [API] 删除 Service
   * DELETE /:id/resources/harvester/containers/services/:namespace/:name
   */
  router.delete(
    '/:id/resources/harvester/containers/services/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params;

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        const url = buildK8sUrl(base, '/api/v1/services', namespace, name);
        const result = await requestJson('DELETE', url, token, insecure);

        res.json({ message: '删除 Service 成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '删除 Service 失败', error: error.message });
      }
    },
  );

  // ============================================================
  // [Ingress 操作] 详情/创建/更新/删除
  // ============================================================

  /**
   * [API] 获取 Ingress 详情
   * GET /:id/resources/harvester/containers/ingresses/:namespace/:name
   */
  router.get(
    '/:id/resources/harvester/containers/ingresses/:namespace/:name',
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

        const url = buildK8sUrl(base, '/apis/networking.k8s.io/v1/ingresses', namespace, name);
        const result = await getJsonOnce(url, token, insecure, true);

        res.json({ message: '查询成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '查询 Ingress 详情失败', error: error.message });
      }
    },
  );

  /**
   * [API] 创建 Ingress
   * POST /:id/resources/harvester/containers/ingresses
   * Body: { namespace, body }
   */
  router.post(
    '/:id/resources/harvester/containers/ingresses',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { namespace, body } = req.body;

        if (!namespace || !body) {
          return res.status(400).json({ message: '缺少必要参数: namespace, body' });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        // 确保 body.metadata.namespace 存在
        if (body.metadata) {
          body.metadata.namespace = namespace;
        }

        const url = buildCreateUrl(base, '/apis/networking.k8s.io/v1/ingresses', namespace);
        console.log('[Ingress 创建] URL:', url);

        const result = await requestJson('POST', url, token, insecure, body);

        // 创建成功后同步数据库缓存
        try {
          await syncHarvesterIngresses(cloud, insecure);
        } catch (syncError) {
          console.warn('[Ingress 创建] 同步缓存失败:', syncError);
        }

        res.json({ message: '创建 Ingress 成功', data: result });
      } catch (error: any) {
        console.error('[Ingress 创建] 错误:', error);
        const errorMsg = error?.body || error?.message || '创建 Ingress 失败';
        res.status(error?.status || 500).json({ message: '创建 Ingress 失败', error: errorMsg });
      }
    },
  );

  /**
   * [API] 更新 Ingress
   * PUT /:id/resources/harvester/containers/ingresses/:namespace/:name
   * Body: Ingress 完整对象
   */
  router.put(
    '/:id/resources/harvester/containers/ingresses/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params;
        const body = req.body;

        if (!body) {
          return res.status(400).json({ message: '缺少请求体' });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        const url = buildK8sUrl(base, '/apis/networking.k8s.io/v1/ingresses', namespace, name);

        const maxRetries = 3;
        let lastError: any;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            const current = await getJsonOnce(url, token, insecure, true);
            if (current?.metadata?.resourceVersion) {
              body.metadata = body.metadata || {};
              body.metadata.resourceVersion = current.metadata.resourceVersion;
            }
          } catch {}

          try {
            const result = await requestJson('PUT', url, token, insecure, body);
            res.json({ message: '更新 Ingress 成功', data: result });
            return;
          } catch (putError: any) {
            lastError = putError;
            if (putError?.status !== 409) throw putError;
          }
        }

        throw lastError;
      } catch (error: any) {
        // 尝试提取 Kubernetes 返回的详细错误信息
        let errorDetail = error.message;
        if (error.response?.body) {
          try {
            const parsed =
              typeof error.response.body === 'string'
                ? JSON.parse(error.response.body)
                : error.response.body;
            errorDetail = parsed.message || parsed.error || error.response.body;
          } catch {
            errorDetail = error.response.body;
          }
        }
        res.status(500).json({ message: '更新 Ingress 失败', error: errorDetail });
      }
    },
  );

  /**
   * [API] 删除 Ingress
   * DELETE /:id/resources/harvester/containers/ingresses/:namespace/:name
   */
  router.delete(
    '/:id/resources/harvester/containers/ingresses/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params;

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        const url = buildK8sUrl(base, '/apis/networking.k8s.io/v1/ingresses', namespace, name);
        const result = await requestJson('DELETE', url, token, insecure);

        res.json({ message: '删除 Ingress 成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '删除 Ingress 失败', error: error.message });
      }
    },
  );
};
