/**
 * ==============================================================================
 * 模块名称: Harvester ECS Lifecycle Handlers (VM Lifecycle Operations)
 * 文件路径: src/routes/clouds/harvester/handlers/ecs-lifecycle.handlers.ts
 * ==============================================================================
 * 功能描述:
 * 本文件包含 Harvester 虚拟机（平台侧称 ECS）的标准生命周期 handlers：
 * 启动、停止、重启、暂停、恢复、删除等，**仅**对应路由前缀
 * `/:id/resources/ecs/:instanceId/...`（instanceId 常为 namespace/name）。
 * Harvester 原生路径下的专用操作见其他 handler 文件。
 *
 * 从 ecs-operations.handlers.ts 中提取的业务逻辑
 * ==============================================================================
 */

import { Request, Response } from 'express';
import {
  harvesterStartVM,
  harvesterStopVM,
  harvesterRebootVM,
  harvesterSoftRebootVM,
  harvesterPauseVM,
  harvesterUnpauseVM,
  harvesterDeleteVM,
  harvesterForceDeleteVM,
  harvesterRestoreVM,
} from '../../../../services/clouds/harvester/client';
import {
  checkTenantAccess,
  resolveTenantVmId,
  ensureProvider,
} from '../harvester.direct.helpers';

/**
 * POST /:id/resources/ecs/:instanceId/start - 启动 VM
 */
export async function harvesterEcsStartHandler(req: Request, res: Response) {
  try {
    const { id, instanceId } = req.params;
    const reqAny = req as any;
    const { allowed, namespace: tenantNamespace, isTenant } =
      await checkTenantAccess(reqAny, id);
    if (!allowed)
      return res
        .status(403)
        .json({ message: 'Access denied to this resource pool' });
    if (isTenant) {
      const p = (reqAny.user as any)?.permissions || [];
      if (!p.includes('clouds.console:write'))
        return res.status(403).json({
          message: 'Permission denied: Requires clouds.console:write',
        });
    }

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported')) return;

    const { resolvedId, error } = await resolveTenantVmId(
      tenantNamespace,
      instanceId,
      cloud,
    );
    if (error)
      return res.status(error.status).json({ message: error.message });

    const insecure = !!(cloud.config as any)?.ignoreTls;

    const data = await harvesterStartVM(
      { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
      resolvedId,
    );
    res.json({ message: '启动成功', data });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({
      message: error.message || '启动实例失败',
      error: error.body || error.message,
    });
  }
}

/**
 * POST /:id/resources/ecs/:instanceId/stop - 停止 VM
 */
export async function harvesterEcsStopHandler(req: Request, res: Response) {
  try {
    const { id, instanceId } = req.params;
    const { force } = (req.body || {}) as any;
    const reqAny = req as any;
    const { allowed, namespace: tenantNamespace, isTenant } =
      await checkTenantAccess(reqAny, id);
    if (!allowed)
      return res
        .status(403)
        .json({ message: 'Access denied to this resource pool' });
    if (isTenant) {
      const p = (reqAny.user as any)?.permissions || [];
      if (!p.includes('clouds.console:write'))
        return res.status(403).json({
          message: 'Permission denied: Requires clouds.console:write',
        });
    }

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported')) return;

    const { resolvedId, error } = await resolveTenantVmId(
      tenantNamespace,
      instanceId,
      cloud,
    );
    if (error)
      return res.status(error.status).json({ message: error.message });

    const insecure = !!(cloud.config as any)?.ignoreTls;

    const data = await harvesterStopVM(
      { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
      resolvedId,
      !!force,
    );
    res.json({ message: '停止成功', data });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({
      message: error.message || '停止实例失败',
      error: error.body || error.message,
    });
  }
}

/**
 * POST /:id/resources/ecs/:instanceId/reboot - 重启 VM
 */
export async function harvesterEcsRebootHandler(req: Request, res: Response) {
  try {
    const { id, instanceId } = req.params;
    const { force } = (req.body || {}) as any;
    const reqAny = req as any;
    const { allowed, namespace: tenantNamespace, isTenant } =
      await checkTenantAccess(reqAny, id);
    if (!allowed)
      return res
        .status(403)
        .json({ message: 'Access denied to this resource pool' });
    if (isTenant) {
      const p = (reqAny.user as any)?.permissions || [];
      if (!p.includes('clouds.console:write'))
        return res.status(403).json({
          message: 'Permission denied: Requires clouds.console:write',
        });
    }

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported')) return;

    const { resolvedId, error } = await resolveTenantVmId(
      tenantNamespace,
      instanceId,
      cloud,
    );
    if (error)
      return res.status(error.status).json({ message: error.message });

    const insecure = !!(cloud.config as any)?.ignoreTls;

    const data = await harvesterRebootVM(
      { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
      resolvedId,
      !!force,
    );
    res.json({ message: '重启成功', data });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({
      message: error.message || '重启实例失败',
      error: error.body || error.message,
    });
  }
}

/**
 * POST /:id/resources/ecs/:instanceId/softreboot - 软重启 VM
 */
export async function harvesterEcsSoftRebootHandler(req: Request, res: Response) {
  try {
    const { id, instanceId } = req.params;
    const reqAny = req as any;
    const { allowed, namespace: tenantNamespace, isTenant } =
      await checkTenantAccess(reqAny, id);
    if (!allowed)
      return res
        .status(403)
        .json({ message: 'Access denied to this resource pool' });
    if (isTenant) {
      const p = (reqAny.user as any)?.permissions || [];
      if (!p.includes('clouds.console:write'))
        return res.status(403).json({
          message: 'Permission denied: Requires clouds.console:write',
        });
    }

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported')) return;

    const { resolvedId, error } = await resolveTenantVmId(
      tenantNamespace,
      instanceId,
      cloud,
    );
    if (error)
      return res.status(error.status).json({ message: error.message });

    const insecure = !!(cloud.config as any)?.ignoreTls;

    const data = await harvesterSoftRebootVM(
      { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
      resolvedId,
    );
    res.json({ message: '软重启成功', data });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({
      message: error.message || '软重启实例失败',
      error: error.body || error.message,
    });
  }
}

/**
 * POST /:id/resources/ecs/:instanceId/pause - 暂停 VM
 */
export async function harvesterEcsPauseHandler(req: Request, res: Response) {
  try {
    const { id, instanceId } = req.params;
    const reqAny = req as any;
    const { allowed, namespace: tenantNamespace, isTenant } =
      await checkTenantAccess(reqAny, id);
    if (!allowed)
      return res
        .status(403)
        .json({ message: 'Access denied to this resource pool' });
    if (isTenant) {
      const p = (reqAny.user as any)?.permissions || [];
      if (!p.includes('clouds.console:write'))
        return res.status(403).json({
          message: 'Permission denied: Requires clouds.console:write',
        });
    }

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported')) return;

    const { resolvedId, error } = await resolveTenantVmId(
      tenantNamespace,
      instanceId,
      cloud,
    );
    if (error)
      return res.status(error.status).json({ message: error.message });

    const insecure = !!(cloud.config as any)?.ignoreTls;

    const data = await harvesterPauseVM(
      { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
      resolvedId,
    );
    res.json({ message: '暂停成功', data });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({
      message: error.message || '暂停实例失败',
      error: error.body || error.message,
    });
  }
}

/**
 * POST /:id/resources/ecs/:instanceId/unpause - 恢复 VM
 */
export async function harvesterEcsUnpauseHandler(req: Request, res: Response) {
  try {
    const { id, instanceId } = req.params;
    const reqAny = req as any;
    const { allowed, namespace: tenantNamespace, isTenant } =
      await checkTenantAccess(reqAny, id);
    if (!allowed)
      return res
        .status(403)
        .json({ message: 'Access denied to this resource pool' });
    if (isTenant) {
      const p = (reqAny.user as any)?.permissions || [];
      if (!p.includes('clouds.console:write'))
        return res.status(403).json({
          message: 'Permission denied: Requires clouds.console:write',
        });
    }

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported')) return;

    const { resolvedId, error } = await resolveTenantVmId(
      tenantNamespace,
      instanceId,
      cloud,
    );
    if (error)
      return res.status(error.status).json({ message: error.message });

    const insecure = !!(cloud.config as any)?.ignoreTls;

    const data = await harvesterUnpauseVM(
      { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
      resolvedId,
    );
    res.json({ message: '恢复成功', data });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({
      message: error.message || '恢复实例失败',
      error: error.body || error.message,
    });
  }
}

/**
 * DELETE /:id/resources/ecs/:instanceId - 删除 VM
 */
export async function harvesterEcsDeleteHandler(req: Request, res: Response) {
  try {
    const { id, instanceId } = req.params;
    const { deleteVolumes } = req.query;
    const reqAny = req as any;
    const { allowed, namespace: tenantNamespace, isTenant } =
      await checkTenantAccess(reqAny, id);
    if (!allowed)
      return res
        .status(403)
        .json({ message: 'Access denied to this resource pool' });
    if (isTenant) {
      const p = (reqAny.user as any)?.permissions || [];
      if (!p.includes('clouds.console:write'))
        return res.status(403).json({
          message: 'Permission denied: Requires clouds.console:write',
        });
    }

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported')) return;

    const { resolvedId, error } = await resolveTenantVmId(
      tenantNamespace,
      instanceId,
      cloud,
    );
    if (error)
      return res.status(error.status).json({ message: error.message });

    const insecure = !!(cloud.config as any)?.ignoreTls;

    const data = await harvesterDeleteVM(
      { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
      resolvedId,
      String(deleteVolumes) === 'true',
      true,
    );
    res.json({ message: '删除成功', data });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({
      message: error.message || '删除实例失败',
      error: error.body || error.message,
    });
  }
}

/**
 * POST /:id/resources/ecs/:instanceId/restore - 恢复 VM (回收站)
 */
export async function harvesterEcsRestoreHandler(req: Request, res: Response) {
  try {
    const { id, instanceId } = req.params;
    const reqAny = req as any;
    const { allowed, namespace: tenantNamespace } =
      await checkTenantAccess(reqAny, id);
    if (!allowed)
      return res
        .status(403)
        .json({ message: 'Access denied to this resource pool' });

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported')) return;

    const { resolvedId, error } = await resolveTenantVmId(
      tenantNamespace,
      instanceId,
      cloud,
    );
    if (error)
      return res.status(error.status).json({ message: error.message });

    const insecure = !!(cloud.config as any)?.ignoreTls;

    const data = await harvesterRestoreVM(
      { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
      resolvedId,
    );
    res.json({ message: '恢复成功', data });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({
      message: error.message || '恢复实例失败',
      error: error.body || error.message,
    });
  }
}

/**
 * DELETE /:id/resources/ecs/:instanceId/force - 强制删除 VM
 */
export async function harvesterEcsForceDeleteHandler(req: Request, res: Response) {
  try {
    const { id, instanceId } = req.params;
    const { deleteVolumes } = req.query;
    const reqAny = req as any;
    const { allowed, namespace: tenantNamespace } =
      await checkTenantAccess(reqAny, id);
    if (!allowed)
      return res
        .status(403)
        .json({ message: 'Access denied to this resource pool' });

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, 'Operation not supported')) return;

    const { resolvedId, error } = await resolveTenantVmId(
      tenantNamespace,
      instanceId,
      cloud,
    );
    if (error)
      return res.status(error.status).json({ message: error.message });

    const insecure = !!(cloud.config as any)?.ignoreTls;

    const data = await harvesterForceDeleteVM(
      { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
      resolvedId,
      String(deleteVolumes) === 'true',
      true,
    );
    res.json({ message: '强制删除成功', data });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({
      message: error.message || '强制删除实例失败',
      error: error.body || error.message,
    });
  }
}
