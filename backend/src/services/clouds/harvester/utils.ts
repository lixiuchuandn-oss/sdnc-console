import https from 'https';
import http from 'http';
import { URL } from 'url';
import axios from 'axios';

const getRequestModule = (target: string) => {
  try {
    const u = new URL(target);
    return u.protocol === 'http:' ? http : https;
  } catch {
    return https;
  }
};

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

export const getJsonOnce = async (target: string, token: string, insecure: boolean = false) => {
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

export const watchJsonStream = (
  target: string,
  token: string,
  insecure: boolean,
  callback: (event: { type: string; object: any }) => void,
  onError?: (err: any) => void,
) => {
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
      // Check for non-2xx status codes (e.g. 401, 403, 404, 410, 500)
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        if (onError) onError(new Error(`Stream HTTP Error ${res.statusCode}`));
        // Consume data to avoid memory leaks, then destroy
        res.resume(); 
        return;
      }

      let buffer = '';
      res.on('data', (chunk) => {
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
            // ignore parse errors
          }
        }
      });
      res.on('end', () => {
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
  
  return {
    abort: () => {
      try {
        req.destroy();
      } catch {}
    }
  };
};

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
