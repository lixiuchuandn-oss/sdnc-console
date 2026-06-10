/**
 * Harvester 容器路由 — ConfigMap / Secret 列表与 CRUD。
 */
import { Router, Response } from 'express';
import { fetchCloudOr404, ensureProvider } from './harvester.cache.helpers';
import { getJsonOnce, requestJson } from '../../../services/clouds/harvester/utils';
import { isSystemResource } from '../../../services/clouds/harvester/namespace';
import {
  CACHE_TTL_CONFIGMAP_DETAIL,
  CACHE_TTL_CONFIGMAPS,
  CACHE_TTL_SECRET_DETAIL,
  CACHE_TTL_SECRETS,
  buildCreateUrl,
  buildK8sUrl,
  clearCacheByPrefix,
  getAllNamespacedResources,
  getCached,
  getNamespacedResources,
  setCache,
} from './harvester.cache.container-shared';
import {
  isRegistryManagedPullSecret,
  isRegistryManagedPullSecretName,
  REGISTRY_MANAGED_SECRET_MESSAGE,
} from '../../../services/registryManagedSecret';

export const registerHarvesterContainerConfigRoutes = (
  router: Router,
  checkAdminPermission: any,
): void => {
  router.get(
    '/:id/resources/harvester/containers/configmaps',
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

        // 生成缓存 key
        const cacheKey = `configmaps:${id}:${namespace || 'all'}:${all || 'false'}`;

        // 尝试从缓存获取（force=true 时跳过缓存）
        // ConfigMaps 响应较慢，使用更长的缓存时间
        let items: any[] | null = null;
        if (force !== 'true' && force !== '1') {
          items = getCached<any[]>(cacheKey, CACHE_TTL_CONFIGMAPS);
        }

        if (!items) {
          // 缓存未命中，从 K8s API 获取
          if (namespace) {
            items = await getNamespacedResources(
              base,
              '/api/v1/configmaps',
              String(namespace),
              token,
              insecure,
            );
          } else {
            items = await getAllNamespacedResources(base, '/api/v1/configmaps', token, insecure);
          }

          // all !== 'true' 时过滤系统命名空间
          if (all !== 'true') {
            items = items.filter((item: any) => !isSystemResource(item));
          }

          // 存入缓存
          setCache(cacheKey, items);
        }

        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({ message: '查询 ConfigMap 失败', error: error.message });
      }
    },
  );

  /**
   * [API] 获取 Secret 列表
   * GET /:id/resources/harvester/containers/secrets
   * Query: namespace, type, force, all
   */
  router.get(
    '/:id/resources/harvester/containers/secrets',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { namespace, type, force, all } = req.query;

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        // 生成缓存 key (不包含 type，全量缓存，type 过滤在读取时进行)
        const cacheKey = `secrets:${id}:${namespace || 'all'}:all:${all || 'false'}`;

        // 尝试从缓存获取（force=true 时跳过缓存）
        // Secrets 响应慢，使用更长的缓存时间
        let items: any[] | null = null;
        if (force !== 'true' && force !== '1') {
          items = getCached<any[]>(cacheKey, CACHE_TTL_SECRETS);
        }

        if (!items) {
          // 缓存未命中，从 K8s API 获取
          if (namespace) {
            items = await getNamespacedResources(
              base,
              '/api/v1/secrets',
              String(namespace),
              token,
              insecure,
            );
          } else {
            items = await getAllNamespacedResources(base, '/api/v1/secrets', token, insecure);
          }

          // all !== 'true' 时过滤系统命名空间
          if (all !== 'true') {
            items = items.filter((item: any) => !isSystemResource(item));
          }

          // 脱敏处理：不返回 data 字段的内容，但提取有用信息
          items = items.map((item: any) => {
            // 对于 dockerconfigjson 类型，解析出仓库地址
            let registryServer: string | undefined;
            let registryUsername: string | undefined;

            if (
              item?.type === 'kubernetes.io/dockerconfigjson' &&
              item?.data?.['.dockerconfigjson']
            ) {
              try {
                const decoded = Buffer.from(item.data['.dockerconfigjson'], 'base64').toString(
                  'utf-8',
                );
                const config = JSON.parse(decoded);
                const auths = config.auths || {};
                const serverKey = Object.keys(auths)[0];
                if (serverKey) {
                  registryServer = serverKey;
                  registryUsername = auths[serverKey]?.username;
                }
              } catch {
                // 解析失败，忽略
              }
            }

            return {
              ...item,
              data: item.data
                ? Object.keys(item.data).reduce((acc: any, key: string) => {
                    acc[key] = '******';
                    return acc;
                  }, {} as any)
                : undefined,
              // 添加解析后的仓库信息（方便前端展示）
              _registryServer: registryServer,
              _registryUsername: registryUsername,
            };
          });

          // 存入缓存
          setCache(cacheKey, items);
        }

        // 按类型过滤（在返回前过滤，不影响缓存）
        let result = items;
        if (type) {
          result = items.filter((item: any) => item?.type === type);
        }

        res.json({ message: '查询成功', data: { items: result } });
      } catch (error: any) {
        res.status(500).json({ message: '查询 Secret 失败', error: error.message });
      }
    },
  );

  // ============================================================
  // [ConfigMap 操作] 创建/详情/更新
  // ============================================================

  /**
   * [API] 创建 ConfigMap
   * POST /:id/resources/harvester/containers/configmaps
   * Body: 完整的 ConfigMap 定义（包含 metadata、data）
   * 说明: 直接透传前端构建的完整资源定义
   */
  router.post(
    '/:id/resources/harvester/containers/configmaps',
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
        const url = buildCreateUrl(base, '/api/v1/configmaps', namespace);
        console.log('[ConfigMap 创建] URL:', url);

        const result = await requestJson('POST', url, token, insecure, body);

        // 清除 configmaps 缓存（列表 + 详情）
        clearCacheByPrefix(`configmaps:${id}:`);
        clearCacheByPrefix(`configmap:${id}:`);

        res.json({ message: '创建 ConfigMap 成功', data: result });
      } catch (error: any) {
        console.error('[ConfigMap 创建] 错误:', JSON.stringify(error, null, 2));
        const status = error?.status || 500;
        const k8sBody = error?.body;

        // 如果是 K8s Status 对象，提取关键信息
        if (k8sBody?.kind === 'Status') {
          const reason = k8sBody.reason || '';
          const message = k8sBody.message || '';
          const name = k8sBody?.details?.name || '';
          const kind = k8sBody?.details?.kind || 'ConfigMap';

          if (reason === 'AlreadyExists') {
            return res.status(409).json({
              message: `${kind} "${name}" 已存在`,
              reason: 'AlreadyExists',
              details: k8sBody.details,
            });
          }

          return res.status(status).json({ message: message || '创建 ConfigMap 失败' });
        }

        const errorMsg =
          typeof error?.body === 'string' ? error.body : error?.message || '创建 ConfigMap 失败';
        res.status(status).json({ message: '创建 ConfigMap 失败', error: errorMsg });
      }
    },
  );

  /**
   * [API] 获取 ConfigMap 详情
   * GET /:id/resources/harvester/containers/configmaps/:namespace/:name
   * Query: force (可选，跳过缓存)
   * 优化: 增加缓存，减少 K8s API 请求
   */
  router.get(
    '/:id/resources/harvester/containers/configmaps/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params;
        const { force } = req.query;

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        // 生成缓存 key
        const cacheKey = `configmap:${id}:${namespace}:${name}`;

        // 尝试从缓存获取（force=true 时跳过缓存）
        let result: any = null;
        if (force !== 'true' && force !== '1') {
          result = getCached<any>(cacheKey, CACHE_TTL_CONFIGMAP_DETAIL);
        }

        if (!result) {
          const url = buildK8sUrl(base, '/api/v1/configmaps', namespace, name);
          result = await getJsonOnce(url, token, insecure, true);
          // 存入缓存
          if (result) {
            setCache(cacheKey, result);
          }
        }

        if (!result) {
          return res.status(404).json({ message: 'ConfigMap 不存在' });
        }

        res.json({ message: '查询成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '查询 ConfigMap 详情失败', error: error.message });
      }
    },
  );

  /**
   * [API] 更新 ConfigMap
   * PUT /:id/resources/harvester/containers/configmaps/:namespace/:name
   * Body: { data, labels? }
   * 说明: 更新现有 ConfigMap 的数据和标签
   */
  router.put(
    '/:id/resources/harvester/containers/configmaps/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params;
        const { data, labels } = req.body;

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        // 先获取现有 ConfigMap 以保留其他字段
        const getUrl = buildK8sUrl(base, '/api/v1/configmaps', namespace, name);
        const existingConfigMap = await getJsonOnce(getUrl, token, insecure, true);

        if (!existingConfigMap) {
          return res.status(404).json({ message: 'ConfigMap 不存在' });
        }

        // 更新 ConfigMap
        const updatedConfigMap = {
          ...existingConfigMap,
          data: data !== undefined ? data : existingConfigMap.data,
          metadata: {
            ...existingConfigMap.metadata,
            labels: labels !== undefined ? labels : existingConfigMap.metadata?.labels,
          },
        };

        // 执行更新
        const updateUrl = buildK8sUrl(base, '/api/v1/configmaps', namespace, name);
        const result = await requestJson('PUT', updateUrl, token, insecure, updatedConfigMap);

        // 清除 configmaps 缓存（列表 + 详情）
        clearCacheByPrefix(`configmaps:${id}:`);
        clearCacheByPrefix(`configmap:${id}:`);

        res.json({ message: '更新 ConfigMap 成功', data: result });
      } catch (error: any) {
        console.error('[ConfigMap 更新] 错误:', JSON.stringify(error, null, 2));
        const errorMsg = error?.body || error?.message || '更新 ConfigMap 失败';
        res.status(error?.status || 500).json({ message: '更新 ConfigMap 失败', error: errorMsg });
      }
    },
  );

  /**
   * [API] 删除 ConfigMap
   * DELETE /:id/resources/harvester/containers/configmaps/:namespace/:name
   */
  router.delete(
    '/:id/resources/harvester/containers/configmaps/:namespace/:name',
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

        const url = buildK8sUrl(base, '/api/v1/configmaps', namespace, name);
        console.log('[ConfigMap 删除] URL:', url);

        const result = await requestJson('DELETE', url, token, insecure);

        // 清除 configmaps 缓存（列表 + 详情）
        clearCacheByPrefix(`configmaps:${id}:`);
        clearCacheByPrefix(`configmap:${id}:`);

        res.json({ message: '删除 ConfigMap 成功', data: result });
      } catch (error: any) {
        console.error('[ConfigMap 删除] 错误:', JSON.stringify(error, null, 2));
        const errorMsg = error?.body || error?.message || '删除 ConfigMap 失败';
        res.status(error?.status || 500).json({ message: '删除 ConfigMap 失败', error: errorMsg });
      }
    },
  );

  // ============================================================
  // [Secret 操作] 创建/详情/更新
  // ============================================================

  /**
   * [API] 创建 Secret
   * POST /:id/resources/harvester/containers/secrets
   * Body: 完整的 Secret 定义（包含 metadata、type、stringData）
   * 说明: 直接透传前端构建的完整资源定义
   */
  router.post(
    '/:id/resources/harvester/containers/secrets',
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
        const url = buildCreateUrl(base, '/api/v1/secrets', namespace);
        console.log('[Secret 创建] URL:', url);

        const result = await requestJson('POST', url, token, insecure, body);

        // 清除 secrets 缓存（列表 + 详情）
        clearCacheByPrefix(`secrets:${id}:`);
        clearCacheByPrefix(`secret:${id}:`);

        res.json({ message: '创建 Secret 成功', data: result });
      } catch (error: any) {
        console.error('[Secret 创建] 错误:', JSON.stringify(error, null, 2));
        const status = error?.status || 500;
        const k8sBody = error?.body;

        // 如果是 K8s Status 对象，提取关键信息
        if (k8sBody?.kind === 'Status') {
          const reason = k8sBody.reason || '';
          const message = k8sBody.message || '';
          const name = k8sBody?.details?.name || '';
          const kind = k8sBody?.details?.kind || 'Secret';

          if (reason === 'AlreadyExists') {
            return res.status(409).json({
              message: `${kind} "${name}" 已存在`,
              reason: 'AlreadyExists',
              details: k8sBody.details,
            });
          }

          return res.status(status).json({ message: message || '创建 Secret 失败' });
        }

        const errorMsg =
          typeof error?.body === 'string' ? error.body : error?.message || '创建 Secret 失败';
        res.status(status).json({ message: '创建 Secret 失败', error: errorMsg });
      }
    },
  );

  /**
   * [API] 获取 Secret 详情
   * GET /:id/resources/harvester/containers/secrets/:namespace/:name
   * Query: reveal (可选，默认 false，是否显示明文数据)
   * 说明: 获取 Secret 详情，默认对 data 值进行脱敏
   */
  router.get(
    '/:id/resources/harvester/containers/secrets/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params;
        const { reveal, force } = req.query;

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        // 生成缓存 key
        const cacheKey = `secret:${id}:${namespace}:${name}`;

        // 尝试从缓存获取（force=true 时跳过缓存）
        let result: any = null;
        if (force !== 'true' && force !== '1') {
          result = getCached<any>(cacheKey, CACHE_TTL_SECRET_DETAIL);
        }

        if (!result) {
          const url = buildK8sUrl(base, '/api/v1/secrets', namespace, name);
          result = await getJsonOnce(url, token, insecure, true);
          // 存入缓存
          setCache(cacheKey, result);
        }

        if (!result) {
          return res.status(404).json({ message: 'Secret 不存在' });
        }

        // 处理数据脱敏
        const shouldReveal = reveal === 'true' || reveal === '1';

        if (!shouldReveal && result.data) {
          // 脱敏处理：将 data 值替换为 ******
          result.data = Object.keys(result.data).reduce((acc: any, key: string) => {
            acc[key] = '******';
            return acc;
          }, {} as any);
        } else if (shouldReveal && result.data) {
          // 解码 base64 数据
          result.stringData = Object.keys(result.data).reduce((acc: any, key: string) => {
            try {
              acc[key] = Buffer.from(result.data[key], 'base64').toString('utf-8');
            } catch {
              acc[key] = result.data[key];
            }
            return acc;
          }, {} as any);
        }

        res.json({ message: '查询成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '查询 Secret 详情失败', error: error.message });
      }
    },
  );

  /**
   * [API] 更新 Secret
   * PUT /:id/resources/harvester/containers/secrets/:namespace/:name
   * Body: { stringData, labels? }
   * 说明: 更新现有 Secret 的数据（使用 stringData，K8s 自动 base64 编码）
   */
  router.put(
    '/:id/resources/harvester/containers/secrets/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params;
        const { stringData, labels } = req.body;

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        // 先获取现有 Secret 以保留其他字段
        const getUrl = buildK8sUrl(base, '/api/v1/secrets', namespace, name);
        const existingSecret = await getJsonOnce(getUrl, token, insecure, true);

        if (!existingSecret) {
          return res.status(404).json({ message: 'Secret 不存在' });
        }

        if (
          isRegistryManagedPullSecretName(name) ||
          isRegistryManagedPullSecret(existingSecret)
        ) {
          return res.status(403).json({ message: REGISTRY_MANAGED_SECRET_MESSAGE });
        }

        // 更新 Secret
        // 注意：使用 stringData 时，K8s 会自动转换为 base64 编码的 data
        const updatedSecret: any = {
          ...existingSecret,
          metadata: {
            ...existingSecret.metadata,
            labels: labels !== undefined ? labels : existingSecret.metadata?.labels,
          },
        };

        // 如果提供了 stringData，添加到更新体中
        if (stringData !== undefined) {
          updatedSecret.stringData = stringData;
          // 删除原有的 data 字段，让 K8s 重新生成
          delete updatedSecret.data;
        }

        // 执行更新
        const updateUrl = buildK8sUrl(base, '/api/v1/secrets', namespace, name);
        const result = await requestJson('PUT', updateUrl, token, insecure, updatedSecret);

        // 清除 secrets 缓存（列表 + 详情）
        clearCacheByPrefix(`secrets:${id}:`);
        clearCacheByPrefix(`secret:${id}:`);

        res.json({ message: '更新 Secret 成功', data: result });
      } catch (error: any) {
        const errorMsg = error?.body || error?.message || '更新 Secret 失败';
        res.status(error?.status || 500).json({ message: '更新 Secret 失败', error: errorMsg });
      }
    },
  );

  /**
   * [API] 删除 Secret
   * DELETE /:id/resources/harvester/containers/secrets/:namespace/:name
   */
  router.delete(
    '/:id/resources/harvester/containers/secrets/:namespace/:name',
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

        if (isRegistryManagedPullSecretName(name)) {
          return res.status(403).json({ message: REGISTRY_MANAGED_SECRET_MESSAGE });
        }

        const getUrl = buildK8sUrl(base, '/api/v1/secrets', namespace, name);
        const existingSecret = await getJsonOnce(getUrl, token, insecure, true);
        if (!existingSecret) {
          return res.status(404).json({ message: 'Secret 不存在' });
        }
        if (isRegistryManagedPullSecret(existingSecret)) {
          return res.status(403).json({ message: REGISTRY_MANAGED_SECRET_MESSAGE });
        }

        const url = buildK8sUrl(base, '/api/v1/secrets', namespace, name);
        console.log('[Secret 删除] URL:', url);

        const result = await requestJson('DELETE', url, token, insecure);

        // 清除 secrets 缓存（列表 + 详情）
        clearCacheByPrefix(`secrets:${id}:`);
        clearCacheByPrefix(`secret:${id}:`);

        res.json({ message: '删除 Secret 成功', data: result });
      } catch (error: any) {
        console.error('[Secret 删除] 错误:', JSON.stringify(error, null, 2));
        const errorMsg = error?.body || error?.message || '删除 Secret 失败';
        res.status(error?.status || 500).json({ message: '删除 Secret 失败', error: errorMsg });
      }
    },
  );
};
