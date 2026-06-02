/**
 * 存储 DRS（SDRS）— 策略、任务、手动迁盘。
 */
import { Request, Response } from 'express';
import {
  createSdrsTask,
  getSdrsOverview,
  getSdrsPools,
  getSdrsTask,
  getVmSdrsDisks,
  listSdrsTasks,
  updateSdrsPolicy,
} from '../../../../services/clouds/harvester/sdrsService';
import type { SdrsMode } from '../../../../services/clouds/harvester/sdrsTypes';
import { fetchCloudOr404, ensureProvider } from '../harvester.cache.helpers';

function handleError(res: Response, e: any, fallback: string) {
  if (res.headersSent) return;
  const status = Number(e?.status) || 500;
  res.status(status >= 400 && status < 600 ? status : 500).json({
    message: e?.message || fallback,
    error: e?.message || fallback,
  });
}

/** GET /:id/resources/harvester/sdrs/overview */
export async function harvesterSdrsOverviewHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester / Cloudmap')) return;
    const data = await getSdrsOverview(cloud);
    res.json({ message: '查询成功', data });
  } catch (e: any) {
    handleError(res, e, '查询存储 DRS 概览失败');
  }
}

/** GET /:id/resources/harvester/sdrs/policy */
export async function harvesterSdrsPolicyGetHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester / Cloudmap')) return;
    const data = await getSdrsOverview(cloud);
    res.json({ message: '查询成功', data: data.policy });
  } catch (e: any) {
    handleError(res, e, '查询 SDRS 策略失败');
  }
}

/** PUT /:id/resources/harvester/sdrs/policy */
export async function harvesterSdrsPolicyPutHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester / Cloudmap')) return;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const data = await updateSdrsPolicy(id, {
      enabled: body.enabled,
      mode: body.mode as SdrsMode,
      capacityThresholdPct: body.capacityThresholdPct,
      latencyThresholdMs: body.latencyThresholdMs,
    });
    res.json({ message: '保存成功', data });
  } catch (e: any) {
    handleError(res, e, '保存 SDRS 策略失败');
  }
}

/** GET /:id/resources/harvester/sdrs/pools */
export async function harvesterSdrsPoolsHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester / Cloudmap')) return;
    const data = await getSdrsPools(cloud);
    res.json({ message: '查询成功', data });
  } catch (e: any) {
    handleError(res, e, '查询 Ceph Pool 失败');
  }
}

/** GET /:id/resources/harvester/sdrs/disks */
export async function harvesterSdrsDisksHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { vmNamespace, vmName } = req.query;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester / Cloudmap')) return;
    const data = await getVmSdrsDisks(cloud, String(vmNamespace || ''), String(vmName || ''));
    res.json({ message: '查询成功', data });
  } catch (e: any) {
    handleError(res, e, '查询 VM 磁盘失败');
  }
}

/** GET /:id/resources/harvester/sdrs/tasks */
export async function harvesterSdrsTasksListHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester / Cloudmap')) return;
    const data = await listSdrsTasks(id);
    res.json({ message: '查询成功', data });
  } catch (e: any) {
    handleError(res, e, '查询 SDRS 任务失败');
  }
}

/** GET /:id/resources/harvester/sdrs/tasks/:taskId */
export async function harvesterSdrsTaskGetHandler(req: Request, res: Response) {
  try {
    const { id, taskId } = req.params;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester / Cloudmap')) return;
    const data = await getSdrsTask(id, taskId);
    if (!data) {
      res.status(404).json({ message: '任务不存在' });
      return;
    }
    res.json({ message: '查询成功', data });
  } catch (e: any) {
    handleError(res, e, '查询 SDRS 任务失败');
  }
}

/** POST /:id/resources/harvester/sdrs/tasks */
export async function harvesterSdrsTaskCreateHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester / Cloudmap')) return;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const data = await createSdrsTask(cloud, {
      vmNamespace: body.vmNamespace,
      vmName: body.vmName,
      pvcName: body.pvcName,
      targetPool: body.targetPool,
      targetImage: body.targetImage,
    });
    res.json({ message: '任务已创建', data });
  } catch (e: any) {
    handleError(res, e, '创建 SDRS 任务失败');
  }
}
