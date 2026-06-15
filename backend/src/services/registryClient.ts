import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { buildRegistryBasicAuthHeader } from './registryHtpasswd';

export interface RegistryRequestOptions {
  username?: string;
  password?: string;
  insecure?: boolean;
  method?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface RegistryRequestResult {
  success: boolean;
  status?: number;
  data?: unknown;
  error?: string;
  digest?: string;
}

interface BearerChallenge {
  realm: string;
  service?: string;
  scope?: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;

/** 提取 host:port，兼容带路径的错误地址 */
export function normalizeRegistryHost(server: string): string {
  let normalized = server.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const match = normalized.match(/^([^:/]+)(?::(\d+))?/);
  if (match) {
    const hostname = match[1];
    let port = match[2];
    if (!port) {
      const portMatch = normalized.match(/:(\d+)/);
      if (portMatch) port = portMatch[1];
    }
    return port ? `${hostname}:${port}` : hostname;
  }
  return normalized;
}

function buildRegistryUrl(server: string, path: string, insecure: boolean): string {
  const host = normalizeRegistryHost(server);
  const protocol = insecure ? 'http' : 'https';
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${protocol}://${host}${normalizedPath}`;
}

function parseBearerChallenge(wwwAuth: string): BearerChallenge | null {
  if (!wwwAuth.startsWith('Bearer ')) return null;
  const paramsStr = wwwAuth.substring(7);
  const result: BearerChallenge = { realm: '' };

  const realmMatch = paramsStr.match(/realm="([^"]+)"/);
  if (realmMatch) result.realm = realmMatch[1];

  const serviceMatch = paramsStr.match(/service="([^"]+)"/);
  if (serviceMatch) result.service = serviceMatch[1];

  const scopeMatch = paramsStr.match(/scope="([^"]+)"/);
  if (scopeMatch) result.scope = scopeMatch[1];

  return result.realm ? result : null;
}

function httpRequest(
  url: string,
  method: string,
  insecure: boolean,
  body: Buffer | undefined,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const client = isHttps ? https : http;
    const agent =
      isHttps && insecure ? new https.Agent({ rejectUnauthorized: false }) : undefined;

    const req = client.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method,
        headers,
        agent,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('连接超时'));
      reject(new Error('连接超时'));
    });

    if (body) req.write(body);
    req.end();
  });
}

async function getBearerToken(
  challenge: BearerChallenge,
  username: string,
  password: string,
  insecure: boolean,
  fallbackScope?: string,
): Promise<string> {
  const params = new URLSearchParams();
  if (challenge.service) params.set('service', challenge.service);
  const scope = challenge.scope || fallbackScope;
  if (scope) params.set('scope', scope);

  const tokenUrl = `${challenge.realm}?${params.toString()}`;
  const res = await httpRequest(
    tokenUrl,
    'GET',
    insecure,
    undefined,
    {
      Accept: 'application/json',
      Authorization: buildRegistryBasicAuthHeader(username, password),
    },
    15_000,
  );

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`获取 Bearer Token 失败: HTTP ${res.status}`);
  }

  const data = JSON.parse(res.body.toString('utf-8'));
  const token = data.token || data.access_token;
  if (!token) {
    throw new Error('Token 响应解析失败');
  }
  return token;
}

function inferFallbackScope(path: string): string | undefined {
  if (path.includes('/_catalog')) {
    return 'registry:catalog:*';
  }
  const repoMatch = path.match(/^\/v2\/([^/]+(?:\/[^/]+)*)\/(?:tags\/list|manifests\/|blobs\/)/);
  if (repoMatch) {
    return `repository:${repoMatch[1]}:pull`;
  }
  return undefined;
}

function buildRequestHeaders(
  path: string,
  extraHeaders?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(extraHeaders || {}),
  };

  if (path.includes('/manifests/')) {
    headers.Accept =
      'application/vnd.docker.distribution.manifest.v2+json, application/vnd.docker.distribution.manifest.list.v2+json, application/json';
  }

  return headers;
}

/** 带 Basic / Bearer 自动重试的 Registry V2 API 请求 */
export async function registryApiRequest(
  server: string,
  path: string,
  options: RegistryRequestOptions = {},
): Promise<RegistryRequestResult> {
  const insecure = options.insecure ?? false;
  const method = options.method || 'GET';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = buildRegistryUrl(server, path, insecure);
  const headers = buildRequestHeaders(path, options.headers);

  const { username, password } = options;
  if (username && password) {
    headers.Authorization = buildRegistryBasicAuthHeader(username, password);
  }

  try {
    let res = await httpRequest(url, method, insecure, undefined, headers, timeoutMs);

    if (res.status === 401 && username && password) {
      const wwwAuth = String(res.headers['www-authenticate'] || '');
      const challenge = parseBearerChallenge(wwwAuth);
      if (challenge) {
        const token = await getBearerToken(
          challenge,
          username,
          password,
          insecure,
          inferFallbackScope(path),
        );
        res = await httpRequest(
          url,
          method,
          insecure,
          undefined,
          { ...headers, Authorization: `Bearer ${token}` },
          timeoutMs,
        );
      }
    }

    const digest = res.headers['docker-content-digest'] as string | undefined;
    const text = res.body.toString('utf-8');

    if (res.status >= 200 && res.status < 300) {
      try {
        return { success: true, status: res.status, data: JSON.parse(text), digest };
      } catch {
        return { success: true, status: res.status, data: text, digest };
      }
    }

    let errorMsg = `HTTP ${res.status}`;
    if (res.status === 401) {
      errorMsg = '认证失败，请检查用户名和密码';
    } else {
      try {
        const errorJson = JSON.parse(text);
        const err0 = errorJson.errors?.[0];
        errorMsg = err0?.message || errorMsg;
        const enclosed = err0?.detail?.Enclosed;
        if (enclosed?.Path) {
          errorMsg = `仓库存储异常，无法读取镜像目录: ${enclosed.Path}`;
        } else if (res.status === 500 && path.includes('/_catalog')) {
          errorMsg = '仓库 catalog 接口异常，可能是存储未初始化；若仅需验证连通性，请使用测试连接';
        }
      } catch {
        // ignore
      }
    }

    return { success: false, status: res.status, error: errorMsg };
  } catch (error: any) {
    return { success: false, error: error?.message || '请求失败' };
  }
}

/** 测试仓库连通性与认证（探测 /v2/，不依赖 catalog） */
export async function probeRegistryConnection(
  server: string,
  options?: { username?: string; password?: string; insecure?: boolean },
): Promise<void> {
  const result = await registryApiRequest(server, '/v2/', {
    username: options?.username,
    password: options?.password,
    insecure: options?.insecure ?? true,
    timeoutMs: 15_000,
  });

  if (!result.success) {
    throw new Error(result.error || '连接失败');
  }
}

export async function probeRegistryCatalog(
  server: string,
  options?: { username?: string; password?: string; insecure?: boolean },
): Promise<void> {
  await probeRegistryConnection(server, options);

  const result = await registryApiRequest(server, '/v2/_catalog?n=1', {
    username: options?.username,
    password: options?.password,
    insecure: options?.insecure ?? true,
    timeoutMs: 15_000,
  });

  if (!result.success) {
    throw new Error(result.error || '获取仓库目录失败');
  }
}

export async function fetchRegistryCatalog(
  server: string,
  options?: {
    username?: string;
    password?: string;
    insecure?: boolean;
    n?: number | string;
    last?: string;
  },
): Promise<unknown> {
  const params: string[] = [];
  if (options?.n) params.push(`n=${options.n}`);
  if (options?.last) params.push(`last=${encodeURIComponent(options.last)}`);
  const path = params.length > 0 ? `/v2/_catalog?${params.join('&')}` : '/v2/_catalog';

  const result = await registryApiRequest(server, path, {
    username: options?.username,
    password: options?.password,
    insecure: options?.insecure ?? true,
    timeoutMs: 60_000,
  });

  if (!result.success) {
    throw new Error(result.error || '获取仓库目录失败');
  }

  return result.data;
}
