/**
 * Harvester 容器路由 — 镜像拉取凭证 (ImagePullSecret / dockerconfigjson)。
 */
import { Router, Response } from 'express';
import { fetchCloudOr404, ensureProvider } from './harvester.cache.helpers';
import { getJsonOnce, requestJson } from '../../../services/clouds/harvester/utils';
import { isSystemResource } from '../../../services/clouds/harvester/namespace';
import {
  CACHE_TTL_SECRETS,
  buildCreateUrl,
  buildK8sUrl,
  clearCacheByPrefix,
  getAllNamespacedResources,
  getCached,
  getNamespacedResources,
  setCache,
} from './harvester.cache.container-shared';

const buildDockerConfigJson = (
  server: string,
  username: string,
  password: string,
  email?: string,
): string => {
  // 构建认证字符串: base64(username:password)
  const authString = Buffer.from(`${username}:${password}`).toString('base64');

  // 构建 dockerconfigjson 结构
  const dockerConfig = {
    auths: {
      [server]: {
        username,
        password,
        auth: authString,
        ...(email && { email }),
      },
    },
  };

  // 返回 Base64 编码的 JSON
  return Buffer.from(JSON.stringify(dockerConfig)).toString('base64');
};

export const registerHarvesterContainerImagePullRoutes = (
  router: Router,
  checkAdminPermission: any,
): void => {
  router.get(
    '/:id/resources/harvester/containers/imagepullsecrets',
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

        // 复用 secrets 缓存 key (与 secrets 列表路由一致)
        const cacheKey = `secrets:${id}:${namespace || 'all'}:all:${all || 'false'}`;

        // 尝试从缓存获取
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

          // 脱敏处理 (复用 secrets 列表路由的逻辑)
          items = items.map((item: any) => {
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
              _registryServer: registryServer,
              _registryUsername: registryUsername,
            };
          });

          // 存入缓存
          setCache(cacheKey, items);
        }

        // 过滤 kubernetes.io/dockerconfigjson 类型并转换为简化格式
        const imagePullSecrets = items
          .filter((item: any) => item?.type === 'kubernetes.io/dockerconfigjson')
          .map((item: any) => ({
            name: item.metadata?.name,
            namespace: item.metadata?.namespace,
            creationTimestamp: item.metadata?.creationTimestamp,
            type: item.type,
            server: item._registryServer,
            username: item._registryUsername,
          }));

        res.json({ message: '查询成功', data: { items: imagePullSecrets } });
      } catch (error: any) {
        res.status(500).json({ message: '查询镜像凭证失败', error: error.message });
      }
    },
  );

  /**
   * [API] 创建镜像凭证
   * POST /:id/resources/harvester/containers/imagepullsecrets
   * Body: { namespace, name, alias?, server, username, password, email? }
   * 说明: 创建 kubernetes.io/dockerconfigjson 类型的 Secret
   */
  router.post(
    '/:id/resources/harvester/containers/imagepullsecrets',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { namespace, name, alias, server, username, password, email } = req.body;

        // 参数验证
        if (!namespace || !name || !server || !username || !password) {
          return res.status(400).json({
            message: '缺少必要参数: namespace, name, server, username, password',
          });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        // 构建 annotations
        const annotations: Record<string, string> = {
          'compute-tower.io/managed': 'true',
          'compute-tower.io/type': 'imagepullsecret',
        };
        if (alias) {
          annotations['tower.io/alias'] = alias;
        }

        // 构建 Secret 对象
        const secretBody = {
          apiVersion: 'v1',
          kind: 'Secret',
          metadata: {
            name: name,
            namespace: namespace,
            labels: {
              'compute-tower.io/managed': 'true',
              'compute-tower.io/type': 'imagepullsecret',
            },
            annotations,
          },
          type: 'kubernetes.io/dockerconfigjson',
          data: {
            '.dockerconfigjson': buildDockerConfigJson(server, username, password, email),
          },
        };

        // 使用原生 K8s API 创建（使用 buildCreateUrl 统一处理 /k8s/clusters/local/ 路径）
        const url = buildCreateUrl(base, '/api/v1/secrets', namespace);
        console.log('[镜像凭证创建] URL:', url);
        console.log('[镜像凭证创建] namespace:', namespace);
        console.log('[镜像凭证创建] name:', name);
        console.log('[镜像凭证创建] server:', server);

        const result = await requestJson('POST', url, token, insecure, secretBody);

        // 清除 secrets 缓存，确保列表能立即显示新创建的凭证
        clearCacheByPrefix(`secrets:${id}:`);

        res.json({ message: '创建镜像凭证成功', data: result });
      } catch (error: any) {
        console.error('[镜像凭证创建] 错误:', JSON.stringify(error, null, 2));
        const errorMsg = error?.body || error?.message || '创建镜像凭证失败';
        res.status(error?.status || 500).json({ message: '创建镜像凭证失败', error: errorMsg });
      }
    },
  );

  /**
   * [API] 更新镜像凭证
   * PUT /:id/resources/harvester/containers/imagepullsecrets/:namespace/:name
   * Body: { server, username, password, email?, alias? }
   * 说明: 更新现有镜像凭证的认证信息，可选更新别名
   */
  router.put(
    '/:id/resources/harvester/containers/imagepullsecrets/:namespace/:name',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params;
        const { server, username, password, email, alias } = req.body;

        // 参数验证
        if (!server || !username || !password) {
          return res.status(400).json({
            message: '缺少必要参数: server, username, password',
          });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        // 先获取现有 Secret 以保留其他字段
        const getUrl = buildK8sUrl(base, '/api/v1/secrets', namespace, name);
        const existingSecret = await getJsonOnce(getUrl, token, insecure, true);

        if (!existingSecret) {
          return res.status(404).json({ message: '镜像凭证不存在' });
        }

        // 更新 Secret
        const updatedSecret = {
          ...existingSecret,
          data: {
            '.dockerconfigjson': buildDockerConfigJson(server, username, password, email),
          },
          // 如果提供了 alias，更新注解
          ...(alias && {
            metadata: {
              ...existingSecret.metadata,
              annotations: {
                ...(existingSecret.metadata?.annotations || {}),
                'tower.io/alias': alias,
              },
            },
          }),
        };

        // 执行更新
        const updateUrl = buildK8sUrl(base, '/api/v1/secrets', namespace, name);
        const result = await requestJson('PUT', updateUrl, token, insecure, updatedSecret);

        // 清除 secrets 缓存，确保列表能立即显示更新后的凭证
        clearCacheByPrefix(`secrets:${id}:`);

        res.json({ message: '更新镜像凭证成功', data: result });
      } catch (error: any) {
        console.error('[镜像凭证更新] 错误:', JSON.stringify(error, null, 2));
        const errorMsg = error?.body || error?.message || '更新镜像凭证失败';
        res.status(error?.status || 500).json({ message: '更新镜像凭证失败', error: errorMsg });
      }
    },
  );

  /**
   * [API] 删除镜像凭证
   * DELETE /:id/resources/harvester/containers/imagepullsecrets/:namespace/:name
   * 说明: 删除指定的镜像拉取凭证
   */
  router.delete(
    '/:id/resources/harvester/containers/imagepullsecrets/:namespace/:name',
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

        // 删除 Secret
        const url = buildK8sUrl(base, '/api/v1/secrets', namespace, name);
        console.log('[镜像凭证删除] URL:', url);

        const result = await requestJson('DELETE', url, token, insecure);

        // 清除 secrets 缓存，确保列表能立即更新
        clearCacheByPrefix(`secrets:${id}:`);

        res.json({ message: '删除镜像凭证成功', data: result });
      } catch (error: any) {
        console.error('[镜像凭证删除] 错误:', JSON.stringify(error, null, 2));
        const errorMsg = error?.body || error?.message || '删除镜像凭证失败';
        res.status(error?.status || 500).json({ message: '删除镜像凭证失败', error: errorMsg });
      }
    },
  );

  /**
   * [API] 获取镜像凭证详情
   * GET /:id/resources/harvester/containers/imagepullsecrets/:namespace/:name
   * 说明: 获取指定镜像凭证的详细信息（不返回密码）
   */
  router.get(
    '/:id/resources/harvester/containers/imagepullsecrets/:namespace/:name',
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

        // 获取 Secret 详情
        const url = buildK8sUrl(base, '/api/v1/secrets', namespace, name);
        const result = await getJsonOnce(url, token, insecure, true);

        if (!result) {
          return res.status(404).json({ message: '镜像凭证不存在' });
        }

        // 验证类型
        if (result.type !== 'kubernetes.io/dockerconfigjson') {
          return res.status(400).json({ message: '该 Secret 不是镜像拉取凭证类型' });
        }

        // 解析并提取仓库信息（不返回密码）
        let registryInfo: any = {};
        try {
          if (result.data?.['.dockerconfigjson']) {
            const decoded = Buffer.from(result.data['.dockerconfigjson'], 'base64').toString(
              'utf-8',
            );
            const config = JSON.parse(decoded);
            const servers = Object.keys(config.auths || {});
            if (servers.length > 0) {
              const firstServer = servers[0];
              registryInfo = {
                server: firstServer,
                username: config.auths[firstServer].username,
                email: config.auths[firstServer].email,
                // 不返回密码和 auth 字符串
              };
            }
          }
        } catch (e) {
          console.error('解析 dockerconfigjson 失败:', e);
        }

        // 返回脱敏后的结果
        const sanitizedResult = {
          name: result.metadata?.name,
          namespace: result.metadata?.namespace,
          creationTimestamp: result.metadata?.creationTimestamp,
          type: result.type,
          labels: result.metadata?.labels,
          ...registryInfo,
        };

        res.json({ message: '查询成功', data: sanitizedResult });
      } catch (error: any) {
        res.status(500).json({ message: '查询镜像凭证详情失败', error: error.message });
      }
    },
  );
};
