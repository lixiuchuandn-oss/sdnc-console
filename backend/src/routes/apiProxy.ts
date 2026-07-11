import express from 'express';
import axios from 'axios';
import https from 'https';
import crypto from 'crypto';
import { getCsmctlBaseUrl } from '../services/vrouter/csmctlEndpoint';
import { logger } from '../utils/logger';

const apiProxyLog = logger.child('Api-Proxy');

// 该路由模块负责将前端请求转发到 CSMCTL 等后端控制面服务，
// 同时本地实现 /api/sign 接口，用于在 CSMCTL 签名逻辑异常或不兼容时兜底，
// 确保「专家模式」等依赖签名能力的功能仍然可用。
const router = express.Router();

// 复用一个 HTTPS Agent，忽略目标服务的自签名证书错误
// 适用于在内网环境或 PoC/实验环境下部署的 CSMCTL，避免因证书问题导致代理失败
const agent = new https.Agent({ rejectUnauthorized: false });

// 本地实现 /api/sign 接口，用于在 CSMCTL 原生签名接口不可用时进行签名计算
// 前端会优先调用 /api-proxy/api/sign 来生成 Authorization 头和 tonce，避免直接暴露密钥给浏览器逻辑
router.post('/api/sign', (req, res) => {
  try {
    const { url, method, other, accessKey, secretKey } = req.query as any;

    // 基础参数校验：URL、HTTP 方法与 AK/SK 均为必填
    if (!url || !method || !accessKey || !secretKey) {
      return res
        .status(400)
        .json({ code: 400, message: 'Missing required parameters for signing' });
    }

    const ak = accessKey;
    const sk = secretKey;
    const tonce = (Date.now() * 1000).toString();

    // 根据请求体生成 MD5 摘要：
    // - 允许 body 为对象（常见）或字符串（前端可能传 JSON 字符串）
    // - GET/DELETE 不参与 body 签名
    const upperMethod = String(method || '').toUpperCase();
    let bodyRaw = '';
    if (upperMethod !== 'GET' && upperMethod !== 'DELETE') {
      const b: any = (req as any).body;
      if (typeof b === 'string') {
        bodyRaw = b;
      } else if (b && typeof b === 'object') {
        // 仅当对象有字段时才参与；空对象视为无 body
        if (Object.keys(b).length > 0) bodyRaw = JSON.stringify(b);
      }
    }
    const md5Body = bodyRaw ? crypto.createHash('md5').update(bodyRaw).digest('hex') : '';

    // 签名原始串格式：
    // METHOD|URL|TONCE|ACCESS_KEY|QUERY_PARAMS|BODY_HASH
    // 其中 other 字段用于承载额外参与签名的查询参数串（由前端或调用方拼接）
    const signStr = `${upperMethod}|${url}|${tonce}|${ak}|${other || ''}|${md5Body}`;

    const signHex = crypto.createHmac('sha256', sk).update(signStr).digest('hex');
    const rawStr = `${ak}:${signHex}`;
    const authBase64 = Buffer.from(rawStr).toString('base64');

    // 日志中仅输出 Authorization 前缀，避免泄露完整签名信息
    apiProxyLog.debug(`Local Sign: ${method} ${url} -> Auth: ${authBase64.substring(0, 10)}...`);

    res.json({
      code: 200,
      data: {
        Authorization: authBase64,
        tonce: Number(tonce),
      },
    });
  } catch (e: any) {
    // 本地签名计算失败时，视为服务器内部错误，不返回细节给前端
    console.error('[API Proxy] Local Sign Error:', e.message);
    res.status(500).json({ message: 'Local signing failed' });
  }
});

router.all('*', async (req, res) => {
  let csmAddress: string;
  try {
    csmAddress = getCsmctlBaseUrl();
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ message });
  }
  // 去掉末尾多余斜杠，避免与后续路由拼接时出现重复 //
  const targetBase = csmAddress;

  // 当该路由模块挂载在 /api-proxy 上时，req.url 为 /api-proxy 之后的子路径
  // 例如前端请求 /api-proxy/api/sign?foo=bar，此处能拿到 /api/sign?foo=bar
  const targetUrl = `${targetBase}${req.url}`;

  apiProxyLog.info(`${req.method} ${req.originalUrl} -> ${targetUrl}`);

  try {
    const config: any = {
      method: req.method,
      url: targetUrl,
      headers: {
        'Content-Type': req.headers['content-type'] || 'application/json',
        Accept: req.headers['accept'] || 'application/json',
        // 透传认证相关请求头（如 Authorization、tonce），保证后端鉴权链路完整
        ...(req.headers['authorization'] ? { Authorization: req.headers['authorization'] } : {}),
        ...(req.headers['tonce'] ? { tonce: req.headers['tonce'] } : {}),
      },
      responseType: 'stream',
      httpsAgent: agent,
      // validateStatus 返回 true，表示不在 axios 侧抛错，而是将状态码原样透传给调用方
      validateStatus: () => true,
    };

    // 仅对存在请求体且方法为写操作时透传 Body
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      // 此处假定上游已通过 express.json() 等中间件将 Body 解析为对象，直接透传给 axios 即可
      if (req.body && Object.keys(req.body).length > 0) {
        config.data = req.body;
      }
    }

    const response = await axios(config);

    // 将下游服务返回的状态码原样设置给前端
    res.status(response.status);

    // 透传下游服务的响应头，部分与 Express 冲突或由框架自动处理的头（如 Content-Length）需要跳过
    Object.entries(response.headers).forEach(([key, value]) => {
      if (['transfer-encoding', 'connection', 'content-length'].includes(key.toLowerCase())) return;
      if (value) res.setHeader(key, value as string);
    });

    // 使用流的方式将响应体直接 pipe 给前端，避免在代理层缓存大体积数据
    response.data.pipe(res);
  } catch (error: any) {
    apiProxyLog.error('Proxy Error:', error.message);
    // 代理层无法连接下游服务时，统一返回 502 Bad Gateway，并附带目标地址与错误信息
    if (!res.headersSent) {
      res.status(502).json({
        message: 'Proxy Error: Failed to connect to remote service',
        details: error.message,
        target: targetUrl,
      });
    }
  }
});

export default router;
