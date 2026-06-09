import * as http from 'http';
import * as https from 'https';
import { buildRegistryBasicAuthHeader } from './registryHtpasswd';

export async function probeRegistryCatalog(
  server: string,
  options?: { username?: string; password?: string; insecure?: boolean },
): Promise<void> {
  const insecure = options?.insecure ?? true;
  const normalized = server.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const protocol = insecure ? 'http' : 'https';
  const lib = insecure ? http : https;
  const path = '/v2/_catalog?n=1';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options?.username && options?.password) {
    headers.Authorization = buildRegistryBasicAuthHeader(options.username, options.password);
  }

  await new Promise<void>((resolve, reject) => {
    const req = lib.request(
      {
        hostname: normalized.split(':')[0],
        port: normalized.includes(':') ? Number(normalized.split(':')[1]) : undefined,
        path,
        method: 'GET',
        headers,
        timeout: 15000,
      },
      (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
          return;
        }
        if (res.statusCode === 401) {
          reject(new Error('认证失败，请检查用户名和密码'));
          return;
        }
        reject(new Error(`仓库返回 HTTP ${res.statusCode}`));
      },
    );
    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('连接超时'));
    });
    req.end();
  });
}
