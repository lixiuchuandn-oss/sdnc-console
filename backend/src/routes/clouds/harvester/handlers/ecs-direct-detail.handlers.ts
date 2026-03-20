/**
 * ==============================================================================
 * 模块名称: Harvester ECS Detail Handlers (VM 详情查询)
 * 文件路径: src/routes/clouds/harvester/handlers/ecs-detail.handlers.ts
 * ==============================================================================
 * 功能描述:
 * 本文件包含 Harvester 虚拟机 (ECS) 的详情查询 handlers
 * 
 * 从 harvester.cache.vm.routes.ts 中提取的业务逻辑
 * ==============================================================================
 */

import { Request, Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import { UserSpace } from '../../../../entities/UserSpace';
import { getHarvesterVM } from '../../../../services/clouds/harvester/client';
import { fetchCloudOr404, ensureProvider } from '../harvester.cache.helpers';

/**
 * GET /:id/resources/harvester/vms/:namespace/:name - 获取 VM 详情
 */
export async function harvesterVmDetailHandler(req: Request, res: Response) {
  try {
    const { id, namespace, name } = req.params;

    // 租户权限检查
    if ((req as any).user?.role === 'tenant') {
      const userSpaceRepo = AppDataSource.getRepository(UserSpace);
      const where: any = { tenantId: (req as any).user.tenantId, cloudId: id, status: 'active' };
      if ((req as any).user?.organizationId) {
        where.organizationId = (req as any).user.organizationId;
      }
      const userSpace = await userSpaceRepo.findOne({ where });
      if (!userSpace) return res.status(403).json({ message: '无权访问该云资源' });

      const validNamespaces = userSpace.namespace ? userSpace.namespace.split(',').map((s) => s.trim()) : [];

      // STRICT: Do not implicitly add ns-{orgId}. Rely on UserSpace record.
      // if ((req.user as any).organizationId) {
      //   validNamespaces.push(`ns-${(req.user as any).organizationId}`);
      // }

      if (!validNamespaces.includes(namespace)) {
        return res.status(403).json({ message: '无权访问该命名空间资源' });
      }
    }

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const vm = await getHarvesterVM(
      {
        endpoint: cloud.endpoint,
        token: cloud.secretKey,
        insecure,
      } as any,
      namespace,
      name,
    );

    res.json({ message: '查询成功', data: vm });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询VM详情失败', error: error.message });
  }
}
