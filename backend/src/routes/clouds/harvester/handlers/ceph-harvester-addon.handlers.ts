/**
 * Harvester rook-ceph Addon：探测与开启统一存储。
 */
import { Request, Response } from 'express';
import { AuthRequest } from '../../../../middleware/auth';
import {
  applyHarvesterRookCephAddon,
  fetchHarvesterRookCephAddon,
  type CephHarvesterAddonApplyInput,
} from '../../../../services/clouds/harvester/cephHarvesterAddon';
import { verifyCurrentUserPassword } from '../../../../utils/verifyCurrentUserPassword';
import { ensureProvider, isUnreachableError } from './monitoring-helpers';

/** GET /api/clouds/:id/ceph/harvester-addon */
export async function harvesterCephHarvesterAddonGetHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const status = await fetchHarvesterRookCephAddon(cloud);
    const { raw: _raw, ...publicStatus } = status;
    res.json({
      ...publicStatus,
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

    const body = (req.body || {}) as CephHarvesterAddonApplyInput & { password?: string };
    const passwordCheck = await verifyCurrentUserPassword((req as AuthRequest).user, body.password);
    if (!passwordCheck.ok) {
      return res.status(passwordCheck.status).json({ message: passwordCheck.message });
    }

    const { password: _password, ...applyInput } = body;
    const result = await applyHarvesterRookCephAddon(cloud, applyInput);
    const { raw: _raw, ...publicStatus } = result.status;
    res.json({
      applied: result.applied,
      ...publicStatus,
      _tower: { api: 'ceph', resource: 'harvester-addon' },
    });
  } catch (e: any) {
    if (res.headersSent) return;
    const st = (e as any).status || 500;
    res.status(st).json({ message: e?.message || '提交 rook-ceph Addon 失败' });
  }
}
