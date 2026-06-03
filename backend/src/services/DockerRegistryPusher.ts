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
  username?: string;
  password?: string;
}

/**
 * 发送 HTTP 请求
 */
function httpRequest(
  url: string,
  method: string,
  insecure: boolean,
  body?: Buffer,
  headers?: Record<string, string>,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const client = isHttps ? https : http;

    const agent = isHttps && insecure ? new https.Agent({ rejectUnauthorized: false }) : undefined;

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
 * 检查 blob 是否存在
 */
async function checkBlobExists(
  server: string,
  repository: string,
  digest: string,
  insecure: boolean,
): Promise<boolean> {
  try {
    const protocol = insecure ? 'http' : 'https';
    const url = `${protocol}://${server}/v2/${repository}/blobs/${digest}`;
    const res = await httpRequest(url, 'HEAD', insecure);
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
  onProgress?: (uploaded: number, total: number) => void,
): Promise<void> {
  const protocol = insecure ? 'http' : 'https';

  // 检查是否已存在
  const exists = await checkBlobExists(server, repository, digest, insecure);
  if (exists) {
    onProgress?.(data.length, data.length);
    return;
  }

  // 开始上传
  const uploadUrl = `${protocol}://${server}/v2/${repository}/blobs/uploads/`;
  const startRes = await httpRequest(uploadUrl, 'POST', insecure, undefined, {
    'Content-Type': 'application/octet-stream',
  });

  if (startRes.status !== 202) {
    throw new Error(`启动上传失败: ${startRes.status}`);
  }

  // 获取上传 URL
  let location = startRes.headers['location'] as string;
  if (!location) {
    throw new Error('未获取到上传位置');
  }
  if (location.startsWith('/')) {
    location = `${protocol}://${server}${location}`;
  }

  // 上传数据
  const uploadRes = await httpRequest(
    `${location}${location.includes('?') ? '&' : '?'}digest=${digest}`,
    'PUT',
    insecure,
    data,
    {
      'Content-Type': 'application/octet-stream',
      'Content-Length': data.length.toString(),
    },
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
): Promise<void> {
  const protocol = insecure ? 'http' : 'https';
  const url = `${protocol}://${server}/v2/${repository}/manifests/${tag}`;

  const res = await httpRequest(url, 'PUT', insecure, manifest, {
    'Content-Type': 'application/vnd.docker.distribution.manifest.v2+json',
  });

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
  const { server, repository, tag, insecure = false } = options;
  const total = parsedImage.layers.length + 1; // layers + config + manifest
  let current = 0;

  try {
    // 上传配置
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
    );
    current++;
    onProgress?.({
      phase: 'uploading',
      current,
      total,
      currentBlob: 'config',
      message: '配置上传完成',
    });

    // 上传每一层
    for (let i = 0; i < parsedImage.layers.length; i++) {
      const layer = parsedImage.layers[i];
      onProgress?.({
        phase: 'uploading',
        current,
        total,
        currentBlob: layer.digest.substring(7, 19),
        message: `上传层 ${i + 1}/${parsedImage.layers.length}...`,
      });

      await uploadBlob(server, repository, layer.digest, layer.data!, insecure);
      current++;
    }

    // 推送 manifest
    onProgress?.({
      phase: 'pushing_manifest',
      current,
      total,
      message: '推送 manifest...',
    });

    const manifest = buildRegistryManifest(parsedImage);
    const manifestBuffer = Buffer.from(JSON.stringify(manifest));
    await pushManifest(server, repository, tag, manifestBuffer, insecure);

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
