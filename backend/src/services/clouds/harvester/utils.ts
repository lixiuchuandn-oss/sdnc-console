import https from 'https';
import http from 'http';
import { URL } from 'url';
import axios from 'axios';

// 根据目标 URL 协议自动选择 http / https 模块
// - Harvester 在某些环境下可能使用 http（测试环境）或 https（生产环境）
// - 这里统一做一次解析，避免调用方关心协议差异
const getRequestModule = (target: string) => {
  try {
    const u = new URL(target);
    return u.protocol === 'http:' ? http : https;
  } catch {
    return https;
  }
};

// 仅做一次 GET 请求，用于健康检查或连通性探测，不关心响应体
// - 成功：ok=true，并带回 status
// - 失败：ok=false，并尽量返回错误码 / 错误信息
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

// 执行一次 JSON GET 请求，自动解析响应体并在常见错误场景下抛出结构化错误
// - silent=true 时仅返回错误，不打印 console.error，适合探测型调用
// - 对 Harvester 返回的非 2xx 响应统一封装为 { status, body, message }
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

// 以流式方式订阅 JSON 行事件（典型用于 K8s/Harvester 的 watch 接口）
// - target: 事件流 URL（通常是 watch=true 的接口）
// - callback: 每条 JSON 行解析成功后回调
// - onError: 连接中断或 HTTP 状态异常时回调
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
      // Check for non-2xx status codes (e.g. 401, 403, 404, 410, 500)
      console.log(`[Watch] Connected to ${target}, Status: ${res.statusCode}`);
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        if (onError) onError(new Error(`Stream HTTP Error ${res.statusCode}`));
        // Consume data to avoid memory leaks, then destroy
        res.resume(); 
        return;
      }

      let buffer = '';
      res.on('data', (chunk) => {
        // console.log(`[Watch] Data received: ${chunk.length} bytes`);
        buffer += chunk.toString('utf-8');
        const lines = buffer.split('\n');
        // Keep the last partial line in buffer
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

// 通用 JSON 请求工具，支持任意 HTTP 方法
// - 自动将 body 序列化为 JSON 并设置 Content-Type
// - 正常 2xx 响应尝试 JSON.parse，失败则返回原始文本
// - 非 2xx 响应统一 reject，携带 { status, body, message }
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
