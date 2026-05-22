import https from 'https';
import http from 'http';
import { URL } from 'url';
import { StringDecoder } from 'string_decoder';
import axios from 'axios';
import { logger } from '../../../utils/logger';

const watchLog = logger.child('watch');
const computeApiLog = logger.child('Compute-Api');

/**
 * ==============================================================================
 * 模块名称: Harvester API 通用请求工具库
 * 文件路径: backend/src/services/clouds/harvester/utils.ts
 * ==============================================================================
 *
 * [功能描述]
 * Harvester API 通用请求工具库。
 * 提供对 Harvester/K8s API 的底层 HTTP 封装，处理协议适配(HTTP/HTTPS)、鉴权注入、
 * 错误标准化处理及长连接流式监听。
 *
 * [核心逻辑]
 * 1. [协议适配]: 根据 URL 自动切换 http/https 模块，适配测试/生产环境。
 * 2. [统一鉴权]: 自动注入 Bearer Token 和标准 Headers。
 * 3. [错误封装]: 将 axios/http 错误转换为统一的结构化异常 { status, body, message }。
 * 4. [流式处理]: 封装 watch 机制，支持 JSON Stream 解析与断线回调。
 * 5. [连接优化]: 使用全局 Keep-Alive Agent 复用连接，减少握手开销。
 * 6. [重试机制]: 针对网络抖动 (ECONNRESET, ETIMEDOUT) 自动重试。
 *
 * [API 依赖]
 * - Harvester/Kubernetes API (REST & Watch)
 * ==============================================================================
 */

// [连接池优化] 定义全局 Keep-Alive Agent
const globalHttpAgent = new http.Agent({ keepAlive: true });
const globalSecureAgent = new https.Agent({ keepAlive: true, rejectUnauthorized: true });
const globalInsecureAgent = new https.Agent({ keepAlive: true, rejectUnauthorized: false });

/**
 * [协议适配]
 * 根据目标 URL 协议自动选择 http / https 模块。
 * Harvester 在某些环境下可能使用 http（测试环境）或 https（生产环境），
 * 此处统一做解析，避免调用方关心协议差异。
 *
 * @param target 目标 URL
 * @returns http 或 https 模块对象
 */
const getRequestModule = (target: string) => {
  try {
    const u = new URL(target);
    return u.protocol === 'http:' ? http : https;
  } catch {
    return https;
  }
};

/**
 * [Agent 获取]
 * 根据协议和安全设置获取对应的全局 Agent
 */
const getAgent = (target: string, insecure: boolean) => {
  try {
    const u = new URL(target);
    if (u.protocol === 'http:') return globalHttpAgent;
  } catch {}
  return insecure ? globalInsecureAgent : globalSecureAgent;
};

/**
 * 从 Kubernetes / Harvester API 错误体解析 Status.message（及 reason、details）。
 */
export function extractKubernetesStatusMessage(body: unknown): string {
  if (body == null) return '';
  if (typeof body === 'string') {
    const s = body.trim();
    if (!s) return '';
    try {
      return extractKubernetesStatusMessage(JSON.parse(s));
    } catch {
      return s.length > 800 ? `${s.slice(0, 800)}…` : s;
    }
  }
  if (typeof body !== 'object') return '';

  const b = body as Record<string, unknown>;
  const parts: string[] = [];

  const push = (v: unknown) => {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s && !parts.includes(s)) parts.push(s);
  };

  push(b.message);
  if (b.reason && b.reason !== b.message) push(b.reason);
  if (typeof b.status === 'string' && b.status !== 'Failure' && b.status !== b.message) {
    push(b.status);
  }

  if (Array.isArray(b.details)) {
    for (const d of b.details) {
      if (!d || typeof d !== 'object') continue;
      const item = d as Record<string, unknown>;
      push(item.message);
      if (Array.isArray(item.causes)) {
        for (const c of item.causes) {
          if (c && typeof c === 'object') {
            push((c as Record<string, unknown>).message);
          }
        }
      }
    }
  }

  if (b.error && typeof b.error === 'object') {
    const nested = extractKubernetesStatusMessage(b.error);
    if (nested && !parts.includes(nested)) parts.push(nested);
  }

  return parts.join('；');
}

/** 热迁移失败时返回给前端的统一文案（含集群 Status.message） */
export function formatVmMigrateFailureMessage(error: {
  status?: number;
  body?: unknown;
  message?: string;
}): string {
  const kubeMsg = extractKubernetesStatusMessage(error?.body);
  const raw = String(error?.message || '').trim();
  let detail = kubeMsg;
  if (!detail && raw && !/^HTTP \d+$/i.test(raw)) {
    detail = raw
      .replace(/^请求无效：/, '')
      .replace(/^权限不足：/, '')
      .replace(/^无法迁移：\s*/, '')
      .trim();
  }
  if (detail) {
    return `无法迁移：${detail.replace(/^无法迁移：\s*/, '')}`;
  }
  return '无法迁移：集群拒绝了本次热迁移请求，请检查虚拟机是否运行中、存储是否支持热迁移、目标节点是否满足调度与存储约束';
}

/**
 * [错误翻译]
 * 将常见的网络/系统错误代码转换为中文描述。
 */
const translateErrorMessage = (error: any): string => {
  const code = error?.code || error?.message;
  const status = error?.status;
  const kubeDetail = extractKubernetesStatusMessage(error?.body);

  if (status === 400) {
    return kubeDetail ? `请求无效：${kubeDetail}` : '请求无效：集群拒绝了该操作';
  }
  if (status === 422) {
    return kubeDetail ? `请求无法处理：${kubeDetail}` : '请求无法处理：参数或状态不符合要求';
  }
  if (status === 401) return '认证失败：Token 已过期或无效';
  if (status === 403) {
    return kubeDetail ? `权限不足：${kubeDetail}` : '权限不足：当前账号无权执行此操作';
  }
  if (status === 404) {
    return kubeDetail ? `资源未找到：${kubeDetail}` : '资源未找到：对象不存在或 API 路径不可用';
  }
  if (status === 409) {
    return kubeDetail
      ? `资源版本冲突：${kubeDetail}`
      : '资源版本冲突：对象有更新，请更新到最新的版本后重试';
  }
  if (status === 500) return '服务器内部错误：Harvester 集群响应异常';
  if (status === 502 || status === 503 || status === 504) return '网关错误：无法连接到 Harvester 控制平面';

  if (kubeDetail) return kubeDetail;

  switch (code) {
    case 'ECONNRESET':
      return '连接被重置：与 Harvester 的连接意外中断';
    case 'ETIMEDOUT':
    case 'timeout':
      return '请求超时：Harvester 响应过慢，请稍后重试';
    case 'ECONNREFUSED':
      return '连接被拒绝：无法访问 Harvester API 地址';
    case 'ENOTFOUND':
      return '域名解析失败：无法找到 Harvester 地址';
    case 'EPIPE':
      return '管道损坏：数据传输中断';
    default:
      return error?.message || '未知网络错误';
  }
};

/**
 * 资源池（Cloud）维度的 Harvester / Rancher Kube Bearer。
 * 与 `clouds.ts` 中 Cloudmap 连接测试一致：Cloudmap 常将 API 令牌放在 config.apiToken / config.token，
 * secretKey 可能与其它用途共存或为空；优先使用配置中的令牌，再回退 secretKey。
 */
export function resolveHarvesterCloudKubeToken(cloud: {
  secretKey?: string | null;
  config?: { apiToken?: string; token?: string } | null;
}): string {
  const cfg = (cloud?.config || {}) as { apiToken?: unknown; token?: unknown };
  const fromApi = typeof cfg.apiToken === 'string' ? cfg.apiToken.trim() : '';
  if (fromApi) return fromApi;
  const fromTok = typeof cfg.token === 'string' ? cfg.token.trim() : '';
  if (fromTok) return fromTok;
  return String(cloud?.secretKey || '').trim();
}

/**
 * [探针请求]
 * 仅做一次 GET 请求，用于健康检查或连通性探测，不关心响应体。
 */
export const requestOnce = (target: string, token: string, insecure: boolean = false) => {
  return new Promise<{ ok: boolean; status?: number; code?: string; error?: string }>((resolve) => {
    const mod = getRequestModule(target);
    const agent = getAgent(target, insecure);
    const req = mod.request(
      target,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        agent,
        rejectUnauthorized: !insecure,
      },
      (res) => {
        resolve({
          ok: res.statusCode ? res.statusCode >= 200 && res.statusCode < 300 : false,
          status: res.statusCode,
        });
      },
    );
    req.setTimeout(15000, () => {
      try {
        req.destroy(new Error('timeout'));
      } catch {}
    });
    req.on('error', (err: any) => resolve({ ok: false, error: translateErrorMessage(err), code: err?.code }));
    req.end();
  });
};

/**
 * [通用 GET 请求]
 * 执行一次 JSON GET 请求，自动解析响应体并在常见错误场景下抛出结构化错误。
 * @param target 请求URL
 * @param token 认证Token
 * @param insecure 是否跳过证书验证
 * @param silent 是否静默模式（不打印日志）
 * @param retryCount 重试次数
 * @param timeout 超时时间（毫秒），默认30秒
 */
export const getJsonOnce = async (
  target: string,
  token: string,
  insecure: boolean = false,
  silent: boolean = false,
  retryCount = 3,
  timeout: number = 30000
): Promise<any> => {
  try {
    const agent = getAgent(target, insecure);
    const isHttp = target.startsWith('http:');
    
    const res = await axios.get(target, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      httpAgent: isHttp ? agent : undefined,
      httpsAgent: !isHttp ? agent : undefined,
      timeout: timeout,
      maxRedirects: 5,
    });
    return res.data;
  } catch (error: any) {
    const isNetworkError = error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'EPIPE';
    if (isNetworkError && retryCount > 0) {
        if (!silent)
          computeApiLog.warn(`Network error ${error.code} for ${target}, retrying (${retryCount} left)...`);
        await new Promise(r => setTimeout(r, 500));
        return getJsonOnce(target, token, insecure, silent, retryCount - 1, timeout);
    }

    if (axios.isAxiosError(error)) {
        if (error.response) {
            if (!silent) {
                computeApiLog.error(`Request failed for ${target}: ${error.response.status}`);
            }
            throw {
                status: error.response.status,
                body: typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data),
                message: translateErrorMessage({ status: error.response.status, message: error.message })
            };
        } else if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
             throw { message: translateErrorMessage({ code: 'ETIMEDOUT' }) };
        }
    }
    throw { ...error, message: translateErrorMessage(error) };
  }
};

/**
 * [长连接监听]
 * 以流式方式订阅 JSON 行事件（典型用于 K8s/Harvester 的 watch 接口）。
 *
 * [流式处理]
 * - target: 事件流 URL（通常是 watch=true 的接口）
 * - callback: 每条 JSON 行解析成功后回调
 * - onError: 连接中断或 HTTP 状态异常时回调
 *
 * [核心逻辑]
 * 1. 建立长连接并处理 HTTP 状态码，非 2xx 直接报错。
 * 2. 监听 'data' 事件，按行缓冲并分割 JSON 数据块。
 * 3. 处理粘包/分包问题：保留最后未完整的行到 buffer。
 * 4. 监听 'end' 和 'error' 事件以确保资源释放和错误通知。
 *
 * @param target 监听 URL
 * @param token 鉴权 Token
 * @param insecure 是否忽略 SSL 证书验证
 * @param callback 数据回调
 * @param onError 错误回调
 * @returns { abort: () => void } 控制器对象
 */

/** 常见断开（关页、重连、上游结束），用于日志级别，不当作严重故障 */
export function isBenignWatchDisconnect(err: any): boolean {
  const code = err?.code || '';
  const msg = String(err?.message || err || '');
  if (code === 'ECONNRESET' || code === 'ECONNABORTED') return true;
  return /aborted|ECONNRESET|ECONNABORTED|context canceled|监听流已结束|socket hang up/i.test(msg);
}

export function logVmWatchStreamError(kind: 'vm' | 'vmi', err: any) {
  const label = kind === 'vm' ? '虚拟机' : 'VMI';
  const detail = { code: err?.code, message: err?.message };
  if (isBenignWatchDisconnect(err)) {
    watchLog.debug(
      `${label} 监听中断（多为页面关闭、网络重置或上游结束）`,
      detail,
    );
  } else {
    watchLog.error(`${label} 监听异常`, err);
  }
}

export const watchJsonStream = (
  target: string,
  token: string,
  insecure: boolean,
  callback: (event: { type: string; object: any }) => void,
  onError?: (err: any) => void,
) => {
  const mod = getRequestModule(target);
  const agent = getAgent(target, insecure);
  let aborted = false;
  watchLog.debug('正在建立长连接', target);
  const req = mod.request(
    target,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      agent,
      rejectUnauthorized: !insecure,
    },
    (res) => {
      // [状态检查] 检查非 2xx 状态码 (如 401, 403, 404, 410, 500)
      watchLog.debug('已连接', { statusCode: res.statusCode, url: target });
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        if (!aborted && onError) onError(new Error(`HTTP 状态异常: ${res.statusCode}`));
        // [资源释放] 消费剩余数据以避免内存泄漏，然后销毁连接
        res.resume(); 
        return;
      }

      let buffer = '';
      const decoder = new StringDecoder('utf8');

      res.on('data', (chunk) => {
        // console.log(`[Watch] Data received: ${chunk.length} bytes`);
        buffer += decoder.write(chunk);
        const lines = buffer.split('\n');
        // [粘包处理] 保留最后一行不完整的数据在 buffer 中，等待下一次 chunk 拼接
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const json = JSON.parse(line);
            callback(json);
          } catch (e) {
            watchLog.warn('JSON 解析失败', e, '片段:', line.slice(0, 100));
          }
        }
      });
      res.on('end', () => {
        watchLog.debug('响应流已结束', target);
        if (buffer.trim()) {
           try {
             const json = JSON.parse(buffer);
             callback(json);
           } catch {}
        }
        if (!aborted && onError) onError(new Error('监听流已结束'));
      });
      res.on('error', (err) => {
        if (!aborted && onError) onError(err);
      });
    },
  );
  req.on('error', (err) => {
    if (!aborted && onError) onError(err);
  });
  req.end();
  watchLog.debug('请求已发出', target);
  
  return {
    abort: () => {
      try {
        aborted = true;
        req.destroy();
      } catch {}
    }
  };
};

/**
 * [通用 JSON 请求]
 * 通用 JSON 请求工具，支持任意 HTTP 方法。
 *
 * [核心逻辑]
 * 1. 自动将 body 序列化为 JSON 并设置 Content-Type。
 * 2. 正常 2xx 响应尝试 JSON.parse，失败则返回原始文本。
 * 3. 非 2xx 响应统一 reject，携带 { status, body, message }。
 * 4. 设置 15s 硬超时。
 *
 * @param method HTTP 方法 (GET, POST, PUT, DELETE, PATCH)
 * @param target 请求 URL
 * @param token 鉴权 Token
 * @param insecure 是否忽略 SSL 证书验证
 * @param body 请求体数据
 * @param customHeaders 自定义 Headers
 * @returns Promise<any> 解析后的响应数据
 */
export const requestJson = (
  method: string,
  target: string,
  token: string,
  insecure: boolean = false,
  body?: any,
  customHeaders?: Record<string, string>,
) => {
  return new Promise<any>((resolve, reject) => {
    // 允许 body 为 null (无请求体)
    const data = body !== undefined ? Buffer.from(JSON.stringify(body)) : undefined;
    
    // 如果 body 是数组，data 也是 buffer。
    // 问题在于 headers 的构建方式。
    
    const mod = getRequestModule(target);
    const agent = getAgent(target, insecure);
    
    const defaultHeaders: any = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    };
    
    // 合并自定义 Header
    const finalHeaders = { ...defaultHeaders, ...(customHeaders || {}) };

    // 仅当有请求体时设置 Content-Type 和 Length (如果未被 customHeaders 覆盖)
    if (data) {
        if (!finalHeaders['Content-Type']) {
            finalHeaders['Content-Type'] = 'application/json';
        }
        finalHeaders['Content-Length'] = String(data.length);
    }

    const req = mod.request(
      target,
      {
        method,
        headers: finalHeaders,
        agent,
        rejectUnauthorized: !insecure,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (d) => chunks.push(Buffer.from(d)));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const text = buffer.toString('utf-8');
          const status = res.statusCode || 0;
          
          if (status >= 200 && status < 300) {
            try {
              resolve(JSON.parse(text));
            } catch {
              resolve(text);
            }
          } else {
            // 尝试解析错误体中的 JSON
            let errorBody = text;
            try { errorBody = JSON.parse(text); } catch {}
            
            reject({
              status,
              body: errorBody,
              message: translateErrorMessage({
                status,
                body: errorBody,
                message: `HTTP ${status}`,
              }),
            });
          }
        });
      },
    );
    req.setTimeout(15000, () => {
      req.destroy(new Error('timeout'));
      reject({ message: translateErrorMessage({ code: 'ETIMEDOUT' }) });
    });
    req.on('error', (err) => reject({ ...err, message: translateErrorMessage(err) }));
    if (data) req.write(data);
    req.end();
  });
};
