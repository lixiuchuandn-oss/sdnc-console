/**
 * Harvester 容器路由 — PodDisruptionBudget 列表与 CRUD。
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

export const registerHarvesterContainerPdbRoutes = (
  router: Router,
  checkAdminPermission: any,
): void => {
  router.get(
    '/:id/resources/harvester/containers/poddisruptionbudgets',
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

        // PDB API: /apis/policy/v1/namespaces/{namespace}/poddisruptionbudgets
        let items: any[];
        if (namespace) {
          items = await getNamespacedResources(
            base,
            '/apis/policy/v1/poddisruptionbudgets',
            String(namespace),
            token,
            insecure,
          );
        } else {
          items = await getAllNamespacedResources(
            base,
            '/apis/policy/v1/poddisruptionbudgets',
            token,
            insecure,
          );
        }

        // all !== 'true' 时过滤系统命名空间
        if (all !== 'true') {
          items = items.filter((item: any) => !isSystemResource(item));
        }

        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({ message: '查询 PodDisruptionBudget 失败', error: error.message });
      }
    },
  );

  /**
   * [API] 获取 PodDisruptionBudget 详情
   * GET /:id/resources/harvester/containers/poddisruptionbudgets/:namespace/:name
   */
  router.get(
    '/:id/resources/harvester/containers/poddisruptionbudgets/:namespace/:name',
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

        const url = buildK8sUrl(base, '/apis/policy/v1/poddisruptionbudgets', namespace, name);
        const result = await getJsonOnce(url, token, insecure, true);

        if (!result) {
          return res.status(404).json({ message: 'PodDisruptionBudget 不存在' });
        }

        res.json({ message: '查询成功', data: result });
      } catch (error: any) {
        res
          .status(500)
          .json({ message: '查询 PodDisruptionBudget 详情失败', error: error.message });
      }
    },
  );

  /**
   * [API] 创建 PodDisruptionBudget
   * POST /:id/resources/harvester/containers/poddisruptionbudgets
   * Body: 完整的 PDB 定义（包含 metadata、spec）
   * 说明: 直接透传前端构建的完整资源定义
   */
  router.post(
    '/:id/resources/harvester/containers/poddisruptionbudgets',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { namespace, body } = req.body;

        // 参数验证
        if (!namespace || !body) {
          return res.status(400).json({
            message: '缺少必要参数: namespace, body',
          });
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

        // 使用原生 K8s API 创建
        const url = buildCreateUrl(base, '/apis/policy/v1/poddisruptionbudgets', namespace);
        console.log('[PDB 创建] URL:', url);

        const result = await requestJson('POST', url, token, insecure, body);

        res.json({ message: '创建 PodDisruptionBudget 成功', data: result });
      } catch (error: any) {
        console.error('[PDB 创建] 错误:', JSON.stringify(error, null, 2));
        const errorMsg = error?.body || error?.message || '创建 PodDisruptionBudget 失败';
        res
          .status(error?.status || 500)
          .json({ message: '创建 PodDisruptionBudget 失败', error: errorMsg });
      }
    },
  );

  /**
   * [API] 删除 PodDisruptionBudget
   * DELETE /:id/resources/harvester/containers/poddisruptionbudgets/:namespace/:name
   */
  router.delete(
    '/:id/resources/harvester/containers/poddisruptionbudgets/:namespace/:name',
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

        const url = buildK8sUrl(base, '/apis/policy/v1/poddisruptionbudgets', namespace, name);
        console.log('[PDB 删除] URL:', url);

        const result = await requestJson('DELETE', url, token, insecure);

        res.json({ message: '删除 PodDisruptionBudget 成功', data: result });
      } catch (error: any) {
        console.error('[PDB 删除] 错误:', JSON.stringify(error, null, 2));
        const errorMsg = error?.body || error?.message || '删除 PodDisruptionBudget 失败';
        res
          .status(error?.status || 500)
          .json({ message: '删除 PodDisruptionBudget 失败', error: errorMsg });
      }
    },
  );
};
