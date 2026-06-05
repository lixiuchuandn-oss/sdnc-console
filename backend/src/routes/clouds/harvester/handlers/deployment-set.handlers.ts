/**
 * 虚拟机部署集管理（Tower 本地定义）。
 */
import { Request, Response } from 'express';
import {
  createDeploymentSet,
  deleteDeploymentSet,
  getDeploymentSetOverview,
  updateDeploymentSet,
} from '../../../../services/clouds/harvester/deploymentSetService';
import { fetchCloudOr404, ensureProvider } from '../harvester.cache.helpers';

function handleError(res: Response, e: any, fallback: string) {
  if (res.headersSent) return;
  const status = Number(e?.status) || 500;
  res.status(status >= 400 && status < 600 ? status : 500).json({
    message: e?.message || fallback,
    error: e?.message || fallback,
  });
}

function readDeploymentSetMutationBody(body: Record<string, any>) {
  return {
    name: body.name,
    namespace: body.namespace,
    labels: body.labels,
    description: body.description,
    sortOrder: body.sortOrder,
    schedulingPolicy: body.schedulingPolicy,
    schedulingStrength: body.schedulingStrength,
    topologyKey: body.topologyKey,
  };
}

/** GET /:id/resources/harvester/deployment-sets/overview */
export async function harvesterDeploymentSetsOverviewHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester / Cloudmap')) return;

    const data = await getDeploymentSetOverview(id);
    res.json({ message: '查询成功', data });
  } catch (e: any) {
    handleError(res, e, '查询部署集失败');
  }
}

/** POST /:id/resources/harvester/deployment-sets */
export async function harvesterDeploymentSetCreateHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester / Cloudmap')) return;

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const data = await createDeploymentSet(id, readDeploymentSetMutationBody(body));
    res.json({ message: '创建成功', data });
  } catch (e: any) {
    handleError(res, e, '创建部署集失败');
  }
}

/** PUT /:id/resources/harvester/deployment-sets/:setId */
export async function harvesterDeploymentSetUpdateHandler(req: Request, res: Response) {
  try {
    const { id, setId } = req.params;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester / Cloudmap')) return;

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const data = await updateDeploymentSet(id, setId, readDeploymentSetMutationBody(body));
    res.json({ message: '更新成功', data });
  } catch (e: any) {
    handleError(res, e, '更新部署集失败');
  }
}

/** DELETE /:id/resources/harvester/deployment-sets/:setId */
export async function harvesterDeploymentSetDeleteHandler(req: Request, res: Response) {
  try {
    const { id, setId } = req.params;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester / Cloudmap')) return;

    await deleteDeploymentSet(id, setId);
    res.json({ message: '删除成功' });
  } catch (e: any) {
    handleError(res, e, '删除部署集失败');
  }
}
