/**
 * 物理节点维护模式（Harvester Steve action 代理）。
 */
import { Request, Response } from 'express';
import { syncHarvesterNodes } from '../../../../services/clouds/harvester/inventory';
import {
  disableNodeMaintenance,
  enableNodeMaintenance,
  listNodeMaintenanceUnhealthyVms,
  precheckNodeMaintenance,
} from '../../../../services/clouds/harvester/nodeMaintenanceService';
import { fetchCloudOr404, ensureProvider } from '../harvester.cache.helpers';

function handleError(res: Response, e: any, fallback: string) {
  if (res.headersSent) return;
  const status = Number(e?.status) || 500;
  res.status(status >= 400 && status < 600 ? status : 500).json({
    message: e?.message || fallback,
    error: e?.message || fallback,
  });
}

async function loadCloud(req: Request, res: Response) {
  const { id } = req.params;
  const cloud = await fetchCloudOr404(id, res);
  if (!cloud) return null;
  if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester / Cloudmap')) return null;
  return cloud;
}

async function refreshNodesAfterMaintenance(cloud: any) {
  const insecure = !!(cloud.config as any)?.ignoreTls;
  try {
    await syncHarvesterNodes(cloud, insecure);
  } catch {
    /* 同步失败不阻断写操作响应 */
  }
}

/** POST /:id/resources/harvester/nodes/:name/maintenance/precheck */
export async function harvesterNodeMaintenancePrecheckHandler(req: Request, res: Response) {
  try {
    const cloud = await loadCloud(req, res);
    if (!cloud) return;
    const { name } = req.params;
    const data = await precheckNodeMaintenance(cloud, name);
    res.json({ message: data.possible ? '可进入维护模式' : '无法进入维护模式', data });
  } catch (e: any) {
    handleError(res, e, '维护模式预检失败');
  }
}

/** POST /:id/resources/harvester/nodes/:name/maintenance/unhealthy-vms */
export async function harvesterNodeMaintenanceUnhealthyVmsHandler(req: Request, res: Response) {
  try {
    const cloud = await loadCloud(req, res);
    if (!cloud) return;
    const { name } = req.params;
    const items = await listNodeMaintenanceUnhealthyVms(cloud, name);
    res.json({ message: '查询成功', data: { items } });
  } catch (e: any) {
    handleError(res, e, '查询阻塞虚拟机失败');
  }
}

/** POST /:id/resources/harvester/nodes/:name/maintenance/enable */
export async function harvesterNodeMaintenanceEnableHandler(req: Request, res: Response) {
  try {
    const cloud = await loadCloud(req, res);
    if (!cloud) return;
    const { name } = req.params;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const force = body.force === true || body.force === 'true' || body.force === 1;
    await enableNodeMaintenance(cloud, name, force);
    await refreshNodesAfterMaintenance(cloud);
    res.json({ message: '已进入维护模式', data: { nodeName: name, force } });
  } catch (e: any) {
    handleError(res, e, '进入维护模式失败');
  }
}

/** POST /:id/resources/harvester/nodes/:name/maintenance/disable */
export async function harvesterNodeMaintenanceDisableHandler(req: Request, res: Response) {
  try {
    const cloud = await loadCloud(req, res);
    if (!cloud) return;
    const { name } = req.params;
    await disableNodeMaintenance(cloud, name);
    await refreshNodesAfterMaintenance(cloud);
    res.json({ message: '已退出维护模式', data: { nodeName: name } });
  } catch (e: any) {
    handleError(res, e, '退出维护模式失败');
  }
}
