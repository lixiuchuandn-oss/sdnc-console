/**
 * OvnMirror CR（hms.rivercloud.com/v1）增删改查。
 */
import { Response } from 'express';
import { fetchCloudOr404, ensureProvider } from '../harvester.cache.helpers';
import {
  createOvnMirrorCr,
  deleteOvnMirrorCr,
  getOvnMirrorCr,
  listOvnMirrorCrs,
  normalizeOvnMirrorSpecInput,
  updateOvnMirrorCr,
  type OvnMirrorCrSpecInput,
} from '../../../../services/hms/ovnMirrorCr';

function parseSpecBody(raw: unknown): OvnMirrorCrSpecInput {
  return normalizeOvnMirrorSpecInput(raw);
}

function handleCrError(res: Response, e: any, fallback: string) {
  if (res.headersSent) return;
  const status = Number(e?.status);
  const bodyMsg =
    typeof e?.body === 'object' && e.body != null
      ? e.body.message || e.body.reason || JSON.stringify(e.body)
      : typeof e?.body === 'string'
        ? e.body
        : '';
  const message = bodyMsg || e?.message || fallback;
  if (status === 404) {
    return res.status(404).json({
      message:
        '未找到 OvnMirror CR API 或资源不存在。请确认集群已安装 ovnmirrors.hms.rivercloud.com。',
      detail: message,
    });
  }
  if (status === 409) {
    return res.status(409).json({ message, detail: message });
  }
  if (status >= 400 && status < 500) {
    return res.status(status).json({ message, detail: message });
  }
  return res.status(500).json({ message: fallback, error: message });
}

/** GET /:id/resources/harvester/ovn-mirrors */
export async function harvesterOvnMirrorsListHandler(req: any, res: Response) {
  try {
    const { id } = req.params;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester / Cloudmap')) return;

    const { items, apiAvailable, listSourceUrl, error } = await listOvnMirrorCrs(cloud);
    res.json({
      message: '查询成功',
      data: { items, available: apiAvailable, listSourceUrl, error },
    });
  } catch (error: any) {
    handleCrError(res, error, '查询 OvnMirror 失败');
  }
}

/** GET /:id/resources/harvester/ovn-mirrors/:name */
export async function harvesterOvnMirrorCrGetHandler(req: any, res: Response) {
  try {
    const { id, name } = req.params;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester / Cloudmap')) return;

    const nameTrim = String(name || '').trim();
    if (!nameTrim) {
      return res.status(400).json({ message: '缺少 OvnMirror 名称' });
    }

    const data = await getOvnMirrorCr(cloud, nameTrim);
    return res.json({ message: '查询成功', data });
  } catch (e: any) {
    handleCrError(res, e, '查询 OvnMirror 失败');
  }
}

/** POST /:id/resources/harvester/ovn-mirrors */
export async function harvesterOvnMirrorCrCreateHandler(req: any, res: Response) {
  try {
    const { id } = req.params;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester / Cloudmap')) return;

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const name = String(body.name || '').trim();
    if (!name) {
      return res.status(400).json({ message: '缺少 OvnMirror 名称' });
    }
    const spec = parseSpecBody(body.spec);
    const data = await createOvnMirrorCr(cloud, { name, spec });
    return res.json({ message: '创建成功', data });
  } catch (e: any) {
    handleCrError(res, e, '创建 OvnMirror 失败');
  }
}

/** PUT /:id/resources/harvester/ovn-mirrors/:name */
export async function harvesterOvnMirrorCrUpdateHandler(req: any, res: Response) {
  try {
    const { id, name } = req.params;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester / Cloudmap')) return;

    const nameTrim = String(name || '').trim();
    if (!nameTrim) {
      return res.status(400).json({ message: '缺少 OvnMirror 名称' });
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const spec = parseSpecBody(body.spec);
    const data = await updateOvnMirrorCr(cloud, nameTrim, { spec });
    return res.json({ message: '更新成功', data });
  } catch (e: any) {
    handleCrError(res, e, '更新 OvnMirror 失败');
  }
}

/** DELETE /:id/resources/harvester/ovn-mirrors/:name */
export async function harvesterOvnMirrorCrDeleteHandler(req: any, res: Response) {
  try {
    const { id, name } = req.params;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester / Cloudmap')) return;

    const nameTrim = String(name || '').trim();
    if (!nameTrim) {
      return res.status(400).json({ message: '缺少 OvnMirror 名称' });
    }
    await deleteOvnMirrorCr(cloud, nameTrim);
    return res.json({ message: '删除成功' });
  } catch (e: any) {
    handleCrError(res, e, '删除 OvnMirror 失败');
  }
}
