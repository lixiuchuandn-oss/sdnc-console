import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { HarborRegistry } from '../../entities/harbor/HarborRegistry';
import { findHarborRegistryForCloud } from './harborRegistryAccess';

export interface HarborScopedRequest extends AuthRequest {
  harborRegistry?: HarborRegistry;
}

/** 从 query / body 解析资源池 ID */
export function resolveHarborCloudId(req: AuthRequest): string | undefined {
  const cloudId = req.query?.cloudId ?? req.body?.cloudId;
  return cloudId ? String(cloudId) : undefined;
}

/**
 * 校验 Harbor 实例是否属于当前资源池，通过后挂载到 req.harborRegistry
 */
export async function harborRegistryCloudAccessMiddleware(
  req: HarborScopedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const harborId = req.params.id;
    if (!harborId) {
      next();
      return;
    }

    const cloudId = resolveHarborCloudId(req);
    if (!cloudId) {
      res.status(400).json({ message: '缺少必要参数: cloudId' });
      return;
    }

    const registry = await findHarborRegistryForCloud(harborId, cloudId);
    if (!registry) {
      res.status(404).json({ message: 'Harbor 实例不存在' });
      return;
    }

    req.harborRegistry = registry;
    next();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误';
    res.status(500).json({ message: '校验 Harbor 访问权限失败', error: message });
  }
}
