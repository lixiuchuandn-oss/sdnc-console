/**
 * Harvester 容器路由 — NetworkPolicy 列表与 CRUD。
 */
import { Router, Response } from 'express';
import { fetchCloudOr404, ensureProvider } from './harvester.cache.helpers';
import { getJsonOnce, requestJson } from '../../../services/clouds/harvester/utils';
import { isSystemResource } from '../../../services/clouds/harvester/namespace';
import {
  buildCreateUrl,
  buildK8sUrl,
  getAllNamespacedResources,
  getNamespacedResources,
} from './harvester.cache.container-shared';

const formatNetworkPolicyItem = (item: any) => item;

export const registerHarvesterContainerNetworkPolicyRoutes = (
  router: Router,
  checkAdminPermission: any,
): void => {
  router.get(
    '/:id/resources/harvester/containers/networkpolicies',
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
            '/apis/networking.k8s.io/v1/networkpolicies',
            String(namespace),
            token,
            insecure,
          );
        } else {
          items = await getAllNamespacedResources(
            base,
            '/apis/networking.k8s.io/v1/networkpolicies',
            token,
            insecure,
          );
        }

        // all !== 'true' 时过滤系统命名空间
        if (all !== 'true') {
          items = items.filter((item: any) => !isSystemResource(item));
        }

        // 格式化返回数据
        const formattedItems = items.map(formatNetworkPolicyItem);

        res.json({ message: '查询成功', data: { items: formattedItems } });
      } catch (error: any) {
        res.status(500).json({ message: '查询 NetworkPolicy 失败', error: error.message });
      }
    },
  );

  /**
   * [API] 获取 NetworkPolicy 详情
   * GET /:id/resources/harvester/containers/networkpolicies/:namespace/:name
   */
  router.get(
    '/:id/resources/harvester/containers/networkpolicies/:namespace/:name',
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

        const url = buildK8sUrl(
          base,
          '/apis/networking.k8s.io/v1/networkpolicies',
          namespace,
          name,
        );
        const result = await getJsonOnce(url, token, insecure, true);

        res.json({ message: '查询成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '查询 NetworkPolicy 详情失败', error: error.message });
      }
    },
  );

  /**
   * [API] 获取 NetworkPolicy YAML
   * GET /:id/resources/harvester/containers/networkpolicies/:namespace/:name/yaml
   */
  router.get(
    '/:id/resources/harvester/containers/networkpolicies/:namespace/:name/yaml',
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

        const url = buildK8sUrl(
          base,
          '/apis/networking.k8s.io/v1/networkpolicies',
          namespace,
          name,
        );
        const result = await getJsonOnce(url, token, insecure, true);

        res.json({ message: '查询成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '获取 NetworkPolicy YAML 失败', error: error.message });
      }
    },
  );

  /**
   * [API] 创建 NetworkPolicy
   * POST /:id/resources/harvester/containers/networkpolicies
   * Body: { namespace, body }
   * 说明: 创建 Kubernetes NetworkPolicy 资源
   */
  router.post(
    '/:id/resources/harvester/containers/networkpolicies',
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

        const url = buildCreateUrl(base, '/apis/networking.k8s.io/v1/networkpolicies', namespace);
        console.log('[NetworkPolicy 创建] URL:', url);
        console.log('[NetworkPolicy 创建] namespace:', namespace);
        console.log('[NetworkPolicy 创建] name:', body?.metadata?.name);

        const result = await requestJson('POST', url, token, insecure, body);

        res.json({ message: '创建 NetworkPolicy 成功', data: result });
      } catch (error: any) {
        console.error('[NetworkPolicy 创建] 错误:', error);
        const errorMsg = error?.body || error?.message || '创建 NetworkPolicy 失败';
        res
          .status(error?.status || 500)
          .json({ message: '创建 NetworkPolicy 失败', error: errorMsg });
      }
    },
  );

  /**
   * [API] 更新 NetworkPolicy
   * PUT /:id/resources/harvester/containers/networkpolicies/:namespace/:name
   * Body: NetworkPolicy 完整对象
   */
  router.put(
    '/:id/resources/harvester/containers/networkpolicies/:namespace/:name',
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

        const url = buildK8sUrl(
          base,
          '/apis/networking.k8s.io/v1/networkpolicies',
          namespace,
          name,
        );

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
            res.json({ message: '更新 NetworkPolicy 成功', data: result });
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
        res.status(500).json({ message: '更新 NetworkPolicy 失败', error: errorDetail });
      }
    },
  );

  /**
   * [API] 删除 NetworkPolicy
   * DELETE /:id/resources/harvester/containers/networkpolicies/:namespace/:name
   */
  router.delete(
    '/:id/resources/harvester/containers/networkpolicies/:namespace/:name',
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

        const url = buildK8sUrl(
          base,
          '/apis/networking.k8s.io/v1/networkpolicies',
          namespace,
          name,
        );
        const result = await requestJson('DELETE', url, token, insecure);

        res.json({ message: '删除 NetworkPolicy 成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '删除 NetworkPolicy 失败', error: error.message });
      }
    },
  );
};
