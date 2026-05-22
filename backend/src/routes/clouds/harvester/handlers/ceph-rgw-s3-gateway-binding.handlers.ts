/**
 * Tower 保存的「按 CephObjectStore 维度」S3 客户端网关参数（clouds.config）。
 */

import { Request, Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import { Cloud } from '../../../../entities/Cloud';
import { ensureProvider } from './monitoring-helpers';
import { assertSafeS3Endpoint } from '../../../../services/clouds/harvester/cephRgwS3';
import {
  readTowerRgwS3ClientByStore,
  upsertTowerRgwS3ClientGateway,
} from '../../../../services/TowerRgwS3GatewayBindingService';

function sendErr(res: Response, e: unknown) {
  if (res.headersSent) return;
  const err = e as any;
  const st = typeof err?.status === 'number' ? err.status : 500;
  res.status(st >= 400 && st < 600 ? st : 500).json({ message: String(err?.message || err || '请求失败') });
}

async function respondWithFreshMap(res: Response, cloudId: string) {
  const repo = AppDataSource.getRepository(Cloud);
  const fresh = await repo.findOne({ where: { id: cloudId } });
  const byStore = readTowerRgwS3ClientByStore(fresh?.config);
  res.json({
    byStore,
    _tower: { api: 'ceph', resource: 'rgw-s3', action: 'gateway-client-config' },
  });
}

/** GET /api/clouds/:id/ceph/rgw/s3/gateway-client-config */
export async function harvesterCephRgwS3GatewayClientConfigGetHandler(req: Request, res: Response) {
  const cloud = (req as any).cloud as Cloud;
  if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;
  try {
    await respondWithFreshMap(res, cloud.id);
  } catch (e: any) {
    sendErr(res, e);
  }
}

/** PUT /api/clouds/:id/ceph/rgw/s3/gateway-client-config/:namespace/:name */
export async function harvesterCephRgwS3GatewayClientConfigPutHandler(req: Request, res: Response) {
  const cloud = (req as any).cloud as Cloud;
  if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;
  const ns = String(req.params.namespace ?? '').trim();
  const nm = String(req.params.name ?? '').trim();
  if (!ns || !nm) {
    res.status(400).json({ message: '缺少 namespace 或 name' });
    return;
  }
  try {
    const b = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    const endpoint = String(b.endpoint ?? '').trim();
    if (!endpoint) {
      await upsertTowerRgwS3ClientGateway(cloud.id, ns, nm, null);
      await respondWithFreshMap(res, cloud.id);
      return;
    }
    assertSafeS3Endpoint(endpoint);
    const region = String(b.region ?? '').trim() || 'us-east-1';
    const forcePathStyle = b.forcePathStyle !== false;
    await upsertTowerRgwS3ClientGateway(cloud.id, ns, nm, { endpoint, region, forcePathStyle });
    await respondWithFreshMap(res, cloud.id);
  } catch (e: any) {
    sendErr(res, e);
  }
}
