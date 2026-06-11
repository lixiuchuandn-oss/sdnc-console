/**
 * 计算节点一键关机全部（POST `/v1/hms/node/shutdown` 代理）。
 */
import { Request, Response } from 'express';
import { AuthRequest } from '../../../../middleware/auth';
import { postHmsAllNodesShutdown } from '../../../../services/hms/nodeShutdown';
import { syncHarvesterNodes } from '../../../../services/clouds/harvester/inventory';
import { verifyCurrentUserPassword } from '../../../../utils/verifyCurrentUserPassword';
import { logger } from '../../../../utils/logger';
import { fetchCloudOr404, ensureProvider } from '../harvester.cache.helpers';

const shutdownLog = logger.child('HmsNodeShutdown');

function handleError(res: Response, e: unknown, fallback: string) {
  if (res.headersSent) return;
  const err = e as { status?: number; message?: string };
  const status = Number(err?.status) || 500;
  res.status(status >= 400 && status < 600 ? status : 500).json({
    message: err?.message || fallback,
    error: err?.message || fallback,
  });
}

async function loadCloud(req: Request, res: Response) {
  const { id } = req.params;
  const cloud = await fetchCloudOr404(id, res);
  if (!cloud) return null;
  if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester / Cloudmap')) return null;
  return cloud;
}

async function refreshNodesAfterPowerAction(cloud: { config?: unknown }) {
  const insecure = !!(cloud.config as { ignoreTls?: boolean })?.ignoreTls;
  try {
    await syncHarvesterNodes(cloud as Parameters<typeof syncHarvesterNodes>[0], insecure);
  } catch {
    /* 同步失败不阻断写操作响应 */
  }
}

/** POST /:id/resources/harvester/nodes/shutdown — 一键关机全部计算节点 */
export async function harvesterAllNodesHmsShutdownHandler(req: Request, res: Response) {
  try {
    const cloud = await loadCloud(req, res);
    if (!cloud) return;

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const passwordCheck = await verifyCurrentUserPassword(
      (req as AuthRequest).user,
      body.password,
    );
    if (!passwordCheck.ok) {
      res.status(passwordCheck.status).json({ message: passwordCheck.message });
      return;
    }

    const insecure = !!(cloud.config as { ignoreTls?: boolean })?.ignoreTls;
    const data = await postHmsAllNodesShutdown({
      endpoint: String(cloud.endpoint || ''),
      insecure,
    });

    await refreshNodesAfterPowerAction(cloud);
    res.json({
      message: data?.message || '全部节点关机指令已下发',
      data: data?.data != null ? { result: data.data } : {},
    });
  } catch (e: unknown) {
    const err = e as { message?: string; status?: number; data?: unknown };
    shutdownLog.warn('HMS 一键关机失败', {
      status: err?.status,
      message: err?.message,
      data: err?.data,
    });
    handleError(res, e, '一键关机失败');
  }
}
