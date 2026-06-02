/**
 * 集群故障域管理（Tower 定义 + 节点 label 同步）。
 */
import { Request, Response } from 'express';
import { syncHarvesterNodes } from '../../../../services/clouds/harvester/inventory';
import {
  createFailureDomain,
  deleteFailureDomain,
  getFailureDomainOverview,
  setFailureDomainNodes,
  updateFailureDomain,
} from '../../../../services/clouds/harvester/failureDomainService';
import type { FailureDomainType } from '../../../../services/clouds/harvester/failureDomainTypes';
import { fetchCloudOr404, ensureProvider } from '../harvester.cache.helpers';

function handleError(res: Response, e: any, fallback: string) {
  if (res.headersSent) return;
  const status = Number(e?.status) || 500;
  res.status(status >= 400 && status < 600 ? status : 500).json({
    message: e?.message || fallback,
    error: e?.message || fallback,
  });
}

/** GET /:id/resources/harvester/failure-domains/overview */
export async function harvesterFailureDomainsOverviewHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { force } = req.query;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester / Cloudmap')) return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    if (String(force) === 'true') {
      try {
        await syncHarvesterNodes(cloud, insecure);
      } catch {
        /* 节点同步失败仍返回故障域定义 */
      }
    }

    const data = await getFailureDomainOverview(id);
    res.json({ message: '查询成功', data });
  } catch (e: any) {
    handleError(res, e, '查询故障域失败');
  }
}

/** POST /:id/resources/harvester/failure-domains */
export async function harvesterFailureDomainCreateHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester / Cloudmap')) return;

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const data = await createFailureDomain(id, {
      name: body.name,
      domainType: body.domainType as FailureDomainType,
      description: body.description,
      sortOrder: body.sortOrder,
    });
    res.json({ message: '创建成功', data });
  } catch (e: any) {
    handleError(res, e, '创建故障域失败');
  }
}

/** PUT /:id/resources/harvester/failure-domains/:domainId */
export async function harvesterFailureDomainUpdateHandler(req: Request, res: Response) {
  try {
    const { id, domainId } = req.params;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester / Cloudmap')) return;

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const data = await updateFailureDomain(id, domainId, cloud, {
      name: body.name,
      domainType: body.domainType as FailureDomainType,
      description: body.description,
      sortOrder: body.sortOrder,
    });
    res.json({ message: '更新成功', data });
  } catch (e: any) {
    handleError(res, e, '更新故障域失败');
  }
}

/** DELETE /:id/resources/harvester/failure-domains/:domainId */
export async function harvesterFailureDomainDeleteHandler(req: Request, res: Response) {
  try {
    const { id, domainId } = req.params;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester / Cloudmap')) return;

    await deleteFailureDomain(id, domainId, cloud);
    res.json({ message: '删除成功' });
  } catch (e: any) {
    handleError(res, e, '删除故障域失败');
  }
}

/** PUT /:id/resources/harvester/failure-domains/:domainId/nodes */
export async function harvesterFailureDomainSetNodesHandler(req: Request, res: Response) {
  try {
    const { id, domainId } = req.params;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester / Cloudmap')) return;

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const nodeNames = Array.isArray(body.nodeNames) ? body.nodeNames : [];
    const data = await setFailureDomainNodes(id, domainId, nodeNames, cloud);
    res.json({ message: '分配成功', data });
  } catch (e: any) {
    handleError(res, e, '分配节点失败');
  }
}
