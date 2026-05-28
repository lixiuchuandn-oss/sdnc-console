/**
 * Harvester Setting `ceph-storage-network`（Ceph 存储网，名称固定）。
 */
import { Request, Response } from 'express';
import {
  applyCephStorageNetworkSetting,
  fetchCephStorageNetworkEffective,
  type CephStorageNetworkConfig,
} from '../../../../services/clouds/harvester/cephStorageNetwork';
import { ensureProvider, isUnreachableError } from './monitoring-helpers';

/** GET /api/clouds/:id/ceph/storage-network */
export async function harvesterCephStorageNetworkGetHandler(req: Request, res: Response) {
  try {
    const cloud = (req as { cloud?: unknown }).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const effective = await fetchCephStorageNetworkEffective(cloud as Parameters<
      typeof fetchCephStorageNetworkEffective
    >[0]);
    res.json({
      ...effective,
      _tower: { api: 'ceph', resource: 'storage-network' },
    });
  } catch (e: unknown) {
    if (isUnreachableError(e)) {
      return res.status(200).json({
        mode: 'mgmt',
        settingName: 'ceph-storage-network',
        config: null,
        rawValue: null,
        _tower: { api: 'ceph', resource: 'storage-network', unreachable: true },
      });
    }
    if (res.headersSent) return;
    const err = e as { status?: number; message?: string };
    res.status(err.status || 500).json({ message: err.message || '读取 Ceph 存储网配置失败' });
  }
}

/** PUT /api/clouds/:id/ceph/storage-network */
export async function harvesterCephStorageNetworkPutHandler(req: Request, res: Response) {
  try {
    const cloud = (req as { cloud?: unknown }).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const body = (req.body || {}) as {
      enabled?: boolean;
      config?: CephStorageNetworkConfig | null;
    };
    const enabled = body.enabled === true;
    const effective = await applyCephStorageNetworkSetting(
      cloud as Parameters<typeof applyCephStorageNetworkSetting>[0],
      { enabled, config: body.config ?? null },
    );
    res.json({
      ...effective,
      _tower: { api: 'ceph', resource: 'storage-network' },
    });
  } catch (e: unknown) {
    if (res.headersSent) return;
    const err = e as { status?: number; message?: string };
    res.status(err.status || 500).json({ message: err.message || '保存 Ceph 存储网配置失败' });
  }
}
