import https from 'https';
import http from 'http';
import { URL } from 'url';
import { StringDecoder } from 'string_decoder';
import axios from 'axios';

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
 *
 * [API 依赖]
 * - Harvester/Kubernetes API (REST & Watch)
 * ==============================================================================
 */

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
 * [探针请求]
 * 仅做一次 GET 请求，用于健康检查或连通性探测，不关心响应体。
 *
 * [业务规则]
 * - 成功：ok=true，并带回 status
 * - 失败：ok=false，并尽量返回错误码 / 错误信息
 * - 超时：默认 15s 超时销毁请求
 *
 * @param target 探测目标 URL
 * @param token 鉴权 Token
 * @param insecure 是否忽略 SSL 证书验证
 * @returns Promise<{ ok: boolean; status?: number; code?: string; error?: string }>
 */
export const requestOnce = (target: string, token: string, insecure: boolean = false) => {
  return new Promise<{ ok: boolean; status?: number; code?: string; error?: string }>((resolve) => {
    const mod = getRequestModule(target);
    const req = mod.request(
      target,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
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
    req.on('error', (err: any) => resolve({ ok: false, error: err?.message, code: err?.code }));
    req.end();
  });
};

/**
 * [通用 GET 请求]
 * 执行一次 JSON GET 请求，自动解析响应体并在常见错误场景下抛出结构化错误。
 *
 * [错误处理]
 * - silent=true 时仅返回错误，不打印 console.error，适合探测型调用。
 * - 对 Harvester 返回的非 2xx 响应统一封装为 { status, body, message }。
 * - 处理 ECONNABORTED 等网络层错误。
 *
 * @param target 请求 URL
 * @param token 鉴权 Token
 * @param insecure 是否忽略 SSL 证书验证
 * @param silent 是否静默模式（不打印错误日志）
 * @returns Promise<any> 解析后的 JSON 数据
 */
export const getJsonOnce = async (target: string, token: string, insecure: boolean = false, silent: boolean = false) => {
  try {
    const res = await axios.get(target, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      httpsAgent: new https.Agent({ rejectUnauthorized: !insecure }),
      timeout: 15000,
      maxRedirects: 5,
    });
    return res.data;
  } catch (error: any) {
    if (axios.isAxiosError(error)) {
        if (error.response) {
            if (!silent) {
                console.error(`[Harvester] Request failed for ${target}: ${error.response.status}`);
            }
            throw {
                status: error.response.status,
                body: typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data),
                message: `HTTP ${error.response.status}`
            };
        } else if (error.code === 'ECONNABORTED') {
             throw { message: 'timeout' };
        }
    }
    throw error;
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
export const watchJsonStream = (
  target: string,
  token: string,
  insecure: boolean,
  callback: (event: { type: string; object: any }) => void,
  onError?: (err: any) => void,
) => {
  const mod = getRequestModule(target);
  console.log(`[Watch] Initiating request to ${target}`);
  const req = mod.request(
    target,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      rejectUnauthorized: !insecure,
    },
    (res) => {
      // [状态检查] 检查非 2xx 状态码 (如 401, 403, 404, 410, 500)
      console.log(`[Watch] Connected to ${target}, Status: ${res.statusCode}`);
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        if (onError) onError(new Error(`Stream HTTP Error ${res.statusCode}`));
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
            console.warn('[Watch] JSON Parse Error:', e, 'Line:', line.slice(0, 100));
          }
        }
      });
      res.on('end', () => {
        console.log(`[Watch] Stream ended for ${target}`);
        if (buffer.trim()) {
           try {
             const json = JSON.parse(buffer);
             callback(json);
           } catch {}
        }
        if (onError) onError(new Error('Stream ended'));
      });
      res.on('error', (err) => {
        if (onError) onError(err);
      });
    },
  );
  req.on('error', (err) => {
    if (onError) onError(err);
  });
  req.end();
  console.log(`[Watch] Request end called for ${target}`);
  
  return {
    abort: () => {
      try {
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
    const data = body ? Buffer.from(JSON.stringify(body)) : undefined;
    const mod = getRequestModule(target);
    const req = mod.request(
      target,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(data
            ? { 'Content-Type': 'application/json', 'Content-Length': String(data.length) }
            : {}),
          ...(customHeaders || {}),
        },
        rejectUnauthorized: !insecure,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (d) => chunks.push(Buffer.from(d)));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          const status = res.statusCode || 0;
          if (status >= 200 && status < 300) {
            try {
              resolve(JSON.parse(text));
            } catch {
              resolve(text);
            }
          } else {
            reject({ status, body: text, message: `HTTP ${status}` });
          }
        });
      },
    );
    req.setTimeout(15000, () => {
      req.destroy(new Error('timeout'));
      reject({ message: 'timeout' });
    });
    req.on('error', (err) => reject(err));
    if (data) req.write(data);
    req.end();
  });
};
