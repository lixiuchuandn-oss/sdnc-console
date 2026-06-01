import { Router, Response, type RequestHandler } from 'express';
import { AppDataSource } from '../../config/database';
import { Cloud } from '../../entities/Cloud';
import { AuthRequest } from '../../middleware/auth';
import { logger } from '../../utils/logger';
import {
  buildClusterInfoView,
  countRunningModels,
  getXinferenceContext,
  normalizeClusterDeviceInfo,
  normalizeClusterVersion,
  xinferenceGet,
} from '../../services/clouds/xinference/xinferenceClient';

const log = logger.child('XinferenceCluster');

async function fetchXinferenceCloudOr404(id: string, res: Response): Promise<Cloud | null> {
  const cloud = await AppDataSource.getRepository(Cloud).findOne({ where: { id } });
  if (!cloud) {
    res.status(404).json({ message: '云资源不存在' });
    return null;
  }
  const provider = String(cloud.config?.provider || '').toLowerCase();
  if (provider !== 'xinference') {
    res.status(400).json({ message: '仅 Xinference 资源池支持该接口' });
    return null;
  }
  return cloud;
}

/**
 * GET /api/clouds/:id/xinference/cluster
 * 聚合 cluster/info（detailed）、cluster/version 与运行中模型数量。
 */
export function attachXinferenceClusterRoutes(router: Router, perm: RequestHandler): void {
  router.get('/:id/xinference/cluster', perm, async (req: AuthRequest, res: Response) => {
    try {
      const cloud = await fetchXinferenceCloudOr404(req.params.id, res);
      if (!cloud) return;
      const ctx = getXinferenceContext(cloud);
      if (!ctx) {
        res.status(400).json({ message: '缺少 Xinference 服务地址' });
        return;
      }

      const [clusterInfoRes, versionRes, modelsRes] = await Promise.all([
        xinferenceGet(ctx, '/v1/cluster/info?detailed=true', { timeout: 25_000 }),
        xinferenceGet(ctx, '/v1/cluster/version', { timeout: 10_000 }),
        // 模型列表在加载权重时可能长时间阻塞；仪表板不应因此整页挂起
        xinferenceGet(ctx, '/v1/models', { timeout: 8_000 }),
      ]);

      if (!clusterInfoRes.ok) {
        res.status(clusterInfoRes.status === 401 ? 401 : 502).json({
          message:
            clusterInfoRes.message || '拉取 Xinference 集群设备信息失败（需 admin 权限 API 令牌）',
        });
        return;
      }

      const nodes = normalizeClusterDeviceInfo(clusterInfoRes.data);
      const version = versionRes.ok ? normalizeClusterVersion(versionRes.data) : {};
      const view = buildClusterInfoView(nodes, version);
      const runningModelCount = modelsRes.ok ? countRunningModels(modelsRes.data) : 0;

      res.json({
        endpoint: ctx.origin,
        supervisor: view.supervisor,
        workersSummary: view.workersSummary,
        workerDetails: view.workerDetails,
        runningModelCount,
        versionError: versionRes.ok ? undefined : versionRes.message,
        modelsError: modelsRes.ok ? undefined : modelsRes.message,
      });
    } catch (error: any) {
      log.error('Xinference cluster fetch failed', error?.message ?? String(error));
      res.status(500).json({ message: error?.message || '获取 Xinference 集群信息失败' });
    }
  });
}
