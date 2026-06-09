/**
 * Harvester 容器路由 — Containerd Registry（Harvester Setting）配置。
 */
import { Router, Response } from 'express';
import { fetchCloudOr404, ensureProvider } from './harvester.cache.helpers';
import { getJsonOnce, requestJson } from '../../../services/clouds/harvester/utils';
import { addInsecureRegistryToHarvesterContainerd } from './harvester.containerd-registry.helpers';

export const registerHarvesterContainerContainerdRegistryRoutes = (
  router: Router,
  checkAdminPermission: any,
): void => {
  // [Containerd Registry 配置] - 配置 HTTP 私有仓库
  // ============================================================

  /**
   * [API] 获取 containerd-registry 配置
   * GET /:id/resources/harvester/containers/containerd-registry
   */
  router.get(
    '/:id/resources/harvester/containers/containerd-registry',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        // 提取 origin（去掉路径部分）
        let origin = base.replace(/\/+$/, '');
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }

        // Harvester Setting API: /v1/harvester/harvesterhci.io.settings/containerd-registry
        const url = `${origin}/v1/harvester/harvesterhci.io.settings/containerd-registry`;
        const result = await getJsonOnce(url, token, insecure, true);

        res.json({ message: '查询成功', data: result });
      } catch (error: any) {
        console.error('[ContainerdRegistry] Error:', error);
        res
          .status(500)
          .json({ message: '查询 containerd-registry 配置失败', error: error.message });
      }
    },
  );

  /**
   * [API] 更新 containerd-registry 配置
   * PUT /:id/resources/harvester/containers/containerd-registry
   * Body: { value: { Mirrors: {...}, Configs: {...} } }
   */
  router.put(
    '/:id/resources/harvester/containers/containerd-registry',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { value } = req.body;

        if (!value) {
          return res.status(400).json({ message: '缺少必要参数: value' });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源配置')) return;

        const insecure = !!(cloud.config as any)?.ignoreTls;
        const token = cloud.secretKey || '';
        const base = cloud.endpoint || '';

        // 提取 origin（去掉路径部分）
        let origin = base.replace(/\/+$/, '');
        try {
          const u = new URL(base);
          origin = `${u.protocol}//${u.host}`;
        } catch {
          origin = base.replace(/\/v[0-9].*$/, '');
        }

        // 首先获取当前配置（获取 resourceVersion）
        const getUrl = `${origin}/v1/harvester/harvesterhci.io.settings/containerd-registry`;
        const current = await getJsonOnce(getUrl, token, insecure, true);
        const resourceVersion =
          (current as any)?.metadata?.resourceVersion || (current as any)?.resourceVersion;

        // 更新配置
        const body = {
          metadata: {
            name: 'containerd-registry',
            resourceVersion,
          },
          value: typeof value === 'string' ? value : JSON.stringify(value),
        };

        const putUrl = `${origin}/v1/harvester/harvesterhci.io.settings/containerd-registry`;
        const result = await requestJson('PUT', putUrl, token, insecure, body);

        console.log('[ContainerdRegistry] Updated successfully');
        res.json({
          message: '配置更新成功，请在每个节点上重启 containerd 服务使配置生效',
          data: result,
        });
      } catch (error: any) {
        console.error('[ContainerdRegistry] Update Error:', error);
        res
          .status(500)
          .json({ message: '更新 containerd-registry 配置失败', error: error.message });
      }
    },
  );

  /**
   * [API] 添加 HTTP 私有仓库到 containerd-registry
   * POST /:id/resources/harvester/containers/containerd-registry/insecure
   * Body: { server: string }
   * 快速添加一个 HTTP 私有仓库配置
   */
  router.post(
    '/:id/resources/harvester/containers/containerd-registry/insecure',
    checkAdminPermission,
    async (req: any, res: Response) => {
      try {
        const { id } = req.params;
        const { server } = req.body;

        if (!server) {
          return res.status(400).json({ message: '缺少必要参数: server' });
        }

        const cloud = await fetchCloudOr404(id, res);
        if (!cloud) return;
        if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源配置')) return;

        const result = await addInsecureRegistryToHarvesterContainerd(cloud, server);

        console.log(`[ContainerdRegistry] Added insecure registry: ${result.server}`);
        res.json({
          message: result.configured
            ? `已添加 HTTP 仓库 ${result.server}，节点将按 HTTP 拉取该仓库镜像`
            : `HTTP 仓库 ${result.server} 已在 containerd-registry 中配置`,
          data: result,
        });
      } catch (error: any) {
        console.error('[ContainerdRegistry] Add Insecure Error:', error);
        res.status(500).json({ message: '添加 HTTP 仓库配置失败', error: error.message });
      }
    },
  );
};
