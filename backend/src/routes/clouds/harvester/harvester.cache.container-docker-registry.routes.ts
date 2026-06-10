/**
 * Harvester 容器路由 — Docker Registry V2 API 代理。
 */
import { Router, Response } from 'express';
import multer from 'multer';
import { fetchCloudOr404, ensureProvider } from './harvester.cache.helpers';
import { parseDockerImageFromBuffer } from '../../../services/ImageTarParser';
import { pushImageToRegistry } from '../../../services/DockerRegistryPusher';
import { probeRegistryConnection, registryApiRequest } from '../../../services/registryClient';

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

        await probeRegistryConnection(server, {
          username: username ? String(username) : undefined,
          password: password ? String(password) : undefined,
          insecure: ignoreTls,
        });

        res.json({
          message: '连接成功',
          data: { success: true, message: '仓库连接测试通过' },
        });
      } catch (error: any) {
        console.error('[Registry Test] Error:', error);
        res.json({
          message: '连接失败',
          data: {
            success: false,
            message: error?.message || '认证失败',
          },
        });
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
          const status =
            result.status && result.status >= 400 && result.status < 600 ? result.status : 502;
          res.status(status).json({
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

        let result = await registryRequest(
          String(server),
          path,
          username ? String(username) : undefined,
          password ? String(password) : undefined,
          ignoreTls,
        );

        // HTTPS 失败时，自动回退 HTTP 重试
        if (!result.success && !ignoreTls) {
          const errorMsg = result.error || '';
          if (
            errorMsg.includes('EPROTO') ||
            errorMsg.includes('SSL') ||
            errorMsg.includes('packet length')
          ) {
            console.log('[Registry Manifest] HTTPS failed, retrying with HTTP...');
            result = await registryRequest(
              String(server),
              path,
              username ? String(username) : undefined,
              password ? String(password) : undefined,
              true,
            );
          }
        }

        if (result.success) {
          res.json({
            message: '查询成功',
            data: result.data,
            digest: result.digest, // 返回 Docker-Content-Digest
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
   * Body: { server, repository, tag, username?, password?, insecure? }
   * 策略: GET manifest 获取 Docker-Content-Digest → DELETE by digest
   */
  router.delete(
    '/:id/resources/harvester/containers/registry/tag',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { server, repository, tag, username, password, insecure } = req.body;

        if (!server || !repository || !tag) {
          return res.status(400).json({ message: '缺少必要参数: server, repository, tag' });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        // 处理 insecure 参数
        let ignoreTls: boolean;
        if (insecure === true || insecure === 'true') {
          ignoreTls = true;
        } else if (insecure === false || insecure === 'false') {
          ignoreTls = false;
        } else {
          ignoreTls = !!(cloud.config as any)?.ignoreTls;
        }

        const isSslError = (error: string): boolean => {
          return (
            error.includes('EPROTO') || error.includes('SSL') || error.includes('packet length')
          );
        };

        // 1. 获取 manifest，拿到 Docker-Content-Digest
        const manifestPath = `/v2/${encodeURIComponent(repository)}/manifests/${encodeURIComponent(tag)}`;
        let manifestResult = await registryRequest(
          server,
          manifestPath,
          username,
          password,
          ignoreTls,
          'GET',
        );

        if (!manifestResult.success && !ignoreTls && isSslError(manifestResult.error || '')) {
          console.log('[Registry Delete] GET HTTPS failed, retrying with HTTP...');
          manifestResult = await registryRequest(
            server,
            manifestPath,
            username,
            password,
            true,
            'GET',
          );
        }

        if (!manifestResult.success) {
          return res.status(manifestResult.status || 500).json({
            message: '获取镜像 Manifest 失败',
            error: manifestResult.error,
          });
        }

        // 2. 用 manifest digest 执行删除
        const manifestDigest =
          manifestResult.digest || (manifestResult.data as { config?: { digest?: string } })?.config?.digest;
        if (!manifestDigest) {
          return res.status(400).json({ message: '无法获取镜像 digest' });
        }

        console.log(`[Registry Delete] Deleting by digest: ${manifestDigest}`);
        const deletePath = `/v2/${encodeURIComponent(repository)}/manifests/${encodeURIComponent(manifestDigest)}`;
        let deleteResult = await registryRequest(
          server,
          deletePath,
          username,
          password,
          ignoreTls,
          'DELETE',
        );

        if (!deleteResult.success && !ignoreTls && isSslError(deleteResult.error || '')) {
          console.log('[Registry Delete] DELETE HTTPS failed, retrying with HTTP...');
          deleteResult = await registryRequest(
            server,
            deletePath,
            username,
            password,
            true,
            'DELETE',
          );
        }

        if (deleteResult.success) {
          res.json({ message: '删除成功', data: deleteResult.data });
        } else {
          res.status(deleteResult.status || 500).json({
            message: '删除镜像失败',
            error: deleteResult.error,
          });
        }
      } catch (error: any) {
        console.error('[Registry Delete] Error:', error);
        res.status(500).json({ message: '删除镜像失败', error: error.message });
      }
    },
  );

  // 配置 multer 用于通用仓库上传
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 * 1024 },
  });

  /**
   * [API] 上传镜像到通用仓库
   * POST /:id/resources/harvester/containers/registry/upload
   * Form: file (tar), server, insecure, username?, password?, targetRepo?, targetTag?
   */
  router.post(
    '/:id/resources/harvester/containers/registry/upload',
    checkAdminPermission,
    upload.single('file'),
    async (req: any, res: Response) => {
      try {
        const { server, insecure, username, password, targetRepo, targetTag } = req.body;

        if (!req.file) {
          return res.status(400).json({ message: '请上传镜像 tar 文件' });
        }
        if (!server) {
          return res.status(400).json({ message: '缺少仓库地址' });
        }

        const parsedImage = await parseDockerImageFromBuffer(req.file.buffer);
        const repo = targetRepo || 'library';
        const tag = targetTag || parsedImage.repoTags[0]?.split(':')[1] || 'latest';

        const isInsecure = insecure === 'true' || insecure === true;

        try {
          await pushImageToRegistry(parsedImage, {
            server: String(server),
            repository: repo,
            tag,
            insecure: isInsecure,
            username: username || undefined,
            password: password || undefined,
          });
        } catch (pushError: any) {
          // HTTPS 连接失败时，自动回退 HTTP 重试
          if (
            !isInsecure &&
            (pushError.code === 'EPROTO' ||
              pushError.code === 'ECONNRESET' ||
              String(pushError.message).includes('SSL'))
          ) {
            console.log('[上传镜像] HTTPS 失败, 回退 HTTP 重试...');
            await pushImageToRegistry(parsedImage, {
              server: String(server),
              repository: repo,
              tag,
              insecure: true,
              username: username || undefined,
              password: password || undefined,
            });
          } else {
            throw pushError;
          }
        }

        res.json({ message: '上传成功', data: { repo, tag } });
      } catch (error: any) {
        console.error('[上传镜像] 错误:', error);
        res.status(500).json({ message: '上传失败', error: error.message });
      }
    },
  );
};

const registryRequest = (
  server: string,
  path: string,
  username?: string,
  password?: string,
  insecure: boolean = false,
  method: string = 'GET',
) =>
  registryApiRequest(server, path, {
    username,
    password,
    insecure,
    method,
  });
