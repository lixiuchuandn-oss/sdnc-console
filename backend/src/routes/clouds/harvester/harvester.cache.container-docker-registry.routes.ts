/**
 * Harvester 容器路由 — Docker Registry V2 API 代理。
 */
import { Router, Response } from 'express';
import { fetchCloudOr404, ensureProvider } from './harvester.cache.helpers';

export const registerHarvesterContainerDockerRegistryRoutes = (
  router: Router,
  checkAdminPermission: any,
): void => {
  // ============================================================
  // [Docker Registry V2 API 代理]
  // ============================================================

  /**
   * [API] 测试仓库连接
   * POST /:id/resources/harvester/containers/registry/test
   * Body: { server, username?, password? }
   */
  router.post(
    '/:id/resources/harvester/containers/registry/test',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { server, username, password, insecure } = req.body;

        if (!server) {
          return res.status(400).json({ message: '缺少必要参数: server' });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        // 使用云配置中的 TLS 设置作为默认值
        const ignoreTls = insecure ?? !!(cloud.config as any)?.ignoreTls;

        const authResult = await getRegistryAuth(server, username, password, ignoreTls);

        if (authResult.success) {
          res.json({
            message: '连接成功',
            data: { success: true, message: '仓库连接测试通过' },
          });
        } else {
          res.json({
            message: '连接失败',
            data: {
              success: false,
              message: authResult.error || '认证失败',
              wwwAuthenticate: authResult.wwwAuthenticate,
            },
          });
        }
      } catch (error: any) {
        console.error('[Registry Test] Error:', error);
        res.status(500).json({ message: '测试仓库连接失败', error: error.message });
      }
    },
  );

  /**
   * [API] 获取仓库目录（Catalog）
   * GET /:id/resources/harvester/containers/registry/catalog
   * Query: server, username?, password?, n?, last?
   * Docker Registry V2 API: GET /v2/_catalog
   */
  router.get(
    '/:id/resources/harvester/containers/registry/catalog',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { server, username, password, insecure, n, last } = req.query;

        if (!server) {
          return res.status(400).json({ message: '缺少必要参数: server' });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const ignoreTls =
          insecure === 'true' || insecure === '1' || !!(cloud.config as any)?.ignoreTls;

        // 构建请求路径，支持分页
        let path = '/v2/_catalog';
        const params: string[] = [];
        if (n) params.push(`n=${n}`);
        if (last) params.push(`last=${encodeURIComponent(String(last))}`);
        if (params.length > 0) path += '?' + params.join('&');

        const result = await registryRequest(
          String(server),
          path,
          username ? String(username) : undefined,
          password ? String(password) : undefined,
          ignoreTls,
        );

        if (result.success) {
          res.json({
            message: '查询成功',
            data: result.data,
          });
        } else {
          res.status(result.status || 500).json({
            message: '获取仓库目录失败',
            error: result.error,
          });
        }
      } catch (error: any) {
        console.error('[Registry Catalog] Error:', error);
        res.status(500).json({ message: '获取仓库目录失败', error: error.message });
      }
    },
  );

  /**
   * [API] 获取镜像标签列表
   * GET /:id/resources/harvester/containers/registry/tags
   * Query: server, repository, username?, password?
   * Docker Registry V2 API: GET /v2/{name}/tags/list
   */
  router.get(
    '/:id/resources/harvester/containers/registry/tags',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { server, repository, username, password, insecure, n, last } = req.query;

        if (!server || !repository) {
          return res.status(400).json({ message: '缺少必要参数: server, repository' });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const ignoreTls =
          insecure === 'true' || insecure === '1' || !!(cloud.config as any)?.ignoreTls;

        // 构建请求路径
        let path = `/v2/${encodeURIComponent(String(repository))}/tags/list`;
        const params: string[] = [];
        if (n) params.push(`n=${n}`);
        if (last) params.push(`last=${encodeURIComponent(String(last))}`);
        if (params.length > 0) path += '?' + params.join('&');

        const result = await registryRequest(
          String(server),
          path,
          username ? String(username) : undefined,
          password ? String(password) : undefined,
          ignoreTls,
        );

        if (result.success) {
          res.json({
            message: '查询成功',
            data: result.data,
          });
        } else {
          res.status(result.status || 500).json({
            message: '获取镜像标签失败',
            error: result.error,
          });
        }
      } catch (error: any) {
        console.error('[Registry Tags] Error:', error);
        res.status(500).json({ message: '获取镜像标签失败', error: error.message });
      }
    },
  );

  /**
   * [API] 获取镜像 Manifest
   * GET /:id/resources/harvester/containers/registry/manifest
   * Query: server, repository, tag, username?, password?
   * Docker Registry V2 API: GET /v2/{name}/manifests/{reference}
   */
  router.get(
    '/:id/resources/harvester/containers/registry/manifest',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { server, repository, tag, username, password, insecure } = req.query;

        if (!server || !repository || !tag) {
          return res.status(400).json({ message: '缺少必要参数: server, repository, tag' });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const ignoreTls =
          insecure === 'true' || insecure === '1' || !!(cloud.config as any)?.ignoreTls;

        // 构建请求路径: /v2/{name}/manifests/{reference}
        const path = `/v2/${encodeURIComponent(String(repository))}/manifests/${encodeURIComponent(String(tag))}`;

        const result = await registryRequest(
          String(server),
          path,
          username ? String(username) : undefined,
          password ? String(password) : undefined,
          ignoreTls,
        );

        if (result.success) {
          res.json({
            message: '查询成功',
            data: result.data,
          });
        } else {
          res.status(result.status || 500).json({
            message: '获取镜像 Manifest 失败',
            error: result.error,
          });
        }
      } catch (error: any) {
        console.error('[Registry Manifest] Error:', error);
        res.status(500).json({ message: '获取镜像 Manifest 失败', error: error.message });
      }
    },
  );

  /**
   * [API] 获取镜像配置（Config）
   * GET /:id/resources/harvester/containers/registry/config
   * Query: server, repository, digest, username?, password?
   * Docker Registry V2 API: GET /v2/{name}/blobs/{digest}
   */
  router.get(
    '/:id/resources/harvester/containers/registry/config',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { server, repository, digest, username, password, insecure } = req.query;

        if (!server || !repository || !digest) {
          return res.status(400).json({ message: '缺少必要参数: server, repository, digest' });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const ignoreTls =
          insecure === 'true' || insecure === '1' || !!(cloud.config as any)?.ignoreTls;

        // 构建请求路径: /v2/{name}/blobs/{digest}
        const path = `/v2/${encodeURIComponent(String(repository))}/blobs/${encodeURIComponent(String(digest))}`;

        const result = await registryRequest(
          String(server),
          path,
          username ? String(username) : undefined,
          password ? String(password) : undefined,
          ignoreTls,
        );

        if (result.success) {
          res.json({
            message: '查询成功',
            data: result.data,
          });
        } else {
          res.status(result.status || 500).json({
            message: '获取镜像配置失败',
            error: result.error,
          });
        }
      } catch (error: any) {
        console.error('[Registry Config] Error:', error);
        res.status(500).json({ message: '获取镜像配置失败', error: error.message });
      }
    },
  );

  /**
   * [API] 删除镜像标签
   * DELETE /:id/resources/harvester/containers/registry/tag
   * Body: { server, repository, digest, username?, password? }
   * Docker Registry V2 API: DELETE /v2/{name}/manifests/{digest}
   */
  router.delete(
    '/:id/resources/harvester/containers/registry/tag',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { server, repository, digest, username, password, insecure } = req.body;

        if (!server || !repository || !digest) {
          return res.status(400).json({ message: '缺少必要参数: server, repository, digest' });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const ignoreTls = insecure ?? !!(cloud.config as any)?.ignoreTls;

        // 构建请求路径: /v2/{name}/manifests/{digest}
        const path = `/v2/${encodeURIComponent(repository)}/manifests/${encodeURIComponent(digest)}`;

        const result = await registryRequest(server, path, username, password, ignoreTls, 'DELETE');

        if (result.success) {
          res.json({
            message: '删除成功',
            data: result.data,
          });
        } else {
          res.status(result.status || 500).json({
            message: '删除镜像失败',
            error: result.error,
          });
        }
      } catch (error: any) {
        console.error('[Registry Delete] Error:', error);
        res.status(500).json({ message: '删除镜像失败', error: error.message });
      }
    },
  );
};

// ============================================================
// [Docker Registry V2 API 代理] — 辅助函数
// ============================================================

/**
 * [辅助函数] Docker Registry V2 API 认证处理器
 *
 * Docker Registry V2 支持两种认证方式：
 * 1. Basic Auth: 直接使用 username:password
 * 2. Bearer Token: 通过 WWW-Authenticate 响应头获取 token 端点
 *
 * @param server 仓库服务器地址
 * @param username 用户名（可选）
 * @param password 密码（可选）
 * @param insecure 是否忽略 TLS
 * @returns 认证信息或 token
 */
interface RegistryAuthResult {
  success: boolean;
  authHeader?: string; // Authorization header value
  token?: string; // Bearer token (如果使用 token 认证)
  error?: string;
  wwwAuthenticate?: string; // WWW-Authenticate header value
}

/**
 * [辅助函数] 解析 WWW-Authenticate 响应头
 * 格式: Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:library/alpine:pull"
 */
const parseWwwAuthenticate = (header: string): Record<string, string> => {
  const result: Record<string, string> = {};

  // 提取认证类型
  const match = header.match(/^(\w+)\s+(.*)$/);
  if (!match) return result;

  result['type'] = match[1].toLowerCase();

  // 解析参数
  const params = match[2];
  const regex = /(\w+)="([^"]*)"/g;
  let paramMatch;
  while ((paramMatch = regex.exec(params)) !== null) {
    result[paramMatch[1]] = paramMatch[2];
  }

  return result;
};

/**
 * [辅助函数] 获取 Docker Registry 认证信息
 */
const getRegistryAuth = async (
  server: string,
  username?: string,
  password?: string,
  insecure: boolean = false,
): Promise<RegistryAuthResult> => {
  const https = await import('https');
  const http = await import('http');

  // 规范化服务器地址
  let normalizedServer = server.replace(/\/+$/, '');
  if (!normalizedServer.startsWith('http://') && !normalizedServer.startsWith('https://')) {
    // insecure=true 时使用 HTTP，否则使用 HTTPS
    normalizedServer = insecure ? `http://${normalizedServer}` : `https://${normalizedServer}`;
  }

  const urlModule = await import('url');
  const parsedUrl = new urlModule.URL(normalizedServer);
  const lib = parsedUrl.protocol === 'https:' ? https : http;

  return new Promise((resolve) => {
    // 构建基础认证头
    let authHeader = '';
    if (username && password) {
      authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    }

    const options: any = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: '/v2/',
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
    };

    if (insecure && parsedUrl.protocol === 'https:') {
      options.rejectUnauthorized = false;
    }

    const req = lib.request(options, (res: any) => {
      // 2xx 表示认证成功（公开仓库可能不需要认证）
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        resolve({
          success: true,
          authHeader: authHeader || undefined,
        });
        return;
      }

      // 401 表示需要认证，检查 WWW-Authenticate 头
      if (res.statusCode === 401) {
        const wwwAuth = res.headers['www-authenticate'];

        if (wwwAuth) {
          const authParams = parseWwwAuthenticate(wwwAuth);

          if (authParams['type'] === 'bearer' && authParams['realm']) {
            // 需要获取 Bearer Token
            resolve({
              success: false,
              wwwAuthenticate: wwwAuth,
              error: '需要 Bearer Token 认证',
            });
            return;
          }

          if (authParams['type'] === 'basic') {
            // 需要 Basic Auth
            if (username && password) {
              resolve({
                success: true,
                authHeader: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
              });
            } else {
              resolve({
                success: false,
                wwwAuthenticate: wwwAuth,
                error: '需要用户名和密码',
              });
            }
            return;
          }
        }

        resolve({
          success: false,
          error: '认证失败：无效的认证信息',
        });
        return;
      }

      resolve({
        success: false,
        error: `连接失败: HTTP ${res.statusCode}`,
      });
    });

    req.setTimeout(15000, () => {
      req.destroy(new Error('timeout'));
      resolve({ success: false, error: '连接超时' });
    });

    req.on('error', (err: any) => {
      resolve({
        success: false,
        error: err.message || '连接失败',
      });
    });

    req.end();
  });
};

/**
 * [辅助函数] 获取 Bearer Token
 */
const getBearerToken = async (
  realm: string,
  service: string,
  scope: string,
  username?: string,
  password?: string,
  insecure: boolean = false,
): Promise<{ success: boolean; token?: string; error?: string }> => {
  const https = await import('https');
  const http = await import('http');
  const urlModule = await import('url');

  // 构建 token 请求 URL
  const tokenUrl = new urlModule.URL(realm);
  tokenUrl.searchParams.set('service', service);
  tokenUrl.searchParams.set('scope', scope);

  const lib = tokenUrl.protocol === 'https:' ? https : http;

  const options: any = {
    hostname: tokenUrl.hostname,
    port: tokenUrl.port || (tokenUrl.protocol === 'https:' ? 443 : 80),
    path: tokenUrl.pathname + tokenUrl.search,
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  };

  // 添加 Basic Auth（如果提供）
  if (username && password) {
    options.headers['Authorization'] =
      `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  }

  if (insecure && tokenUrl.protocol === 'https:') {
    options.rejectUnauthorized = false;
  }

  return new Promise((resolve) => {
    const req = lib.request(options, (res: any) => {
      let data = '';
      res.on('data', (chunk: string) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const json = JSON.parse(data);
            resolve({ success: true, token: json.access_token || json.token });
          } catch {
            resolve({ success: false, error: 'Token 响应解析失败' });
          }
        } else {
          resolve({ success: false, error: `获取 Token 失败: HTTP ${res.statusCode}` });
        }
      });
    });

    req.setTimeout(15000, () => {
      req.destroy(new Error('timeout'));
      resolve({ success: false, error: '获取 Token 超时' });
    });

    req.on('error', (err: any) => {
      resolve({ success: false, error: err.message || '获取 Token 失败' });
    });

    req.end();
  });
};

/**
 * [辅助函数] 带认证的 Docker Registry API 请求
 */
const registryRequest = async (
  server: string,
  path: string,
  username?: string,
  password?: string,
  insecure: boolean = false,
  method: string = 'GET',
): Promise<{ success: boolean; data?: any; status?: number; error?: string }> => {
  const https = await import('https');
  const http = await import('http');
  const urlModule = await import('url');

  // 规范化服务器地址
  let normalizedServer = server.replace(/\/+$/, '');
  if (!normalizedServer.startsWith('http://') && !normalizedServer.startsWith('https://')) {
    // insecure=true 时使用 HTTP，否则使用 HTTPS
    normalizedServer = insecure ? `http://${normalizedServer}` : `https://${normalizedServer}`;
  }

  // 首先尝试获取认证信息
  const authResult = await getRegistryAuth(normalizedServer, username, password, insecure);

  let authHeader = authResult.authHeader || '';

  // 如果需要 Bearer Token，先获取 token
  if (!authResult.success && authResult.wwwAuthenticate) {
    const authParams = parseWwwAuthenticate(authResult.wwwAuthenticate);

    if (authParams['type'] === 'bearer' && authParams['realm']) {
      // 从 path 提取 scope
      let scope = 'repository:library:pull';

      // 解析 path 获取仓库信息用于构建 scope
      const pathParts = path.replace('/v2/', '').split('/');
      if (pathParts.length > 1) {
        // 例如: /v2/library/alpine/tags/list -> scope: repository:library/alpine:pull
        const manifestOrTags = pathParts.findIndex((p) => p === 'tags' || p === 'manifests');
        if (manifestOrTags > 0) {
          const repoPath = pathParts.slice(0, manifestOrTags).join('/');
          scope = `repository:${repoPath}:pull`;
        }
      }

      const tokenResult = await getBearerToken(
        authParams['realm'],
        authParams['service'] || '',
        scope,
        username,
        password,
        insecure,
      );

      if (!tokenResult.success) {
        return { success: false, error: tokenResult.error };
      }

      authHeader = `Bearer ${tokenResult.token}`;
    } else if (!authResult.success) {
      return { success: false, error: authResult.error };
    }
  }

  // 执行实际请求
  const fullUrl = new urlModule.URL(normalizedServer);
  const lib = fullUrl.protocol === 'https:' ? https : http;

  const options: any = {
    hostname: fullUrl.hostname,
    port: fullUrl.port || (fullUrl.protocol === 'https:' ? 443 : 80),
    path: path,
    method: method,
    headers: {
      Accept: 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
  };

  // 对于 manifest 请求，添加额外的 Accept 头
  if (path.includes('/manifests/')) {
    options.headers['Accept'] =
      'application/vnd.docker.distribution.manifest.v2+json, application/vnd.docker.distribution.manifest.list.v2+json, application/json';
  }

  if (insecure && fullUrl.protocol === 'https:') {
    options.rejectUnauthorized = false;
  }

  return new Promise((resolve) => {
    const req = lib.request(options, (res: any) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const text = buffer.toString('utf-8');
        const status = res.statusCode || 0;

        if (status >= 200 && status < 300) {
          try {
            resolve({ success: true, data: JSON.parse(text), status });
          } catch {
            // 如果不是 JSON，返回原始文本
            resolve({ success: true, data: text, status });
          }
        } else {
          // 尝试解析错误信息
          let errorMsg = `HTTP ${status}`;
          try {
            const errorJson = JSON.parse(text);
            errorMsg = errorJson.errors?.[0]?.message || errorMsg;
          } catch {}
          resolve({ success: false, error: errorMsg, status });
        }
      });
    });

    req.setTimeout(60000, () => {
      req.destroy(new Error('timeout'));
      resolve({ success: false, error: '请求超时' });
    });

    req.on('error', (err: any) => {
      resolve({ success: false, error: err.message || '请求失败' });
    });

    req.end();
  });
};
