/**
 * ==============================================================================
 * 模块名称: Harvester 容器资源路由 (Harvester Container Resource Routes)
 * 文件路径: backend/src/routes/clouds/harvester/harvester.cache.container.routes.ts
 * ==============================================================================
 * 
 * [功能描述]
 * 处理 Harvester/Kubernetes 容器相关资源查询和操作，包括：
 * 1. 工作负载管理 (Deployments, StatefulSets, DaemonSets)
 * 2. Pod 管理
 * 3. 任务管理 (Jobs, CronJobs)
 * 4. 配置管理 (ConfigMaps, Secrets)
 * 5. 镜像凭证管理
 * 
 * [核心逻辑]
 * 复用已有的 Harvester API 代理机制，通过 Kubernetes 原生 API 管理容器资源。
 * 
 * ------------------------------------------------------------------------------
 * [API 版本说明]
 * ------------------------------------------------------------------------------
 * - v1: Pod, Service, ConfigMap, Secret, PVC 等
 * - apps/v1: Deployment, StatefulSet, DaemonSet
 * - batch/v1: Job, CronJob
 * - networking.k8s.io/v1: Ingress
 * ==============================================================================
 */
import { Router, Response } from 'express';
import { fetchCloudOr404, ensureProvider } from './harvester.cache.helpers';
import { getJsonOnce } from '../../../services/clouds/harvester/utils';

/**
 * [内存缓存] 简单的 TTL 缓存，用于优化 Secret 等资源的查询性能
 * 缓存时间: 30 秒
 */
interface CacheItem<T> {
  data: T;
  timestamp: number;
}

const resourceCache = new Map<string, CacheItem<any>>();
const CACHE_TTL = 30 * 1000; // 30 秒

const getCached = <T>(key: string): T | null => {
  const item = resourceCache.get(key);
  if (!item) return null;
  if (Date.now() - item.timestamp > CACHE_TTL) {
    resourceCache.delete(key);
    return null;
  }
  return item.data as T;
};

const setCache = <T>(key: string, data: T): void => {
  resourceCache.set(key, { data, timestamp: Date.now() });
};

/**
 * [辅助函数] 构建 Kubernetes API URL
 * @param base 基础 endpoint
 * @param apiPath API 路径 (如 /api/v1, /apis/apps/v1)
 * @param namespace 命名空间 (可选)
 * @param resource 资源名称 (可选)
 * @returns 完整的 URL
 *
 * 支持两种使用模式：
 * 1. 列表查询: buildK8sUrl(base, '/apis/apps/v1/deployments', namespace)
 *    生成: /apis/apps/v1/namespaces/{ns}/deployments
 * 2. 单个资源: buildK8sUrl(base, '/apis/apps/v1/deployments', namespace, name)
 *    生成: /apis/apps/v1/namespaces/{ns}/deployments/{name}
 */
const buildK8sUrl = (
  base: string,
  apiPath: string,
  namespace?: string,
  resource?: string,
): string => {
  let url = base.replace(/\/+$/, '');

  // 处理 endpoint 中可能存在的版本号
  if ((apiPath.startsWith('/api/') || apiPath.startsWith('/apis/')) && !url.includes('/k8s/clusters/')) {
    url = url.replace(/\/v[0-9]+(\/harvester)?$/, '');
  }

  // 解析 apiPath 获取资源类型
  // 例如: /apis/apps/v1/deployments -> 资源类型是 deployments
  //       /api/v1/pods -> 资源类型是 pods
  const pathParts = apiPath.split('/').filter(Boolean);
  const resourceType = pathParts[pathParts.length - 1]; // 最后一个部分是资源类型
  const apiPrefix = pathParts.slice(0, -1).join('/');   // 前面的部分是 API 前缀

  url += '/' + apiPrefix;

  if (namespace) {
    url += `/namespaces/${encodeURIComponent(namespace)}`;
  }

  // 添加资源类型
  url += `/${resourceType}`;

  // 如果有资源名称，添加到末尾
  if (resource) {
    url += `/${encodeURIComponent(resource)}`;
  }

  return url;
};

/**
 * [辅助函数] 获取所有命名空间的资源列表
 * @param base 基础 endpoint
 * @param apiPath API 路径
 * @param token 认证 token
 * @param insecure 是否忽略 TLS
 */
const getAllNamespacedResources = async (
  base: string,
  apiPath: string,
  token: string,
  insecure: boolean,
): Promise<any[]> => {
  const url = buildK8sUrl(base, apiPath);
  const result = await getJsonOnce(url, token, insecure, true);
  return result?.items || [];
};

/**
 * [辅助函数] 获取指定命名空间的资源列表
 */
const getNamespacedResources = async (
  base: string,
  apiPath: string,
  namespace: string,
  token: string,
  insecure: boolean,
): Promise<any[]> => {
  const url = buildK8sUrl(base, apiPath, namespace);
  const result = await getJsonOnce(url, token, insecure, true);
  return result?.items || [];
};

export const registerHarvesterContainerRoutes = (
  router: Router,
  checkAdminPermission: any,
) => {
  // ============================================================
  // [工作负载管理] Deployment, StatefulSet, DaemonSet
  // ============================================================

  /**
   * [API] 获取 Deployment 列表
   * GET /:id/resources/harvester/containers/deployments
   * Query: namespace (可选，不传则返回所有命名空间)
   */
  router.get(
    '/:id/resources/harvester/containers/deployments',
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
        
        let items: any[];
        if (namespace) {
          items = await getNamespacedResources(base, '/apis/apps/v1/deployments', String(namespace), token, insecure);
        } else {
          items = await getAllNamespacedResources(base, '/apis/apps/v1/deployments', token, insecure);
        }
        
        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({ message: '查询 Deployment 失败', error: error.message });
      }
    },
  );

  /**
   * [API] 获取 StatefulSet 列表
   * GET /:id/resources/harvester/containers/statefulsets
   */
  router.get(
    '/:id/resources/harvester/containers/statefulsets',
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
        
        let items: any[];
        if (namespace) {
          items = await getNamespacedResources(base, '/apis/apps/v1/statefulsets', String(namespace), token, insecure);
        } else {
          items = await getAllNamespacedResources(base, '/apis/apps/v1/statefulsets', token, insecure);
        }
        
        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({ message: '查询 StatefulSet 失败', error: error.message });
      }
    },
  );

  /**
   * [API] 获取 DaemonSet 列表
   * GET /:id/resources/harvester/containers/daemonsets
   */
  router.get(
    '/:id/resources/harvester/containers/daemonsets',
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
        
        let items: any[];
        if (namespace) {
          items = await getNamespacedResources(base, '/apis/apps/v1/daemonsets', String(namespace), token, insecure);
        } else {
          items = await getAllNamespacedResources(base, '/apis/apps/v1/daemonsets', token, insecure);
        }
        
        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({ message: '查询 DaemonSet 失败', error: error.message });
      }
    },
  );

  // ============================================================
  // [Pod 管理]
  // ============================================================

  /**
   * [API] 获取 Pod 列表
   * GET /:id/resources/harvester/containers/pods
   */
  router.get(
    '/:id/resources/harvester/containers/pods',
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
        
        // 生成缓存 key
        const cacheKey = `pods:${id}:${namespace || 'all'}`;
        
        // 尝试从缓存获取
        let items = getCached<any[]>(cacheKey);
        
        if (!items) {
          // 缓存未命中，从 K8s API 获取
          if (namespace) {
            items = await getNamespacedResources(base, '/api/v1/pods', String(namespace), token, insecure);
          } else {
            items = await getAllNamespacedResources(base, '/api/v1/pods', token, insecure);
          }
          
          // 存入缓存
          setCache(cacheKey, items);
        }
        
        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({ message: '查询 Pod 失败', error: error.message });
      }
    },
  );

  /**
   * [API] 获取 Pod 详情
   * GET /:id/resources/harvester/containers/pods/:namespace/:name
   */
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

  /**
   * [API] 获取 Pod 日志
   * GET /:id/resources/harvester/containers/pods/:namespace/:name/log
   */
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
        
        // Pod 日志路径: /api/v1/namespaces/{ns}/pods/{name}/log
        let url = buildK8sUrl(base, '/api/v1/pods', namespace, name) + '/log?';
        if (container) url += `container=${encodeURIComponent(String(container))}&`;
        if (tailLines) url += `tailLines=${tailLines}&`;
        if (follow) url += `follow=${follow}&`;
        
        console.log(`[Container Log] Fetching logs from: ${url}`);
        
        const result = await getJsonOnce(url, token, insecure, false);
        console.log(`[Container Log] Result type: ${typeof result}, length: ${result?.length || 0}`);
        
        // 日志返回的是纯文本
        res.type('text/plain').send(result);
      } catch (error: any) {
        console.error(`[Container Log] Error:`, error);
        const errorMsg = error?.body || error?.message || '获取 Pod 日志失败';
        res.status(error?.status || 500).type('text/plain').send(errorMsg);
      }
    },
  );

  // ============================================================
  // [任务管理] Job, CronJob
  // ============================================================

  /**
   * [API] 获取 Job 列表
   * GET /:id/resources/harvester/containers/jobs
   */
  router.get(
    '/:id/resources/harvester/containers/jobs',
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
        
        let items: any[];
        if (namespace) {
          items = await getNamespacedResources(base, '/apis/batch/v1/jobs', String(namespace), token, insecure);
        } else {
          items = await getAllNamespacedResources(base, '/apis/batch/v1/jobs', token, insecure);
        }
        
        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({ message: '查询 Job 失败', error: error.message });
      }
    },
  );

  /**
   * [API] 获取 CronJob 列表
   * GET /:id/resources/harvester/containers/cronjobs
   */
  router.get(
    '/:id/resources/harvester/containers/cronjobs',
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
        
        let items: any[];
        if (namespace) {
          items = await getNamespacedResources(base, '/apis/batch/v1/cronjobs', String(namespace), token, insecure);
        } else {
          items = await getAllNamespacedResources(base, '/apis/batch/v1/cronjobs', token, insecure);
        }
        
        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({ message: '查询 CronJob 失败', error: error.message });
      }
    },
  );

  // ============================================================
  // [配置管理] ConfigMap, Secret
  // ============================================================

  /**
   * [API] 获取 ConfigMap 列表
   * GET /:id/resources/harvester/containers/configmaps
   */
  router.get(
    '/:id/resources/harvester/containers/configmaps',
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
        
        // 生成缓存 key
        const cacheKey = `configmaps:${id}:${namespace || 'all'}`;
        
        // 尝试从缓存获取
        let items = getCached<any[]>(cacheKey);
        
        if (!items) {
          // 缓存未命中，从 K8s API 获取
          if (namespace) {
            items = await getNamespacedResources(base, '/api/v1/configmaps', String(namespace), token, insecure);
          } else {
            items = await getAllNamespacedResources(base, '/api/v1/configmaps', token, insecure);
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
   */
  router.get(
    '/:id/resources/harvester/containers/secrets',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { namespace, type } = req.query;
        
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';
        
        // 生成缓存 key
        const cacheKey = `secrets:${id}:${namespace || 'all'}`;
        
        // 尝试从缓存获取
        let items = getCached<any[]>(cacheKey);
        
        if (!items) {
          // 缓存未命中，从 K8s API 获取
          if (namespace) {
            items = await getNamespacedResources(base, '/api/v1/secrets', String(namespace), token, insecure);
          } else {
            items = await getAllNamespacedResources(base, '/api/v1/secrets', token, insecure);
          }
          
          // 脱敏处理：不返回 data 字段的内容（在缓存前处理，避免重复处理）
          items = items.map((item: any) => ({
            ...item,
            data: item.data ? Object.keys(item.data).reduce((acc: any, key: string) => {
              acc[key] = '******';
              return acc;
            }, {} as any) : undefined,
          }));
          
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
  // [服务发现] Service, Ingress
  // ============================================================

  /**
   * [API] 获取 Service 列表
   * GET /:id/resources/harvester/containers/services
   * Query: namespace (可选，不传则返回所有命名空间)
   * 说明: Service 是 Kubernetes 核心资源，用于服务发现和负载均衡
   * K8s API: /api/v1/namespaces/{ns}/services 或 /api/v1/services
   */
  router.get(
    '/:id/resources/harvester/containers/services',
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
        
        let items: any[];
        if (namespace) {
          items = await getNamespacedResources(base, '/api/v1/services', String(namespace), token, insecure);
        } else {
          items = await getAllNamespacedResources(base, '/api/v1/services', token, insecure);
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
   * Query: namespace (可选，不传则返回所有命名空间)
   * 说明: Ingress 是 Kubernetes 网络资源，用于 HTTP/HTTPS 路由
   * K8s API: /apis/networking.k8s.io/v1/namespaces/{ns}/ingresses 或 /apis/networking.k8s.io/v1/ingresses
   */
  router.get(
    '/:id/resources/harvester/containers/ingresses',
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
        
        let items: any[];
        if (namespace) {
          items = await getNamespacedResources(base, '/apis/networking.k8s.io/v1/ingresses', String(namespace), token, insecure);
        } else {
          items = await getAllNamespacedResources(base, '/apis/networking.k8s.io/v1/ingresses', token, insecure);
        }
        
        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({ message: '查询 Ingress 失败', error: error.message });
      }
    },
  );

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
        
        const url = buildK8sUrl(base, apiPath, namespace);
        const result = await requestJson('POST', url, token, insecure, body);
        
        res.json({ message: '创建成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '创建资源失败', error: error.message });
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
        
        const url = buildK8sUrl(base, apiPath, namespace, name);
        const result = await requestJson('PUT', url, token, insecure, body);
        
        res.json({ message: '更新成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '更新资源失败', error: error.message });
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
        
        const url = buildK8sUrl(base, apiPath, namespace, name);
        const result = await requestJson('DELETE', url, token, insecure);
        
        res.json({ message: '删除成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '删除资源失败', error: error.message });
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
};

// 辅助函数：带额外 headers 的请求
async function requestJson(
  method: string,
  url: string,
  token: string,
  insecure: boolean,
  body?: any,
  extraHeaders?: Record<string, string>,
): Promise<any> {
  const { requestJson: _requestJson } = await import('../../../services/clouds/harvester/utils');
  // 如果有额外 headers，需要自定义请求
  if (extraHeaders) {
    const https = await import('https');
    const http = await import('http');
    const urlModule = await import('url');
    
    return new Promise((resolve, reject) => {
      const parsedUrl = new urlModule.URL(url);
      const lib = parsedUrl.protocol === 'https:' ? https : http;
      
      const options: any = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...extraHeaders,
        },
      };
      
      if (insecure && parsedUrl.protocol === 'https:') {
        options.rejectUnauthorized = false;
      }
      
      const req = lib.request(options, (res: any) => {
        let data = '';
        res.on('data', (chunk: string) => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        });
      });
      
      req.on('error', reject);
      
      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }
  
  return _requestJson(method, url, token, insecure, body);
}
