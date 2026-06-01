/**
 * Harvester 容器路由共享：内存 TTL 缓存与 K8s URL 构建辅助函数。
 */
import { getJsonOnce } from '../../../services/clouds/harvester/utils';

interface CacheItem<T> {
  data: T;
  timestamp: number;
}

const resourceCache = new Map<string, CacheItem<any>>();
export const CACHE_TTL = 30 * 1000;
export const CACHE_TTL_SECRETS = 5 * 60 * 1000;
export const CACHE_TTL_CONFIGMAPS = 2 * 60 * 1000;
export const CACHE_TTL_SECRET_DETAIL = 2 * 60 * 1000;
export const CACHE_TTL_CONFIGMAP_DETAIL = 2 * 60 * 1000;

export const getCached = <T>(key: string, customTtl?: number): T | null => {
  const item = resourceCache.get(key);
  if (!item) return null;
  const ttl = customTtl || CACHE_TTL;
  if (Date.now() - item.timestamp > ttl) {
    resourceCache.delete(key);
    return null;
  }
  return item.data as T;
};

export const setCache = <T>(key: string, data: T): void => {
  resourceCache.set(key, { data, timestamp: Date.now() });
};

export const clearCacheByPrefix = (prefix: string): void => {
  for (const key of resourceCache.keys()) {
    if (key.startsWith(prefix)) {
      resourceCache.delete(key);
    }
  }
};

export const buildK8sUrl = (
  base: string,
  apiPath: string,
  namespace?: string,
  resource?: string,
): string => {
  let url = base.replace(/\/+$/, '');

  if (
    (apiPath.startsWith('/api/') || apiPath.startsWith('/apis/')) &&
    !url.includes('/k8s/clusters/')
  ) {
    url = url.replace(/\/v[0-9]+(\/harvester)?$/, '');
    url += '/k8s/clusters/local';
  }

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

export const extractOrigin = (base: string): string => {
  let origin = base.replace(/\/+$/, '');

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

export const buildCreateUrl = (base: string, apiPath: string, namespace: string): string => {
  let origin = base.replace(/\/+$/, '');

  if (!origin.includes('/k8s/clusters/')) {
    origin = origin.replace(/\/v[0-9].*$/, '');
    origin += '/k8s/clusters/local';
  }

  const pathParts = apiPath.split('/').filter(Boolean);
  const resourceType = pathParts[pathParts.length - 1];

  if (apiPath.startsWith('/api/v1/')) {
    return `${origin}/api/v1/namespaces/${encodeURIComponent(namespace)}/${resourceType}`;
  } else if (apiPath.startsWith('/apis/')) {
    const group = pathParts[1] || '';
    const version = pathParts[2] || 'v1';
    return `${origin}/apis/${group}/${version}/namespaces/${encodeURIComponent(namespace)}/${resourceType}`;
  }

  return `${origin}/api/v1/namespaces/${encodeURIComponent(namespace)}/${resourceType}`;
};

export const getAllNamespacedResources = async (
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

export const getNamespacedResources = async (
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
