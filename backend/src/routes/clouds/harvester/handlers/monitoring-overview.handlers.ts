/**
 * Harvester Monitoring Overview Handlers
 * 监控概览相关操作（存储节点、节点资源、节点指标、虚拟机、块设备、指标查询、允许的命名空间）
 */

import { Request, Response } from 'express';
import { getJsonOnce } from '../../../../services/clouds/harvester/utils';
import {
  fetchCephRookResourceBundle,
  emptyCephRookBundle,
} from '../../../../services/clouds/harvester/cephRookBundle';
import {
  PAGESIZE,
  EXCLUDE,
  PROMETHEUS_QUERY_RANGE_PATH,
  ensureProvider,
  getTenantAccessForMonitoring,
  isUnreachableError,
  normalizeOrigin,
} from './monitoring-helpers';

function normalizeSteveCollection(payload: any): any[] {
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

/** 与前端 harvesterUtils.isClusterDefaultStorageClass 对齐 */
function isClusterDefaultStorageClass(sc: any): boolean {
  const meta = sc?.metadata?.annotations || {};
  const top = sc?.annotations || {};
  const flag =
    meta['storageclass.kubernetes.io/is-default-class'] ??
    meta['storageclass.beta.kubernetes.io/is-default-class'] ??
    top['storageclass.kubernetes.io/is-default-class'] ??
    top['storageclass.beta.kubernetes.io/is-default-class'] ??
    sc?.isDefault;
  return String(flag || '').toLowerCase() === 'true';
}

/** 与前端 pickDefaultStorageClassName：先 is-default，否则列表首项 */
function pickDefaultStorageClassRecord(list: any[]): any | null {
  if (!Array.isArray(list) || list.length === 0) return null;
  const hit = list.find(isClusterDefaultStorageClass);
  return hit ?? list[0];
}

function storageClassRecordName(sc: any): string {
  return String(sc?.metadata?.name ?? sc?.id ?? sc?.name ?? '').trim();
}

/** 默认存储类对应的分布式块存储大类（用于监控概览储存卡片数据源切换） */
function classifyDistributedStorageKind(sc: any): 'longhorn' | 'ceph' | 'unknown' {
  const prov = String(sc?.provisioner ?? sc?.spec?.provisioner ?? '').trim();
  const pl = prov.toLowerCase();
  if (!pl) return 'unknown';
  if (pl.includes('longhorn') || pl.includes('driver.longhorn.io')) return 'longhorn';
  if (
    pl.includes('rook-ceph') ||
    pl.includes('rbd.csi.ceph.com') ||
    pl.includes('cephfs.csi.ceph.com') ||
    pl.includes('csi.ceph.com') ||
    pl.includes('ceph.csi')
  ) {
    return 'ceph';
  }
  return 'unknown';
}

/** Longhorn StorageClass 常用 parameters.numberOfReplicas */
function parseStorageClassNumberOfReplicas(sc: any): number | null {
  const params = sc?.parameters ?? {};
  const raw = params.numberOfReplicas ?? params.NumberOfReplicas;
  const n = parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

// 监控概览 Handlers
export async function harvesterMonitoringStorageNodesHandler(req: Request, res: Response) {
  try {
    const { id: _id } = req.params;
    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const url = `${origin}/v1/harvester/longhorn.io.nodes?${PAGESIZE}&${EXCLUDE}`;
    const data = await getJsonOnce(url, cloud.secretKey || '', insecure, true);

    let defaultStorageClassReplicaCount: number | null = null;
    let defaultStorageClassName: string | null = null;
    let defaultStorageClassProvisioner: string | null = null;
    let distributedStorageKind: 'longhorn' | 'ceph' | 'unknown' = 'unknown';
    try {
      const scUrl = `${origin}/v1/harvester/storage.k8s.io.storageclasses?${PAGESIZE}&${EXCLUDE}`;
      const scData = await getJsonOnce(scUrl, cloud.secretKey || '', insecure, true);
      const defSc = pickDefaultStorageClassRecord(normalizeSteveCollection(scData));
      if (defSc) {
        defaultStorageClassProvisioner =
          String(defSc?.provisioner ?? defSc?.spec?.provisioner ?? '').trim() || null;
        distributedStorageKind = classifyDistributedStorageKind(defSc);
        const nm = storageClassRecordName(defSc);
        if (distributedStorageKind === 'longhorn') {
          defaultStorageClassName = nm || null;
          defaultStorageClassReplicaCount = parseStorageClassNumberOfReplicas(defSc);
        } else if (distributedStorageKind === 'ceph') {
          defaultStorageClassName = nm || null;
        }
      }
    } catch {
      /* 权限或 Steve 路径不可用：不下发臆测副本数 */
    }

    const out =
      data && typeof data === 'object' && !Array.isArray(data)
        ? {
            ...data,
            _tower: {
              ...(data as any)._tower,
              defaultStorageClassReplicaCount,
              defaultStorageClassName,
              defaultStorageClassProvisioner,
              distributedStorageKind,
            },
          }
        : data;
    res.json(out);
  } catch (e: any) {
    if (isUnreachableError(e)) return res.status(200).json({ data: [] });
    if (res.headersSent) return;
    const status = (e as any).status || 500;
    res.status(status).json({ message: e?.message || '请求存储节点失败' });
  }
}

/** Rook Ceph 多资源聚合（对齐 Ceph Dashboard 部分模块：集群 / Pool / FS / RGW 抽象） */
export async function harvesterMonitoringCephRookBundleHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    try {
      const out = await fetchCephRookResourceBundle(cloud);
      res.json(out);
    } catch (e: any) {
      if (isUnreachableError(e)) {
        return res.status(200).json(emptyCephRookBundle());
      }
      throw e;
    }
  } catch (e: any) {
    if (isUnreachableError(e)) {
      return res.status(200).json(emptyCephRookBundle());
    }
    if (res.headersSent) return;
    const st = (e as any).status || 500;
    res.status(st).json({ message: e?.message || '请求统一存储资源聚合失败' });
  }
}

export async function harvesterMonitoringCephClustersHandler(req: Request, res: Response) {
  try {
    const { id: _id } = req.params;
    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const steveResourcePaths = ['cephclusters.ceph.rook.io', 'ceph.rook.io.cephclusters'];
    let data: any = null;
    let last403: any = null;
    for (const p of steveResourcePaths) {
      const url = `${origin}/v1/harvester/${p}?${PAGESIZE}&${EXCLUDE}`;
      try {
        data = await getJsonOnce(url, cloud.secretKey || '', insecure, true);
        break;
      } catch (e: any) {
        if (isUnreachableError(e)) {
          return res.status(200).json({ data: [] });
        }
        const status = (e as any).status;
        if (status === 404) continue;
        if (status === 403) {
          last403 = e;
          continue;
        }
        throw e;
      }
    }
    if (data == null) {
      if (last403) {
        return res.status(200).json({
          data: [],
          _tower: { cephHint: 'forbidden' },
        });
      }
      return res.status(200).json({
        data: [],
        _tower: { cephHint: 'resource_not_found' },
      });
    }
    res.json(data);
  } catch (e: any) {
    if (isUnreachableError(e)) return res.status(200).json({ data: [] });
    if (res.headersSent) return;
    const st = (e as any).status || 500;
    res.status(st).json({ message: e?.message || '请求统一存储集群列表失败' });
  }
}

export async function harvesterMonitoringNodeResourcesHandler(req: Request, res: Response) {
  try {
    const { id: _id } = req.params;
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
    const { id: _id } = req.params;
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
    const { id: _id } = req.params;
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

export async function harvesterMonitoringVirtualMachineInstancesHandler(
  req: Request,
  res: Response,
) {
  try {
    const { id: _id } = req.params;
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
    const { id: _id } = req.params;
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
      return res
        .status(200)
        .json({ status: 'success', data: { resultType: 'matrix', result: [] } });
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
