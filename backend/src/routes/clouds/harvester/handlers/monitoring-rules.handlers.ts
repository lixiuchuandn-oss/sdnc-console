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