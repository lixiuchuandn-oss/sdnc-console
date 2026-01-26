import express from 'express';
import axios from 'axios';
import https from 'https';
import crypto from 'crypto';
import { getSystemSetting } from '../config/systemSettings';

const router = express.Router();
// Create a shared agent to reuse connections and ignore SSL errors
const agent = new https.Agent({ rejectUnauthorized: false });

// Local implementation of /api/sign to bypass CSMCTL signature issues
// This ensures that Expert Mode (which relies on /api-proxy/api/sign) works even if CSMCTL /api/sign is broken/incompatible
router.post('/api/sign', (req, res) => {
  try {
    const { url, method, other, accessKey, secretKey } = req.query as any;

    if (!url || !method || !accessKey || !secretKey) {
      return res
        .status(400)
        .json({ code: 400, message: 'Missing required parameters for signing' });
    }

    const ak = accessKey;
    const sk = secretKey;
    const tonce = (Date.now() * 1000).toString();

    let md5Body = '';
    if (req.body && Object.keys(req.body).length > 0) {
      if (method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'DELETE') {
        // Try to reproduce the body string for hashing
        // Note: This assumes JSON body. If strict consistency is needed, we might need raw body parsing.
        md5Body = crypto.createHash('md5').update(JSON.stringify(req.body)).digest('hex');
      }
    }

    // Sign String Format: METHOD|URL|TONCE|ACCESS_KEY|QUERY_PARAMS|BODY_HASH
    const signStr = `${method}|${url}|${tonce}|${ak}|${other || ''}|${md5Body}`;

    const signHex = crypto.createHmac('sha256', sk).update(signStr).digest('hex');
    const rawStr = `${ak}:${signHex}`;
    const authBase64 = Buffer.from(rawStr).toString('base64');

    console.log(
      `[API Proxy] Local Sign: ${method} ${url} -> Auth: ${authBase64.substring(0, 10)}...`,
    );

    res.json({
      code: 200,
      data: {
        Authorization: authBase64,
        tonce: Number(tonce),
      },
    });
  } catch (e: any) {
    console.error('[API Proxy] Local Sign Error:', e.message);
    res.status(500).json({ message: 'Local signing failed' });
  }
});

router.all('*', async (req, res) => {
  // 优先使用系统设置，如果未设置，则默认尝试本地回环地址（更稳健，适用于同机部署），
  // 如果本地不通，也可以回退到内网IP（保留旧默认值作为备选，但在代码逻辑中主要体现为默认值变更）
  const csmAddress = getSystemSetting('CSMCTL_ADDRESS') || 'https://127.0.0.1:8016';
  // Remove trailing slash
  const targetBase = csmAddress.replace(/\/+$/, '');

  // If mounted at /api-proxy, req.url is the path after /api-proxy (e.g. /api/sign?foo=bar)
  const targetUrl = `${targetBase}${req.url}`;

  console.log(`[API Proxy] ${req.method} ${req.originalUrl} -> ${targetUrl}`);

  try {
    const config: any = {
      method: req.method,
      url: targetUrl,
      headers: {
        'Content-Type': req.headers['content-type'] || 'application/json',
        Accept: req.headers['accept'] || 'application/json',
        // Pass auth headers if present
        ...(req.headers['authorization'] ? { Authorization: req.headers['authorization'] } : {}),
        ...(req.headers['tonce'] ? { tonce: req.headers['tonce'] } : {}),
      },
      responseType: 'stream',
      httpsAgent: agent,
      validateStatus: () => true, // Allow any status code to be passed back
    };

    // Handle body
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      // If body was already parsed by express.json(), we need to stringify it back
      // If it's empty or not parsed, we might need to handle streams, but for now assume JSON
      if (req.body && Object.keys(req.body).length > 0) {
        config.data = req.body;
      }
    }

    const response = await axios(config);

    // Set status
    res.status(response.status);

    // Forward headers
    Object.entries(response.headers).forEach(([key, value]) => {
      // Skip some headers that might conflict or be handled by Express
      if (['transfer-encoding', 'connection', 'content-length'].includes(key.toLowerCase())) return;
      if (value) res.setHeader(key, value as string);
    });

    // Pipe data
    response.data.pipe(res);
  } catch (error: any) {
    console.error('[API Proxy] Error:', error.message);
    // If it's a network error (e.g. target unreachable), return 502
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
