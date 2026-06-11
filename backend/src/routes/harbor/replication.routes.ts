/**
 * Harbor 复制规则路由
 *
 * 实现 Harbor 复制规则的管理 API，包括策略列表、创建、执行记录和手动触发。
 *
 * @see HarborProxyService
 */
import { Router, Response } from 'express';
import { HarborRegistry } from '../../entities/harbor/HarborRegistry';
import { HarborProxyService } from '../../services/harbor/HarborProxyService';
import { checkPermission } from '../../permissions';
import { logger } from '../../utils/logger';
import {
  harborRegistryCloudAccessMiddleware,
  HarborScopedRequest,
} from '../../services/harbor/harborRegistryCloudMiddleware';

const harborLog = logger.child('HarborReplication');

const router = Router();

router.use('/registries/:id', harborRegistryCloudAccessMiddleware);

function getHarborProxyFromRequest(req: HarborScopedRequest): HarborProxyService | null {
  const harbor = req.harborRegistry;
  if (!harbor) return null;
  return HarborProxyService.getInstance(harbor);
}

/**
 * 获取复制规则列表
 * GET /api/harbor/registries/:id/replication/policies
 */
router.get('/registries/:id/replication/policies', async (req: HarborScopedRequest, res: Response) => {
  try {
    const proxy = getHarborProxyFromRequest(req);
    if (!proxy) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }
    const policies = await proxy.getReplicationPolicies();

    res.json({ message: '查询成功', data: policies });
  } catch (error: any) {
    harborLog.error('获取复制规则列表失败:', error.message);
    res.status(500).json({ message: '获取复制规则列表失败', error: error.message });
  }
});

/**
 * 创建复制规则
 * POST /api/harbor/registries/:id/replication/policies
 */
router.post('/registries/:id/replication/policies', async (req: HarborScopedRequest, res: Response) => {
  try {
    const perms: string[] = Array.isArray((req.user as any)?.permissions)
      ? (req.user as any).permissions
      : [];
    if (!checkPermission(perms, 'harbor.registry:update')) {
      return res.status(403).json({ message: '权限不足' });
    }

    const { id } = req.params;
    const proxy = getHarborProxyFromRequest(req);
    if (!proxy) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }

    const result = await proxy.createReplicationPolicy(req.body);

    harborLog.info(`创建复制规则: harbor=${id}`);
    res.status(201).json({ message: '创建成功', data: result });
  } catch (error: any) {
    harborLog.error('创建复制规则失败:', error.message);
    res.status(500).json({ message: '创建复制规则失败', error: error.message });
  }
});

/**
 * 获取复制执行记录
 * GET /api/harbor/registries/:id/replication/executions
 */
router.get('/registries/:id/replication/executions', async (req: HarborScopedRequest, res: Response) => {
  try {
    const { policyId } = req.query;

    const proxy = getHarborProxyFromRequest(req);
    if (!proxy) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }
    const executions = await proxy.getReplicationExecutions({
      policyId: policyId ? Number(policyId) : undefined,
    });

    res.json({ message: '查询成功', data: executions });
  } catch (error: any) {
    harborLog.error('获取复制执行记录失败:', error.message);
    res.status(500).json({ message: '获取复制执行记录失败', error: error.message });
  }
});

/**
 * 手动触发复制
 * POST /api/harbor/registries/:id/replication/executions
 */
router.post('/registries/:id/replication/executions', async (req: HarborScopedRequest, res: Response) => {
  try {
    const perms: string[] = Array.isArray((req.user as any)?.permissions)
      ? (req.user as any).permissions
      : [];
    if (!checkPermission(perms, 'harbor.registry:update')) {
      return res.status(403).json({ message: '权限不足' });
    }

    const { id } = req.params;
    const { policyId } = req.body;

    if (!policyId) {
      return res.status(400).json({ message: '缺少必要参数: policyId' });
    }

    const proxy = getHarborProxyFromRequest(req);
    if (!proxy) {
      return res.status(404).json({ message: 'Harbor 实例不存在' });
    }
    const result = await proxy.triggerReplication(Number(policyId));

    harborLog.info(`触发复制执行: harbor=${id}, policyId=${policyId}`);
    res.json({ message: '触发成功', data: result });
  } catch (error: any) {
    harborLog.error('触发复制执行失败:', error.message);
    res.status(500).json({ message: '触发复制执行失败', error: error.message });
  }
});

/**
 * 获取单个复制规则详情
 * GET /api/harbor/registries/:id/replication/policies/:policyId
 */
router.get(
  '/registries/:id/replication/policies/:policyId',
  async (req: HarborScopedRequest, res: Response) => {
    try {
      const { policyId } = req.params;
      const proxy = getHarborProxyFromRequest(req);
      if (!proxy) {
        return res.status(404).json({ message: 'Harbor 实例不存在' });
      }

      const policy = await proxy.getReplicationPolicy(Number(policyId));

      res.json({ message: '查询成功', data: policy });
    } catch (error: any) {
      harborLog.error('获取复制规则详情失败:', error.message);
      res.status(500).json({ message: '获取复制规则详情失败', error: error.message });
    }
  },
);

/**
 * 更新复制规则
 * PUT /api/harbor/registries/:id/replication/policies/:policyId
 */
router.put(
  '/registries/:id/replication/policies/:policyId',
  async (req: HarborScopedRequest, res: Response) => {
    try {
      const perms: string[] = Array.isArray((req.user as any)?.permissions)
        ? (req.user as any).permissions
        : [];
      if (!checkPermission(perms, 'harbor.registry:update')) {
        return res.status(403).json({ message: '权限不足' });
      }

      const { id, policyId } = req.params;
      const proxy = getHarborProxyFromRequest(req);
      if (!proxy) {
        return res.status(404).json({ message: 'Harbor 实例不存在' });
      }

      const result = await proxy.updateReplicationPolicy(Number(policyId), req.body);

      harborLog.info(`更新复制规则: harbor=${id}, policyId=${policyId}`);
      res.json({ message: '更新成功', data: result });
    } catch (error: any) {
      harborLog.error('更新复制规则失败:', error.message);
      res.status(500).json({ message: '更新复制规则失败', error: error.message });
    }
  },
);

/**
 * 删除复制规则
 * DELETE /api/harbor/registries/:id/replication/policies/:policyId
 */
router.delete(
  '/registries/:id/replication/policies/:policyId',
  async (req: HarborScopedRequest, res: Response) => {
    try {
      const perms: string[] = Array.isArray((req.user as any)?.permissions)
        ? (req.user as any).permissions
        : [];
      if (!checkPermission(perms, 'harbor.registry:delete')) {
        return res.status(403).json({ message: '权限不足' });
      }

      const { id, policyId } = req.params;
      const proxy = getHarborProxyFromRequest(req);
      if (!proxy) {
        return res.status(404).json({ message: 'Harbor 实例不存在' });
      }

      await proxy.deleteReplicationPolicy(Number(policyId));

      harborLog.info(`删除复制规则: harbor=${id}, policyId=${policyId}`);
      res.json({ message: '删除成功' });
    } catch (error: any) {
      harborLog.error('删除复制规则失败:', error.message);
      res.status(500).json({ message: '删除复制规则失败', error: error.message });
    }
  },
);

export { router as replicationRoutes };
