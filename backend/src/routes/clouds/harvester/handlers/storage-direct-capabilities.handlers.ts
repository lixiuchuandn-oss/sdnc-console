/**
 * Harvester 存储能力查询直连 Handlers
 * 从 harvester.direct.storage.routes.ts 中提取的能力查询操作
 */

import { Request, Response } from 'express';
import { getHarvesterCapabilities } from '../../../../services/clouds/harvester/client';
import { getJsonOnce } from '../../../../services/clouds/harvester/utils';
import {
  checkTenantAccess,
  fetchCloudOr404,
  ensureProvider,
} from '../harvester.direct.helpers';

/**
 * [GET] /:id/resources/harvester/capabilities
 * 查询存储能力
 */
export async function harvesterCapabilitiesDirectHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed)
      return res.status(403).json({ message: 'Access denied to this resource pool' });

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;

    const data = await getHarvesterCapabilities({
      endpoint: cloud.endpoint,
      token: cloud.secretKey || '',
      insecure: !!(cloud.config as any)?.ignoreTls,
    });

    res.json({ message: '查询成功', data });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({
      message: '查询Capabilities失败',
      error: error.body || error.message,
    });
  }
}

/**
 * [GET] /:id/resources/harvester/storage-classes/:name
 * 查询存储类详情
 */
export async function harvesterStorageClassDetailHandler(req: Request, res: Response) {
  try {
    const { id, name } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed)
      return res.status(403).json({ message: 'Access denied to this resource pool' });

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester 资源查询')) return;
    const insecure = !!(cloud.config as any)?.ignoreTls;

    const base = (cloud.endpoint || '').replace(/\/+$/, '');
    let origin = base;
    try {
      const u = new URL(base);
      origin = `${u.protocol}//${u.host}`;
    } catch {
      origin = base.replace(/\/v[0-9].*$/, '');
    }

    const url = `${origin}/apis/storage.k8s.io/v1/storageclasses/${encodeURIComponent(name)}`;
    const raw = await getJsonOnce(url, cloud.secretKey || '', insecure);

    res.json(raw);
  } catch (e: any) {
    if (res.headersSent) return;
    res.status(500).json({ error: e.message });
  }
}
