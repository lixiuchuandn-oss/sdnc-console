/**
 * DRS · MetricRule CR（hms.rivercloud.com/v1）增删改查。
 */
import { Response } from 'express';
import { fetchCloudOr404, ensureProvider } from '../harvester.cache.helpers';
import {
  createMetricRuleCr,
  deleteMetricRuleCr,
  getMetricRuleCr,
  listMetricRuleCrs,
  updateMetricRuleCr,
  type MetricRuleCrSpecInput,
} from '../../../../services/hms/metricRuleCr';

function parseSpecBody(raw: unknown): MetricRuleCrSpecInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw as MetricRuleCrSpecInput;
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
        '未找到 MetricRule CR API 或资源不存在。请确认集群已安装 metricrules.hms.rivercloud.com。',
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

/** GET /:id/resources/harvester/drs/metric-rules */
export async function harvesterDrsMetricRulesListHandler(req: any, res: Response) {
  try {
    const { id } = req.params;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester / Cloudmap')) return;

    const { items, apiAvailable, listSourceUrl, error } = await listMetricRuleCrs(cloud);
    res.json({
      message: '查询成功',
      data: { items, available: apiAvailable, listSourceUrl, error },
    });
  } catch (error: any) {
    handleCrError(res, error, '查询 MetricRule 失败');
  }
}

/** GET /:id/resources/harvester/drs/metric-rules/:name */
export async function harvesterDrsMetricRuleCrGetHandler(req: any, res: Response) {
  try {
    const { id, name } = req.params;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester / Cloudmap')) return;

    const nameTrim = String(name || '').trim();
    if (!nameTrim) {
      return res.status(400).json({ message: '缺少 MetricRule 名称' });
    }

    const data = await getMetricRuleCr(cloud, nameTrim);
    return res.json({ message: '查询成功', data });
  } catch (e: any) {
    handleCrError(res, e, '查询 MetricRule 失败');
  }
}

/** POST /:id/resources/harvester/drs/metric-rules */
export async function harvesterDrsMetricRuleCrCreateHandler(req: any, res: Response) {
  try {
    const { id } = req.params;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester / Cloudmap')) return;

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const name = String(body.name || body.metadata?.name || '').trim();
    const spec = parseSpecBody(body.spec);
    if (!name) {
      return res.status(400).json({ message: '缺少必要参数: name' });
    }

    const data = await createMetricRuleCr(cloud, { name, spec });
    return res.json({ message: '创建成功', data });
  } catch (e: any) {
    if (e?.status === 400) {
      return res.status(400).json({ message: e.message });
    }
    handleCrError(res, e, '创建 MetricRule 失败');
  }
}

/** PUT /:id/resources/harvester/drs/metric-rules/:name */
export async function harvesterDrsMetricRuleCrUpdateHandler(req: any, res: Response) {
  try {
    const { id, name } = req.params;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester / Cloudmap')) return;

    const nameTrim = String(name || '').trim();
    if (!nameTrim) {
      return res.status(400).json({ message: '缺少 MetricRule 名称' });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const spec = parseSpecBody(body.spec);
    const data = await updateMetricRuleCr(cloud, nameTrim, { spec });
    return res.json({ message: '更新成功', data });
  } catch (e: any) {
    if (e?.status === 400) {
      return res.status(400).json({ message: e.message });
    }
    handleCrError(res, e, '更新 MetricRule 失败');
  }
}

/** DELETE /:id/resources/harvester/drs/metric-rules/:name */
export async function harvesterDrsMetricRuleCrDeleteHandler(req: any, res: Response) {
  try {
    const { id, name } = req.params;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester / Cloudmap')) return;

    const nameTrim = String(name || '').trim();
    if (!nameTrim) {
      return res.status(400).json({ message: '缺少 MetricRule 名称' });
    }

    await deleteMetricRuleCr(cloud, nameTrim);
    return res.json({ message: '删除成功' });
  } catch (e: any) {
    handleCrError(res, e, '删除 MetricRule 失败');
  }
}
