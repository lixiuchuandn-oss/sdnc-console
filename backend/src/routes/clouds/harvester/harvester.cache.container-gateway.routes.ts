/**
 * Harvester 容器路由 — Gateway API（GatewayClass / Gateway / HTTPRoute / GRPCRoute）。
 */
import { Router, Response } from 'express';
import { fetchCloudOr404, ensureProvider } from './harvester.cache.helpers';
import { getJsonOnce, requestJson } from '../../../services/clouds/harvester/utils';
import { extractOrigin } from './harvester.cache.container-shared';

export const registerHarvesterContainerGatewayRoutes = (
  router: Router,
  checkAdminPermission: any,
): void => {
  router.get(
    '/:id/resources/harvester/containers/gateway-api/status',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        const origin = extractOrigin(base);

        // 检查 GatewayClass CRD 是否存在
        const crdUrl = `${origin}/apis/apiextensions.k8s.io/v1/customresourcedefinitions/gatewayclasses.gateway.networking.k8s.io`;

        let gatewayClassInstalled = false;
        let gatewayInstalled = false;
        let httpRouteInstalled = false;
        let grpcRouteInstalled = false;

        try {
          await getJsonOnce(crdUrl, token, insecure, true);
          gatewayClassInstalled = true;
        } catch {
          // GatewayClass CRD 不存在
        }

        if (gatewayClassInstalled) {
          // 检查其他 CRD
          try {
            const gatewayCrdUrl = `${origin}/apis/apiextensions.k8s.io/v1/customresourcedefinitions/gateways.gateway.networking.k8s.io`;
            await getJsonOnce(gatewayCrdUrl, token, insecure, true);
            gatewayInstalled = true;
          } catch {}

          try {
            const httpRouteCrdUrl = `${origin}/apis/apiextensions.k8s.io/v1/customresourcedefinitions/httproutes.gateway.networking.k8s.io`;
            await getJsonOnce(httpRouteCrdUrl, token, insecure, true);
            httpRouteInstalled = true;
          } catch {}

          try {
            const grpcRouteCrdUrl = `${origin}/apis/apiextensions.k8s.io/v1/customresourcedefinitions/grpcroutes.gateway.networking.k8s.io`;
            await getJsonOnce(grpcRouteCrdUrl, token, insecure, true);
            grpcRouteInstalled = true;
          } catch {}
        }

        const installed = gatewayClassInstalled && gatewayInstalled && httpRouteInstalled;

        res.json({
          message: '检测完成',
          data: {
            installed,
            resources: {
              gatewayClass: gatewayClassInstalled,
              gateway: gatewayInstalled,
              httpRoute: httpRouteInstalled,
              grpcRoute: grpcRouteInstalled,
            },
          },
        });
      } catch (error: any) {
        res.status(500).json({ message: '检测 Gateway API 状态失败', error: error.message });
      }
    },
  );

  /**
   * [API] 获取 GatewayClass 列表
   * GET /:id/resources/harvester/containers/gatewayclasses
   * 说明: GatewayClass 是集群级别的资源，不属于任何命名空间
   */
  router.get(
    '/:id/resources/harvester/containers/gatewayclasses',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        const origin = extractOrigin(base);
        const url = `${origin}/apis/gateway.networking.k8s.io/v1/gatewayclasses`;

        const result = await getJsonOnce(url, token, insecure, true);
        const items = result?.items || [];

        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        if (error?.status === 404 || error?.statusCode === 404) {
          return res.json({ message: '查询成功', data: { items: [] } });
        }
        res.status(500).json({ message: '查询 GatewayClass 失败', error: error.message });
      }
    },
  );

  router.post(
    '/:id/resources/harvester/containers/gatewayclasses',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const body = req.body;

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        const origin = extractOrigin(base);
        const url = `${origin}/apis/gateway.networking.k8s.io/v1/gatewayclasses`;

        const payload = {
          apiVersion: 'gateway.networking.k8s.io/v1',
          kind: 'GatewayClass',
          metadata: body?.metadata || { name: 'nginx' },
          spec: body?.spec || { controllerName: 'nginx.org/gateway-controller' },
        };

        const result = await requestJson('POST', url, token, insecure, payload);
        res.json({ message: '创建成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '创建 GatewayClass 失败', error: error.message });
      }
    },
  );

  /**
   * [API] 获取 Gateway 列表
   * GET /:id/resources/harvester/containers/gateways
   * Query: namespace (可选)
   */
  router.get(
    '/:id/resources/harvester/containers/gateways',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { namespace } = req.query;

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        const origin = extractOrigin(base);
        let url: string;

        if (namespace) {
          url = `${origin}/apis/gateway.networking.k8s.io/v1/namespaces/${encodeURIComponent(String(namespace))}/gateways`;
        } else {
          url = `${origin}/apis/gateway.networking.k8s.io/v1/gateways`;
        }

        const result = await getJsonOnce(url, token, insecure, true);
        const items = result?.items || [];

        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        if (error?.status === 404 || error?.statusCode === 404) {
          return res.json({ message: '查询成功', data: { items: [] } });
        }
        res.status(500).json({ message: '查询 Gateway 失败', error: error.message });
      }
    },
  );

  /**
   * [API] 获取 Gateway 详情
   * GET /:id/resources/harvester/containers/gateways/:namespace/:name
   */
  router.get(
    '/:id/resources/harvester/containers/gateways/:namespace/:name',
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

        const origin = extractOrigin(base);
        const url = `${origin}/apis/gateway.networking.k8s.io/v1/namespaces/${encodeURIComponent(namespace)}/gateways/${encodeURIComponent(name)}`;

        const result = await getJsonOnce(url, token, insecure, true);

        res.json({ message: '查询成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '查询 Gateway 详情失败', error: error.message });
      }
    },
  );

  /**
   * [API] 创建 Gateway
   * POST /:id/resources/harvester/containers/gateways
   * Body: { namespace, body }
   */
  router.post(
    '/:id/resources/harvester/containers/gateways',
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

        if (body.metadata) {
          body.metadata.namespace = namespace;
        }

        const origin = extractOrigin(base);
        const url = `${origin}/apis/gateway.networking.k8s.io/v1/namespaces/${encodeURIComponent(namespace)}/gateways`;

        console.log('[Gateway 创建] URL:', url);
        const result = await requestJson('POST', url, token, insecure, body);

        res.json({ message: '创建 Gateway 成功', data: result });
      } catch (error: any) {
        console.error('[Gateway 创建] 错误:', error);
        const errorMsg = error?.body || error?.message || '创建 Gateway 失败';
        res.status(error?.status || 500).json({ message: '创建 Gateway 失败', error: errorMsg });
      }
    },
  );

  /**
   * [API] 删除 Gateway
   * DELETE /:id/resources/harvester/containers/gateways/:namespace/:name
   */
  router.delete(
    '/:id/resources/harvester/containers/gateways/:namespace/:name',
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

        const origin = extractOrigin(base);
        const url = `${origin}/apis/gateway.networking.k8s.io/v1/namespaces/${encodeURIComponent(namespace)}/gateways/${encodeURIComponent(name)}`;

        const result = await requestJson('DELETE', url, token, insecure);

        res.json({ message: '删除 Gateway 成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '删除 Gateway 失败', error: error.message });
      }
    },
  );

  /**
   * [API] 获取 HTTPRoute 列表
   * GET /:id/resources/harvester/containers/httproutes
   * Query: namespace (可选)
   */
  router.get(
    '/:id/resources/harvester/containers/httproutes',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { namespace } = req.query;

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        const origin = extractOrigin(base);
        let url: string;

        if (namespace) {
          url = `${origin}/apis/gateway.networking.k8s.io/v1/namespaces/${encodeURIComponent(String(namespace))}/httproutes`;
        } else {
          url = `${origin}/apis/gateway.networking.k8s.io/v1/httproutes`;
        }

        const result = await getJsonOnce(url, token, insecure, true);
        const items = result?.items || [];

        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        if (error?.status === 404 || error?.statusCode === 404) {
          return res.json({ message: '查询成功', data: { items: [] } });
        }
        res.status(500).json({ message: '查询 HTTPRoute 失败', error: error.message });
      }
    },
  );

  /**
   * [API] 获取 HTTPRoute 详情
   * GET /:id/resources/harvester/containers/httproutes/:namespace/:name
   */
  router.get(
    '/:id/resources/harvester/containers/httproutes/:namespace/:name',
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

        const origin = extractOrigin(base);
        const url = `${origin}/apis/gateway.networking.k8s.io/v1/namespaces/${encodeURIComponent(namespace)}/httproutes/${encodeURIComponent(name)}`;

        const result = await getJsonOnce(url, token, insecure, true);

        res.json({ message: '查询成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '查询 HTTPRoute 详情失败', error: error.message });
      }
    },
  );

  /**
   * [API] 创建 HTTPRoute
   * POST /:id/resources/harvester/containers/httproutes
   * Body: { namespace, body }
   */
  router.post(
    '/:id/resources/harvester/containers/httproutes',
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

        if (body.metadata) {
          body.metadata.namespace = namespace;
        }

        const origin = extractOrigin(base);
        const url = `${origin}/apis/gateway.networking.k8s.io/v1/namespaces/${encodeURIComponent(namespace)}/httproutes`;

        console.log('[HTTPRoute 创建] URL:', url);
        const result = await requestJson('POST', url, token, insecure, body);

        res.json({ message: '创建 HTTPRoute 成功', data: result });
      } catch (error: any) {
        console.error('[HTTPRoute 创建] 错误:', error);
        const errorMsg = error?.body || error?.message || '创建 HTTPRoute 失败';
        res.status(error?.status || 500).json({ message: '创建 HTTPRoute 失败', error: errorMsg });
      }
    },
  );

  /**
   * [API] 删除 HTTPRoute
   * DELETE /:id/resources/harvester/containers/httproutes/:namespace/:name
   */
  router.delete(
    '/:id/resources/harvester/containers/httproutes/:namespace/:name',
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

        const origin = extractOrigin(base);
        const url = `${origin}/apis/gateway.networking.k8s.io/v1/namespaces/${encodeURIComponent(namespace)}/httproutes/${encodeURIComponent(name)}`;

        const result = await requestJson('DELETE', url, token, insecure);

        res.json({ message: '删除 HTTPRoute 成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '删除 HTTPRoute 失败', error: error.message });
      }
    },
  );

  /**
   * [API] 获取 GRPCRoute 列表
   * GET /:id/resources/harvester/containers/grpcroutes
   * Query: namespace (可选)
   */
  router.get(
    '/:id/resources/harvester/containers/grpcroutes',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { namespace } = req.query;

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        const origin = extractOrigin(base);
        let url: string;

        if (namespace) {
          url = `${origin}/apis/gateway.networking.k8s.io/v1/namespaces/${encodeURIComponent(String(namespace))}/grpcroutes`;
        } else {
          url = `${origin}/apis/gateway.networking.k8s.io/v1/grpcroutes`;
        }

        const result = await getJsonOnce(url, token, insecure, true);
        const items = result?.items || [];

        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        if (error?.status === 404 || error?.statusCode === 404) {
          return res.json({ message: '查询成功', data: { items: [] } });
        }
        res.status(500).json({ message: '查询 GRPCRoute 失败', error: error.message });
      }
    },
  );

  /**
   * [API] 获取 GRPCRoute 详情
   * GET /:id/resources/harvester/containers/grpcroutes/:namespace/:name
   */
  router.get(
    '/:id/resources/harvester/containers/grpcroutes/:namespace/:name',
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

        const origin = extractOrigin(base);
        const url = `${origin}/apis/gateway.networking.k8s.io/v1/namespaces/${encodeURIComponent(namespace)}/grpcroutes/${encodeURIComponent(name)}`;

        const result = await getJsonOnce(url, token, insecure, true);

        res.json({ message: '查询成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '查询 GRPCRoute 详情失败', error: error.message });
      }
    },
  );

  /**
   * [API] 创建 GRPCRoute
   * POST /:id/resources/harvester/containers/grpcroutes
   * Body: { namespace, body }
   */
  router.post(
    '/:id/resources/harvester/containers/grpcroutes',
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

        if (body.metadata) {
          body.metadata.namespace = namespace;
        }

        const origin = extractOrigin(base);
        const url = `${origin}/apis/gateway.networking.k8s.io/v1/namespaces/${encodeURIComponent(namespace)}/grpcroutes`;

        console.log('[GRPCRoute 创建] URL:', url);
        const result = await requestJson('POST', url, token, insecure, body);

        res.json({ message: '创建 GRPCRoute 成功', data: result });
      } catch (error: any) {
        console.error('[GRPCRoute 创建] 错误:', error);
        const errorMsg = error?.body || error?.message || '创建 GRPCRoute 失败';
        res.status(error?.status || 500).json({ message: '创建 GRPCRoute 失败', error: errorMsg });
      }
    },
  );

  /**
   * [API] 删除 GRPCRoute
   * DELETE /:id/resources/harvester/containers/grpcroutes/:namespace/:name
   */
  router.delete(
    '/:id/resources/harvester/containers/grpcroutes/:namespace/:name',
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

        const origin = extractOrigin(base);
        const url = `${origin}/apis/gateway.networking.k8s.io/v1/namespaces/${encodeURIComponent(namespace)}/grpcroutes/${encodeURIComponent(name)}`;

        const result = await requestJson('DELETE', url, token, insecure);

        res.json({ message: '删除 GRPCRoute 成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '删除 GRPCRoute 失败', error: error.message });
      }
    },
  );
};
