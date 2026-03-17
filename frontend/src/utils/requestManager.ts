/**
 * 请求管理器
 * 提供请求去重、缓存、重试等功能
 */

interface RequestConfig {
  method?: string;
  endpoint: string;
  body?: any;
  headers?: Record<string, string>;
  // 请求选项
  options?: {
    enableDeduplication?: boolean; // 是否启用请求去重（默认：true）
    enableCache?: boolean; // 是否启用缓存（默认：仅 GET 请求）
    cacheTTL?: number; // 缓存过期时间（毫秒，默认：5分钟）
    enableRetry?: boolean; // 是否启用重试（默认：true）
    retryCount?: number; // 最大重试次数（默认：2次）
    retryDelay?: number; // 重试延迟基数（毫秒，默认：1000ms，指数退避）
    skipCache?: boolean; // 跳过缓存强制刷新（默认：false）
  };
}

interface CacheEntry {
  data: any;
  timestamp: number;
  ttl: number;
}

interface PendingRequest {
  promise: Promise<any>;
  timestamp: number;
}

// 请求缓存（内存缓存）
const requestCache = new Map<string, CacheEntry>();

// 正在进行的请求（用于去重）
const pendingRequests = new Map<string, PendingRequest>();

// 缓存清理间隔（5分钟）
const CACHE_CLEANUP_INTERVAL = 5 * 60 * 1000;

// 默认配置
const DEFAULT_CONFIG = {
  enableDeduplication: true,
  enableCache: true,
  cacheTTL: 5 * 60 * 1000, // 5分钟
  enableRetry: true,
  retryCount: 2,
  retryDelay: 1000,
  skipCache: false,
};

/**
 * 生成请求的唯一键（用于去重和缓存）
 */
function generateRequestKey(config: RequestConfig): string {
  const { method = 'GET', endpoint, body } = config;
  const bodyStr = body ? JSON.stringify(body) : '';
  return `${method}-${endpoint}-${bodyStr}`;
}

/**
 * 清理过期的缓存
 */
function cleanupExpiredCache() {
  const now = Date.now();
  for (const [key, entry] of requestCache.entries()) {
    if (now - entry.timestamp > entry.ttl) {
      requestCache.delete(key);
    }
  }
}

/**
 * 清理过期的待处理请求（防止内存泄漏）
 */
function cleanupExpiredPendingRequests() {
  const now = Date.now();
  const maxAge = 30 * 1000; // 30秒
  for (const [key, request] of pendingRequests.entries()) {
    if (now - request.timestamp > maxAge) {
      pendingRequests.delete(key);
    }
  }
}

// 定期清理过期缓存和待处理请求
if (typeof window !== 'undefined') {
  setInterval(() => {
    cleanupExpiredCache();
    cleanupExpiredPendingRequests();
  }, CACHE_CLEANUP_INTERVAL);
}

/**
 * 解析错误响应（与 api.ts 中的逻辑保持一致）
 */
async function parseErrorResponse(response: Response): Promise<never> {
  let errorMsg = `HTTP error! status: ${response.status}`;
  let responseData: any = null;
  try {
    // 克隆响应以便多次读取（因为 response.json() 会消费响应体）
    const clonedResponse = response.clone();
    responseData = await clonedResponse.json();
    if (responseData && typeof responseData === 'object') {
      // 1. Prefer 'message' field
      if (responseData.message) {
        errorMsg = responseData.message;
        // Append 'error' detail if exists
        if (responseData.error) {
          const detail = typeof responseData.error === 'string' ? responseData.error : JSON.stringify(responseData.error);
          // Avoid duplication
          if (!errorMsg.includes(detail)) {
            errorMsg += `: ${detail}`;
          }
        }
      }
      // 2. Fallback to 'error' field
      else if (responseData.error) {
        errorMsg = typeof responseData.error === 'string' ? responseData.error : JSON.stringify(responseData.error);
      }
    }
  } catch (e) {
    // ignore JSON parse error
  }
  const translateKnownMessage = (raw: string) => {
    const msg = String(raw || '').trim();
    if (!msg) return raw;
    const lower = msg.toLowerCase();
    if (
      /runstategy\s+halted.*manual restart/i.test(msg) ||
      /runstrategy\s+halted.*manual restart/i.test(msg) ||
      (lower.includes('virtualmachine.kubevirt.io') && lower.includes('runstategy halted')) ||
      (lower.includes('virtualmachine.kubevirt.io') && lower.includes('runstrategy halted'))
    ) {
      let vm = '';
      const m1 = msg.match(/restart virtual machine\s+([^\s]+)\s+failed/i);
      if (m1?.[1]) vm = String(m1[1]);
      const m2 = msg.match(/virtualmachine\.kubevirt\.io\s+"([^"]+)"/i);
      if (!vm && m2?.[1]) vm = String(m2[1]);
      const head = vm ? `实例 ${vm} ` : '实例 ';
      return `${head}运行策略为 Halted（保持停止），不支持重启。请先启动实例或将运行策略调整为允许运行后再重试。`;
    }
    return raw;
  };
  errorMsg = translateKnownMessage(errorMsg);
  const err: any = new Error(errorMsg);
  err.status = response.status;
  err.response = response;
  // 保存解析后的响应数据，方便前端访问 e?.response?.data
  err.responseData = responseData;
  throw err;
}

/**
 * 执行实际的请求
 */
async function executeRequest(
  config: RequestConfig,
  apiBaseUrl: string
): Promise<any> {
  const { method = 'GET', endpoint, body, headers = {} } = config;

  const url = `${apiBaseUrl}${endpoint}`;
  const fetchOptions: RequestInit = {
    method,
    headers: {
      ...headers,
    },
    credentials: 'include',
    cache: 'no-store',
  };

  // 如果是 FormData，不设置 Content-Type（让浏览器自动设置，包括 boundary）
  // 如果不是 FormData，只有在 headers 中没有 Content-Type 时才设置默认值
  if (!(body instanceof FormData)) {
    // 如果 headers 中已经指定了 Content-Type，使用它（例如 application/merge-patch+json）
    // 否则使用默认的 application/json
    if (!headers['Content-Type']) {
      fetchOptions.headers = {
        'Content-Type': 'application/json',
        ...headers,
      };
    } else {
      fetchOptions.headers = headers;
    }
  } else {
    // FormData 情况下，只保留用户自定义的 headers（但不包括 Content-Type）
    const { 'Content-Type': _, ...otherHeaders } = headers;
    fetchOptions.headers = otherHeaders;
  }

  if (body && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
    // FormData 直接传递，其他情况序列化为 JSON
    fetchOptions.body = body instanceof FormData ? body : JSON.stringify(body);
  }

  const response = await fetch(url, fetchOptions);

  if (!response.ok) {
    await parseErrorResponse(response);
  }

  // 处理 204 No Content
  if (response.status === 204) {
    return null;
  }

  return await response.json();
}

/**
 * 带重试的请求执行
 */
async function executeRequestWithRetry(
  config: RequestConfig,
  apiBaseUrl: string,
  retryCount: number,
  retryDelay: number
): Promise<any> {
  try {
    return await executeRequest(config, apiBaseUrl);
  } catch (error: any) {
    // 判断是否应该重试
    const shouldRetry =
      retryCount > 0 &&
      // 网络错误或 5xx 服务器错误才重试
      (error.status >= 500 || !error.status);

    if (!shouldRetry) {
      throw error;
    }

    // 指数退避：延迟时间 = retryDelay * (2 ^ (总重试次数 - 当前剩余次数))
    const delay = retryDelay * Math.pow(2, retryCount - 1);
    await new Promise((resolve) => setTimeout(resolve, delay));

    return executeRequestWithRetry(config, apiBaseUrl, retryCount - 1, retryDelay);
  }
}

/**
 * 请求管理器主函数
 * 
 * @param config - 请求配置
 * @param apiBaseUrl - API 基础 URL
 * @returns Promise<any> 请求结果
 */
export async function requestManager(
  config: RequestConfig,
  apiBaseUrl: string
): Promise<any> {
  const options = { ...DEFAULT_CONFIG, ...config.options };
  const method = (config.method || 'GET').toUpperCase();
  const isGetRequest = method === 'GET';

  // 如果 URL 中包含 force=true，自动跳过缓存和去重
  const endpoint = config.endpoint || '';
  const hasForceParam = endpoint.includes('force=true');
  if (hasForceParam) {
    options.skipCache = true;
  }

  // 生成请求键
  const requestKey = generateRequestKey(config);

  // 1. 检查缓存（仅 GET 请求且启用缓存）
  if (isGetRequest && options.enableCache && !options.skipCache) {
    const cached = requestCache.get(requestKey);
    if (cached) {
      const now = Date.now();
      if (now - cached.timestamp < cached.ttl) {
        // 缓存有效，直接返回
        return cached.data;
      } else {
        // 缓存过期，删除
        requestCache.delete(requestKey);
      }
    }
  }

  // 2. 检查请求去重（启用去重且不是强制刷新）
  if (options.enableDeduplication && !options.skipCache) {
    const pending = pendingRequests.get(requestKey);
    if (pending) {
      // 已有相同请求正在进行，等待该请求完成
      return pending.promise;
    }
  }

  // 3. 创建新请求
  const requestPromise = (async () => {
    try {
      // 执行请求（带重试）
      const data = options.enableRetry
        ? await executeRequestWithRetry(
            config,
            apiBaseUrl,
            options.retryCount!,
            options.retryDelay!
          )
        : await executeRequest(config, apiBaseUrl);

      // 4. 缓存结果（仅 GET 请求且启用缓存）
      if (isGetRequest && options.enableCache) {
        requestCache.set(requestKey, {
          data,
          timestamp: Date.now(),
          ttl: options.cacheTTL!,
        });
      }

      return data;
    } finally {
      // 请求完成，从待处理列表中移除
      pendingRequests.delete(requestKey);
    }
  })();

  // 记录待处理请求（用于去重）
  if (options.enableDeduplication && !options.skipCache) {
    pendingRequests.set(requestKey, {
      promise: requestPromise,
      timestamp: Date.now(),
    });
  }

  return requestPromise;
}

/**
 * 清除指定请求的缓存
 */
export function clearCache(endpoint: string, method: string = 'GET') {
  const key = generateRequestKey({ method, endpoint });
  requestCache.delete(key);
}

/**
 * 清除所有缓存
 */
export function clearAllCache() {
  requestCache.clear();
}

/**
 * 清除指定请求的待处理状态（用于取消去重）
 */
export function clearPendingRequest(endpoint: string, method: string = 'GET', body?: any) {
  const key = generateRequestKey({ method, endpoint, body });
  pendingRequests.delete(key);
}

/**
 * 获取缓存统计信息（用于调试）
 */
export function getCacheStats() {
  return {
    cacheSize: requestCache.size,
    pendingSize: pendingRequests.size,
    cacheKeys: Array.from(requestCache.keys()),
    pendingKeys: Array.from(pendingRequests.keys()),
  };
}
