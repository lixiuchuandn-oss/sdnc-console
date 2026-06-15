/**
 * Harvester 容器路由 — 通用 CRUD 代理与工作负载扩缩/重启/驱逐。
 */
import { Router, Response } from 'express';
import { fetchCloudOr404, ensureProvider } from './harvester.cache.helpers';
import { getJsonOnce, requestJson } from '../../../services/clouds/harvester/utils';
import {
  buildCreateUrl,
  buildK8sUrl,
  clearCacheByPrefix,
  extractOrigin,
} from './harvester.cache.container-shared';
import {
  isRegistryManagedPullSecret,
  isRegistryManagedPullSecretName,
  REGISTRY_MANAGED_SECRET_MESSAGE,
  extractImagePullSecretNames,
} from '../../../services/registryManagedSecret';
import {
  cleanupOrphanedPullSecretsAfterWorkloadDelete,
  isWorkloadApiPath,
} from '../../../services/workloadPullSecretCleanup';
import {
  isLocalRegistryManagedDeployment,
  isLocalRegistryManagedDeploymentName,
  REGISTRY_MANAGED_DEPLOYMENT_MESSAGE,
} from '../../../services/registryManagedLocalRegistry';

async function rejectLocalRegistryManagedDeployment(
  res: Response,
  base: string,
  token: string,
  insecure: boolean,
  namespace: string,
  name: string,
): Promise<boolean> {
  if (isLocalRegistryManagedDeploymentName(name)) {
    res.status(403).json({ message: REGISTRY_MANAGED_DEPLOYMENT_MESSAGE });
    return true;
  }

  const getUrl = buildK8sUrl(base, '/apis/apps/v1/deployments', namespace, name);
  try {
    const existing = await getJsonOnce(getUrl, token, insecure, true);
    if (existing && isLocalRegistryManagedDeployment(existing)) {
      res.status(403).json({ message: REGISTRY_MANAGED_DEPLOYMENT_MESSAGE });
      return true;
    }
  } catch {
    // 资源不存在时继续由后续 API 处理
  }

  return false;
}

export const registerHarvesterContainerCrudRoutes = (
  router: Router,
  checkAdminPermission: any,
): void => {
  // ============================================================
  // [CRUD 操作] 通过代理转发
  // ============================================================

  /**
   * [API] 创建资源 (通用)
   * POST /:id/resources/harvester/containers/create
   * Body: { apiPath, namespace?, body }
   */
  router.post(
    '/:id/resources/harvester/containers/create',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { apiPath, namespace, body } = req.body;

        if (!apiPath || !body) {
          return res.status(400).json({ message: '缺少必要参数: apiPath, body' });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        // 确保 namespace 有值，否则使用 default
        const effectiveNamespace = namespace || 'default';

        // 确保 body.metadata.namespace 存在
        if (body && body.metadata) {
          body.metadata.namespace = effectiveNamespace;
        }

        // 创建操作使用 Steve API 格式
        const url = buildCreateUrl(base, apiPath, effectiveNamespace);
        console.log('[容器创建] base:', base);
        console.log('[容器创建] apiPath:', apiPath);
        console.log('[容器创建] namespace (原始):', namespace);
        console.log('[容器创建] namespace (使用):', effectiveNamespace);
        console.log('[容器创建] 最终 URL:', url);

        const result = await requestJson('POST', url, token, insecure, body);

        res.json({ message: '创建成功', data: result });
      } catch (error: any) {
        console.error('[容器创建] 错误:', JSON.stringify(error, null, 2));
        // 如果是 Kubernetes API 返回的错误，提取详细信息
        const errorBody = error?.body || error?.message || String(error);
        const statusCode = error?.statusCode || 500;
        console.error('[容器创建] 请求体:', JSON.stringify(req.body?.body, null, 2));
        res.status(statusCode).json({
          message: '创建资源失败',
          error: errorBody,
          details: error?.details || null,
        });
      }
    },
  );

  /**
   * [API] 更新资源 (通用)
   * PUT /:id/resources/harvester/containers/update
   * Body: { apiPath, namespace, name, body }
   */
  router.put(
    '/:id/resources/harvester/containers/update',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { apiPath, namespace, name, body } = req.body;

        if (!apiPath || !namespace || !name || !body) {
          return res.status(400).json({ message: '缺少必要参数: apiPath, namespace, name, body' });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        if (apiPath.includes('/deployments')) {
          if (await rejectLocalRegistryManagedDeployment(res, base, token, insecure, namespace, name)) {
            return;
          }
        }

        const url = buildK8sUrl(base, apiPath, namespace, name);

        const maxRetries = 3;
        let lastError: any;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          let freshRv: string | undefined;
          try {
            const current = await getJsonOnce(url, token, insecure, true);
            freshRv = current?.metadata?.resourceVersion;
            if (freshRv) {
              body.metadata = body.metadata || {};
              body.metadata.resourceVersion = freshRv;
            }
          } catch (getErr: any) {
            console.warn(
              `[更新容器] GET resourceVersion 失败 (attempt ${attempt + 1}/${maxRetries + 1}): ${getErr?.status || getErr?.message}`,
            );
          }

          try {
            const result = await requestJson('PUT', url, token, insecure, body);
            if (attempt > 0)
              console.log(`[更新容器] 第 ${attempt + 1} 次尝试成功, resourceVersion: ${freshRv}`);
            res.json({ message: '更新成功', data: result });
            return;
          } catch (putError: any) {
            lastError = putError;
            if (putError?.status !== 409) {
              console.error(
                `[更新容器] PUT 非 409 错误 (attempt ${attempt + 1}):`,
                putError?.status,
                putError?.message?.substring(0, 200),
              );
              throw putError;
            }
            console.warn(
              `[更新容器] 版本冲突 409 (attempt ${attempt + 1}/${maxRetries + 1}, rv=${freshRv}), 重试中...`,
            );
          }
        }

        console.error(
          `[更新容器] 所有 ${maxRetries + 1} 次重试均失败，最后错误:`,
          lastError?.message?.substring(0, 200),
        );
        throw lastError;
      } catch (error: any) {
        console.error(`[更新容器] 最终失败:`, error?.status, error?.message?.substring(0, 200));
        res.status(500).json({ message: '更新资源失败', error: error.message });
      }
    },
  );

  /**
   * [API] Patch 资源 (JSON Patch)
   * PATCH /:id/resources/harvester/containers/patch
   * Body: { apiPath, namespace, name, patchBody }
   */
  router.patch(
    '/:id/resources/harvester/containers/patch',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { apiPath, namespace, name, patchBody } = req.body;

        if (!apiPath || !namespace || !name || !patchBody) {
          return res
            .status(400)
            .json({ message: '缺少必要参数: apiPath, namespace, name, patchBody' });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        if (apiPath.includes('/deployments')) {
          if (await rejectLocalRegistryManagedDeployment(res, base, token, insecure, namespace, name)) {
            return;
          }
        }

        const url = buildK8sUrl(base, apiPath, namespace, name);
        const result = await requestJson('PATCH', url, token, insecure, patchBody, {
          'Content-Type': 'application/json-patch+json',
        });

        res.json({ message: '更新成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: 'Patch 资源失败', error: error.message });
      }
    },
  );

  /**
   * [API] 删除资源 (通用)
   * DELETE /:id/resources/harvester/containers/delete
   * Body: { apiPath, namespace, name }
   */
  router.delete(
    '/:id/resources/harvester/containers/delete',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { apiPath, namespace, name } = req.body;

        if (!apiPath || !namespace || !name) {
          return res.status(400).json({ message: '缺少必要参数: apiPath, namespace, name' });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        if (apiPath.includes('/secrets')) {
          if (isRegistryManagedPullSecretName(name)) {
            return res.status(403).json({ message: REGISTRY_MANAGED_SECRET_MESSAGE });
          }

          const getUrl = buildK8sUrl(base, '/api/v1/secrets', namespace, name);
          const existingSecret = await getJsonOnce(getUrl, token, insecure, true);
          if (existingSecret && isRegistryManagedPullSecret(existingSecret)) {
            return res.status(403).json({ message: REGISTRY_MANAGED_SECRET_MESSAGE });
          }
        }

        if (apiPath.includes('/deployments')) {
          if (await rejectLocalRegistryManagedDeployment(res, base, token, insecure, namespace, name)) {
            return;
          }
        }

        let pullSecretNames: string[] = [];
        if (isWorkloadApiPath(apiPath)) {
          try {
            const getUrl = buildK8sUrl(base, apiPath, namespace, name);
            const workload = await getJsonOnce(getUrl, token, insecure, true);
            pullSecretNames = extractImagePullSecretNames(workload, apiPath);
          } catch (error: any) {
            console.warn('[Workload 删除] 读取 imagePullSecrets 失败:', error?.message || error);
          }
        }

        const url = buildK8sUrl(base, apiPath, namespace, name);
        const result = await requestJson('DELETE', url, token, insecure);

        if (pullSecretNames.length > 0) {
          try {
            await cleanupOrphanedPullSecretsAfterWorkloadDelete({
              cloudId: id,
              base,
              token,
              insecure,
              namespace,
              secretNames: pullSecretNames,
            });
          } catch (error: any) {
            console.warn('[Workload 删除] 清理拉取凭证失败:', error?.message || error);
          }
        }

        // 根据资源类型清除相应的缓存
        if (apiPath.includes('/secrets')) {
          clearCacheByPrefix(`secrets:${id}:`);
        }

        res.json({ message: '删除成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '删除资源失败', error: error.message });
      }
    },
  );

  /**
   * [API] 安全驱逐 Pod (Eviction)
   * POST /:id/resources/harvester/containers/pods/:namespace/:name/evict
   * 使用 Kubernetes Eviction API，会触发 PDB (PodDisruptionBudget) 保护机制
   * 如果 PDB 不允许驱逐，将返回 429 错误
   */
  router.post(
    '/:id/resources/harvester/containers/pods/:namespace/:name/evict',
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

        // 提取 origin（去除版本后缀）
        const origin = extractOrigin(base);

        // Kubernetes Eviction API 路径
        const url = `${origin}/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(name)}/eviction`;

        // Eviction 请求体
        const evictionBody = {
          apiVersion: 'policy/v1',
          kind: 'Eviction',
          metadata: {
            name: name,
            namespace: namespace,
          },
        };

        const result = await requestJson('POST', url, token, insecure, evictionBody, {
          'Content-Type': 'application/json',
        });

        // 清除 Pod 缓存
        clearCacheByPrefix(`pods:${id}:`);

        res.json({ message: '驱逐成功', data: result });
      } catch (error: any) {
        // 429 Too Many Requests 表示 PDB 阻止了驱逐
        if (error.status === 429) {
          return res.status(429).json({
            message: '驱逐被 PDB 阻止',
            error: error.message || 'PodDisruptionBudget 不允许此次驱逐操作',
            pdbBlocked: true,
          });
        }
        // 403 Forbidden 可能是权限问题
        if (error.status === 403) {
          return res.status(403).json({
            message: '没有权限执行驱逐操作',
            error: error.message,
          });
        }
        res.status(error.status || 500).json({ message: '驱逐 Pod 失败', error: error.message });
      }
    },
  );

  /**
   * [API] 批量安全驱逐 Pod (Batch Eviction)
   * POST /:id/resources/harvester/containers/pods/batch-evict
   * Body: { pods: [{ namespace: string, name: string }, ...] }
   * 使用 Kubernetes Eviction API，会触发 PDB (PodDisruptionBudget) 保护机制
   */
  router.post(
    '/:id/resources/harvester/containers/pods/batch-evict',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { pods } = req.body;

        if (!Array.isArray(pods) || pods.length === 0) {
          return res.status(400).json({ message: '缺少必要参数: pods 数组' });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        // 提取 origin
        const origin = extractOrigin(base);

        const results: {
          name: string;
          namespace: string;
          status: 'success' | 'blocked' | 'failed';
          message?: string;
        }[] = [];

        for (const pod of pods) {
          const { namespace, name } = pod;
          if (!namespace || !name) {
            results.push({
              name: name || 'unknown',
              namespace: namespace || 'unknown',
              status: 'failed',
              message: '缺少 namespace 或 name',
            });
            continue;
          }

          try {
            const url = `${origin}/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(name)}/eviction`;
            const evictionBody = {
              apiVersion: 'policy/v1',
              kind: 'Eviction',
              metadata: { name, namespace },
            };

            await requestJson('POST', url, token, insecure, evictionBody, {
              'Content-Type': 'application/json',
            });

            results.push({ name, namespace, status: 'success' });
          } catch (error: any) {
            if (error.status === 429) {
              results.push({
                name,
                namespace,
                status: 'blocked',
                message: 'PDB 阻止了驱逐操作',
              });
            } else {
              results.push({
                name,
                namespace,
                status: 'failed',
                message: error.message || '驱逐失败',
              });
            }
          }
        }

        // 清除 Pod 缓存
        clearCacheByPrefix(`pods:${id}:`);

        const successCount = results.filter((r) => r.status === 'success').length;
        const blockedCount = results.filter((r) => r.status === 'blocked').length;
        const failedCount = results.filter((r) => r.status === 'failed').length;

        res.json({
          message: `成功驱逐 ${successCount} 个，被 PDB 阻止 ${blockedCount} 个，失败 ${failedCount} 个`,
          data: {
            results,
            successCount,
            blockedCount,
            failedCount,
          },
        });
      } catch (error: any) {
        res.status(500).json({ message: '批量驱逐失败', error: error.message });
      }
    },
  );

  /**
   * [API] 扩缩容 Deployment
   * PATCH /:id/resources/harvester/containers/deployments/scale
   * Body: { namespace, name, replicas }
   */
  router.patch(
    '/:id/resources/harvester/containers/deployments/scale',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { namespace, name, replicas } = req.body;

        if (!namespace || !name || typeof replicas !== 'number') {
          return res.status(400).json({ message: '缺少必要参数: namespace, name, replicas' });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        if (await rejectLocalRegistryManagedDeployment(res, base, token, insecure, namespace, name)) {
          return;
        }

        // 使用 Strategic Merge Patch 更新副本数
        const url = buildK8sUrl(base, '/apis/apps/v1/deployments', namespace, name);
        const patchBody = {
          spec: {
            replicas: replicas,
          },
        };

        const result = await requestJson('PATCH', url, token, insecure, patchBody, {
          'Content-Type': 'application/strategic-merge-patch+json',
        });

        res.json({ message: '扩缩容成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '扩缩容失败', error: error.message });
      }
    },
  );

  /**
   * [API] 重启 Deployment (通过更新 annotation 触发滚动更新)
   * POST /:id/resources/harvester/containers/deployments/restart
   * Body: { namespace, name }
   */
  router.post(
    '/:id/resources/harvester/containers/deployments/restart',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { namespace, name } = req.body;

        if (!namespace || !name) {
          return res.status(400).json({ message: '缺少必要参数: namespace, name' });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        // 更新 annotation 触发滚动重启
        const url = buildK8sUrl(base, '/apis/apps/v1/deployments', namespace, name);
        const now = new Date().toISOString();
        const patchBody = {
          spec: {
            template: {
              metadata: {
                annotations: {
                  'kubectl.kubernetes.io/restartedAt': now,
                },
              },
            },
          },
        };

        const result = await requestJson('PATCH', url, token, insecure, patchBody, {
          'Content-Type': 'application/strategic-merge-patch+json',
        });

        res.json({ message: '重启指令已下发', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '重启失败', error: error.message });
      }
    },
  );

  /**
   * [API] 扩缩容 StatefulSet
   * PATCH /:id/resources/harvester/containers/statefulsets/scale
   * Body: { namespace, name, replicas }
   */
  router.patch(
    '/:id/resources/harvester/containers/statefulsets/scale',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { namespace, name, replicas } = req.body;

        if (!namespace || !name || typeof replicas !== 'number') {
          return res.status(400).json({ message: '缺少必要参数: namespace, name, replicas' });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        const url = buildK8sUrl(base, '/apis/apps/v1/statefulsets', namespace, name);
        const patchBody = {
          spec: {
            replicas: replicas,
          },
        };

        const result = await requestJson('PATCH', url, token, insecure, patchBody, {
          'Content-Type': 'application/strategic-merge-patch+json',
        });

        res.json({ message: '扩缩容成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '扩缩容失败', error: error.message });
      }
    },
  );

  /**
   * [API] 重启 StatefulSet (通过更新 annotation 触发滚动更新)
   * POST /:id/resources/harvester/containers/statefulsets/restart
   * Body: { namespace, name }
   */
  router.post(
    '/:id/resources/harvester/containers/statefulsets/restart',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { namespace, name } = req.body;

        if (!namespace || !name) {
          return res.status(400).json({ message: '缺少必要参数: namespace, name' });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        const url = buildK8sUrl(base, '/apis/apps/v1/statefulsets', namespace, name);
        const now = new Date().toISOString();
        const patchBody = {
          spec: {
            template: {
              metadata: {
                annotations: {
                  'kubectl.kubernetes.io/restartedAt': now,
                },
              },
            },
          },
        };

        const result = await requestJson('PATCH', url, token, insecure, patchBody, {
          'Content-Type': 'application/strategic-merge-patch+json',
        });

        res.json({ message: '重启指令已下发', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '重启失败', error: error.message });
      }
    },
  );

  /**
   * [API] 重启 DaemonSet (通过更新 annotation 触发滚动更新)
   * POST /:id/resources/harvester/containers/daemonsets/restart
   * Body: { namespace, name }
   */
  router.post(
    '/:id/resources/harvester/containers/daemonsets/restart',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { namespace, name } = req.body;

        if (!namespace || !name) {
          return res.status(400).json({ message: '缺少必要参数: namespace, name' });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        const url = buildK8sUrl(base, '/apis/apps/v1/daemonsets', namespace, name);
        const now = new Date().toISOString();
        const patchBody = {
          spec: {
            template: {
              metadata: {
                annotations: {
                  'kubectl.kubernetes.io/restartedAt': now,
                },
              },
            },
          },
        };

        const result = await requestJson('PATCH', url, token, insecure, patchBody, {
          'Content-Type': 'application/strategic-merge-patch+json',
        });

        res.json({ message: '重启指令已下发', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '重启失败', error: error.message });
      }
    },
  );
};
