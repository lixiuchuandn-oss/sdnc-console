/**
 * Harbor 凭证同步路由
 *
 * 实现 Harbor 凭证同步到 Harvester 集群的 API，支持创建和更新 K8s Secret。
 */
import { Router, Response } from 'express';
import { AppDataSource } from '../../config/database';
import { HarborRegistry } from '../../entities/harbor/HarborRegistry';
import { Cloud } from '../../entities/Cloud';
import { AuthRequest } from '../../middleware/auth';
import { checkPermission } from '../../permissions';
import { logger } from '../../utils/logger';
import {
  deleteHarborPullSecret,
  isHarvesterCloud,
  listManagedHarborPullSecrets,
  upsertHarborPullSecret,
} from '../../services/harbor/HarborSecretSyncService';
import {
  harborRegistryCloudAccessMiddleware,
  HarborScopedRequest,
} from '../../services/harbor/harborRegistryCloudMiddleware';

const harborLog = logger.child('HarborSync');

const router = Router();

router.use('/registries/:id', harborRegistryCloudAccessMiddleware);

/**
 * 同步 Harbor 凭证到 Harvester 集群
 * POST /api/harbor/registries/:id/sync-secret
 */
router.post('/registries/:id/sync-secret', async (req: HarborScopedRequest, res: Response) => {
  try {
    const perms: string[] = Array.isArray((req.user as any)?.permissions)
      ? (req.user as any).permissions
      : [];
    if (!checkPermission(perms, 'harbor.registry:update')) {
      return res.status(403).json({ message: '权限不足' });
    }

    const { id } = req.params;
    const { cloudId, namespace, secretName } = req.body;

    if (!cloudId || !namespace) {
      return res.status(400).json({ message: '缺少必要参数: cloudId, namespace' });
    }

    const harbor = req.harborRegistry;
    if (!harbor) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }

    const cloudRepo = AppDataSource.getRepository(Cloud);
    const cloud = await cloudRepo.findOne({ where: { id: cloudId } });
    if (!cloud) {
      return res.status(404).json({ message: 'Harvester 云资源池不存在' });
    }
    if (!isHarvesterCloud(cloud)) {
      return res.status(400).json({ message: '仅支持同步到 Harvester 资源池' });
    }

    const { secretName: finalSecretName, exists } = await upsertHarborPullSecret(
      harbor,
      id,
      cloud,
      namespace,
      secretName,
    );

    harborLog.info(
      `${exists ? '更新' : '创建'}凭证: harbor=${id}, cloud=${cloudId}, namespace=${namespace}, secret=${finalSecretName}`,
    );

    res.json({
      message: exists ? '凭证已更新' : '凭证已创建',
      data: {
        secretName: finalSecretName,
        namespace,
        registryUrl: harbor.url,
        exists,
      },
    });
  } catch (error: any) {
    harborLog.error('同步凭证失败:', error.message);
    res.status(500).json({ message: '同步凭证失败', error: error.message });
  }
});

/**
 * 删除已同步的 Harbor 凭证
 * DELETE /api/harbor/registries/:id/sync-secret
 */
router.delete('/registries/:id/sync-secret', async (req: AuthRequest, res: Response) => {
  try {
    const perms: string[] = Array.isArray((req.user as any)?.permissions)
      ? (req.user as any).permissions
      : [];
    if (!checkPermission(perms, 'harbor.registry:delete')) {
      return res.status(403).json({ message: '权限不足' });
    }

    const { id } = req.params;
    const { cloudId, namespace, secretName } = req.body;

    if (!cloudId || !namespace) {
      return res.status(400).json({ message: '缺少必要参数: cloudId, namespace' });
    }

    const cloudRepo = AppDataSource.getRepository(Cloud);
    const cloud = await cloudRepo.findOne({ where: { id: cloudId } });
    if (!cloud) {
      return res.status(404).json({ message: 'Harvester 云资源池不存在' });
    }
    if (!isHarvesterCloud(cloud)) {
      return res.status(400).json({ message: '仅支持操作 Harvester 资源池' });
    }

    const finalSecretName = secretName || `harbor-${id}-pull-secret`;
    await deleteHarborPullSecret(cloud, namespace, finalSecretName);

    harborLog.info(
      `删除凭证: harbor=${id}, cloud=${cloudId}, namespace=${namespace}, secret=${finalSecretName}`,
    );
    res.json({ message: '凭证已删除' });
  } catch (error: any) {
    harborLog.error('删除凭证失败:', error.message);
    res.status(500).json({ message: '删除凭证失败', error: error.message });
  }
});

/**
 * 获取已同步的凭证列表
 * GET /api/harbor/registries/:id/sync-secrets
 */
router.get('/registries/:id/sync-secrets', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { cloudId } = req.query;

    if (!cloudId) {
      return res.status(400).json({ message: '缺少必要参数: cloudId' });
    }

    const cloudRepo = AppDataSource.getRepository(Cloud);
    const cloud = await cloudRepo.findOne({ where: { id: String(cloudId) } });
    if (!cloud) {
      return res.status(404).json({ message: 'Harvester 云资源池不存在' });
    }
    if (!isHarvesterCloud(cloud)) {
      return res.status(400).json({ message: '仅支持查询 Harvester 资源池' });
    }

    const items = await listManagedHarborPullSecrets(cloud, id);

    res.json({ message: '查询成功', data: { items } });
  } catch (error: any) {
    harborLog.error('获取凭证列表失败:', error.message);
    res.status(500).json({ message: '获取凭证列表失败', error: error.message });
  }
});

export { router as syncRoutes };
