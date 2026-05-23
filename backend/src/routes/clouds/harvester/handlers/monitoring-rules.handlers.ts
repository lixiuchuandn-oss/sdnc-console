/**
 * Harvester Monitoring Rules Handlers
 * 告警规则相关操作（站内实时告警列表、Prometheus 规则列表、告警分组、VM 自定义规则）
 */

import { Request, Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import { PrometheusRulesGroup } from '../../../../entities/monitoring/PrometheusRulesGroupEntity';
import { getJsonOnce } from '../../../../services/clouds/harvester/utils';
import { ensureProvider, normalizeOrigin } from './monitoring-helpers';
import {
  PAGESIZE,
  EXCLUDE,
  ALERTMANAGER_PATH,
  PROMETHEUSRULE_VM,
  isUnreachableError,
  isWebsiteReceiverInMonitoringNs,
  getTenantAccessForMonitoring,
  extractAlertNamesFromSpec,
} from './monitoring-helpers';

const PROMETHEUSRULES_PATH = 'v1/harvester/monitoring.coreos.com.prometheusrules';
const PROMETHEUSRULES_EXCLUDE =
  'exclude=metadata.managedFields&exclude=metadata.ownerReferences&exclude=metadata.relationships&exclude=metadata.fields&exclude=metadata.state&labelSelector=app.kubernetes.io/rule-type=custom-rules';
const MONITORING_PROMETHEUS_CANDIDATE_PATHS = ['v1/harvester/monitoring.coreos.com.prometheuses'];
const MONITORING_SERVICE_MONITOR_PATH = 'v1/harvester/monitoring.coreos.com.servicemonitors';
const MONITORING_POD_MONITOR_PATH = 'v1/harvester/monitoring.coreos.com.podmonitors';

function normalizeList(raw: any): any[] {
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw?.items)) return raw.items;
  if (Array.isArray(raw)) return raw;
  return [];
}

async function getJsonListByCandidatePaths(
  origin: string,
  cloud: any,
  insecure: boolean,
  paths: string[]
): Promise<any[]> {
  let lastNon404Err: any = null;
  for (const p of paths) {
    try {
      const url = `${origin}/${p}?limit=-1&${EXCLUDE}`;
      const raw = await getJsonOnce(url, cloud.secretKey || '', insecure, true);
      return normalizeList(raw);
    } catch (e: any) {
      const status = Number(e?.status ?? e?.statusCode ?? 0);
      if (status === 404) continue;
      lastNon404Err = e;
      continue;
    }
  }
  if (lastNon404Err) throw lastNon404Err;
  return [];
}

export async function harvesterMonitoringAlertsRulesHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const datasource = String(req.query?.datasource ?? 'prometheus').trim().toLowerCase();
    if (datasource && datasource !== 'prometheus') {
      return res.status(400).json({ message: '暂不支持的数据源，当前仅支持 prometheus' });
    }

    const tenant = await getTenantAccessForMonitoring(req as any, id);
    if (!tenant.allowed) return res.status(403).json({ message: '您没有该资源池的访问权限' });

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const query = new URLSearchParams();
    query.set('silenced', 'false');
    query.set('inhibited', 'false');
    const url = `${origin}/${ALERTMANAGER_PATH}?${query.toString()}`;
    const raw = await getJsonOnce(url, cloud.secretKey || '', insecure, true);
    let list: any[] = Array.isArray(raw) ? raw : (raw?.data ?? []) || [];
    list = list.filter((item: any) => {
      const receivers = Array.isArray(item?.receivers) ? item.receivers : [];
      return receivers.some((r: any) => isWebsiteReceiverInMonitoringNs(r?.name));
    });

    if (!tenant.isAdmin && tenant.namespaces.length > 0) {
      const allowedSet = new Set(tenant.namespaces);
      list = list.filter((item: any) => allowedSet.has(String(item?.labels?.namespace ?? '').trim()));
    }
    const namespaceParam = String((req.query?.namespace ?? req.query?.filter ?? '')).trim();
    if (namespaceParam) {
      const allowedNs = new Set(
        namespaceParam.split(/[,，\s]+/).map((s: string) => s.trim()).filter(Boolean)
      );
      if (allowedNs.size > 0) {
        list = list.filter((item: any) => {
          const ns = String(item?.labels?.namespace ?? '').trim();
          return allowedNs.has(ns);
        });
      }
    }

    const withTs = list.map((item: any) => {
      const raw = item?.updatedAt ?? item?.startsAt ?? '';
      const ts = raw ? new Date(raw).getTime() : 0;
      return { item, ts: Number.isNaN(ts) ? 0 : ts };
    });
    withTs.sort((a, b) => b.ts - a.ts);
    list = withTs.map((x) => x.item);

    const page = Math.max(1, parseInt(String(req.query?.page), 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query?.pageSize), 10) || 10));
    const total = list.length;
    const hasPagination = req.query?.page !== undefined || req.query?.pageSize !== undefined;
    if (hasPagination) {
      const start = (page - 1) * pageSize;
      list = list.slice(start, start + pageSize);
      res.json({ data: list, total });
    } else {
      res.json(list);
    }
  } catch (e: any) {
    if (isUnreachableError(e)) {
      const hasPagination = req.query?.page !== undefined || req.query?.pageSize !== undefined;
      return res.status(200).json(hasPagination ? { data: [], total: 0 } : []);
    }
    if (res.headersSent) return;
    const status = (e as any).status || 500;
    res.status(status).json({ message: e?.message || '请求站内实时告警列表失败' });
  }
}

export async function harvesterMonitoringPrometheusRulesHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const datasource = String(req.query?.datasource ?? '').trim().toLowerCase();
    if (datasource !== 'prometheus') {
      return res.status(400).json({ message: '此接口仅支持 datasource=prometheus' });
    }

    const tenant = await getTenantAccessForMonitoring(req as any, id);
    if (!tenant.allowed) return res.status(403).json({ message: '您没有该资源池的访问权限' });

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const url = `${origin}/${PROMETHEUSRULES_PATH}?limit=-1&${PROMETHEUSRULES_EXCLUDE}`;
    const raw = await getJsonOnce(url, cloud.secretKey || '', insecure, true);
    let data: any[] = Array.isArray((raw as any)?.data) ? (raw as any).data : [];

    if (!tenant.isAdmin && tenant.namespaces.length > 0) {
      const allowedSet = new Set(tenant.namespaces);
      data = data.filter((item: any) => allowedSet.has(String(item?.metadata?.namespace ?? '').trim()));
    }

    const rulesGroupMap: Record<string, string> = {};
    const rules: Array<{
      datasource: string;
      groupName: string;
      groupAliasName: string;
      namespace?: string;
      name: string;
      aliasName: string;
      expression: string;
      interval: string;
      severity: string;
    }> = [];

    for (const item of data) {
      const meta = item?.metadata ?? {};
      const groupName = String(meta.name ?? '').trim();
      const groupAliasName = String(meta.annotations?.['cloudhci.io/rule-name'] ?? '').trim();
      const namespace = meta.namespace ? String(meta.namespace).trim() : undefined;
      if (groupName) rulesGroupMap[groupName] = groupAliasName || groupName;

      const groups = item?.spec?.groups ?? [];
      for (const grp of groups) {
        const ruleList = grp?.rules ?? [];
        for (const r of ruleList) {
          if (!r?.alert) continue;
          rules.push({
            datasource: 'prometheus',
            groupName,
            groupAliasName: groupAliasName || groupName,
            namespace,
            name: String(r.alert),
            aliasName: String(r.annotations?.summary ?? r.alert),
            expression: String(r.expr ?? ''),
            interval: String(r.for ?? ''),
            severity: String(r.labels?.severity ?? ''),
          });
        }
      }
    }

    try {
      const repo = AppDataSource.getRepository(PrometheusRulesGroup);
      let row = await repo.findOne({ where: { cloudId: id } });
      if (row) {
        row.data = JSON.stringify(rulesGroupMap);
        await repo.save(row);
      } else {
        await repo.save(repo.create({ cloudId: id, data: JSON.stringify(rulesGroupMap) }));
      }
    } catch (dbErr: any) {
      console.warn('[monitoring] prometheus-rules cache save failed:', dbErr?.message);
    }

    if (!tenant.isAdmin && req.query?.alertNames != null) {
      const raw = req.query.alertNames;
      const alertNamesSet = new Set<string>(
        Array.isArray(raw)
          ? (raw as string[]).map((v) => String(v).trim()).filter(Boolean)
          : String(raw ?? '')
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
      );
      if (alertNamesSet.size > 0) {
        const filtered = rules.filter((r) => alertNamesSet.has(r.name));
        return res.json({ rules: filtered });
      }
    }

    res.json({ rules });
  } catch (e: any) {
    if (isUnreachableError(e)) return res.status(200).json({ rules: [] });
    if (res.headersSent) return;
    const status = (e as any).status || 500;
    res.status(status).json({ message: e?.message || '请求 Prometheus 规则失败' });
  }
}

export async function harvesterMonitoringPrometheusRulesGroupsHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const datasource = String(req.query?.datasource ?? '').trim().toLowerCase();
    if (datasource !== 'prometheus') {
      return res.status(400).json({ message: '此接口仅支持 datasource=prometheus' });
    }

    const tenant = await getTenantAccessForMonitoring(req as any, id);
    if (!tenant.allowed) return res.status(403).json({ message: '您没有该资源池的访问权限' });

    const repo = AppDataSource.getRepository(PrometheusRulesGroup);
    const row = await repo.findOne({ where: { cloudId: id } });
    const rulesGroupMap: Record<string, string> = row?.data ? JSON.parse(row.data) : {};
    res.json({ rulesGroupMap });
  } catch (e: any) {
    if (res.headersSent) return;
    const status = (e as any).status || 500;
    res.status(status).json({ message: e?.message || '获取告警分组失败' });
  }
}

export async function harvesterMonitoringVmCustomRulesHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const exclude = 'exclude=metadata.managedFields&exclude=metadata.ownerReferences&exclude=metadata.relationships&exclude=metadata.fields&exclude=metadata.state&exclude=metadata.labels&exclude=metadata.annotations';
    const data = await getJsonOnce(`${origin}/${PROMETHEUSRULE_VM}?limit=-1&${exclude}`, cloud.secretKey || '', insecure, true);
    res.json(data);
  } catch (e: any) {
    if (isUnreachableError(e)) return res.status(200).json({});
    if (res.headersSent) return;
    const status = (e as any).status || 500;
    res.status(status).json({ message: e?.message || '请求虚拟机告警规则失败' });
  }
}

export async function harvesterMonitoringAccessManagementHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const tenant = await getTenantAccessForMonitoring(req as any, id);
    if (!tenant.allowed) return res.status(403).json({ message: '您没有该资源池的访问权限' });

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const [prometheusList, serviceMonitorList, podMonitorList] = await Promise.all([
      getJsonListByCandidatePaths(origin, cloud, insecure, MONITORING_PROMETHEUS_CANDIDATE_PATHS),
      getJsonListByCandidatePaths(origin, cloud, insecure, [MONITORING_SERVICE_MONITOR_PATH]),
      getJsonListByCandidatePaths(origin, cloud, insecure, [MONITORING_POD_MONITOR_PATH]),
    ]);

    const nsAllowed = !tenant.isAdmin && tenant.namespaces.length > 0 ? new Set(tenant.namespaces) : null;
    const filterByTenantNs = (items: any[]) =>
      nsAllowed ? items.filter((x) => nsAllowed.has(String(x?.metadata?.namespace ?? '').trim())) : items;

    const evaluatePrometheusHealth = (
      replicas: number,
      availableReplicas: number
    ): { healthStatus: 'healthy' | 'degraded' | 'unhealthy' | 'unknown'; healthReason: string } => {
      if (!Number.isFinite(replicas) || replicas <= 0) {
        return { healthStatus: 'unknown', healthReason: '未获取到期望副本信息' };
      }
      if (availableReplicas <= 0) {
        return { healthStatus: 'unhealthy', healthReason: '可用副本为 0' };
      }
      if (availableReplicas >= replicas) {
        return { healthStatus: 'healthy', healthReason: `副本状态正常（${availableReplicas}/${replicas}）` };
      }
      if (availableReplicas < replicas) {
        return {
          healthStatus: 'degraded',
          healthReason: `可用副本不足（${availableReplicas}/${replicas}）`,
        };
      }
      return { healthStatus: 'unknown', healthReason: '状态信息不足' };
    };

    const prometheusInstances = filterByTenantNs(prometheusList).map((item: any) => {
      const spec = item?.spec ?? {};
      const status = item?.status ?? {};
      const selectorToText = (sel: any): string => {
        if (!sel || typeof sel !== 'object') return '';
        const ml = sel?.matchLabels;
        if (ml && typeof ml === 'object') {
          return Object.entries(ml).map(([k, v]) => `${k}=${v}`).join(',');
        }
        return '';
      };
      const name = String(item?.metadata?.name ?? '').trim();
      const namespace = String(item?.metadata?.namespace ?? '').trim();
      const replicas = Number(spec.replicas ?? 1);
      const availableReplicas = Number(status.availableReplicas ?? 0);
      const { healthStatus, healthReason } = evaluatePrometheusHealth(replicas, availableReplicas);

      return {
        name,
        namespace,
        version: String(spec.version ?? '').trim(),
        image: String(spec.image ?? '').trim(),
        replicas,
        availableReplicas,
        retention: String(spec.retention ?? '').trim(),
        retentionSize: String(spec.retentionSize ?? '').trim(),
        externalUrl: String(spec.externalUrl ?? '').trim(),
        scrapeInterval: String(spec.scrapeInterval ?? '').trim(),
        evaluationInterval: String(spec.evaluationInterval ?? '').trim(),
        serviceAccountName: String(spec.serviceAccountName ?? '').trim(),
        cpuRequest: String(spec.resources?.requests?.cpu ?? '').trim(),
        memoryRequest: String(spec.resources?.requests?.memory ?? '').trim(),
        cpuLimit: String(spec.resources?.limits?.cpu ?? '').trim(),
        memoryLimit: String(spec.resources?.limits?.memory ?? '').trim(),
        serviceMonitorSelector: selectorToText(spec.serviceMonitorSelector),
        podMonitorSelector: selectorToText(spec.podMonitorSelector),
        createdAt: String(item?.metadata?.creationTimestamp ?? '').trim(),
        labels: item?.metadata?.labels && typeof item.metadata.labels === 'object' ? item.metadata.labels : {},
        healthStatus,
        healthReason,
      };
    });

    const serviceMonitors = filterByTenantNs(serviceMonitorList).map((item: any) => ({
      type: 'ServiceMonitor',
      name: String(item?.metadata?.name ?? '').trim(),
      namespace: String(item?.metadata?.namespace ?? '').trim(),
      labels: item?.metadata?.labels && typeof item.metadata.labels === 'object' ? item.metadata.labels : {},
      endpointsCount: Array.isArray(item?.spec?.endpoints) ? item.spec.endpoints.length : 0,
      selector: item?.spec?.selector ?? {},
      createdAt: String(item?.metadata?.creationTimestamp ?? '').trim(),
    }));

    const podMonitors = filterByTenantNs(podMonitorList).map((item: any) => ({
      type: 'PodMonitor',
      name: String(item?.metadata?.name ?? '').trim(),
      namespace: String(item?.metadata?.namespace ?? '').trim(),
      labels: item?.metadata?.labels && typeof item.metadata.labels === 'object' ? item.metadata.labels : {},
      endpointsCount: Array.isArray(item?.spec?.podMetricsEndpoints) ? item.spec.podMetricsEndpoints.length : 0,
      selector: item?.spec?.selector ?? {},
      createdAt: String(item?.metadata?.creationTimestamp ?? '').trim(),
    }));

    res.json({
      prometheusInstances,
      monitorTargets: [...serviceMonitors, ...podMonitors],
    });
  } catch (e: any) {
    if (isUnreachableError(e)) {
      return res.status(200).json({ prometheusInstances: [], monitorTargets: [] });
    }
    if (res.headersSent) return;
    const status = (e as any).status || 500;
    res.status(status).json({ message: e?.message || '请求监控接入管理数据失败' });
  }
}