/**
 * Harvester Monitoring Alerts Policies Handlers
 * 告警通知策略 CRUD（基于 AlertmanagerConfig CR，对外暴露结构化 AlertmanagerPolicy）
 *
 * 与「通知对象」(AlertmanagerConfig CR 带 label monitoring-receiver=true) 的区分：
 *   - 列表/详情：仅返回 **非接收器 CR** 解析出的 AlertmanagerPolicy（自动过滤 label monitoring-receiver=true）
 *   - 创建/更新：接收前端结构化 payload {name, namespace, aliasName, description, receivers, alertNames, ...}，
 *     由 buildAlertmanagerConfigCRFromPolicyPayload 序列化为 CR，再调 Harvester
 *
 * 字段口径（与 monitoring-helpers.ts 中的 AlertmanagerPolicy 同步）：
 *   - aliasName  ← annotations['tower.io/alias']
 *   - name       ← metadata.name
 *   - namespace  ← metadata.namespace
 *   - description ← annotations['tower.io/description'] || annotations['description']
 *   - receivers  ← spec.receivers + 关联通知对象 CR 的 receiverType / aliasName
 *   - route      ← 完整 route（预留，UI 不消费）
 *   - subRoute   ← routes[0]，含 alertNames（唯一可信源：sub-route matchers）
 */

import { Request, Response } from 'express';
import { requestJson } from '../../../../services/clouds/harvester/utils';
import {
  PAGESIZE,
  ALERTMANAGERCONFIG_BASE,
  MONITORING_RECEIVER_LABEL_SELECTOR,
  isUnreachableError,
  ensureProvider,
  normalizeOrigin,
  getTenantAccessForMonitoring,
  requireTenantAccessForMonitoring,
  extractAlertNamesFromPolicyCR,
  isMonitoringReceiverConfigMeta,
  normalizePolicySpec,
  collectReceiverNamesFromRoute,
  buildAlertmanagerPolicyFromCR,
  buildReceiverRefIndexFromReceiverCRs,
  joinReceiverRefsForPolicies,
  buildAlertmanagerConfigCRFromPolicyPayload,
  type AlertmanagerPolicy,
  type UpsertAlertmanagerPolicyPayload,
} from './monitoring-helpers';
import { getJsonOnce } from '../../../../services/clouds/harvester/utils';

interface UpsertRequestBody extends Partial<UpsertAlertmanagerPolicyPayload> {
  /** 兼容直接透传 CR 的兜底（不推荐；仅做错误提示用） */
  apiVersion?: string;
  kind?: string;
  metadata?: any;
  spec?: any;
}

function validateUpsertPayload(body: UpsertRequestBody): {
  ok: boolean;
  error?: string;
  payload?: UpsertAlertmanagerPolicyPayload;
} {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: '请求体不能为空' };
  }
  // 防呆：仍按旧的 CR shape 提交（带 kind/apiVersion/spec.route）时给出明确错误
  if (body.kind || body.apiVersion || body.spec) {
    return {
      ok: false,
      error: '告警通知策略接口已切换为结构化 payload（name/namespace/aliasName/description/receivers/alertNames），请勿直接提交 AlertmanagerConfig CR',
    };
  }
  const name = String(body?.name ?? '').trim();
  const namespace = String(body?.namespace ?? '').trim();
  if (!name) return { ok: false, error: 'name 不能为空' };
  if (!namespace) return { ok: false, error: 'namespace 不能为空' };
  const receivers = Array.isArray(body?.receivers)
    ? body.receivers
        .map((r) => ({ name: String((r as { name?: unknown })?.name ?? '').trim() }))
        .filter((r) => r.name)
    : [];
  if (receivers.length === 0) {
    return { ok: false, error: 'receivers 至少需要一条' };
  }
  const alertNames = Array.isArray(body?.alertNames)
    ? body.alertNames.map((s: unknown) => String(s ?? '').trim()).filter(Boolean)
    : [];
  if (alertNames.length === 0) {
    return { ok: false, error: 'alertNames 至少需要一条' };
  }
  return {
    ok: true,
    payload: {
      name,
      namespace,
      aliasName: String(body?.aliasName ?? '').trim() || undefined,
      description: String(body?.description ?? '').trim() || undefined,
      receivers,
      alertNames,
      subRouteRepeatInterval: String(body?.subRouteRepeatInterval ?? '').trim() || undefined,
      resourceVersion: String(body?.resourceVersion ?? '').trim() || undefined,
    },
  };
}

async function fetchReceiverIndex(
  conn: { origin: string; token: string; insecure: boolean },
  namespaces?: string[] | null,
): Promise<Map<string, { receiverType?: string; aliasName?: string }>> {
  const labelQs = `&labelSelector=${encodeURIComponent(MONITORING_RECEIVER_LABEL_SELECTOR)}`;
  const url = `${conn.origin}/${ALERTMANAGERCONFIG_BASE}?${PAGESIZE}${labelQs}`;
  try {
    const raw = await getJsonOnce(url, conn.token, conn.insecure, true);
    const items: any[] = Array.isArray(raw?.data) ? raw.data : [];
    const filtered = namespaces && namespaces.length > 0
      ? items.filter((it: any) => {
          const ns = (it?.data?.metadata?.namespace ?? it?.metadata?.namespace ?? '').toString().trim();
          return namespaces!.includes(ns);
        })
      : items;
    return buildReceiverRefIndexFromReceiverCRs(filtered);
  } catch (e) {
    console.warn('[monitoring/policies] fetch receiver index failed:', e);
    return new Map();
  }
}

export async function harvesterMonitoringAlertmanagerConfigsHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const tenant = await getTenantAccessForMonitoring(req as any, id);
    if (!tenant.allowed) return res.status(403).json({ message: '您没有该资源池的访问权限' });

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const conn = { origin, token: cloud.secretKey || '', insecure };
    const url = `${origin}/${ALERTMANAGERCONFIG_BASE}?${PAGESIZE}&exclude=metadata.managedFields&exclude=metadata.ownerReferences`;
    const raw = await getJsonOnce(url, conn.token, conn.insecure, true);
    let list: any[] = Array.isArray(raw?.data) ? raw.data : (Array.isArray(raw) ? raw : []);

    // 过滤掉接收器 CR（带 label monitoring-receiver=true 或历史共享 CR）
    list = list.filter((item: any) => {
      const inner = item?.data ?? item;
      return !isMonitoringReceiverConfigMeta(inner?.metadata ?? {});
    });

    // 租户隔离
    if (!tenant.isAdmin && tenant.namespaces.length > 0) {
      const allowedSet = new Set(tenant.namespaces);
      list = list.filter((item: any) => {
        const inner = item?.data ?? item;
        const ns = (inner?.metadata?.namespace ?? '').toString().trim();
        return allowedSet.has(ns);
      });
    }

    // alertName= 查询：用唯一可信源（sub-route matchers）筛选
    const alertNameFilter = (req.query?.alertName ?? '').toString().trim();
    if (alertNameFilter) {
      list = list.filter((item: any) => {
        const inner = item?.data ?? item;
        const names = extractAlertNamesFromPolicyCR(inner);
        return names.includes(alertNameFilter);
      });
    }

    // 解析为 AlertmanagerPolicy
    const policies: AlertmanagerPolicy[] = list.map((item: any) =>
      buildAlertmanagerPolicyFromCR(item),
    );

    // 联表 receivers 的 receiverType / aliasName
    const involvedNamespaces = Array.from(new Set(policies.map((p) => p.namespace))).filter(Boolean);
    const receiverIndex = await fetchReceiverIndex(
      conn,
      involvedNamespaces.length > 0 ? involvedNamespaces : null,
    );
    const enriched = joinReceiverRefsForPolicies(policies, receiverIndex);

    // 默认按创建时间倒序，UI 端无需再排
    enriched.sort((a, b) => {
      const ta = a.creationTimestamp ? Date.parse(a.creationTimestamp) : 0;
      const tb = b.creationTimestamp ? Date.parse(b.creationTimestamp) : 0;
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
    });

    res.json({ data: enriched });
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
    const conn = { origin, token: cloud.secretKey || '', insecure };
    const path = `${ALERTMANAGERCONFIG_BASE}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
    const excludeQs = 'exclude=metadata.managedFields&exclude=metadata.ownerReferences';
    const url = `${origin}/${path}?${excludeQs}`;
    const raw = await getJsonOnce(url, conn.token, conn.insecure, true);

    // 同步拉同命名空间的通知对象 CR 用于 join
    const receiverIndex = await fetchReceiverIndex(conn, [namespace]);
    const inner = (raw as any)?.data && typeof (raw as any).data === 'object' ? (raw as any).data : raw;

    if (isMonitoringReceiverConfigMeta(inner?.metadata ?? {})) {
      return res.status(404).json({ message: '该资源是通知对象而非通知策略' });
    }

    const base = buildAlertmanagerPolicyFromCR(inner);
    const [enriched] = joinReceiverRefsForPolicies([base], receiverIndex);
    res.json({ data: enriched });
  } catch (e: any) {
    if (isUnreachableError(e)) return res.status(200).json({ data: null });
    if (res.headersSent) return;
    const status = (e as any).status || 500;
    res.status(status).json({ message: e?.message || '请求配置详情失败' });
  }
}

export async function harvesterMonitoringAlertmanagerConfigsCreateHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const valid = validateUpsertPayload(req.body as UpsertRequestBody);
    if (!valid.ok || !valid.payload) {
      return res.status(400).json({ message: valid.error ?? '请求体不合法' });
    }
    const payload = valid.payload;

    const tenant = await requireTenantAccessForMonitoring(req as any, res, id, {
      namespaces: [payload.namespace],
      forbiddenMessage: '仅能在您有权限的命名空间下创建告警通知策略',
    });
    if (!tenant) return;

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');

    // 显式禁止使用历史共享 CR 的保留名作为策略名
    if (
      payload.name === 'email-receiver' ||
      payload.name === 'dingtalk-receiver' ||
      payload.name === 'website-receiver'
    ) {
      return res.status(400).json({ message: `策略标识不能与通知方式保留名 ${payload.name} 冲突` });
    }

    const cr = buildAlertmanagerConfigCRFromPolicyPayload(payload);
    const finalPayload = { ...cr, spec: normalizePolicySpec(cr.spec) };
    const created = await requestJson(
      'POST',
      `${origin}/${ALERTMANAGERCONFIG_BASE}`,
      cloud.secretKey || '',
      insecure,
      finalPayload,
    );
    // 返回结构化 Policy（附 receiver join）
    const conn = { origin, token: cloud.secretKey || '', insecure };
    const receiverIndex = await fetchReceiverIndex(conn, [payload.namespace]);
    const base = buildAlertmanagerPolicyFromCR(created);
    const [enriched] = joinReceiverRefsForPolicies([base], receiverIndex);
    res.status(201).json({ data: enriched });
  } catch (e: any) {
    if (res.headersSent) return;
    const status = (e as any).status || 500;
    res.status(status).json({ message: e?.message || '创建告警通知策略失败' });
  }
}

export async function harvesterMonitoringAlertmanagerConfigsUpdateHandler(req: Request, res: Response) {
  try {
    const { id, namespace, name } = req.params;
    const valid = validateUpsertPayload(req.body as UpsertRequestBody);
    if (!valid.ok || !valid.payload) {
      return res.status(400).json({ message: valid.error ?? '请求体不合法' });
    }
    const payload = valid.payload;
    if (payload.namespace !== namespace || payload.name !== name) {
      return res.status(400).json({
        message: `URL 中的 namespace/name 与 payload 不一致（URL: ${namespace}/${name}，body: ${payload.namespace}/${payload.name}）`,
      });
    }

    const tenant = await requireTenantAccessForMonitoring(req as any, res, id, {
      namespaces: [namespace],
      forbiddenMessage: '无权修改该命名空间下的告警通知策略',
    });
    if (!tenant) return;

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const conn = { origin, token: cloud.secretKey || '', insecure };
    const path = `${ALERTMANAGERCONFIG_BASE}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;

    // 取既有 CR 用作 base：尽量保留外部维护的字段
    let existing: any = null;
    try {
      const raw = await getJsonOnce(`${origin}/${path}`, conn.token, insecure, true);
      existing = (raw as any)?.data != null && typeof (raw as any).data === 'object' ? (raw as any).data : raw;
    } catch (e: any) {
      const status = Number((e as any)?.status ?? (e as any)?.statusCode ?? 0);
      if (status === 404) return res.status(404).json({ message: '未找到该通知策略' });
      throw e;
    }

    if (isMonitoringReceiverConfigMeta(existing?.metadata ?? {})) {
      return res.status(400).json({ message: '该资源是通知对象而非通知策略，不能用此接口修改' });
    }

    // 用 payload 携带的 resourceVersion 覆盖（如果有）；否则用既有的
    const cr = buildAlertmanagerConfigCRFromPolicyPayload(payload, existing);
    const finalPayload = { ...cr, spec: normalizePolicySpec(cr.spec) };
    const updated = await requestJson('PUT', `${origin}/${path}`, conn.token, insecure, finalPayload);

    const receiverIndex = await fetchReceiverIndex(conn, [namespace]);
    const base = buildAlertmanagerPolicyFromCR(updated);
    const [enriched] = joinReceiverRefsForPolicies([base], receiverIndex);
    res.json({ data: enriched });
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
