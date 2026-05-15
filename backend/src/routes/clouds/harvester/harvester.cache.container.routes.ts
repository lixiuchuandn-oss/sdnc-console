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
import { Router, Response, json } from 'express';
import { fetchCloudOr404, ensureProvider } from './harvester.cache.helpers';
import { getJsonOnce, requestJson } from '../../../services/clouds/harvester/utils';
import { syncHarvesterServices, syncHarvesterIngresses } from '../../../services/clouds/harvester/inventory';
import { isSystemNamespaceName, isSystemResource } from '../../../services/clouds/harvester/namespace';

/**
 * [内存缓存] 简单的 TTL 缓存，用于优化 Secret 等资源的查询性能
 * 缓存时间: 30 秒
 */
interface CacheItem<T> {
  data: T;
  timestamp: number;
}

const resourceCache = new Map<string, CacheItem<any>>();
const CACHE_TTL = 30 * 1000; // 30 秒（默认）
const CACHE_TTL_SECRETS = 5 * 60 * 1000; // 5 分钟（Secrets 响应慢，缓存更久）
const CACHE_TTL_CONFIGMAPS = 2 * 60 * 1000; // 2 分钟（ConfigMaps 响应较慢）

const getCached = <T>(key: string, customTtl?: number): T | null => {
  const item = resourceCache.get(key);
  if (!item) return null;
  const ttl = customTtl || CACHE_TTL;
  if (Date.now() - item.timestamp > ttl) {
    resourceCache.delete(key);
    return null;
  }
  return item.data as T;
};

const setCache = <T>(key: string, data: T): void => {
  resourceCache.set(key, { data, timestamp: Date.now() });
};

/**
 * [辅助函数] 清除指定前缀的缓存
 * @param prefix 缓存 key 前缀
 */
const clearCacheByPrefix = (prefix: string): void => {
  for (const key of resourceCache.keys()) {
    if (key.startsWith(prefix)) {
      resourceCache.delete(key);
    }
  }
};

/**
 * [辅助函数] 构建 Kubernetes API URL (用于列表查询)
 * @param base 基础 endpoint
 * @param apiPath API 路径 (如 /api/v1, /apis/apps/v1)
 * @param namespace 命名空间 (可选)
 * @param resource 资源名称 (可选)
 * @returns 完整的 URL
 */
const buildK8sUrl = (
  base: string,
  apiPath: string,
  namespace?: string,
  resource?: string,
): string => {
  let url = base.replace(/\/+$/, '');

  // 处理 endpoint 中可能存在的版本号，并添加 /k8s/clusters/local/ 路径
  if ((apiPath.startsWith('/api/') || apiPath.startsWith('/apis/')) && !url.includes('/k8s/clusters/')) {
    url = url.replace(/\/v[0-9]+(\/harvester)?$/, '');
    url += '/k8s/clusters/local';
  }

  // 解析 apiPath 获取资源类型
  const pathParts = apiPath.split('/').filter(Boolean);
  const resourceType = pathParts[pathParts.length - 1];
  const apiPrefix = pathParts.slice(0, -1).join('/');

  url += '/' + apiPrefix;

  if (namespace) {
    url += `/namespaces/${encodeURIComponent(namespace)}`;
  }

  url += `/${resourceType}`;

  if (resource) {
    url += `/${encodeURIComponent(resource)}`;
  }

  return url;
};

/**
 * [辅助函数] 提取 origin（去除版本后缀）
 * 用于构建原生 K8s API URL
 * @param base 基础 endpoint (如 https://172.16.3.79/v3)
 * @returns origin (如 https://172.16.3.79)
 */
const extractOrigin = (base: string): string => {
  let origin = base.replace(/\/+$/, '');
  
  // 添加 /k8s/clusters/local/ 路径（如果不存在）
  if (!origin.includes('/k8s/clusters/')) {
    try {
      const u = new URL(origin);
      origin = `${u.protocol}//${u.host}`;
    } catch {
      origin = origin.replace(/\/v[0-9].*$/, '');
    }
    origin += '/k8s/clusters/local';
  }
  
  return origin;
};

/**
 * [辅助函数] 构建创建资源的 URL (使用原生 K8s API 格式)
 * Harvester 创建资源需要使用原生 Kubernetes API 格式
 * @param base 基础 endpoint
 * @param apiPath API 路径 (如 /api/v1/secrets, /apis/apps/v1/deployments)
 * @param namespace 命名空间
 * @returns 完整的 URL
 */
const buildCreateUrl = (
  base: string,
  apiPath: string,
  namespace: string,
): string => {
  let origin = base.replace(/\/+$/, '');
  
  // 添加 /k8s/clusters/local/ 路径（如果不存在）
  if (!origin.includes('/k8s/clusters/')) {
    origin = origin.replace(/\/v[0-9].*$/, '');
    origin += '/k8s/clusters/local';
  }
  
  // 解析 apiPath 获取资源类型
  const pathParts = apiPath.split('/').filter(Boolean);
  const resourceType = pathParts[pathParts.length - 1];
  
  // 使用原生 K8s API 格式
  // 例如: /api/v1/namespaces/{namespace}/secrets
  // 例如: /apis/apps/v1/namespaces/{namespace}/deployments
  if (apiPath.startsWith('/api/v1/')) {
    // 核心 API 资源: pods, services, configmaps, secrets 等
    return `${origin}/api/v1/namespaces/${encodeURIComponent(namespace)}/${resourceType}`;
  } else if (apiPath.startsWith('/apis/')) {
    // 命名空间级别的 CRD 资源
    // 例如: /apis/apps/v1/namespaces/{namespace}/deployments
    const group = pathParts[1] || '';
    const version = pathParts[2] || 'v1';
    return `${origin}/apis/${group}/${version}/namespaces/${encodeURIComponent(namespace)}/${resourceType}`;
  }
  
  // 默认使用核心 API
  return `${origin}/api/v1/namespaces/${encodeURIComponent(namespace)}/${resourceType}`;
};

/**
 * [辅助函数] 获取所有命名空间的资源列表
 * @param base 基础 endpoint
 * @param apiPath API 路径
 * @param token 认证 token
 * @param insecure 是否忽略 TLS
 * @param labelSelector 标签选择器 (可选)
 */
const getAllNamespacedResources = async (
  base: string,
  apiPath: string,
  token: string,
  insecure: boolean,
  labelSelector?: string,
): Promise<any[]> => {
  let url = buildK8sUrl(base, apiPath);
  if (labelSelector) {
    url += `?labelSelector=${encodeURIComponent(labelSelector)}`;
  }
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
  labelSelector?: string,
): Promise<any[]> => {
  let url = buildK8sUrl(base, apiPath, namespace);
  if (labelSelector) {
    url += `?labelSelector=${encodeURIComponent(labelSelector)}`;
  }
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
        const { namespace, all } = req.query;
        
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
        
        // all !== 'true' 时过滤系统命名空间
        if (all !== 'true') {
          items = items.filter((item: any) => !isSystemResource(item));
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
   * Query: namespace, all
   */
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
          items = await getNamespacedResources(base, '/apis/apps/v1/statefulsets', String(namespace), token, insecure);
        } else {
          items = await getAllNamespacedResources(base, '/apis/apps/v1/statefulsets', token, insecure);
        }
        
        // all !== 'true' 时过滤系统命名空间
        if (all !== 'true') {
          items = items.filter((item: any) => !isSystemResource(item));
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
   * Query: namespace, all
   */
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
          items = await getNamespacedResources(base, '/apis/apps/v1/daemonsets', String(namespace), token, insecure);
        } else {
          items = await getAllNamespacedResources(base, '/apis/apps/v1/daemonsets', token, insecure);
        }
        
        // all !== 'true' 时过滤系统命名空间
        if (all !== 'true') {
          items = items.filter((item: any) => !isSystemResource(item));
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
    * Query: namespace, force, labelSelector, all
    */
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
        
        // 生成缓存 key
        const cacheKey = `pods:${id}:${namespace || 'all'}:${labelSelector || 'all'}:${all || 'false'}`;
        
        // 尝试从缓存获取（force=true 时跳过缓存）
        let items = force === 'true' ? null : getCached<any[]>(cacheKey);
        
        if (!items) {
          // 缓存未命中或强制刷新，从 K8s API 获取
          const selector = labelSelector ? String(labelSelector) : undefined;
          if (namespace) {
            items = await getNamespacedResources(base, '/api/v1/pods', String(namespace), token, insecure, selector);
          } else {
            items = await getAllNamespacedResources(base, '/api/v1/pods', token, insecure, selector);
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

  /**
   * [API] 获取 Pod 相关的 Kubernetes Events
   * GET /:id/resources/harvester/containers/pods/:namespace/:name/events
   * 
   * Kubernetes Events 包含重要的事件日志，如镜像拉取失败、调度错误等。
   * 这与 Pod status.conditions 不同，后者只是状态条件快照。
   */
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
        
        // 获取命名空间下所有事件，然后过滤与该 Pod 相关的
        // Events API: /api/v1/namespaces/{ns}/events
        const url = buildK8sUrl(base, '/api/v1/events', namespace) 
          + `?fieldSelector=involvedObject.name=${encodeURIComponent(name)},involvedObject.kind=Pod`;
        
        console.log(`[Pod Events] Fetching events from: ${url}`);
        
        const result = await getJsonOnce(url, token, insecure, true);
        const items = result?.items || [];
        
        // 按时间倒序排列（最新的在前）
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

  // ============================================================
  // [任务管理] Job, CronJob
  // ============================================================

  /**
   * [API] 获取 Job 列表
   * GET /:id/resources/harvester/containers/jobs
   * Query: namespace, all
   */
  router.get(
    '/:id/resources/harvester/containers/jobs',
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
          items = await getNamespacedResources(base, '/apis/batch/v1/jobs', String(namespace), token, insecure);
        } else {
          items = await getAllNamespacedResources(base, '/apis/batch/v1/jobs', token, insecure);
        }
        
        // all !== 'true' 时过滤系统命名空间
        if (all !== 'true') {
          items = items.filter((item: any) => !isSystemResource(item));
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
   * Query: namespace, all
   */
  router.get(
    '/:id/resources/harvester/containers/cronjobs',
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
          items = await getNamespacedResources(base, '/apis/batch/v1/cronjobs', String(namespace), token, insecure);
        } else {
          items = await getAllNamespacedResources(base, '/apis/batch/v1/cronjobs', token, insecure);
        }
        
        // all !== 'true' 时过滤系统命名空间
        if (all !== 'true') {
          items = items.filter((item: any) => !isSystemResource(item));
        }
        
        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        res.status(500).json({ message: '查询 CronJob 失败', error: error.message });
      }
    },
  );

  /**
   * [API] 获取 Job 详情
   * GET /:id/resources/harvester/containers/jobs/:namespace/:name
   */
  router.get(
    '/:id/resources/harvester/containers/jobs/:namespace/:name',
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
        
        const url = buildK8sUrl(base, '/apis/batch/v1/jobs', namespace, name);
        const result = await getJsonOnce(url, token, insecure, true);
        
        res.json({ message: '查询成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '查询 Job 详情失败', error: error.message });
      }
    },
  );

  /**
   * [API] 获取 Job 关联的 Pod 列表
   * GET /:id/resources/harvester/containers/jobs/:namespace/:name/pods
   * 
   * 说明: Job 通过标签选择器 job-name={job-name} 关联 Pod
   * K8s API: /api/v1/namespaces/{namespace}/pods?labelSelector=job-name={name}
   */
  router.get(
    '/:id/resources/harvester/containers/jobs/:namespace/:name/pods',
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
        
        // 构建 Pod 查询 URL，使用 labelSelector 过滤关联的 Pod
        // Job 自动为 Pod 添加 label: job-name={job-name}
        const podUrl = buildK8sUrl(base, '/api/v1/pods', namespace) 
          + `?labelSelector=${encodeURIComponent('job-name=' + name)}`;
        
        console.log(`[Job Pods] Fetching pods from: ${podUrl}`);
        
        const result = await getJsonOnce(podUrl, token, insecure, true);
        const items = result?.items || [];
        
        // 按创建时间倒序排列（最新的在前）
        items.sort((a: any, b: any) => {
          const timeA = new Date(a?.metadata?.creationTimestamp || 0).getTime();
          const timeB = new Date(b?.metadata?.creationTimestamp || 0).getTime();
          return timeB - timeA;
        });
        
        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        console.error(`[Job Pods] Error:`, error);
        res.status(500).json({ message: '获取 Job 关联 Pod 失败', error: error.message });
      }
    },
  );

  /**
   * [API] 获取 Job 相关的 Kubernetes Events
   * GET /:id/resources/harvester/containers/jobs/:namespace/:name/events
   * 
   * Kubernetes Events 包含重要的事件日志，如 Job 完成、失败、Pod 创建等。
   */
  router.get(
    '/:id/resources/harvester/containers/jobs/:namespace/:name/events',
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
        
        // 获取与该 Job 相关的事件
        // Events API: /api/v1/namespaces/{ns}/events
        const url = buildK8sUrl(base, '/api/v1/events', namespace) 
          + `?fieldSelector=${encodeURIComponent(`involvedObject.name=${name},involvedObject.kind=Job`)}`;
        
        console.log(`[Job Events] Fetching events from: ${url}`);
        
        const result = await getJsonOnce(url, token, insecure, true);
        const items = result?.items || [];
        
        // 按时间倒序排列（最新的在前）
        items.sort((a: any, b: any) => {
          const timeA = new Date(a?.lastTimestamp || a?.eventTime || 0).getTime();
          const timeB = new Date(b?.lastTimestamp || b?.eventTime || 0).getTime();
          return timeB - timeA;
        });
        
        res.json({ message: '查询成功', data: { items } });
      } catch (error: any) {
        console.error(`[Job Events] Error:`, error);
        res.status(500).json({ message: '获取 Job 事件失败', error: error.message });
      }
    },
  );

  /**
   * [API] 删除 Job
   * DELETE /:id/resources/harvester/containers/jobs/:namespace/:name
   */
  router.delete(
    '/:id/resources/harvester/containers/jobs/:namespace/:name',
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
        
        const url = buildK8sUrl(base, '/apis/batch/v1/jobs', namespace, name);
        const result = await requestJson('DELETE', url, token, insecure);
        
        res.json({ message: '删除 Job 成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '删除 Job 失败', error: error.message });
      }
    },
  );

  /**
   * [API] 获取 Job 相关的 Kubernetes Events
   * GET /:id/resources/harvester/containers/jobs/:namespace/:name/events
   * 
   * 查询 Job 本身的事件和关联 Pod 的事件，用于故障排查。
   * Events 包含调度、镜像拉取、容器启动等关键事件。
   */
  router.get(
    '/:id/resources/harvester/containers/jobs/:namespace/:name/events',
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
        
        // 1. 获取 Job 本身的事件
        const jobEventsUrl = buildK8sUrl(base, '/api/v1/events', namespace) 
          + `?fieldSelector=${encodeURIComponent('involvedObject.name=' + name + ',involvedObject.kind=Job')}`;
        
        console.log(`[Job Events] Fetching job events from: ${jobEventsUrl}`);
        
        const jobEventsResult = await getJsonOnce(jobEventsUrl, token, insecure, true);
        const jobEvents = jobEventsResult?.items || [];
        
        // 2. 获取关联的 Pod 的事件
        // 先获取 Job 关联的 Pod 列表
        const podsUrl = buildK8sUrl(base, '/api/v1/pods', namespace) 
          + `?labelSelector=${encodeURIComponent('job-name=' + name)}`;
        
        const podsResult = await getJsonOnce(podsUrl, token, insecure, true);
        const pods = podsResult?.items || [];
        
        // 收集所有 Pod 的事件
        const podEvents: any[] = [];
        for (const pod of pods) {
          const podName = pod.metadata?.name;
          if (podName) {
            const podEventsUrl = buildK8sUrl(base, '/api/v1/events', namespace) 
              + `?fieldSelector=${encodeURIComponent('involvedObject.name=' + podName + ',involvedObject.kind=Pod')}`;
            
            try {
              const podEventsResult = await getJsonOnce(podEventsUrl, token, insecure, true);
              const events = podEventsResult?.items || [];
              podEvents.push(...events);
            } catch (e) {
              // 忽略单个 Pod 事件查询的错误，继续处理其他 Pod
              console.warn(`[Job Events] Failed to fetch events for pod ${podName}:`, e);
            }
          }
        }
        
        // 3. 合并所有事件并按时间排序
        const allEvents = [...jobEvents, ...podEvents];
        
        // 去重（根据 event 的 uid）
        const uniqueEvents = allEvents.filter((event: any, index: number, self: any[]) => 
          index === self.findIndex((e: any) => e.metadata?.uid === event.metadata?.uid)
        );
        
        // 按时间倒序排列（最新的在前）
        uniqueEvents.sort((a: any, b: any) => {
          const timeA = new Date(a?.lastTimestamp || a?.eventTime || 0).getTime();
          const timeB = new Date(b?.lastTimestamp || b?.eventTime || 0).getTime();
          return timeB - timeA;
        });
        
        // 4. 格式化返回数据，提取关键字段
        const formattedEvents = uniqueEvents.map((event: any) => ({
          uid: event.metadata?.uid,
          name: event.metadata?.name,
          namespace: event.metadata?.namespace,
          creationTimestamp: event.metadata?.creationTimestamp,
          reason: event.reason,
          message: event.message,
          type: event.type, // Normal 或 Warning
          count: event.count,
          firstTimestamp: event.firstTimestamp,
          lastTimestamp: event.lastTimestamp,
          eventTime: event.eventTime,
          involvedObject: {
            kind: event.involvedObject?.kind,
            name: event.involvedObject?.name,
            namespace: event.involvedObject?.namespace,
          },
          source: {
            component: event.source?.component,
            host: event.source?.host,
          },
        }));
        
        console.log(`[Job Events] Total events: ${formattedEvents.length} (Job: ${jobEvents.length}, Pod: ${podEvents.length})`);
        
        res.json({ 
          message: '查询成功', 
          data: { 
            items: formattedEvents,
            summary: {
              total: formattedEvents.length,
              jobEvents: jobEvents.length,
              podEvents: podEvents.length,
              warningCount: formattedEvents.filter((e: any) => e.type === 'Warning').length,
            }
          } 
        });
      } catch (error: any) {
        console.error(`[Job Events] Error:`, error);
        res.status(500).json({ message: '获取 Job 事件失败', error: error.message });
      }
    },
  );

  /**
   * [API] 获取 CronJob 详情
   * GET /:id/resources/harvester/containers/cronjobs/:namespace/:name
   */
  router.get(
    '/:id/resources/harvester/containers/cronjobs/:namespace/:name',
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
        
        const url = buildK8sUrl(base, '/apis/batch/v1/cronjobs', namespace, name);
        const result = await getJsonOnce(url, token, insecure, true);
        
        res.json({ message: '查询成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '查询 CronJob 详情失败', error: error.message });
      }
    },
  );

  /**
   * [API] 删除 CronJob
   * DELETE /:id/resources/harvester/containers/cronjobs/:namespace/:name
   */
  router.delete(
    '/:id/resources/harvester/containers/cronjobs/:namespace/:name',
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
        
        const url = buildK8sUrl(base, '/apis/batch/v1/cronjobs', namespace, name);
        const result = await requestJson('DELETE', url, token, insecure);
        
        res.json({ message: '删除 CronJob 成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '删除 CronJob 失败', error: error.message });
      }
    },
  );

  /**
   * [API] 暂停/恢复 CronJob
   * PATCH /:id/resources/harvester/containers/cronjobs/:namespace/:name/suspend
   * Body: { suspend: boolean }
   */
  router.patch(
    '/:id/resources/harvester/containers/cronjobs/:namespace/:name/suspend',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id, namespace, name } = req.params;
        const { suspend } = req.body;
        
        if (typeof suspend !== 'boolean') {
          return res.status(400).json({ message: '缺少必要参数: suspend (boolean)' });
        }
        
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
        
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';
        
        const url = buildK8sUrl(base, '/apis/batch/v1/cronjobs', namespace, name);
        const patchBody = {
          spec: {
            suspend: suspend,
          },
        };
        
        const result = await requestJson('PATCH', url, token, insecure, patchBody, {
          'Content-Type': 'application/strategic-merge-patch+json',
        });
        
        res.json({ message: suspend ? 'CronJob 已暂停' : 'CronJob 已恢复', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '操作失败', error: error.message });
      }
    },
  );

  /**
   * [API] 手动触发 CronJob
   * POST /:id/resources/harvester/containers/cronjobs/:namespace/:name/trigger
   * 说明: 创建一个关联的 Job，手动执行一次 CronJob
   */
  router.post(
    '/:id/resources/harvester/containers/cronjobs/:namespace/:name/trigger',
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
        
        // 1. 获取 CronJob 详情
        const cronjobUrl = buildK8sUrl(base, '/apis/batch/v1/cronjobs', namespace, name);
        const cronjob = await getJsonOnce(cronjobUrl, token, insecure, true);
        
        if (!cronjob) {
          return res.status(404).json({ message: 'CronJob 不存在' });
        }
        
        // 2. 生成 Job 名称 (cronjob-name-手动触发时间戳)
        const timestamp = Date.now();
        const jobName = `${name}-manual-${timestamp}`;
        
        // 3. 创建 Job，使用 CronJob 的 jobTemplate
        const jobBody = {
          apiVersion: 'batch/v1',
          kind: 'Job',
          metadata: {
            name: jobName,
            namespace: namespace,
            labels: {
              'cronjob-name': name,
              'manual-trigger': 'true',
            },
            ownerReferences: [{
              apiVersion: 'batch/v1',
              kind: 'CronJob',
              name: name,
              uid: cronjob.metadata?.uid,
            }],
          },
          spec: cronjob.spec?.jobTemplate?.spec || {},
        };
        
        // 4. 创建 Job
        const jobUrl = buildCreateUrl(base, '/apis/batch/v1/jobs', namespace);
        const result = await requestJson('POST', jobUrl, token, insecure, jobBody);
        
        res.json({ message: '已触发 CronJob 执行', data: result });
      } catch (error: any) {
        console.error('[CronJob Trigger] Error:', error);
        res.status(500).json({ message: '触发 CronJob 失败', error: error.message });
      }
    },
  );

  // ============================================================
  // [配置管理] ConfigMap, Secret
  // ============================================================

  /**
   * [API] 获取 ConfigMap 列表
   * GET /:id/resources/harvester/containers/configmaps
   * Query: namespace, force, all
   */
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
            items = await getNamespacedResources(base, '/api/v1/configmaps', String(namespace), token, insecure);
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
        
        // 生成缓存 key
        const cacheKey = `secrets:${id}:${namespace || 'all'}:${type || 'all'}:${all || 'false'}`;
        
        // 尝试从缓存获取（force=true 时跳过缓存）
        // Secrets 响应慢，使用更长的缓存时间
        let items: any[] | null = null;
        if (force !== 'true' && force !== '1') {
          items = getCached<any[]>(cacheKey, CACHE_TTL_SECRETS);
        }
        
        if (!items) {
          // 缓存未命中，从 K8s API 获取
          if (namespace) {
            items = await getNamespacedResources(base, '/api/v1/secrets', String(namespace), token, insecure);
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
            
            if (item?.type === 'kubernetes.io/dockerconfigjson' && item?.data?.['.dockerconfigjson']) {
              try {
                const decoded = Buffer.from(item.data['.dockerconfigjson'], 'base64').toString('utf-8');
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
              data: item.data ? Object.keys(item.data).reduce((acc: any, key: string) => {
                acc[key] = '******';
                return acc;
              }, {} as any) : undefined,
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
            message: '缺少必要参数: namespace, body' 
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
        
        // 清除 configmaps 缓存
        clearCacheByPrefix(`configmaps:${id}:`);
        
        res.json({ message: '创建 ConfigMap 成功', data: result });
      } catch (error: any) {
        console.error('[ConfigMap 创建] 错误:', JSON.stringify(error, null, 2));
        const errorMsg = error?.body || error?.message || '创建 ConfigMap 失败';
        res.status(error?.status || 500).json({ message: '创建 ConfigMap 失败', error: errorMsg });
      }
    },
  );

  /**
   * [API] 获取 ConfigMap 详情
   * GET /:id/resources/harvester/containers/configmaps/:namespace/:name
   */
  router.get(
    '/:id/resources/harvester/containers/configmaps/:namespace/:name',
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
        
        const url = buildK8sUrl(base, '/api/v1/configmaps', namespace, name);
        const result = await getJsonOnce(url, token, insecure, true);
        
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
        
        // 清除 configmaps 缓存
        clearCacheByPrefix(`configmaps:${id}:`);
        
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
        
        // 清除 configmaps 缓存
        clearCacheByPrefix(`configmaps:${id}:`);
        
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
            message: '缺少必要参数: namespace, body' 
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
        
        // 清除 secrets 缓存
        clearCacheByPrefix(`secrets:${id}:`);
        
        res.json({ message: '创建 Secret 成功', data: result });
      } catch (error: any) {
        console.error('[Secret 创建] 错误:', JSON.stringify(error, null, 2));
        const errorMsg = error?.body || error?.message || '创建 Secret 失败';
        res.status(error?.status || 500).json({ message: '创建 Secret 失败', error: errorMsg });
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
          result = getCached<any>(cacheKey);
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
        
        // 清除 secrets 缓存
        clearCacheByPrefix(`secrets:${id}:`);
        
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
        
        const url = buildK8sUrl(base, '/api/v1/secrets', namespace, name);
        console.log('[Secret 删除] URL:', url);
        
        const result = await requestJson('DELETE', url, token, insecure);
        
        // 清除 secrets 缓存
        clearCacheByPrefix(`secrets:${id}:`);
        
        res.json({ message: '删除 Secret 成功', data: result });
      } catch (error: any) {
        console.error('[Secret 删除] 错误:', JSON.stringify(error, null, 2));
        const errorMsg = error?.body || error?.message || '删除 Secret 失败';
        res.status(error?.status || 500).json({ message: '删除 Secret 失败', error: errorMsg });
      }
    },
  );

  // ============================================================
  // [镜像凭证管理] ImagePullSecret (kubernetes.io/dockerconfigjson)
  // ============================================================

  /**
   * [辅助函数] 构建 dockerconfigjson 数据
   * @param server 仓库地址 (如 registry.example.com)
   * @param username 用户名
   * @param password 密码
   * @param email 邮箱 (可选)
   * @returns Base64 编码的 dockerconfigjson 字符串
   */
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

  /**
   * [API] 获取镜像凭证列表
   * GET /:id/resources/harvester/containers/imagepullsecrets
   * Query: namespace (可选，不传则返回所有命名空间)
   * 说明: 返回类型为 kubernetes.io/dockerconfigjson 的 Secret
   */
  router.get(
    '/:id/resources/harvester/containers/imagepullsecrets',
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
        
        // 获取所有 Secret，然后过滤
        let items: any[];
        if (namespace) {
          items = await getNamespacedResources(base, '/api/v1/secrets', String(namespace), token, insecure);
        } else {
          items = await getAllNamespacedResources(base, '/api/v1/secrets', token, insecure);
        }
        
        // 过滤 kubernetes.io/dockerconfigjson 类型
        const imagePullSecrets = items
          .filter((item: any) => item?.type === 'kubernetes.io/dockerconfigjson')
          .map((item: any) => {
            // 解析并提取仓库信息
            let registryInfo: any = {};
            try {
              if (item.data?.['.dockerconfigjson']) {
                const decoded = Buffer.from(item.data['.dockerconfigjson'], 'base64').toString('utf-8');
                const config = JSON.parse(decoded);
                const servers = Object.keys(config.auths || {});
                if (servers.length > 0) {
                  const firstServer = servers[0];
                  registryInfo = {
                    server: firstServer,
                    username: config.auths[firstServer].username,
                    // 不返回密码
                  };
                }
              }
            } catch (e) {
              console.error('解析 dockerconfigjson 失败:', e);
            }
            
            return {
              name: item.metadata?.name,
              namespace: item.metadata?.namespace,
              creationTimestamp: item.metadata?.creationTimestamp,
              type: item.type,
              ...registryInfo,
            };
          });
        
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
            message: '缺少必要参数: namespace, name, server, username, password' 
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
            message: '缺少必要参数: server, username, password' 
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
            const decoded = Buffer.from(result.data['.dockerconfigjson'], 'base64').toString('utf-8');
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

  // ============================================================
  // [服务发现] Service, Ingress
  // ============================================================

  /**
   * [API] 获取 Service 列表
   * GET /:id/resources/harvester/containers/services
   * Query: namespace, all
   * 说明: Service 是 Kubernetes 核心资源，用于服务发现和负载均衡
   * K8s API: /api/v1/namespaces/{ns}/services 或 /api/v1/services
   */
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
          items = await getNamespacedResources(base, '/api/v1/services', String(namespace), token, insecure);
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
            items = await getNamespacedResources(base, '/apis/networking.k8s.io/v1/ingresses', String(namespace), token, insecure);
          } else {
            items = await getAllNamespacedResources(base, '/apis/networking.k8s.io/v1/ingresses', token, insecure);
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
        const result = await requestJson('PUT', url, token, insecure, body);
        
        res.json({ message: '更新 Service 成功', data: result });
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
        const result = await requestJson('PUT', url, token, insecure, body);
        
        res.json({ message: '更新 Ingress 成功', data: result });
      } catch (error: any) {
        // 尝试提取 Kubernetes 返回的详细错误信息
        let errorDetail = error.message;
        if (error.response?.body) {
          try {
            const parsed = typeof error.response.body === 'string' 
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

  // ============================================================
  // [NetworkPolicy 管理] 网络策略
  // ============================================================

  /**
   * [辅助函数] 格式化 NetworkPolicy 列表项
   * 保留原始 K8s 资源结构，前端统一使用 metadata 访问
   */
  const formatNetworkPolicyItem = (item: any) => {
    // 直接返回原始数据结构，前端统一处理
    return item;
  };

  /**
   * [API] 获取 NetworkPolicy 列表
   * GET /:id/resources/harvester/containers/networkpolicies
   * Query: namespace, all
   * 说明: NetworkPolicy 是 Kubernetes 网络策略资源，用于控制 Pod 之间的网络访问
   * K8s API: /apis/networking.k8s.io/v1/namespaces/{ns}/networkpolicies
   */
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
          items = await getNamespacedResources(base, '/apis/networking.k8s.io/v1/networkpolicies', String(namespace), token, insecure);
        } else {
          items = await getAllNamespacedResources(base, '/apis/networking.k8s.io/v1/networkpolicies', token, insecure);
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
        
        const url = buildK8sUrl(base, '/apis/networking.k8s.io/v1/networkpolicies', namespace, name);
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
        
        const url = buildK8sUrl(base, '/apis/networking.k8s.io/v1/networkpolicies', namespace, name);
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
        res.status(error?.status || 500).json({ message: '创建 NetworkPolicy 失败', error: errorMsg });
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
        
        const url = buildK8sUrl(base, '/apis/networking.k8s.io/v1/networkpolicies', namespace, name);
        const result = await requestJson('PUT', url, token, insecure, body);
        
        res.json({ message: '更新 NetworkPolicy 成功', data: result });
      } catch (error: any) {
        // 尝试提取 Kubernetes 返回的详细错误信息
        let errorDetail = error.message;
        if (error.response?.body) {
          try {
            const parsed = typeof error.response.body === 'string' 
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
        
        const url = buildK8sUrl(base, '/apis/networking.k8s.io/v1/networkpolicies', namespace, name);
        const result = await requestJson('DELETE', url, token, insecure);
        
        res.json({ message: '删除 NetworkPolicy 成功', data: result });
      } catch (error: any) {
        res.status(500).json({ message: '删除 NetworkPolicy 失败', error: error.message });
      }
    },
  );

  // ============================================================
  // [PodDisruptionBudget 管理] PDB
  // ============================================================

  /**
   * [API] 获取 PodDisruptionBudget 列表
   * GET /:id/resources/harvester/containers/poddisruptionbudgets
   * Query: namespace, all
   */
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
          items = await getNamespacedResources(base, '/apis/policy/v1/poddisruptionbudgets', String(namespace), token, insecure);
        } else {
          items = await getAllNamespacedResources(base, '/apis/policy/v1/poddisruptionbudgets', token, insecure);
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
        res.status(500).json({ message: '查询 PodDisruptionBudget 详情失败', error: error.message });
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
            message: '缺少必要参数: namespace, body' 
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
        res.status(error?.status || 500).json({ message: '创建 PodDisruptionBudget 失败', error: errorMsg });
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
        res.status(error?.status || 500).json({ message: '删除 PodDisruptionBudget 失败', error: errorMsg });
      }
    },
  );

  // ============================================================
  // [Gateway API] GatewayClass, Gateway, HTTPRoute, GRPCRoute
  // ============================================================

  /**
   * [API] 检测 Gateway API CRD 是否已安装
   * GET /:id/resources/harvester/containers/gateway-api/status
   * 说明: 检查集群是否安装了 Gateway API CRD
   */
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
        // 如果 CRD 不存在，返回空列表而不是错误
        if (error?.status === 404 || error?.statusCode === 404) {
          return res.json({ message: '查询成功', data: { items: [] } });
        }
        res.status(500).json({ message: '查询 GatewayClass 失败', error: error.message });
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
          details: error?.details || null
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
        
        const url = buildK8sUrl(base, apiPath, namespace, name);
        const result = await requestJson('PUT', url, token, insecure, body);
        
        res.json({ message: '更新成功', data: result });
      } catch (error: any) {
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
          return res.status(400).json({ message: '缺少必要参数: apiPath, namespace, name, patchBody' });
        }
        
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';
        
        const url = buildK8sUrl(base, apiPath, namespace, name);
        const result = await requestJson('PATCH', url, token, insecure, patchBody, {
          'Content-Type': 'application/json-patch+json'
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
        
        const url = buildK8sUrl(base, apiPath, namespace, name);
        const result = await requestJson('DELETE', url, token, insecure);
        
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
        
        const results: { name: string; namespace: string; status: 'success' | 'blocked' | 'failed'; message?: string }[] = [];
        
        for (const pod of pods) {
          const { namespace, name } = pod;
          if (!namespace || !name) {
            results.push({ name: name || 'unknown', namespace: namespace || 'unknown', status: 'failed', message: '缺少 namespace 或 name' });
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
                message: 'PDB 阻止了驱逐操作' 
              });
            } else {
              results.push({ 
                name, 
                namespace, 
                status: 'failed', 
                message: error.message || '驱逐失败' 
              });
            }
          }
        }
        
        // 清除 Pod 缓存
        clearCacheByPrefix(`pods:${id}:`);
        
        const successCount = results.filter(r => r.status === 'success').length;
        const blockedCount = results.filter(r => r.status === 'blocked').length;
        const failedCount = results.filter(r => r.status === 'failed').length;
        
        res.json({ 
          message: `成功驱逐 ${successCount} 个，被 PDB 阻止 ${blockedCount} 个，失败 ${failedCount} 个`,
          data: { 
            results,
            successCount,
            blockedCount,
            failedCount 
          }
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

  // ============================================================
  // [Docker Registry V2 API 代理]
  // ============================================================

  /**
   * [API] 测试仓库连接
   * POST /:id/resources/harvester/containers/registry/test
   * Body: { server, username?, password? }
   */
  router.post(
    '/:id/resources/harvester/containers/registry/test',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { server, username, password, insecure } = req.body;
        
        if (!server) {
          return res.status(400).json({ message: '缺少必要参数: server' });
        }
        
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        
        // 使用云配置中的 TLS 设置作为默认值
        const ignoreTls = insecure ?? !!(cloud.config as any)?.ignoreTls;
        
        const authResult = await getRegistryAuth(server, username, password, ignoreTls);
        
        if (authResult.success) {
          res.json({
            message: '连接成功',
            data: { success: true, message: '仓库连接测试通过' },
          });
        } else {
          res.json({
            message: '连接失败',
            data: {
              success: false,
              message: authResult.error || '认证失败',
              wwwAuthenticate: authResult.wwwAuthenticate,
            },
          });
        }
      } catch (error: any) {
        console.error('[Registry Test] Error:', error);
        res.status(500).json({ message: '测试仓库连接失败', error: error.message });
      }
    },
  );

  /**
   * [API] 获取仓库目录（Catalog）
   * GET /:id/resources/harvester/containers/registry/catalog
   * Query: server, username?, password?, n?, last?
   * Docker Registry V2 API: GET /v2/_catalog
   */
  router.get(
    '/:id/resources/harvester/containers/registry/catalog',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { server, username, password, insecure, n, last } = req.query;
        
        if (!server) {
          return res.status(400).json({ message: '缺少必要参数: server' });
        }
        
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        
        const ignoreTls = insecure === 'true' || insecure === '1' || !!(cloud.config as any)?.ignoreTls;
        
        // 构建请求路径，支持分页
        let path = '/v2/_catalog';
        const params: string[] = [];
        if (n) params.push(`n=${n}`);
        if (last) params.push(`last=${encodeURIComponent(String(last))}`);
        if (params.length > 0) path += '?' + params.join('&');
        
        const result = await registryRequest(
          String(server),
          path,
          username ? String(username) : undefined,
          password ? String(password) : undefined,
          ignoreTls,
        );
        
        if (result.success) {
          res.json({
            message: '查询成功',
            data: result.data,
          });
        } else {
          res.status(result.status || 500).json({
            message: '获取仓库目录失败',
            error: result.error,
          });
        }
      } catch (error: any) {
        console.error('[Registry Catalog] Error:', error);
        res.status(500).json({ message: '获取仓库目录失败', error: error.message });
      }
    },
  );

  /**
   * [API] 获取镜像标签列表
   * GET /:id/resources/harvester/containers/registry/tags
   * Query: server, repository, username?, password?
   * Docker Registry V2 API: GET /v2/{name}/tags/list
   */
  router.get(
    '/:id/resources/harvester/containers/registry/tags',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { server, repository, username, password, insecure, n, last } = req.query;
        
        if (!server || !repository) {
          return res.status(400).json({ message: '缺少必要参数: server, repository' });
        }
        
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        
        const ignoreTls = insecure === 'true' || insecure === '1' || !!(cloud.config as any)?.ignoreTls;
        
        // 构建请求路径
        let path = `/v2/${encodeURIComponent(String(repository))}/tags/list`;
        const params: string[] = [];
        if (n) params.push(`n=${n}`);
        if (last) params.push(`last=${encodeURIComponent(String(last))}`);
        if (params.length > 0) path += '?' + params.join('&');
        
        const result = await registryRequest(
          String(server),
          path,
          username ? String(username) : undefined,
          password ? String(password) : undefined,
          ignoreTls,
        );
        
        if (result.success) {
          res.json({
            message: '查询成功',
            data: result.data,
          });
        } else {
          res.status(result.status || 500).json({
            message: '获取镜像标签失败',
            error: result.error,
          });
        }
      } catch (error: any) {
        console.error('[Registry Tags] Error:', error);
        res.status(500).json({ message: '获取镜像标签失败', error: error.message });
      }
    },
  );

  /**
   * [API] 获取镜像 Manifest
   * GET /:id/resources/harvester/containers/registry/manifest
   * Query: server, repository, tag, username?, password?
   * Docker Registry V2 API: GET /v2/{name}/manifests/{reference}
   */
  router.get(
    '/:id/resources/harvester/containers/registry/manifest',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { server, repository, tag, username, password, insecure } = req.query;
        
        if (!server || !repository || !tag) {
          return res.status(400).json({ message: '缺少必要参数: server, repository, tag' });
        }
        
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        
        const ignoreTls = insecure === 'true' || insecure === '1' || !!(cloud.config as any)?.ignoreTls;
        
        // 构建请求路径: /v2/{name}/manifests/{reference}
        const path = `/v2/${encodeURIComponent(String(repository))}/manifests/${encodeURIComponent(String(tag))}`;
        
        const result = await registryRequest(
          String(server),
          path,
          username ? String(username) : undefined,
          password ? String(password) : undefined,
          ignoreTls,
        );
        
        if (result.success) {
          res.json({
            message: '查询成功',
            data: result.data,
          });
        } else {
          res.status(result.status || 500).json({
            message: '获取镜像 Manifest 失败',
            error: result.error,
          });
        }
      } catch (error: any) {
        console.error('[Registry Manifest] Error:', error);
        res.status(500).json({ message: '获取镜像 Manifest 失败', error: error.message });
      }
    },
  );

  /**
   * [API] 获取镜像配置（Config）
   * GET /:id/resources/harvester/containers/registry/config
   * Query: server, repository, digest, username?, password?
   * Docker Registry V2 API: GET /v2/{name}/blobs/{digest}
   */
  router.get(
    '/:id/resources/harvester/containers/registry/config',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { server, repository, digest, username, password, insecure } = req.query;
        
        if (!server || !repository || !digest) {
          return res.status(400).json({ message: '缺少必要参数: server, repository, digest' });
        }
        
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        
        const ignoreTls = insecure === 'true' || insecure === '1' || !!(cloud.config as any)?.ignoreTls;
        
        // 构建请求路径: /v2/{name}/blobs/{digest}
        const path = `/v2/${encodeURIComponent(String(repository))}/blobs/${encodeURIComponent(String(digest))}`;
        
        const result = await registryRequest(
          String(server),
          path,
          username ? String(username) : undefined,
          password ? String(password) : undefined,
          ignoreTls,
        );
        
        if (result.success) {
          res.json({
            message: '查询成功',
            data: result.data,
          });
        } else {
          res.status(result.status || 500).json({
            message: '获取镜像配置失败',
            error: result.error,
          });
        }
      } catch (error: any) {
        console.error('[Registry Config] Error:', error);
        res.status(500).json({ message: '获取镜像配置失败', error: error.message });
      }
    },
  );

  /**
   * [API] 删除镜像标签
   * DELETE /:id/resources/harvester/containers/registry/tag
   * Body: { server, repository, digest, username?, password? }
   * Docker Registry V2 API: DELETE /v2/{name}/manifests/{digest}
   */
  router.delete(
    '/:id/resources/harvester/containers/registry/tag',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { server, repository, digest, username, password, insecure } = req.body;
        
        if (!server || !repository || !digest) {
          return res.status(400).json({ message: '缺少必要参数: server, repository, digest' });
        }
        
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
        
        const ignoreTls = insecure ?? !!(cloud.config as any)?.ignoreTls;
        
        // 构建请求路径: /v2/{name}/manifests/{digest}
        const path = `/v2/${encodeURIComponent(repository)}/manifests/${encodeURIComponent(digest)}`;
        
        const result = await registryRequest(
          server,
          path,
          username,
          password,
          ignoreTls,
          'DELETE',
        );
        
        if (result.success) {
          res.json({
            message: '删除成功',
            data: result.data,
          });
        } else {
          res.status(result.status || 500).json({
            message: '删除镜像失败',
            error: result.error,
          });
        }
      } catch (error: any) {
        console.error('[Registry Delete] Error:', error);
        res.status(500).json({ message: '删除镜像失败', error: error.message });
      }
    },
  );

  // ============================================================
  // [Containerd Registry 配置] - 配置 HTTP 私有仓库
  // ============================================================

  /**
   * [API] 获取 containerd-registry 配置
   * GET /:id/resources/harvester/containers/containerd-registry
   */
  router.get(
    '/:id/resources/harvester/containers/containerd-registry',
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
        
        // 提取 origin（去掉路径部分）
        let origin = base.replace(/\/+$/, '');
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }
        
        // Harvester Setting API: /v1/harvester/harvesterhci.io.settings/containerd-registry
        const url = `${origin}/v1/harvester/harvesterhci.io.settings/containerd-registry`;
        const result = await getJsonOnce(url, token, insecure, true);
        
        res.json({ message: '查询成功', data: result });
      } catch (error: any) {
        console.error('[ContainerdRegistry] Error:', error);
        res.status(500).json({ message: '查询 containerd-registry 配置失败', error: error.message });
      }
    },
  );

  /**
   * [API] 更新 containerd-registry 配置
   * PUT /:id/resources/harvester/containers/containerd-registry
   * Body: { value: { Mirrors: {...}, Configs: {...} } }
   */
  router.put(
    '/:id/resources/harvester/containers/containerd-registry',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { value } = req.body;
        
        if (!value) {
          return res.status(400).json({ message: '缺少必要参数: value' });
        }
        
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源配置')) return;
        
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';
        
        // 提取 origin（去掉路径部分）
        let origin = base.replace(/\/+$/, '');
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }
        
        // 首先获取当前配置（获取 resourceVersion）
        const getUrl = `${origin}/v1/harvester/harvesterhci.io.settings/containerd-registry`;
        const current = await getJsonOnce(getUrl, token, insecure, true);
        const resourceVersion = (current as any)?.metadata?.resourceVersion || (current as any)?.resourceVersion;
        
        // 更新配置
        const body = {
          metadata: {
            name: 'containerd-registry',
            resourceVersion,
          },
          value: typeof value === 'string' ? value : JSON.stringify(value),
        };
        
        const putUrl = `${origin}/v1/harvester/harvesterhci.io.settings/containerd-registry`;
        const result = await requestJson('PUT', putUrl, token, insecure, body);
        
        console.log('[ContainerdRegistry] Updated successfully');
        res.json({ message: '配置更新成功，请在每个节点上重启 containerd 服务使配置生效', data: result });
      } catch (error: any) {
        console.error('[ContainerdRegistry] Update Error:', error);
        res.status(500).json({ message: '更新 containerd-registry 配置失败', error: error.message });
      }
    },
  );

  /**
   * [API] 添加 HTTP 私有仓库到 containerd-registry
   * POST /:id/resources/harvester/containers/containerd-registry/insecure
   * Body: { server: string }
   * 快速添加一个 HTTP 私有仓库配置
   */
  router.post(
    '/:id/resources/harvester/containers/containerd-registry/insecure',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { server } = req.body;
        
        if (!server) {
          return res.status(400).json({ message: '缺少必要参数: server' });
        }
        
        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源配置')) return;
        
        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';
        
        // 提取 origin（去掉路径部分）
        let origin = base.replace(/\/+$/, '');
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }
        
        // 首先获取当前配置（获取 resourceVersion）
        const getUrl = `${origin}/v1/harvester/harvesterhci.io.settings/containerd-registry`;
        const current = await getJsonOnce(getUrl, token, insecure, true);
        const resourceVersion = (current as any)?.metadata?.resourceVersion || (current as any)?.resourceVersion;
        
        // 解析当前值
        let currentValue: any = { Mirrors: {}, Configs: {} };
        try {
          const currentVal = (current as any)?.value;
          if (currentVal) {
            currentValue = typeof currentVal === 'string' ? JSON.parse(currentVal) : currentVal;
          }
        } catch (e) {
          console.warn('[ContainerdRegistry] Failed to parse current value, using default');
        }
        
        // 确保结构存在
        if (!currentValue.Mirrors) currentValue.Mirrors = {};
        if (!currentValue.Configs) currentValue.Configs = {};
        
        // 添加新的 HTTP 仓库配置
        currentValue.Mirrors[server] = {
          Endpoints: [`http://${server}`],
        };
        currentValue.Configs[server] = {
          TLS: {
            InsecureSkipVerify: true,
          },
        };
        
        // 更新配置
        const body = {
          metadata: {
            name: 'containerd-registry',
            resourceVersion,
          },
          value: JSON.stringify(currentValue),
        };
        
        const putUrl = `${origin}/v1/harvester/harvesterhci.io.settings/containerd-registry`;
        const result = await requestJson('PUT', putUrl, token, insecure, body);
        
        console.log(`[ContainerdRegistry] Added insecure registry: ${server}`);
        res.json({ 
          message: `已添加 HTTP 仓库 ${server}，请在每个节点上重启 containerd 服务使配置生效`, 
          data: result 
        });
      } catch (error: any) {
        console.error('[ContainerdRegistry] Add Insecure Error:', error);
        res.status(500).json({ message: '添加 HTTP 仓库配置失败', error: error.message });
      }
    },
  );
};

// 辅助函数：带额外 headers 的请求
async function requestJsonWithHeaders(
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

// ============================================================
// [Docker Registry V2 API 代理]
// ============================================================

/**
 * [辅助函数] Docker Registry V2 API 认证处理器
 * 
 * Docker Registry V2 支持两种认证方式：
 * 1. Basic Auth: 直接使用 username:password
 * 2. Bearer Token: 通过 WWW-Authenticate 响应头获取 token 端点
 * 
 * @param server 仓库服务器地址
 * @param username 用户名（可选）
 * @param password 密码（可选）
 * @param insecure 是否忽略 TLS
 * @returns 认证信息或 token
 */
interface RegistryAuthResult {
  success: boolean;
  authHeader?: string;  // Authorization header value
  token?: string;       // Bearer token (如果使用 token 认证)
  error?: string;
  wwwAuthenticate?: string; // WWW-Authenticate header value
}

/**
 * [辅助函数] 解析 WWW-Authenticate 响应头
 * 格式: Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:library/alpine:pull"
 */
const parseWwwAuthenticate = (header: string): Record<string, string> => {
  const result: Record<string, string> = {};
  
  // 提取认证类型
  const match = header.match(/^(\w+)\s+(.*)$/);
  if (!match) return result;
  
  result['type'] = match[1].toLowerCase();
  
  // 解析参数
  const params = match[2];
  const regex = /(\w+)="([^"]*)"/g;
  let paramMatch;
  while ((paramMatch = regex.exec(params)) !== null) {
    result[paramMatch[1]] = paramMatch[2];
  }
  
  return result;
};

/**
 * [辅助函数] 获取 Docker Registry 认证信息
 */
const getRegistryAuth = async (
  server: string,
  username?: string,
  password?: string,
  insecure: boolean = false,
): Promise<RegistryAuthResult> => {
  const https = await import('https');
  const http = await import('http');
  
  // 规范化服务器地址
  let normalizedServer = server.replace(/\/+$/, '');
  if (!normalizedServer.startsWith('http://') && !normalizedServer.startsWith('https://')) {
    // insecure=true 时使用 HTTP，否则使用 HTTPS
    normalizedServer = insecure ? `http://${normalizedServer}` : `https://${normalizedServer}`;
  }
  
  const urlModule = await import('url');
  const parsedUrl = new urlModule.URL(normalizedServer);
  const lib = parsedUrl.protocol === 'https:' ? https : http;
  
  return new Promise((resolve) => {
    // 构建基础认证头
    let authHeader = '';
    if (username && password) {
      authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    }
    
    const options: any = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: '/v2/',
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        ...(authHeader ? { 'Authorization': authHeader } : {}),
      },
    };
    
    if (insecure && parsedUrl.protocol === 'https:') {
      options.rejectUnauthorized = false;
    }
    
    const req = lib.request(options, (res: any) => {
      // 2xx 表示认证成功（公开仓库可能不需要认证）
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        resolve({
          success: true,
          authHeader: authHeader || undefined,
        });
        return;
      }
      
      // 401 表示需要认证，检查 WWW-Authenticate 头
      if (res.statusCode === 401) {
        const wwwAuth = res.headers['www-authenticate'];
        
        if (wwwAuth) {
          const authParams = parseWwwAuthenticate(wwwAuth);
          
          if (authParams['type'] === 'bearer' && authParams['realm']) {
            // 需要获取 Bearer Token
            resolve({
              success: false,
              wwwAuthenticate: wwwAuth,
              error: '需要 Bearer Token 认证',
            });
            return;
          }
          
          if (authParams['type'] === 'basic') {
            // 需要 Basic Auth
            if (username && password) {
              resolve({
                success: true,
                authHeader: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
              });
            } else {
              resolve({
                success: false,
                wwwAuthenticate: wwwAuth,
                error: '需要用户名和密码',
              });
            }
            return;
          }
        }
        
        resolve({
          success: false,
          error: '认证失败：无效的认证信息',
        });
        return;
      }
      
      resolve({
        success: false,
        error: `连接失败: HTTP ${res.statusCode}`,
      });
    });
    
    req.setTimeout(15000, () => {
      req.destroy(new Error('timeout'));
      resolve({ success: false, error: '连接超时' });
    });
    
    req.on('error', (err: any) => {
      resolve({
        success: false,
        error: err.message || '连接失败',
      });
    });
    
    req.end();
  });
};

/**
 * [辅助函数] 获取 Bearer Token
 */
const getBearerToken = async (
  realm: string,
  service: string,
  scope: string,
  username?: string,
  password?: string,
  insecure: boolean = false,
): Promise<{ success: boolean; token?: string; error?: string }> => {
  const https = await import('https');
  const http = await import('http');
  const urlModule = await import('url');
  
  // 构建 token 请求 URL
  const tokenUrl = new urlModule.URL(realm);
  tokenUrl.searchParams.set('service', service);
  tokenUrl.searchParams.set('scope', scope);
  
  const lib = tokenUrl.protocol === 'https:' ? https : http;
  
  const options: any = {
    hostname: tokenUrl.hostname,
    port: tokenUrl.port || (tokenUrl.protocol === 'https:' ? 443 : 80),
    path: tokenUrl.pathname + tokenUrl.search,
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
  };
  
  // 添加 Basic Auth（如果提供）
  if (username && password) {
    options.headers['Authorization'] = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  }
  
  if (insecure && tokenUrl.protocol === 'https:') {
    options.rejectUnauthorized = false;
  }
  
  return new Promise((resolve) => {
    const req = lib.request(options, (res: any) => {
      let data = '';
      res.on('data', (chunk: string) => data += chunk);
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const json = JSON.parse(data);
            resolve({ success: true, token: json.access_token || json.token });
          } catch {
            resolve({ success: false, error: 'Token 响应解析失败' });
          }
        } else {
          resolve({ success: false, error: `获取 Token 失败: HTTP ${res.statusCode}` });
        }
      });
    });
    
    req.setTimeout(15000, () => {
      req.destroy(new Error('timeout'));
      resolve({ success: false, error: '获取 Token 超时' });
    });
    
    req.on('error', (err: any) => {
      resolve({ success: false, error: err.message || '获取 Token 失败' });
    });
    
    req.end();
  });
};

/**
 * [辅助函数] 带认证的 Docker Registry API 请求
 */
const registryRequest = async (
  server: string,
  path: string,
  username?: string,
  password?: string,
  insecure: boolean = false,
  method: string = 'GET',
): Promise<{ success: boolean; data?: any; status?: number; error?: string }> => {
  const https = await import('https');
  const http = await import('http');
  const urlModule = await import('url');
  
  // 规范化服务器地址
  let normalizedServer = server.replace(/\/+$/, '');
  if (!normalizedServer.startsWith('http://') && !normalizedServer.startsWith('https://')) {
    // insecure=true 时使用 HTTP，否则使用 HTTPS
    normalizedServer = insecure ? `http://${normalizedServer}` : `https://${normalizedServer}`;
  }
  
  // 首先尝试获取认证信息
  const authResult = await getRegistryAuth(normalizedServer, username, password, insecure);
  
  let authHeader = authResult.authHeader || '';
  
  // 如果需要 Bearer Token，先获取 token
  if (!authResult.success && authResult.wwwAuthenticate) {
    const authParams = parseWwwAuthenticate(authResult.wwwAuthenticate);
    
    if (authParams['type'] === 'bearer' && authParams['realm']) {
      // 从 path 提取 scope
      let scope = 'repository:library:pull';
      
      // 解析 path 获取仓库信息用于构建 scope
      const pathParts = path.replace('/v2/', '').split('/');
      if (pathParts.length > 1) {
        // 例如: /v2/library/alpine/tags/list -> scope: repository:library/alpine:pull
        const manifestOrTags = pathParts.findIndex(p => p === 'tags' || p === 'manifests');
        if (manifestOrTags > 0) {
          const repoPath = pathParts.slice(0, manifestOrTags).join('/');
          scope = `repository:${repoPath}:pull`;
        }
      }
      
      const tokenResult = await getBearerToken(
        authParams['realm'],
        authParams['service'] || '',
        scope,
        username,
        password,
        insecure,
      );
      
      if (!tokenResult.success) {
        return { success: false, error: tokenResult.error };
      }
      
      authHeader = `Bearer ${tokenResult.token}`;
    } else if (!authResult.success) {
      return { success: false, error: authResult.error };
    }
  }
  
  // 执行实际请求
  const fullUrl = new urlModule.URL(normalizedServer);
  const lib = fullUrl.protocol === 'https:' ? https : http;
  
  const options: any = {
    hostname: fullUrl.hostname,
    port: fullUrl.port || (fullUrl.protocol === 'https:' ? 443 : 80),
    path: path,
    method: method,
    headers: {
      'Accept': 'application/json',
      ...(authHeader ? { 'Authorization': authHeader } : {}),
    },
  };
  
  // 对于 manifest 请求，添加额外的 Accept 头
  if (path.includes('/manifests/')) {
    options.headers['Accept'] = 'application/vnd.docker.distribution.manifest.v2+json, application/vnd.docker.distribution.manifest.list.v2+json, application/json';
  }
  
  if (insecure && fullUrl.protocol === 'https:') {
    options.rejectUnauthorized = false;
  }
  
  return new Promise((resolve) => {
    const req = lib.request(options, (res: any) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const text = buffer.toString('utf-8');
        const status = res.statusCode || 0;
        
        if (status >= 200 && status < 300) {
          try {
            resolve({ success: true, data: JSON.parse(text), status });
          } catch {
            // 如果不是 JSON，返回原始文本
            resolve({ success: true, data: text, status });
          }
        } else {
          // 尝试解析错误信息
          let errorMsg = `HTTP ${status}`;
          try {
            const errorJson = JSON.parse(text);
            errorMsg = errorJson.errors?.[0]?.message || errorMsg;
          } catch {}
          resolve({ success: false, error: errorMsg, status });
        }
      });
    });
    
    req.setTimeout(60000, () => {
      req.destroy(new Error('timeout'));
      resolve({ success: false, error: '请求超时' });
    });
    
    req.on('error', (err: any) => {
      resolve({ success: false, error: err.message || '请求失败' });
    });
    
    req.end();
  });
};


