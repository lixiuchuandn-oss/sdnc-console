/**
 * Harvester rook-ceph Addon：探测与开启统一存储。
 */
import { Request, Response } from 'express';
import {
  applyHarvesterRookCephAddon,
  fetchHarvesterRookCephAddon,
  type CephHarvesterAddonApplyInput,
} from '../../../../services/clouds/harvester/cephHarvesterAddon';
import { ensureProvider, isUnreachableError } from './monitoring-helpers';

/** GET /api/clouds/:id/ceph/harvester-addon */
export async function harvesterCephHarvesterAddonGetHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const status = await fetchHarvesterRookCephAddon(cloud);
    res.json({
      ...status,
      raw: undefined,
      _tower: { api: 'ceph', resource: 'harvester-addon' },
    });
  } catch (e: any) {
    if (isUnreachableError(e)) {
      return res.status(200).json({
        exists: false,
        enabled: false,
        deployStatus: '',
        phase: 'unknown',
        message: '无法连接 Harvester 控制面',
        _tower: { api: 'ceph', resource: 'harvester-addon', unreachable: true },
      });
    }
    if (res.headersSent) return;
    const st = (e as any).status || 500;
    res.status(st).json({ message: e?.message || '读取 rook-ceph Addon 失败' });
  }
}

/** POST /api/clouds/:id/ceph/harvester-addon */
export async function harvesterCephHarvesterAddonApplyHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const body = (req.body || {}) as CephHarvesterAddonApplyInput;
    const result = await applyHarvesterRookCephAddon(cloud, body);
    res.json({
      applied: result.applied,
      ...result.status,
      raw: undefined,
      _tower: { api: 'ceph', resource: 'harvester-addon' },
    });
  } catch (e: any) {
    if (res.headersSent) return;
    const st = (e as any).status || 500;
    res.status(st).json({ message: e?.message || '提交 rook-ceph Addon 失败' });
  }
}
