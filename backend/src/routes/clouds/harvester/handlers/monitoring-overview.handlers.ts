/**
 * Harvester Monitoring Overview Handlers
 * 监控概览相关操作（存储节点、节点资源、节点指标、虚拟机、块设备、指标查询、允许的命名空间）
 */

import { Request, Response } from 'express';
import { getJsonOnce } from '../../../../services/clouds/harvester/utils';
import { ensureProvider, normalizeOrigin } from './monitoring-helpers';
import {
  PAGESIZE,
  EXCLUDE,
  PROMETHEUS_QUERY_RANGE_PATH,
  isUnreachableError,
  getTenantAccessForMonitoring,
} from './monitoring-helpers';

function parseLonghornDefaultReplicaCount(settingsPayload: any): number | null {
  const items = Array.isArray(settingsPayload?.data)
    ? settingsPayload.data
    : Array.isArray(settingsPayload?.items)
      ? settingsPayload.items
      : [];
  const hit = items.find((x: any) => {
    const id = String(x?.id ?? x?.metadata?.name ?? '').trim();
    return id === 'default-replica-count';
  });
  if (!hit) return null;
  const raw = hit?.value ?? hit?.spec?.value ?? hit?.status?.value;
  const n = parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

// 监控概览 Handlers
export async function harvesterMonitoringStorageNodesHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const url = `${origin}/v1/harvester/longhorn.io.nodes?${PAGESIZE}&${EXCLUDE}`;
    const data = await getJsonOnce(url, cloud.secretKey || '', insecure, true);
    let defaultLonghornReplicaCount = 3;
    try {
      const sUrl = `${origin}/v1/harvester/longhorn.io.settings?${PAGESIZE}&${EXCLUDE}`;
      const sData = await getJsonOnce(sUrl, cloud.secretKey || '', insecure, true);
      const parsed = parseLonghornDefaultReplicaCount(sData);
      if (parsed != null) defaultLonghornReplicaCount = parsed;
    } catch {
      /* 忽略：无权限或集群未暴露该 Steve 资源时沿用默认 3 */
    }
    const out =
      data && typeof data === 'object' && !Array.isArray(data)
        ? { ...data, _tower: { ...(data as any)._tower, defaultLonghornReplicaCount } }
        : data;
    res.json(out);
  } catch (e: any) {
    if (isUnreachableError(e)) return res.status(200).json({ data: [] });
    if (res.headersSent) return;
    const status = (e as any).status || 500;
    res.status(status).json({ message: e?.message || '请求存储节点失败' });
  }
}

export async function harvesterMonitoringNodeResourcesHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const url = `${origin}/v1/harvester/nodes?${PAGESIZE}&${EXCLUDE}`;
    const data = await getJsonOnce(url, cloud.secretKey || '', insecure, true);
    res.json(data);
  } catch (e: any) {
    if (isUnreachableError(e)) return res.status(200).json({ data: [] });
    if (res.headersSent) return;
    const status = (e as any).status || 500;
    res.status(status).json({ message: e?.message || '请求节点资源失败' });
  }
}

export async function harvesterMonitoringNodeMetricsHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const url = `${origin}/v1/harvester/metrics.k8s.io.nodes?${PAGESIZE}&${EXCLUDE}`;
    const data = await getJsonOnce(url, cloud.secretKey || '', insecure, true);
    res.json(data);
  } catch (e: any) {
    if (isUnreachableError(e)) return res.status(200).json({ data: [] });
    if (res.headersSent) return;
    const status = (e as any).status || 500;
    res.status(status).json({ message: e?.message || '请求节点指标失败' });
  }
}

export async function harvesterMonitoringVirtualMachinesHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const url = `${origin}/v1/harvester/kubevirt.io.virtualmachines?${PAGESIZE}&${EXCLUDE}`;
    const data = await getJsonOnce(url, cloud.secretKey || '', insecure, true);
    res.json(data);
  } catch (e: any) {
    if (isUnreachableError(e)) return res.status(200).json({ data: [] });
    if (res.headersSent) return;
    const status = (e as any).status || 500;
    res.status(status).json({ message: e?.message || '请求虚拟机失败' });
  }
}

export async function harvesterMonitoringVirtualMachineInstancesHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const url = `${origin}/v1/harvester/kubevirt.io.virtualmachineinstances?${PAGESIZE}&${EXCLUDE}`;
    const data = await getJsonOnce(url, cloud.secretKey || '', insecure, true);
    res.json(data);
  } catch (e: any) {
    if (isUnreachableError(e)) return res.status(200).json({ data: [] });
    if (res.headersSent) return;
    const status = (e as any).status || 500;
    res.status(status).json({ message: e?.message || '请求虚拟机实例失败' });
  }
}

export async function harvesterMonitoringBlockDevicesHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const url = `${origin}/v1/harvester/harvesterhci.io.blockdevices?${PAGESIZE}&${EXCLUDE}`;
    const data = await getJsonOnce(url, cloud.secretKey || '', insecure, true);
    res.json(data);
  } catch (e: any) {
    if (isUnreachableError(e)) return res.status(200).json({ data: [] });
    if (res.headersSent) return;
    const status = (e as any).status || 500;
    res.status(status).json({ message: e?.message || '请求块设备失败' });
  }
}

export async function harvesterMonitoringMetricRangeHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const tenant = await getTenantAccessForMonitoring(req as any, id);
    if (!tenant.allowed) return res.status(403).json({ message: '您没有该资源池的访问权限' });

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const query = String(req.query?.query ?? '').trim();
    const start = req.query?.start;
    const end = req.query?.end;
    const step = req.query?.step;
    if (!query || start == null || end == null || step == null) {
      return res.status(400).json({ message: '缺少 query/start/end/step 参数' });
    }

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const params = new URLSearchParams({
      query,
      start: String(start),
      end: String(end),
      step: String(step),
    });
    const url = `${origin}/${PROMETHEUS_QUERY_RANGE_PATH}?${params.toString()}`;
    const data = await getJsonOnce(url, cloud.secretKey || '', insecure, true);
    res.json(data);
  } catch (e: any) {
    if (isUnreachableError(e)) {
      return res.status(200).json({ status: 'success', data: { resultType: 'matrix', result: [] } });
    }
    if (res.headersSent) return;
    const status = (e as any).status || 500;
    res.status(status).json({ message: e?.message || '请求指标失败' });
  }
}

export async function harvesterMonitoringAllowedNamespacesHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const tenant = await getTenantAccessForMonitoring(req as any, id);
    if (!tenant.allowed) return res.status(403).json({ message: '您没有该资源池的访问权限' });
    res.json({ isAdmin: tenant.isAdmin, namespaces: tenant.namespaces });
  } catch (e: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: e?.message || '获取失败' });
  }
}
