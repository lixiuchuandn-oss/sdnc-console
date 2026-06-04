/**
 * Docker Registry V2 API 客户端服务。
 * 用于将镜像推送到 Docker Registry。
 */
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { ParsedImage, buildRegistryManifest } from './ImageTarParser';

export interface PushProgress {
  phase: 'checking' | 'uploading' | 'pushing_manifest' | 'completed' | 'error';
  current: number;
  total: number;
  currentBlob?: string;
  message?: string;
}

export type ProgressCallback = (progress: PushProgress) => void;

export interface RegistryPushOptions {
  server: string;
  repository: string;
  tag: string;
  insecure?: boolean;
  rejectUnauthorized?: boolean;
  username?: string;
  password?: string;
}

interface BearerChallenge {
  realm: string;
  service?: string;
  scope?: string;
}

/**
 * 解析 Www-Authenticate Bearer challenge 头部
 */
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

/**
 * 向 Harbor/Registry Token 服务获取 Bearer Token
 */
async function getBearerToken(
  realm: string,
  service: string | undefined,
  scope: string | undefined,
  username: string,
  password: string,
  insecure: boolean,
  rejectUnauthorized?: boolean,
): Promise<string> {
  const basicAuth = Buffer.from(`${username}:${password}`).toString('base64');
  const params = new URLSearchParams();
  if (service) params.set('service', service);
  if (scope) params.set('scope', scope);

  const url = `${realm}?${params.toString()}`;
  const res = await httpRequest(url, 'GET', insecure, rejectUnauthorized, undefined, {
    Authorization: `Basic ${basicAuth}`,
  });

  if (res.status !== 200) {
    throw new Error(`获取 Bearer Token 失败: ${res.status} ${res.body.toString()}`);
  }

  const data = JSON.parse(res.body.toString());
  return data.token || data.access_token;
}

/**
 * 发送 HTTP 请求
 */
function httpRequest(
  url: string,
  method: string,
  insecure: boolean,
  rejectUnauthorized?: boolean,
  body?: Buffer,
  headers?: Record<string, string>,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const client = isHttps ? https : http;

    const allowInsecure = insecure || rejectUnauthorized === false;
    const agent =
      isHttps && allowInsecure ? new https.Agent({ rejectUnauthorized: false }) : undefined;

    const reqOptions: http.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers: headers || {},
      agent,
    };

    const req = client.request(reqOptions, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode || 0,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
    });

    req.on('error', reject);
    req.on('socket', (socket) => {
      socket.setTimeout(60000, () => {
        req.destroy(new Error('Request timeout'));
      });
    });

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

/**
 * 发送 Registry API 请求，自动处理 Bearer Token 认证
 */
async function registryRequest(
  url: string,
  method: string,
  insecure: boolean,
  rejectUnauthorized: boolean | undefined,
  body: Buffer | undefined,
  headers: Record<string, string>,
  username?: string,
  password?: string,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  const res = await httpRequest(url, method, insecure, rejectUnauthorized, body, headers);

  if (res.status !== 401 || !username || !password) return res;

  const wwwAuth = (res.headers['www-authenticate'] || '') as string;
  const challenge = parseBearerChallenge(wwwAuth);
  if (!challenge) return res;

  const token = await getBearerToken(
    challenge.realm,
    challenge.service,
    challenge.scope,
    username,
    password,
    insecure,
    rejectUnauthorized,
  );

  return httpRequest(url, method, insecure, rejectUnauthorized, body, {
    ...headers,
    Authorization: `Bearer ${token}`,
  });
}

/**
 * 检查 blob 是否存在
 */
async function checkBlobExists(
  server: string,
  repository: string,
  digest: string,
  insecure: boolean,
  rejectUnauthorized?: boolean,
  username?: string,
  password?: string,
): Promise<boolean> {
  try {
    const protocol = insecure ? 'http' : 'https';
    const url = `${protocol}://${server}/v2/${repository}/blobs/${digest}`;
    const res = await registryRequest(
      url,
      'HEAD',
      insecure,
      rejectUnauthorized,
      undefined,
      {},
      username,
      password,
    );
    return res.status === 200;
  } catch {
    return false;
  }
}

/**
 * 上传 blob 到 Registry
 */
async function uploadBlob(
  server: string,
  repository: string,
  digest: string,
  data: Buffer,
  insecure: boolean,
  rejectUnauthorized?: boolean,
  username?: string,
  password?: string,
  onProgress?: (uploaded: number, total: number) => void,
): Promise<void> {
  const protocol = insecure ? 'http' : 'https';

  const exists = await checkBlobExists(
    server,
    repository,
    digest,
    insecure,
    rejectUnauthorized,
    username,
    password,
  );
  if (exists) {
    onProgress?.(data.length, data.length);
    return;
  }

  const uploadUrl = `${protocol}://${server}/v2/${repository}/blobs/uploads/`;
  const startRes = await registryRequest(
    uploadUrl,
    'POST',
    insecure,
    rejectUnauthorized,
    Buffer.alloc(0),
    {
      'Content-Type': 'application/octet-stream',
      'Content-Length': '0',
    },
    username,
    password,
  );

  if (startRes.status !== 202) {
    throw new Error(`启动上传失败: ${startRes.status} ${startRes.body.toString()}`);
  }

  let location = startRes.headers['location'] as string;
  if (!location) {
    throw new Error('未获取到上传位置');
  }
  if (location.startsWith('/')) {
    location = `${protocol}://${server}${location}`;
  }

  const uploadRes = await registryRequest(
    `${location}${location.includes('?') ? '&' : '?'}digest=${digest}`,
    'PUT',
    insecure,
    rejectUnauthorized,
    data,
    {
      'Content-Type': 'application/octet-stream',
      'Content-Length': data.length.toString(),
    },
    username,
    password,
  );

  if (uploadRes.status !== 201) {
    throw new Error(`上传 blob 失败: ${uploadRes.status} ${uploadRes.body.toString()}`);
  }

  onProgress?.(data.length, data.length);
}

/**
 * 推送镜像 manifest
 */
async function pushManifest(
  server: string,
  repository: string,
  tag: string,
  manifest: Buffer,
  insecure: boolean,
  rejectUnauthorized?: boolean,
  username?: string,
  password?: string,
): Promise<void> {
  const protocol = insecure ? 'http' : 'https';
  const url = `${protocol}://${server}/v2/${repository}/manifests/${tag}`;

  const res = await registryRequest(
    url,
    'PUT',
    insecure,
    rejectUnauthorized,
    manifest,
    {
      'Content-Type': 'application/vnd.docker.distribution.manifest.v2+json',
    },
    username,
    password,
  );

  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`推送 manifest 失败: ${res.status} ${res.body.toString()}`);
  }
}

/**
 * 推送镜像到 Registry
 */
export async function pushImageToRegistry(
  parsedImage: ParsedImage,
  options: RegistryPushOptions,
  onProgress?: ProgressCallback,
): Promise<void> {
  const {
    server,
    repository,
    tag,
    insecure = false,
    rejectUnauthorized,
    username,
    password,
  } = options;
  const total = parsedImage.layers.length + 1;
  let current = 0;

  try {
    onProgress?.({
      phase: 'uploading',
      current: 0,
      total,
      currentBlob: 'config',
      message: '上传配置...',
    });

    await uploadBlob(
      server,
      repository,
      parsedImage.configDigest,
      parsedImage.configData,
      insecure,
      rejectUnauthorized,
      username,
      password,
    );
    current++;
    onProgress?.({
      phase: 'uploading',
      current,
      total,
      currentBlob: 'config',
      message: '配置上传完成',
    });

    for (let i = 0; i < parsedImage.layers.length; i++) {
      const layer = parsedImage.layers[i];
      onProgress?.({
        phase: 'uploading',
        current,
        total,
        currentBlob: layer.digest.substring(7, 19),
        message: `上传层 ${i + 1}/${parsedImage.layers.length}...`,
      });

      await uploadBlob(
        server,
        repository,
        layer.digest,
        layer.data!,
        insecure,
        rejectUnauthorized,
        username,
        password,
      );
      current++;
    }

    onProgress?.({
      phase: 'pushing_manifest',
      current,
      total,
      message: '推送 manifest...',
    });

    const manifest = buildRegistryManifest(parsedImage);
    const manifestBuffer = Buffer.from(JSON.stringify(manifest));
    await pushManifest(
      server,
      repository,
      tag,
      manifestBuffer,
      insecure,
      rejectUnauthorized,
      username,
      password,
    );

    onProgress?.({
      phase: 'completed',
      current: total,
      total,
      message: '推送完成',
    });
  } catch (error: any) {
    onProgress?.({
      phase: 'error',
      current,
      total,
      message: error.message,
    });
    throw error;
  }
}
