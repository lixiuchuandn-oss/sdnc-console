/**
 * Harvester Monitoring Rules Handlers
 * 告警规则相关操作（站内实时告警列表、Prometheus 规则列表、告警分组、VM 自定义规则）
 */

import { Request, Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import { PrometheusRulesGroup } from '../../../../entities/monitoring/PrometheusRulesGroupEntity';
import { getJsonOnce, requestJson } from '../../../../services/clouds/harvester/utils';
import { ensureProvider, normalizeOrigin } from './monitoring-helpers';
import {
  PAGESIZE,
  EXCLUDE,
  ALERTMANAGER_PATH,
  ANNOTATION_ALIAS,
  CATTLE_MONITORING_SYSTEM_NS,
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
const MONITORING_ALERTMANAGER_CANDIDATE_PATHS = ['v1/harvester/monitoring.coreos.com.alertmanagers'];
const MONITORING_SERVICE_MONITOR_PATH = 'v1/harvester/monitoring.coreos.com.servicemonitors';
const MONITORING_POD_MONITOR_PATH = 'v1/harvester/monitoring.coreos.com.podmonitors';
const MONITORING_POD_CANDIDATE_PATHS = ['v1/harvester/core.pods', 'v1/harvester/core.v1.pods'];
const MONITORING_STATEFULSET_CANDIDATE_PATHS = [
  'v1/harvester/apps.statefulsets',
  'v1/harvester/apps.v1.statefulsets',
  'apis/apps/v1/statefulsets',
];
const DEFAULT_MONITORING_AUTO_REFRESH_MS = 10 * 60 * 1000;
const MAX_MONITORING_AUTO_REFRESH_MS = 24 * 60 * 60 * 1000;

interface PrometheusTarget {
  namespace: string;
  job: string;
  service: string;
  pod: string;
  container: string;
  endpoint: string;
  instance: string;
  scrapePool: string;
  scrapeUrl: string;
  globalUrl: string;
  health: string;
  lastError: string;
  lastScrape: string;
  lastScrapeDuration: number;
  scrapeInterval: string;
  scrapeTimeout: string;
  labels: Record<string, string>;
}

interface PrometheusTaskEndpoint {
  endpoint: string;
  total: number;
  upCount: number;
  downCount: number;
  targets: PrometheusTarget[];
}

interface PrometheusMonitorTask {
  namespace: string;
  job: string;
  service: string;
  scrapePool: string;
  total: number;
  upCount: number;
  downCount: number;
  endpoints: PrometheusTaskEndpoint[];
}

function normalizeList(raw: any): any[] {
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw?.items)) return raw.items;
  if (Array.isArray(raw)) return raw;
  return [];
}

function normalizeAutoRefreshMs(raw: unknown): number {
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_MONITORING_AUTO_REFRESH_MS;
  if (parsed <= 0) return 0;
  return Math.min(parsed, MAX_MONITORING_AUTO_REFRESH_MS);
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
    const hasAutoRefreshParam = req.query?.autoRefreshMs !== undefined;
    const autoRefreshMs = normalizeAutoRefreshMs(req.query?.autoRefreshMs);

    const tenant = await getTenantAccessForMonitoring(req as any, id);
    if (!tenant.allowed) return res.status(403).json({ message: '您没有该资源池的访问权限' });

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const query = new URLSearchParams();
    query.set('silenced', 'false'); // 非静默告警
    query.set('inhibited', 'false'); // 非抑制告警
    const url = `${origin}/${ALERTMANAGER_PATH}?${query.toString()}`;
    const raw = await getJsonOnce(url, cloud.secretKey || '', insecure, true);
    let list: any[] = Array.isArray(raw) ? raw : (raw?.data ?? []) || [];
    list = list.filter((item: any) => {
      const receivers = Array.isArray(item?.receivers) ? item.receivers : [];
      return receivers.some((r: any) => isWebsiteReceiverInMonitoringNs(r?.name)); // 是否为站内信接收器
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
      res.json(hasAutoRefreshParam ? { data: list, total, autoRefreshMs } : { data: list, total });
    } else {  
      res.json(hasAutoRefreshParam ? { data: list, total, autoRefreshMs } : list);
    }
  } catch (e: any) {
    if (isUnreachableError(e)) {
      const hasPagination = req.query?.page !== undefined || req.query?.pageSize !== undefined;
      const hasAutoRefreshParam = req.query?.autoRefreshMs !== undefined;
      const autoRefreshMs = normalizeAutoRefreshMs(req.query?.autoRefreshMs);
      return res.status(200).json(
        hasPagination || hasAutoRefreshParam
          ? { data: [], total: 0, ...(hasAutoRefreshParam ? { autoRefreshMs } : {}) }
          : []
      );
    }
    if (res.headersSent) return;
    const status = (e as any).status || 500;
    res.status(status).json({ message: e?.message || '请求站内告警列表失败，请检查告警组件的健康状态' });
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
      const groupAliasName = String(meta.annotations?.[ANNOTATION_ALIAS] ?? '').trim();
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

export async function harvesterMonitoringPrometheusRuleDetailHandler(req: Request, res: Response) {
  try {
    const { id, namespace, name } = req.params;
    const tenant = await getTenantAccessForMonitoring(req as any, id);
    if (!tenant.allowed) return res.status(403).json({ message: '您没有该资源池的访问权限' });

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const ns = String(namespace ?? '').trim();
    const ruleName = String(name ?? '').trim();
    if (!ns || !ruleName) return res.status(400).json({ message: '缺少 namespace 或 prometheusrule 名称' });

    if (!tenant.isAdmin && tenant.namespaces.length > 0 && !tenant.namespaces.includes(ns)) {
      return res.status(403).json({ message: '您没有该命名空间的访问权限' });
    }

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const exclude =
      'exclude=metadata.managedFields&exclude=metadata.ownerReferences&exclude=metadata.relationships&exclude=metadata.fields&exclude=metadata.state';
    const url = `${origin}/${PROMETHEUSRULES_PATH}/${encodeURIComponent(ns)}/${encodeURIComponent(ruleName)}?${exclude}`;
    const raw = await getJsonOnce(url, cloud.secretKey || '', insecure, true);
    const item = (raw as any)?.data != null && typeof (raw as any).data === 'object' ? (raw as any).data : raw;
    res.json(item);
  } catch (e: any) {
    if (isUnreachableError(e)) return res.status(200).json({});
    if (res.headersSent) return;
    const status = (e as any).status || 500;
    res.status(status).json({ message: e?.message || '请求 PrometheusRule 详情失败' });
  }
}

export async function harvesterMonitoringPrometheusRuleUpdateHandler(req: Request, res: Response) {
  try {
    const { id, namespace, name } = req.params;
    const tenant = await getTenantAccessForMonitoring(req as any, id);
    if (!tenant.allowed) return res.status(403).json({ message: '您没有该资源池的访问权限' });

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const ns = String(namespace ?? '').trim();
    const ruleName = String(name ?? '').trim();
    if (!ns || !ruleName) return res.status(400).json({ message: '缺少 namespace 或 prometheusrule 名称' });

    if (!tenant.isAdmin && tenant.namespaces.length > 0 && !tenant.namespaces.includes(ns)) {
      return res.status(403).json({ message: '您没有该命名空间的访问权限' });
    }

    const payload =
      req.body && typeof req.body === 'object' ? { ...(req.body as Record<string, unknown>) } : null;
    if (!payload) return res.status(400).json({ message: '请求体必须为 PrometheusRule CR 对象' });

    const metadata =
      payload.metadata && typeof payload.metadata === 'object'
        ? { ...(payload.metadata as Record<string, unknown>) }
        : {};
    payload.metadata = {
      ...metadata,
      namespace: ns,
      name: ruleName,
    };

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const updateUrl = `${origin}/${PROMETHEUSRULES_PATH}/${encodeURIComponent(ns)}/${encodeURIComponent(ruleName)}`;
    const updated = await requestJson('PUT', updateUrl, cloud.secretKey || '', insecure, payload);

    try {
      const groupAliasName = String(
        (payload.metadata as any)?.annotations?.[ANNOTATION_ALIAS] ?? ''
      ).trim();
      if (groupAliasName) {
        const repo = AppDataSource.getRepository(PrometheusRulesGroup);
        let row = await repo.findOne({ where: { cloudId: id } });
        const rulesGroupMap: Record<string, string> = row?.data ? JSON.parse(row.data) : {};
        rulesGroupMap[ruleName] = groupAliasName;
        if (row) {
          row.data = JSON.stringify(rulesGroupMap);
          await repo.save(row);
        } else {
          await repo.save(repo.create({ cloudId: id, data: JSON.stringify(rulesGroupMap) }));
        }
      }
    } catch (dbErr: any) {
      console.warn('[monitoring] prometheus-rule update cache save failed:', dbErr?.message);
    }

    res.json(updated);
  } catch (e: any) {
    if (isUnreachableError(e)) return res.status(200).json({});
    if (res.headersSent) return;
    const status = (e as any).status || 500;
    res.status(status).json({ message: e?.message || '更新 PrometheusRule 失败' });
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

export async function harvesterMonitoringPrometheusDetailHandler(req: Request, res: Response) {
  try {
    const { id, namespace, name } = req.params;
    const tenant = await getTenantAccessForMonitoring(req as any, id);
    if (!tenant.allowed) return res.status(403).json({ message: '您没有该资源池的访问权限' });

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const ns = String(namespace || '').trim();
    const promName = String(name || '').trim();
    if (!ns || !promName) return res.status(400).json({ message: '缺少 namespace 或 prometheus 名称' });

    if (!tenant.isAdmin && tenant.namespaces.length > 0 && !tenant.namespaces.includes(ns)) {
      return res.status(403).json({ message: '您没有该命名空间的访问权限' });
    }

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const promUrl = `${origin}/v1/harvester/monitoring.coreos.com.prometheuses/${encodeURIComponent(ns)}/${encodeURIComponent(promName)}?${EXCLUDE}`;
    const promRaw = await getJsonOnce(promUrl, cloud.secretKey || '', insecure, true);
    const promObj = promRaw?.data ?? promRaw ?? {};

    const podList = await getJsonListByCandidatePaths(origin, cloud, insecure, MONITORING_POD_CANDIDATE_PATHS);
    const pods = normalizeList(podList)
      .filter((pod: any) => {
        const podNs = String(pod?.metadata?.namespace ?? '').trim();
        if (podNs !== ns) return false;
        const labels = (pod?.metadata?.labels ?? {}) as Record<string, string>;
        const labelProm = String(labels.prometheus ?? '').trim();
        const labelOperatorProm = String(labels['operator.prometheus.io/name'] ?? '').trim();
        const labelName = String(labels['app.kubernetes.io/name'] ?? '').trim().toLowerCase();
        const labelInstance = String(labels['app.kubernetes.io/instance'] ?? '').trim();
        const byDirectLabel = labelProm === promName || labelOperatorProm === promName;
        const byAppLabels = labelName === 'prometheus' && (labelInstance === promName || labelInstance.includes(promName));
        return byDirectLabel || byAppLabels;
      })
      .map((pod: any) => {
        const containerStatuses = Array.isArray(pod?.status?.containerStatuses) ? pod.status.containerStatuses : [];
        const ready = containerStatuses.length > 0 ? containerStatuses.every((cs: any) => cs?.ready === true) : false;
        const restartCount = containerStatuses.reduce((sum: number, cs: any) => sum + Number(cs?.restartCount ?? 0), 0);
        return {
          name: String(pod?.metadata?.name ?? '').trim(),
          namespace: String(pod?.metadata?.namespace ?? '').trim(),
          phase: String(pod?.status?.phase ?? '').trim(),
          ready,
          restartCount,
          nodeName: String(pod?.spec?.nodeName ?? '').trim(),
          podIP: String(pod?.status?.podIP ?? '').trim(),
          createdAt: String(pod?.metadata?.creationTimestamp ?? '').trim(),
        };
      });

    res.json({
      prometheus: promObj,
      pods,
    });
  } catch (e: any) {
    if (isUnreachableError(e)) return res.status(200).json({ prometheus: {}, pods: [] });
    if (res.headersSent) return;
    const status = (e as any).status || 500;
    res.status(status).json({ message: e?.message || '请求 Prometheus 详情失败' });
  }
}

export async function harvesterMonitoringPrometheusUpdateHandler(req: Request, res: Response) {
  try {
    const { id, namespace, name } = req.params;
    const tenant = await getTenantAccessForMonitoring(req as any, id);
    if (!tenant.allowed) return res.status(403).json({ message: '您没有该资源池的访问权限' });

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const ns = String(namespace ?? '').trim();
    const promName = String(name ?? '').trim();
    if (!ns || !promName) return res.status(400).json({ message: '缺少 namespace 或 prometheus 名称' });

    const payload =
      req.body && typeof req.body === 'object' ? { ...(req.body as Record<string, unknown>) } : null;
    if (!payload) return res.status(400).json({ message: '请求体必须为 Prometheus CR 对象' });

    const metadata =
      payload.metadata && typeof payload.metadata === 'object'
        ? { ...(payload.metadata as Record<string, unknown>) }
        : {};
    payload.metadata = {
      ...metadata,
      namespace: ns,
      name: promName,
    };

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const updateUrl = `${origin}/v1/harvester/monitoring.coreos.com.prometheuses/${encodeURIComponent(ns)}/${encodeURIComponent(promName)}`;
    const updated = await requestJson('PUT', updateUrl, cloud.secretKey || '', insecure, payload);
    res.json(updated);
  } catch (e: any) {
    if (isUnreachableError(e)) return res.status(200).json({});
    if (res.headersSent) return;
    const status = (e as any).status || 500;
    res.status(status).json({ message: e?.message || '更新 Prometheus 配置失败' });
  }
}

export async function harvesterMonitoringAlertmanagerDetailHandler(req: Request, res: Response) {
  try {
    const { id, namespace, name } = req.params;
    const tenant = await getTenantAccessForMonitoring(req as any, id);
    if (!tenant.allowed) return res.status(403).json({ message: '您没有该资源池的访问权限' });

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const ns = String(namespace ?? '').trim();
    const alertmanagerName = String(name ?? '').trim();
    if (!ns || !alertmanagerName) return res.status(400).json({ message: '缺少 namespace 或 alertmanager 名称' });

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const amUrl = `${origin}/v1/harvester/monitoring.coreos.com.alertmanagers/${encodeURIComponent(ns)}/${encodeURIComponent(alertmanagerName)}?${EXCLUDE}`;
    const amObj = await getJsonOnce(amUrl, cloud.secretKey || '', insecure, true);

    const allPods = await getJsonListByCandidatePaths(origin, cloud, insecure, MONITORING_POD_CANDIDATE_PATHS);
    const pods = allPods
      .filter((item: any) => {
        const meta = item?.metadata ?? {};
        const podNs = String(meta?.namespace ?? '').trim();
        if (podNs !== ns) return false;
        const labels = (meta?.labels ?? {}) as Record<string, string>;
        const labelAlertmanager = String(labels.alertmanager ?? '').trim();
        const labelOperatorName = String(labels['operator.prometheus.io/name'] ?? '').trim();
        const podName = String(meta?.name ?? '').trim();
        if (labelAlertmanager === alertmanagerName || labelOperatorName === alertmanagerName) return true;
        return podName.startsWith(`alertmanager-${alertmanagerName}-`);
      })
      .map((item: any) => {
        const meta = item?.metadata ?? {};
        const st = item?.status ?? {};
        const statuses = Array.isArray(st?.containerStatuses) ? st.containerStatuses : [];
        const ready = statuses.length > 0 ? statuses.every((c: any) => !!c?.ready) : false;
        const restartCount = statuses.reduce((sum: number, c: any) => sum + Number(c?.restartCount ?? 0), 0);
        return {
          name: String(meta?.name ?? '').trim(),
          namespace: String(meta?.namespace ?? '').trim(),
          phase: String(st?.phase ?? '').trim(),
          ready,
          restartCount,
          nodeName: String(st?.nodeName ?? '').trim(),
          podIP: String(st?.podIP ?? '').trim(),
          createdAt: String(meta?.creationTimestamp ?? '').trim(),
        };
      });

    res.json({
      alertmanager: amObj,
      pods,
    });
  } catch (e: any) {
    if (isUnreachableError(e)) return res.status(200).json({ alertmanager: {}, pods: [] });
    if (res.headersSent) return;
    const status = (e as any).status || 500;
    res.status(status).json({ message: e?.message || '请求 Alertmanager 详情失败' });
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
    const [prometheusList, serviceMonitorList, podMonitorList, statefulSetList] = await Promise.all([
      getJsonListByCandidatePaths(origin, cloud, insecure, MONITORING_PROMETHEUS_CANDIDATE_PATHS),
      getJsonListByCandidatePaths(origin, cloud, insecure, [MONITORING_SERVICE_MONITOR_PATH]),
      getJsonListByCandidatePaths(origin, cloud, insecure, [MONITORING_POD_MONITOR_PATH]),
      getJsonListByCandidatePaths(origin, cloud, insecure, MONITORING_STATEFULSET_CANDIDATE_PATHS),
    ]);

    const nsAllowed = !tenant.isAdmin && tenant.namespaces.length > 0 ? new Set(tenant.namespaces) : null;
    const filterByTenantNs = (items: any[]) =>
      nsAllowed ? items.filter((x) => nsAllowed.has(String(x?.metadata?.namespace ?? '').trim())) : items;

    const evaluatePrometheusHealthByStatefulSet = (status: any): {
      healthStatus: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
      healthReason: string;
      replicas: number;
      readyReplicas: number;
      availableReplicas: number;
      updatedReplicas: number;
    } => {
      const replicas = Number(status?.replicas ?? 0);
      const readyReplicas = Number(status?.readyReplicas ?? 0);
      const availableReplicas = Number(status?.availableReplicas ?? 0);
      const updatedReplicas = Number(status?.updatedReplicas ?? 0);

      if (!Number.isFinite(replicas) || replicas <= 0) {
        return {
          healthStatus: 'unknown',
          healthReason: 'StatefulSet 未上报有效 replicas',
          replicas: 0,
          readyReplicas: Number.isFinite(readyReplicas) ? readyReplicas : 0,
          availableReplicas: Number.isFinite(availableReplicas) ? availableReplicas : 0,
          updatedReplicas: Number.isFinite(updatedReplicas) ? updatedReplicas : 0,
        };
      }

      const safeReady = Number.isFinite(readyReplicas) ? readyReplicas : 0;
      const safeAvailable = Number.isFinite(availableReplicas) ? availableReplicas : 0;
      const safeUpdated = Number.isFinite(updatedReplicas) ? updatedReplicas : 0;

      if (safeReady <= 0 || safeAvailable <= 0) {
        return {
          healthStatus: 'unhealthy',
          healthReason: `StatefulSet 副本不可用（ready=${safeReady}, available=${safeAvailable}, replicas=${replicas}）`,
          replicas,
          readyReplicas: safeReady,
          availableReplicas: safeAvailable,
          updatedReplicas: safeUpdated,
        };
      }

      if (safeReady >= replicas && safeAvailable >= replicas && safeUpdated >= replicas) {
        return {
          healthStatus: 'healthy',
          healthReason: `StatefulSet 状态正常（ready/available/updated/replicas=${safeReady}/${safeAvailable}/${safeUpdated}/${replicas}）`,
          replicas,
          readyReplicas: safeReady,
          availableReplicas: safeAvailable,
          updatedReplicas: safeUpdated,
        };
      }

      return {
        healthStatus: 'degraded',
        healthReason: `StatefulSet 副本未完全就绪（ready/available/updated/replicas=${safeReady}/${safeAvailable}/${safeUpdated}/${replicas}）`,
        replicas,
        readyReplicas: safeReady,
        availableReplicas: safeAvailable,
        updatedReplicas: safeUpdated,
      };
    };

    const prometheusInstances = filterByTenantNs(prometheusList).map((item: any) => {
      const spec = item?.spec ?? {};
      const status = item?.status ?? {};
      const storageSpec = spec?.storage?.volumeClaimTemplate?.spec ?? {};
      const storageRequests = storageSpec?.resources?.requests ?? {};
      const storageAccessModes = Array.isArray(storageSpec?.accessModes)
        ? storageSpec.accessModes.map((x: any) => String(x ?? '').trim()).filter(Boolean)
        : [];
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
      const statefulSetName = `prometheus-${name}`;
      const matchedStatefulSet = statefulSetList.find((sts: any) => {
        const stsName = String(sts?.metadata?.name ?? '').trim();
        const stsNs = String(sts?.metadata?.namespace ?? '').trim();
        if (stsName === statefulSetName && stsNs === namespace) return true;

        const labels = (sts?.metadata?.labels ?? {}) as Record<string, string>;
        const labelProm = String(labels['operator.prometheus.io/name'] ?? labels.prometheus ?? '').trim();
        return stsNs === namespace && labelProm === name;
      });

      const healthBySts = matchedStatefulSet
        ? evaluatePrometheusHealthByStatefulSet(matchedStatefulSet?.status ?? {})
        : {
            healthStatus: 'unknown' as const,
            healthReason: '未找到对应 StatefulSet，无法判定副本状态',
            replicas: Number(spec.replicas ?? 1),
            readyReplicas: Number(status.readyReplicas ?? 0),
            availableReplicas: Number(status.availableReplicas ?? 0),
            updatedReplicas: Number(status.updatedReplicas ?? 0),
          };

      return {
        name,
        namespace,
        version: String(spec.version ?? '').trim(),
        image: String(spec.image ?? '').trim(),
        replicas: healthBySts.replicas,
        readyReplicas: healthBySts.readyReplicas,
        availableReplicas: healthBySts.availableReplicas,
        updatedReplicas: healthBySts.updatedReplicas,
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
        storageRequest: String(storageRequests?.storage ?? '').trim(),
        storageClassName: String(storageSpec?.storageClassName ?? '').trim(),
        storageAccessModes,
        storageVolumeMode: String(storageSpec?.volumeMode ?? '').trim(),
        serviceMonitorSelector: selectorToText(spec.serviceMonitorSelector),
        podMonitorSelector: selectorToText(spec.podMonitorSelector),
        createdAt: String(item?.metadata?.creationTimestamp ?? '').trim(),
        labels: item?.metadata?.labels && typeof item.metadata.labels === 'object' ? item.metadata.labels : {},
        healthStatus: healthBySts.healthStatus,
        healthReason: healthBySts.healthReason,
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

/**·
 * 获取 Prometheus 监控接入管理数据
 * @param req 请求对象
 * @param res 响应对象
 * @returns 响应数据
 */
export async function harvesterMonitoringPrometheusTargetsHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const tenant = await getTenantAccessForMonitoring(req as any, id);
    if (!tenant.allowed) return res.status(403).json({ message: '您没有该资源池的访问权限' });

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const search = String(req.query?.search ?? '').trim().toLowerCase();
    const targetsPath = `api/v1/namespaces/${encodeURIComponent(CATTLE_MONITORING_SYSTEM_NS)}/services/http:rancher-monitoring-prometheus:9090/proxy/api/v1/targets`;
    const url = `${origin}/${targetsPath}`;
    const raw = await getJsonOnce(url, cloud.secretKey || '', insecure, true);
    const activeTargets = Array.isArray(raw?.data?.activeTargets) ? raw.data.activeTargets : [];

    const nsAllowed = !tenant.isAdmin && tenant.namespaces.length > 0 ? new Set(tenant.namespaces) : null;
    const list: PrometheusTarget[] = activeTargets
      .map((item: any): PrometheusTarget => {
        const labels = item?.labels && typeof item.labels === 'object' ? item.labels : {};
        const healthRaw = String(item?.health ?? '').trim().toLowerCase();
        const normalizedHealth =
          healthRaw === 'up' ? 'up' : healthRaw === 'down' ? 'down' : healthRaw || 'unknown';
        const rawDuration = Number(item?.lastScrapeDuration ?? 0);
        return {
          namespace: String(labels?.namespace ?? '').trim(),
          job: String(labels?.job ?? '').trim(),
          service: String(labels?.service ?? '').trim(),
          pod: String(labels?.pod ?? '').trim(),
          container: String(labels?.container ?? '').trim(),
          endpoint: String(labels?.endpoint ?? '').trim(),
          instance: String(labels?.instance ?? '').trim(),
          scrapePool: String(item?.scrapePool ?? '').trim(),
          scrapeUrl: String(item?.scrapeUrl ?? '').trim(),
          globalUrl: String(item?.globalUrl ?? '').trim(),
          health: normalizedHealth,
          lastError: String(item?.lastError ?? '').trim(),
          lastScrape: String(item?.lastScrape ?? '').trim(),
          lastScrapeDuration: Number.isFinite(rawDuration) ? rawDuration : 0,
          scrapeInterval: String(item?.scrapeInterval ?? '').trim(),
          scrapeTimeout: String(item?.scrapeTimeout ?? '').trim(),
          labels,
        };
      })
      .filter((item: PrometheusTarget) => {
        if (!nsAllowed) return true;
        return nsAllowed.has(item.namespace);
      })
      .filter((item: PrometheusTarget) => {
        if (!search) return true;
        const haystack = [
          item.namespace,
          item.job,
          item.service,
          item.pod,
          item.container,
          item.endpoint,
          item.instance,
          item.scrapePool,
          item.scrapeUrl,
          item.lastError,
          JSON.stringify(item.labels ?? {}),
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(search);
      });

    const tasksByJob = new Map<
      string,
      { task: PrometheusMonitorTask; endpointMap: Map<string, PrometheusTaskEndpoint> }
    >();
    for (const target of list) {
      const taskKey = `${target.namespace}|${target.job || '__unknown_job__'}`;
      let bucket = tasksByJob.get(taskKey);
      if (!bucket) {
        bucket = {
          task: {
            namespace: target.namespace,
            job: target.job,
            service: target.service,
            scrapePool: target.scrapePool,
            total: 0,
            upCount: 0,
            downCount: 0,
            endpoints: [],
          },
          endpointMap: new Map<string, PrometheusTaskEndpoint>(),
        };
        tasksByJob.set(taskKey, bucket);
      } else {
        if (!bucket.task.service && target.service) bucket.task.service = target.service;
        if (!bucket.task.scrapePool && target.scrapePool) bucket.task.scrapePool = target.scrapePool;
      }

      const endpointKey = target.endpoint || '__unknown_endpoint__';
      let endpointBucket = bucket.endpointMap.get(endpointKey);
      if (!endpointBucket) {
        endpointBucket = {
          endpoint: target.endpoint,
          total: 0,
          upCount: 0,
          downCount: 0,
          targets: [],
        };
        bucket.endpointMap.set(endpointKey, endpointBucket);
        bucket.task.endpoints.push(endpointBucket);
      }
      endpointBucket.targets.push(target);
      endpointBucket.total += 1;
      bucket.task.total += 1;
      if (target.health === 'up') {
        endpointBucket.upCount += 1;
        bucket.task.upCount += 1;
      } else {
        endpointBucket.downCount += 1;
        bucket.task.downCount += 1;
      }
    }

    const monitorTasks: PrometheusMonitorTask[] = Array.from(tasksByJob.values())
      .map((x) => x.task)
      .sort((a, b) => {
        if (a.namespace !== b.namespace) return a.namespace.localeCompare(b.namespace);
        return a.job.localeCompare(b.job);
      });

    res.json({ targets: list, monitorTasks });
  } catch (e: any) {
    if (isUnreachableError(e)) return res.status(200).json({ targets: [], monitorTasks: [] });
    if (res.headersSent) return;
    const status = (e as any).status || 500;
    res.status(status).json({ message: e?.message || '请求 Prometheus Targets 失败' });
  }
}