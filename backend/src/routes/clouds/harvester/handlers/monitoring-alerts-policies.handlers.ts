/**
 * Harvester Monitoring Alerts Policies Handlers
 * 告警策略相关操作（策略列表、策略详情、创建策略、更新策略、删除策略、策略引用查询）
 */

import { Request, Response } from 'express';
import { requestJson } from '../../../../services/clouds/harvester/utils';
import { ensureProvider, normalizeOrigin } from './monitoring-helpers';
import {
  PAGESIZE,
  ALERTMANAGERCONFIG_BASE,
  isUnreachableError,
  getTenantAccessForMonitoring,
  requireTenantAccessForMonitoring,
  extractAlertNamesFromSpec,
  isPolicyAlertmanagerConfig,
  isMonitoringReceiverConfigMeta,
  normalizePolicySpec,
  collectReceiverNamesFromRoute,
} from './monitoring-helpers';
import { getJsonOnce } from '../../../../services/clouds/harvester/utils';

export async function harvesterMonitoringAlertmanagerConfigsHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const tenant = await getTenantAccessForMonitoring(req as any, id);
    if (!tenant.allowed) return res.status(403).json({ message: '您没有该资源池的访问权限' });

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const url = `${origin}/${ALERTMANAGERCONFIG_BASE}?${PAGESIZE}&exclude=metadata.managedFields&exclude=metadata.ownerReferences`;
    const raw = await getJsonOnce(url, cloud.secretKey || '', insecure, true);
    let list: any[] = Array.isArray(raw?.data) ? raw.data : (Array.isArray(raw) ? raw : []);
    // 接收器 CR（含历史共享与新模型 per-target）通过 label monitoring-receiver=true 识别
    list = list.filter((item: any) => {
      const inner = item?.data ?? item;
      return !isMonitoringReceiverConfigMeta(inner?.metadata ?? {});
    });
    if (!tenant.isAdmin && tenant.namespaces.length > 0) {
      const allowedSet = new Set(tenant.namespaces);
      list = list.filter((item: any) => {
        const inner = item?.data ?? item;
        const ns = (inner?.metadata?.namespace ?? item?.namespace ?? '').toString().trim();
        return allowedSet.has(ns);
      });
    }
    const alertNameFilter = (req.query?.alertName ?? '').toString().trim();
    if (alertNameFilter) {
      list = list.filter((item: any) => {
        const inner = item?.data ?? item;
        const spec = inner?.spec ?? {};
        const meta = inner?.metadata ?? {};
        const annotations = meta?.annotations && typeof meta.annotations === 'object' ? meta.annotations : {};
        const names = extractAlertNamesFromSpec(spec, annotations);
        return names.includes(alertNameFilter);
      });
    }
    const normalized = list.map((item: any) => {
      const inner = item?.data ?? item;
      const meta = inner?.metadata ?? {};
      const name = (meta?.name ?? inner?.name ?? '').toString().trim();
      const ns = (meta?.namespace ?? '').toString().trim();
      return {
        id: `${ns}/${name}`,
        metadata: { ...meta, name, namespace: ns },
        spec: inner?.spec ?? {},
      };
    });
    res.json({ data: normalized });
  } catch (e: any) {
    if (isUnreachableError(e)) return res.status(200).json({ data: [] });
    if (Number((e as any)?.status) === 502) return res.status(200).json({ data: [] });
    if (res.headersSent) return;
    const status = (e as any).status || 500;
    res.status(status).json({ message: e?.message || '请求告警通知策略失败' });
  }
}

export async function harvesterMonitoringAlertmanagerConfigsPolicyReceiversHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const namespace = (req.query?.namespace ?? '').toString().trim();
    const specReceiverName = (req.query?.specReceiverName ?? '').toString().trim();
    const tenant = await requireTenantAccessForMonitoring(req as any, res, id);
    if (!tenant) return;

    const list: Array<{ namespace: string; policyName: string; receiverType?: string }> = [];
    const cloud = (req as any).cloud;
    if (!cloud || !specReceiverName) {
      return res.json({ data: list });
    }

    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const url = `${origin}/${ALERTMANAGERCONFIG_BASE}?${PAGESIZE}&exclude=metadata.managedFields&exclude=metadata.ownerReferences`;
    const raw = await getJsonOnce(url, cloud.secretKey || '', insecure, true);
    const items: any[] = Array.isArray(raw?.data) ? raw.data : [];
    for (const item of items) {
      const inner = item?.data ?? item;
      const policyName = (inner?.metadata?.name ?? '').toString().trim();
      const ns = (inner?.metadata?.namespace ?? '').toString().trim();
      // 跳过接收器 CR（label monitoring-receiver=true，含历史共享与新模型）
      if (isMonitoringReceiverConfigMeta(inner?.metadata ?? {})) continue;
      if (namespace && ns !== namespace) continue;
      if (!tenant.isAdmin && tenant.namespaces.length > 0 && !tenant.namespaces.includes(ns)) continue;
      const route = inner?.spec?.route ?? {};
      const refs = collectReceiverNamesFromRoute(route);
      if (refs.includes(specReceiverName)) {
        list.push({ namespace: ns, policyName });
      }
    }
    res.json({ data: list });
  } catch (e: any) {
    if (res.headersSent) return;
    const status = (e as any).status || 500;
    res.status(status).json({ message: e?.message || '查询失败' });
  }
}

export async function harvesterMonitoringAlertmanagerConfigsDetailHandler(req: Request, res: Response) {
  try {
    const { id, namespace, name } = req.params;
    const tenant = await requireTenantAccessForMonitoring(req as any, res, id, { namespaces: [namespace] });
    if (!tenant) return;

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const path = `${ALERTMANAGERCONFIG_BASE}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
    const excludeQs = 'exclude=metadata.managedFields&exclude=metadata.ownerReferences';
    const url = `${origin}/${path}?${excludeQs}`;
    const data = await getJsonOnce(url, cloud.secretKey || '', insecure, true);
    res.json(data);
  } catch (e: any) {
    if (isUnreachableError(e)) return res.status(200).json({});
    if (res.headersSent) return;
    const status = (e as any).status || 500;
    res.status(status).json({ message: e?.message || '请求配置详情失败' });
  }
}

export async function harvesterMonitoringAlertmanagerConfigsCreateHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const ns = (body?.metadata?.namespace ?? '').toString().trim();
    const name = (body?.metadata?.name ?? '').toString().trim();
    if (!ns || !name) {
      return res.status(400).json({ message: 'body 中 metadata.namespace 与 metadata.name 不能为空' });
    }
    const tenant = await requireTenantAccessForMonitoring(req as any, res, id, {
      namespaces: [ns],
      forbiddenMessage: '仅能在您有权限的命名空间下创建告警配置',
    });
    if (!tenant) return;

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    // 优先按 body.metadata 判定（label monitoring-receiver=true 视为接收器 CR，不走策略 spec 归一化）
    const payload = isPolicyAlertmanagerConfig(body?.metadata ?? name)
      ? { ...body, spec: normalizePolicySpec(body.spec) }
      : body;
    const data = await requestJson('POST', `${origin}/${ALERTMANAGERCONFIG_BASE}`, cloud.secretKey || '', insecure, payload);
    res.status(201).json(data);
  } catch (e: any) {
    if (res.headersSent) return;
    const status = (e as any).status || 500;
    res.status(status).json({ message: e?.message || '创建告警配置失败' });
  }
}

export async function harvesterMonitoringAlertmanagerConfigsUpdateHandler(req: Request, res: Response) {
  try {
    const { id, namespace, name } = req.params;
    const tenant = await requireTenantAccessForMonitoring(req as any, res, id, {
      namespaces: [namespace],
      forbiddenMessage: '无权修改该命名空间下的告警通知策略',
    });
    if (!tenant) return;

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const path = `${ALERTMANAGERCONFIG_BASE}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
    const body = req.body || {};
    // 优先按 body.metadata 判定（label monitoring-receiver=true 视为接收器 CR，不走策略 spec 归一化）
    const payload = isPolicyAlertmanagerConfig(body?.metadata ?? name)
      ? { ...body, spec: normalizePolicySpec(body.spec) }
      : body;
    const data = await requestJson('PUT', `${origin}/${path}`, cloud.secretKey || '', insecure, payload);
    res.json(data);
  } catch (e: any) {
    if (res.headersSent) return;
    const status = (e as any).status || 500;
    res.status(status).json({ message: e?.message || '更新告警通知策略失败' });
  }
}

export async function harvesterMonitoringAlertmanagerConfigsDeleteHandler(req: Request, res: Response) {
  try {
    const { id, namespace, name } = req.params;
    const tenant = await requireTenantAccessForMonitoring(req as any, res, id, {
      namespaces: [namespace],
      forbiddenMessage: '无权删除该命名空间下的告警通知策略',
    });
    if (!tenant) return;

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const path = `${ALERTMANAGERCONFIG_BASE}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
    await requestJson('DELETE', `${origin}/${path}`, cloud.secretKey || '', insecure);
    res.status(204).send();
  } catch (e: any) {
    if (res.headersSent) return;
    const status = (e as any).status || 500;
    res.status(status).json({ message: e?.message || '删除告警通知策略失败' });
  }
}