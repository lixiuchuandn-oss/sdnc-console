/**
 * ==============================================================================
 * 模块名称: Harvester Restores Handlers (恢复相关)
 * 文件路径: src/routes/clouds/harvester/handlers/restores.handlers.ts
 * ==============================================================================
 * 功能描述:
 * 本文件包含 Harvester 恢复相关的 handlers，包括：
 * - 创建 VM 恢复任务（从备份或快照）
 * 
 * 从 harvester.cache.storage.routes.ts 中提取的业务逻辑
 * ==============================================================================
 */

import { Request, Response } from 'express';
import { createHarvesterVirtualMachineRestore } from '../../../../services/clouds/harvester/client';
import { fetchCloudOr404, ensureProvider } from '../harvester.cache.helpers';

/**
 * POST /:id/resources/harvester/virtualmachinerestores/:namespace - 恢复 VM (从备份或快照)
 */
export async function harvesterRestoreCreateHandler(req: Request, res: Response) {
  try {
    const { id, namespace } = req.params;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源操作')) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const result = await createHarvesterVirtualMachineRestore(
      { endpoint: cloud.endpoint, token: cloud.secretKey, insecure } as any,
      namespace,
      req.body,
    );

    res.json({ message: '创建恢复任务成功', data: result });
  } catch (error: any) {
    res.status(500).json({ message: '创建恢复任务失败', error: error.body || error.message });
  }
}
