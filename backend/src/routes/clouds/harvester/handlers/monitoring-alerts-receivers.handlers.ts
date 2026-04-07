/**
 * Harvester Monitoring Alerts Receivers Handlers
 * 告警通知对象相关操作（通知对象列表、校验、创建/更新、删除，包含钉钉集成逻辑）
 */

import { Request, Response } from 'express';
import { requestJson } from '../../../../services/clouds/harvester/utils';
import { ensureProvider, normalizeOrigin } from './monitoring-helpers';
import {
  PAGESIZE,
  ALERTMANAGERCONFIG_BASE,
  MONITORING_RECEIVER_LABEL_SELECTOR,
  EMAIL_RECEIVER,
  DINGTALK_RECEIVER,
  WEBSITE_RECEIVER,
  DINGTALK_WEBHOOK_BASE,
  isUnreachableError,
  requireTenantAccessForMonitoring,
  isValidReceiverConfigName,
  parseQueryArray,
  removeDingtalkConfigMapTarget,
  updateDingtalkConfigMapTargets,
  syncPoliciesReceiverSpecsAfterReceiverConfigUpdate,
  collectReceiverNamesFromRoute,
} from './monitoring-helpers';
import { getJsonOnce } from '../../../../services/clouds/harvester/utils';

const DEFAULT_RECEIVER_NAMES = [EMAIL_RECEIVER, DINGTALK_RECEIVER, WEBSITE_RECEIVER];

export async function harvesterMonitoringAlertmanagerConfigsReceiversHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const namespaces = parseQueryArray(req.query?.namespaces);
    let receiverNames = parseQueryArray(req.query?.receiverName);
    if (receiverNames.length === 0) receiverNames = [...DEFAULT_RECEIVER_NAMES];
    const tenant = await requireTenantAccessForMonitoring(req as any, res, id, { namespaces });
    if (!tenant) return;

    const cloud = (req as any).cloud;
    const receivers: any[] = [];
    const nsFilter = namespaces.length > 0 ? namespaces : null;

    if (!cloud) {
      return res.json({ receivers });
    }

    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const labelQs = `&labelSelector=${encodeURIComponent(MONITORING_RECEIVER_LABEL_SELECTOR)}`;
    const url = `${origin}/${ALERTMANAGERCONFIG_BASE}?${PAGESIZE}${labelQs}`;
    const raw = await getJsonOnce(url, cloud.secretKey || '', insecure, true);
    const harvesterList: any[] = Array.isArray(raw?.data) ? raw.data : [];

    for (const item of harvesterList) {
      const inner = item?.data ?? item;
      const ns = (inner?.metadata?.namespace ?? '').toString().trim();
      const name = (inner?.metadata?.name ?? '').toString().trim();
      if (!ns || !name) continue;
      if (nsFilter?.length && !nsFilter.includes(ns)) continue;
      if (!tenant.isAdmin && tenant.namespaces.length > 0 && !tenant.namespaces.includes(ns)) continue;
      if (!receiverNames.includes(name)) continue;

      const spec = inner?.spec ?? {};
      const meta = inner?.metadata ?? {};
      const rawReceivers = Array.isArray(spec.receivers) ? spec.receivers : [];
      const creator = meta?.annotations?.['cloudhci.io/creator'];
      const createdAt = meta?.creationTimestamp ? String(meta.creationTimestamp) : undefined;

      const specReceivers = rawReceivers.map((r: any) => ({
        ...r,
        creator: creator ?? undefined,
        createdAt: createdAt ?? undefined,
      }));

      if (specReceivers.length > 0) {
        receivers.push({ namespace: ns, receiverName: name, specReceivers });
      }
    }

    res.json({ receivers });
  } catch (e: any) {
    if (res.headersSent) return;
    const status = (e as any).status || 500;
    res.status(status).json({ message: e?.message || '获取通知对象列表失败' });
  }
}

export async function harvesterMonitoringAlertmanagerConfigsReceiversCheckHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const namespace = (req.query?.namespace ?? '').toString().trim();
    const specReceiverName = (req.query?.specReceiverName ?? '').toString().trim();
    const receiverType = (req.query?.receiverType ?? '').toString().trim();
    if (!namespace || !specReceiverName) {
      return res.status(400).json({ message: 'namespace 与 specReceiverName 不能为空' });
    }
    const tenant = await requireTenantAccessForMonitoring(req as any, res, id, { namespaces: [namespace] });
    if (!tenant) return;

    const cloud = (req as any).cloud;
    const configName = receiverType && isValidReceiverConfigName(receiverType) ? receiverType : EMAIL_RECEIVER;
    let exists = false;
    if (cloud) {
      if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

      const insecure = !!(cloud.config as any)?.ignoreTls;
      const origin = normalizeOrigin(cloud.endpoint || '');
      try {
        const path = `${ALERTMANAGERCONFIG_BASE}/${encodeURIComponent(namespace)}/${encodeURIComponent(configName)}`;
        const raw = await getJsonOnce(`${origin}/${path}`, cloud.secretKey || '', insecure, true);
        const item = (raw as any)?.data != null && typeof (raw as any).data === 'object' ? (raw as any).data : raw;
        const receivers = Array.isArray(item?.spec?.receivers) ? item.spec.receivers : [];
        exists = receivers.some((r: any) => (r?.name ?? '').toString().trim() === specReceiverName);
      } catch {
        /* 404 or error => exists false */
      }
    }
    res.json({ exists });
  } catch (e: any) {
    if (res.headersSent) return;
    const status = (e as any).status || 500;
    res.status(status).json({ message: e?.message || '校验失败' });
  }
}

// 处理邮件/站内信接收器
async function processEmailReceivers(
  conn: { origin: string; token: string; insecure: boolean },
  ns: string,
  name: string,
  body: any,
  res: Response,
  path: string,
  getUrl: string
): Promise<Response | void> {
  const normalizeReceivers = (receivers: any[]) => (Array.isArray(receivers) ? receivers : []);
  let existingRaw: any = null;
  const exists = await getJsonOnce(getUrl, conn.token, conn.insecure, true)
    .then((data) => {
      existingRaw = data;
      return true;
    })
    .catch((err: any) => (err?.status === 404 || err?.statusCode === 404 ? false : Promise.reject(err)));
  if (!exists) {
    const rawReceivers = Array.isArray(body?.spec?.receivers) ? body.spec.receivers : [];
    const createPayload = {
      ...body,
      spec: { ...(body?.spec || {}), receivers: normalizeReceivers(rawReceivers) },
      metadata: {
        ...(body?.metadata || {}),
        namespace: ns,
        name,
        labels: { ...(body?.metadata?.labels || {}), 'monitoring-receiver': 'true' },
      },
    };
    const data = await requestJson('POST', `${conn.origin}/${ALERTMANAGERCONFIG_BASE}`, conn.token, conn.insecure, createPayload);
    return res.status(201).json(data);
  }
  const existing = (existingRaw as any)?.data != null && typeof (existingRaw as any).data === 'object' ? (existingRaw as any).data : existingRaw;
  if (!existing?.spec) {
    return res.status(500).json({ message: '通知对象配置异常' });
  }
  const rawReceivers = Array.isArray(body?.spec?.receivers) ? body.spec.receivers : (existing.spec.receivers || []);
  existing.spec.receivers = normalizeReceivers(rawReceivers);
  if (!existing.metadata) existing.metadata = {};
  if (existing.metadata.labels?.['monitoring-receiver'] !== 'true') {
    existing.metadata.labels = { ...(existing.metadata.labels || {}), 'monitoring-receiver': 'true' };
  }
  const data = await requestJson('PUT', `${conn.origin}/${path}`, conn.token, conn.insecure, existing);
  try {
    await syncPoliciesReceiverSpecsAfterReceiverConfigUpdate(conn, ns, existing.spec.receivers);
  } catch (e) {
    console.warn('[processEmailReceivers] syncPoliciesReceiverSpecs failed:', e);
  }
  return res.json(data);
}

// 处理钉钉接收器
async function processDingtalkReceivers(
  conn: { origin: string; token: string; insecure: boolean },
  ns: string,
  name: string,
  body: any,
  res: Response,
  path: string,
  getUrl: string
): Promise<Response | void> {
  const normalizeReceiversForDingtalk = (receivers: any[]): any[] => {
    if (!Array.isArray(receivers)) return receivers;
    return receivers.map((r: any) => {
      const specReceiverName = (r?.name ?? '').toString().trim();
      const webhookConfigs = Array.isArray(r.webhookConfigs) ? r.webhookConfigs : [];
      let normalized = webhookConfigs.map((wc: any) => {
        const robotAccount =
          (wc as any)?.robotAccount ?? (r as any)?.robotAccount ?? `${ns}_${specReceiverName}`;
        const explicitUrl = (r?.url ?? (wc as any)?.url ?? '').toString().trim();
        const url = explicitUrl || `${DINGTALK_WEBHOOK_BASE}/${robotAccount}/send`;
        return {
          url,
          sendResolved: (wc as any)?.sendResolved !== false,
        };
      });
      if (normalized.length === 0 && specReceiverName) {
        const robotAccount = `${ns}_${specReceiverName}`;
        normalized = [{ url: `${DINGTALK_WEBHOOK_BASE}/${robotAccount}/send`, sendResolved: true }];
      }
      return { ...r, webhookConfigs: normalized };
    });
  };
  let existingRaw: any = null;
  const exists = await getJsonOnce(getUrl, conn.token, conn.insecure, true)
    .then((data) => {
      existingRaw = data;
      return true;
    })
    .catch((err: any) => (err?.status === 404 || err?.statusCode === 404 ? false : Promise.reject(err)));
  if (!exists) {
    const rawReceivers = Array.isArray(body?.spec?.receivers) ? body.spec.receivers : [];
    if (rawReceivers.length > 0) {
      try {
        await updateDingtalkConfigMapTargets(conn, ns, rawReceivers);
      } catch (e: any) {
        const status = (e as any)?.status ?? (e as any)?.statusCode ?? 500;
        const msg = e?.message || '更新钉钉Webhook配置文件失败';
        if (status >= 500) console.error('[dingtalk-receiver] updateDingtalkWebhookConfig:', e);
        return res.status(status).json({ message: msg });
      }
    }
    const createPayload = {
      ...body,
      spec: { ...(body?.spec || {}), receivers: normalizeReceiversForDingtalk(rawReceivers) },
      metadata: {
        ...(body?.metadata || {}),
        namespace: ns,
        name,
        labels: { ...(body?.metadata?.labels || {}), 'monitoring-receiver': 'true' },
      },
    };
    const data = await requestJson('POST', `${conn.origin}/${ALERTMANAGERCONFIG_BASE}`, conn.token, conn.insecure, createPayload);
    return res.status(201).json(data);
  }
  const existing = (existingRaw as any)?.data != null && typeof (existingRaw as any).data === 'object' ? (existingRaw as any).data : existingRaw;
  if (!existing?.spec) {
    return res.status(500).json({ message: '通知对象配置异常' });
  }
  const rawReceivers = Array.isArray(body?.spec?.receivers) ? body.spec.receivers : (existing.spec.receivers || []);
  if (rawReceivers.length > 0) {
    try {
      await updateDingtalkConfigMapTargets(conn, ns, rawReceivers);
    } catch (e: any) {
      const status = (e as any)?.status ?? (e as any)?.statusCode ?? 500;
      const msg = e?.message || '更新钉钉 Webhook ConfigMap 失败';
      if (status >= 500) console.error('[dingtalk-receiver] updateDingtalkConfigMapTargets:', e);
      return res.status(status).json({ message: msg });
    }
  }
  existing.spec.receivers = normalizeReceiversForDingtalk(rawReceivers);
  if (!existing.metadata) existing.metadata = {};
  if (existing.metadata.labels?.['monitoring-receiver'] !== 'true') {
    existing.metadata.labels = { ...(existing.metadata.labels || {}), 'monitoring-receiver': 'true' };
  }
  const data = await requestJson('PUT', `${conn.origin}/${path}`, conn.token, conn.insecure, existing);
  try {
    await syncPoliciesReceiverSpecsAfterReceiverConfigUpdate(conn, ns, existing.spec.receivers);
  } catch (e) {
    console.warn('[processDingtalkReceivers] syncPoliciesReceiverSpecs failed:', e);
  }
  return res.json(data);
}

export async function harvesterMonitoringAlertmanagerConfigsReceiversCreateUpdateHandler(req: Request, res: Response) {
  try {
    const { id, namespace: ns, name } = req.params;
    if (!ns) return res.status(400).json({ message: '命名空间不能为空' });
    if (!isValidReceiverConfigName(name)) {
      return res.status(400).json({ message: '通知方式必须是邮件、钉钉或站内信之一' });
    }
    const tenant = await requireTenantAccessForMonitoring(req as any, res, id, {
      namespaces: [ns],
      forbiddenMessage: '仅能在您有权限的命名空间下操作告警通知对象',
    });
    if (!tenant) return;

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const path = `${ALERTMANAGERCONFIG_BASE}/${encodeURIComponent(ns)}/${encodeURIComponent(name)}`;
    const getUrl = `${origin}/${path}`;
    const conn = { origin, token: cloud.secretKey || '', insecure };

    const body = req.body || {};
    if (name === EMAIL_RECEIVER) {
      return await processEmailReceivers(conn, ns, name, body, res, path, getUrl);
    }
    if (name === DINGTALK_RECEIVER) {
      return await processDingtalkReceivers(conn, ns, name, body, res, path, getUrl);
    }
    if (name === WEBSITE_RECEIVER) {
      const websitePayload = {
        apiVersion: 'monitoring.coreos.com/v1alpha1',
        kind: 'AlertmanagerConfig',
        metadata: { name: WEBSITE_RECEIVER, namespace: ns, labels: { 'monitoring-receiver': 'true' } },
        spec: { receivers: [{ name: WEBSITE_RECEIVER }] },
      };
      return await processEmailReceivers(conn, ns, name, websitePayload, res, path, getUrl);
    }
    return res.status(400).json({ message: '不支持的通知方式' });
  } catch (e: any) {
    if (res.headersSent) return;
    const status = (e as any)?.status ?? (e as any)?.statusCode ?? 500;
    const msg = e?.message || '创建或更新告警通知对象失败';
    if (status >= 500) console.error('[alertmanagerconfigs/receivers]', e);
    res.status(status).json({ message: msg });
  }
}

export async function harvesterMonitoringAlertmanagerConfigsReceiversDeleteHandler(req: Request, res: Response) {
  try {
    const { id, namespace, name } = req.params;
    const specReceiverName = (req.query.specReceiverName ?? '').toString().trim();
    if (!specReceiverName) {
      return res.status(400).json({ message: '需要删除的通知对象名称不能为空' });
    }
    const tenant = await requireTenantAccessForMonitoring(req as any, res, id, { namespaces: [namespace] });
    if (!tenant) return;

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    if (!isValidReceiverConfigName(name)) {
      return res.status(400).json({ message: '通知方式必须是邮件、钉钉或站内信之一' });
    }

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const path = `${ALERTMANAGERCONFIG_BASE}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
    const getUrl = `${origin}/${path}`;
    const conn = { origin, token: cloud.secretKey || '', insecure };

    // 删除前检查是否被告警策略引用
    try {
      const listUrl = `${origin}/${ALERTMANAGERCONFIG_BASE}?${PAGESIZE}&exclude=metadata.managedFields&exclude=metadata.ownerReferences`;
      const listRaw = await getJsonOnce(listUrl, conn.token, conn.insecure, true);
      const listItems: any[] = Array.isArray(listRaw?.data) ? listRaw.data : [];
      const receiverConfigNames = new Set([EMAIL_RECEIVER, DINGTALK_RECEIVER, WEBSITE_RECEIVER]);
      const referencedPolicies: string[] = [];
      for (const item of listItems) {
        const inner = item?.data ?? item;
        const policyName = (inner?.metadata?.name ?? '').toString().trim();
        const ns = (inner?.metadata?.namespace ?? '').toString().trim();
        if (ns !== namespace || receiverConfigNames.has(policyName)) continue;
        const route = inner?.spec?.route ?? {};
        const refs = collectReceiverNamesFromRoute(route);
        if (refs.includes(specReceiverName)) referencedPolicies.push(policyName);
      }
      if (referencedPolicies.length > 0) {
        return res.status(400).json({
          message: '该通知对象已被以下策略引用，请先解除关联',
          policies: referencedPolicies,
        });
      }
    } catch (e: any) {
      const status = (e as any)?.status ?? (e as any)?.statusCode ?? 500;
      if (status >= 500) console.warn('[DELETE receivers] policy-references check failed:', e);
    }

    const raw = await getJsonOnce(getUrl, conn.token, conn.insecure, true);
    const existing = (raw as any)?.data != null && typeof (raw as any).data === 'object' ? (raw as any).data : raw;
    if (!existing?.spec) {
      return res.status(404).json({ message: '未找到该通知对象名称' });
    }
    const receivers = Array.isArray(existing.spec.receivers) ? existing.spec.receivers : [];
    const toRemove = receivers.find((r: any) => (r?.name ?? '').toString().trim() === specReceiverName);
    const nextReceivers = receivers.filter((r: any) => (r?.name ?? '').toString().trim() !== specReceiverName);
    if (nextReceivers.length === receivers.length) {
      return res.status(404).json({ message: '未找到该通知对象名称' });
    }
    if (name === DINGTALK_RECEIVER && toRemove) {
      const robotAccount =
        ((toRemove as any)?.webhookConfigs?.[0] as any)?.robotAccount ??
        (toRemove as any)?.robotAccount ??
        `${namespace}_${specReceiverName}`;
      try {
        await removeDingtalkConfigMapTarget(conn, robotAccount);
      } catch (e: any) {
        const status = (e as any)?.status ?? (e as any)?.statusCode ?? 500;
        const msg = e?.message || '移除钉钉 Webhook ConfigMap target 失败';
        if (status >= 500) console.error('[dingtalk-receiver] removeDingtalkConfigMapTarget:', e);
        return res.status(status).json({ message: msg });
      }
    }
    existing.spec.receivers = nextReceivers;
    await requestJson('PUT', `${origin}/${path}`, conn.token, conn.insecure, existing);
    res.status(204).send();
  } catch (e: any) {
    if (Number((e as any)?.status) === 404) {
      return res.status(404).json({ message: e?.message || '未找到该通知对象名称' });
    }
    if (res.headersSent) return;
    const status = (e as any).status || 500;
    res.status(status).json({ message: e?.message || '删除通知对象失败' });
  }
}
