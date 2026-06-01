/**
 * 独立 Ceph API：Rook / Steve 控制面读路径（与 `/monitoring/ceph-resources` 数据同源，URL 归属 Ceph 域）。
 */

import { Request, Response } from 'express';
import {
  fetchCephRookResourceBundle,
  emptyCephRookBundle,
} from '../../../../services/clouds/harvester/cephRookBundle';
import { ensureProvider, isUnreachableError } from './monitoring-helpers';

/** GET /api/clouds/:id/ceph/rook/bundle */
export async function harvesterCephRookBundleHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    try {
      const body = await fetchCephRookResourceBundle(cloud);
      res.json({
        ...body,
        _tower: {
          api: 'ceph',
          resource: 'rook-bundle',
        },
      });
    } catch (e: any) {
      if (isUnreachableError(e)) {
        return res.status(200).json({
          ...emptyCephRookBundle(),
          _tower: {
            api: 'ceph',
            resource: 'rook-bundle',
            unreachable: true,
          },
        });
      }
      throw e;
    }
  } catch (e: any) {
    if (isUnreachableError(e)) {
      return res.status(200).json({
        ...emptyCephRookBundle(),
        _tower: {
          api: 'ceph',
          resource: 'rook-bundle',
          unreachable: true,
        },
      });
    }
    if (res.headersSent) return;
    const st = (e as any).status || 500;
    res.status(st).json({ message: e?.message || '请求统一存储 Rook 聚合失败' });
  }
}
