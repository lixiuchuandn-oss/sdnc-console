/**
 * Harvester Monitoring Alerts Receivers Handlers
 * 告警通知对象（AlertmanagerConfig）：
 *
 * 新模型（自此版本起强制）：
 *   - 每个通知对象 ⇄ 一个独立的 AlertmanagerConfig CR
 *   - metadata.name = 通知对象唯一标识（specReceiverName）
 *   - metadata.labels.monitoring-receiver = 'true'
 *   - metadata.annotations['tower.io/monitoring-receiver'] = 'email-receiver' | 'dingtalk-receiver' | 'website-receiver'
 *   - spec.receivers 仅含一个条目，name 与 metadata.name 一致
 *
 * 兼容历史数据（旧模型）：列表/删除仍能解析「单 CR 多接收器」的历史共享 CR：
 *   - metadata.name 等于 email-receiver / dingtalk-receiver / website-receiver
 *   - spec.receivers 中包含多个接收器条目
 *   - 删除时若提供 ?specReceiverName= 且条目数 >1，仅移除该条目（不删整个 CR）
 *
 * 注意：新建 / 编辑「永远」按新模型写入 per-target CR，不再向历史共享 CR 中合并新条目。
 */

import { Request, Response } from 'express';
import { requestJson } from '../../../../services/clouds/harvester/utils';
import { ensureProvider, normalizeOrigin } from './monitoring-helpers';
import {
  PAGESIZE,
  ALERTMANAGERCONFIG_BASE,
  SECRETS_BASE,
  MONITORING_RECEIVER_LABEL_SELECTOR,
  ALERTMANAGER_TARGET_ANNOTATION,
  ANNOTATION_MONITORING_RECEIVER,
  ANNOTATION_ALIAS,
  ANNOTATION_DESCRIPTION,
  EMAIL_RECEIVER,
  DINGTALK_RECEIVER,
  WEBSITE_RECEIVER,
  DINGTALK_WEBHOOK_BASE,
  isUnreachableError,
  requireTenantAccessForMonitoring,
  parseQueryArray,
  removeDingtalkConfigMapTarget,
  updateDingtalkConfigMapTargets,
  syncPoliciesReceiverSpecsAfterReceiverConfigUpdate,
  collectReceiverNamesFromRoute,
  resolveMonitoringReceiverType,
} from './monitoring-helpers';
import { getJsonOnce } from '../../../../services/clouds/harvester/utils';

/** 默认拉取所有三种通知方式 */
const DEFAULT_RECEIVER_NAMES = [EMAIL_RECEIVER, DINGTALK_RECEIVER, WEBSITE_RECEIVER];

/** 合法的通知方式取值集合 */
const VALID_RECEIVER_TYPES = new Set<string>([EMAIL_RECEIVER, DINGTALK_RECEIVER, WEBSITE_RECEIVER]);

/** 历史共享 CR 的 metadata.name 集合（兼容路径使用） */
const LEGACY_SHARED_CONFIG_NAMES = new Set<string>([EMAIL_RECEIVER, DINGTALK_RECEIVER, WEBSITE_RECEIVER]);

function isValidReceiverType(t: string): boolean {
  return VALID_RECEIVER_TYPES.has(String(t ?? '').trim());
}

/**
 * 合并通知对象 CR 的 metadata.annotations：保留既有键，写入 monitoring-receiver / alias / description。
 * bodyAnnotations 中若显式携带 alias 或 description 键（含空串），则覆盖或删除对应注解。
 */
function buildReceiverMetadataAnnotations(
  existingAnnotations: Record<string, string> | undefined,
  bodyAnnotations: Record<string, string> | undefined,
  receiverType: string
): Record<string, string> {
  const next: Record<string, string> = { ...(existingAnnotations || {}) };
  if (isValidReceiverType(receiverType)) {
    next[ANNOTATION_MONITORING_RECEIVER] = receiverType;
  }
  const body = bodyAnnotations && typeof bodyAnnotations === 'object' ? bodyAnnotations : {};
  if (Object.prototype.hasOwnProperty.call(body, ANNOTATION_ALIAS)) {
    const alias = String(body[ANNOTATION_ALIAS] ?? '').trim();
    if (alias) next[ANNOTATION_ALIAS] = alias;
    else delete next[ANNOTATION_ALIAS];
  }
  if (Object.prototype.hasOwnProperty.call(body, ANNOTATION_DESCRIPTION)) {
    const description = String(body[ANNOTATION_DESCRIPTION] ?? '').trim();
    if (description) next[ANNOTATION_DESCRIPTION] = description;
    else delete next[ANNOTATION_DESCRIPTION];
  }
  return next;
}

function readReceiverAliasDescription(meta: any): { alias?: string; description?: string } {
  const annotations = meta?.annotations && typeof meta.annotations === 'object' ? meta.annotations : {};
  const alias = String(annotations[ANNOTATION_ALIAS] ?? '').trim();
  const description = String(annotations[ANNOTATION_DESCRIPTION] ?? '').trim();
  return {
    ...(alias ? { alias } : {}),
    ...(description ? { description } : {}),
  };
}

/**
 * 解析请求中显式传入的 receiverType：优先 query.receiverType，其次 body.metadata.annotations。
 * 返回 ''（空串）表示未提供。
 */
function resolveRequestedReceiverType(req: Request, body: any): string {
  const q = String((req.query as any)?.receiverType ?? '').trim();
  if (q) return q;
  const fromBody = String(body?.metadata?.annotations?.[ANNOTATION_MONITORING_RECEIVER] ?? '').trim();
  return fromBody;
}

function collectEmailReceiverSecretTargets(receivers: any[]): Map<string, Set<string>> {
  const secretTargets = new Map<string, Set<string>>();
  const list = Array.isArray(receivers) ? receivers : [];
  for (const receiver of list) {
    const targetName = (receiver?.name ?? '').toString().trim();
    if (!targetName) continue;
    const emailConfigs = Array.isArray(receiver?.emailConfigs) ? receiver.emailConfigs : [];
    for (const cfg of emailConfigs) {
      const secretName = (cfg?.authPassword?.name ?? '').toString().trim();
      if (!secretName) continue;
      if (!secretTargets.has(secretName)) secretTargets.set(secretName, new Set<string>());
      secretTargets.get(secretName)!.add(targetName);
    }
  }
  return secretTargets;
}

function parseAnnotationTargets(value: string): Set<string> {
  return new Set(value.split(',').map((s) => s.trim()).filter(Boolean));
}

async function syncLinkedSecretsAnnotationForReceivers(
  conn: { origin: string; token: string; insecure: boolean },
  namespace: string,
  previousReceivers: any[],
  nextReceivers: any[]
): Promise<void> {
  const previousMap = collectEmailReceiverSecretTargets(previousReceivers);
  const nextMap = collectEmailReceiverSecretTargets(nextReceivers);
  const affectedSecrets = new Set<string>([...previousMap.keys(), ...nextMap.keys()]);
  for (const secretName of affectedSecrets) {
    const path = `${SECRETS_BASE}/${encodeURIComponent(namespace)}/${encodeURIComponent(secretName)}`;
    let raw: any;
    try {
      raw = await getJsonOnce(`${conn.origin}/${path}`, conn.token, conn.insecure, true);
    } catch (e: any) {
      const status = Number((e as any)?.status ?? (e as any)?.statusCode ?? 0);
      if (status === 404) {
        return Promise.reject({
          status: 400,
          message: `引用的告警密钥 ${namespace}/${secretName} 不存在，无法保存通知对象`,
        });
      }
      throw e;
    }
    const secret =
      (raw as any)?.data != null && typeof (raw as any).data === 'object' && (raw as any).data?.metadata != null
        ? (raw as any).data
        : raw;
    if (!secret?.metadata) {
      return Promise.reject({
        status: 400,
        message: `引用的告警密钥 ${namespace}/${secretName} 数据异常，无法保存通知对象`,
      });
    }
    const annotations = secret.metadata?.annotations && typeof secret.metadata.annotations === 'object'
      ? secret.metadata.annotations
      : {};
    const currentSet = parseAnnotationTargets((annotations?.[ALERTMANAGER_TARGET_ANNOTATION] ?? '').toString().trim());
    const nextSet = new Set<string>(currentSet);
    const removedTargets = previousMap.get(secretName) ?? new Set<string>();
    const addedTargets = nextMap.get(secretName) ?? new Set<string>();
    for (const targetName of removedTargets) nextSet.delete(targetName);
    for (const targetName of addedTargets) nextSet.add(targetName);
    const currentValue = Array.from(currentSet).join(',');
    const nextValue = Array.from(nextSet).join(',');
    if (nextValue === currentValue) continue;
    const nextAnnotations: Record<string, string> = { ...annotations };
    if (nextValue) {
      nextAnnotations[ALERTMANAGER_TARGET_ANNOTATION] = nextValue;
    } else {
      delete nextAnnotations[ALERTMANAGER_TARGET_ANNOTATION];
    }
    const payload = {
      ...secret,
      metadata: {
        ...secret.metadata,
        name: (secret.metadata?.name ?? secretName).toString().trim(),
        namespace,
        resourceVersion: secret.metadata?.resourceVersion,
        annotations: nextAnnotations,
      },
    };
    await requestJson('PUT', `${conn.origin}/${path}`, conn.token, conn.insecure, payload);
  }
}
/**
 * 获取告警通知对象列表 from alertmanager API
 *
 * 接口约定：
 * - `receiverName` 兼容历史调用，可传入 `email-receiver|dingtalk-receiver|website-receiver`
 *   做「通知方式」过滤（与 annotation `tower.io/monitoring-receiver` 等价）。
 * - 响应中每条 `{ namespace, receiverName, receiverType, alias, description, specReceivers }`：
 *   - `receiverName`: AlertmanagerConfig `metadata.name`，用于后续 CRUD URL 寻址。
 *   - `receiverType`: 通知方式类型，来源 **annotation `tower.io/monitoring-receiver`**，
 *     annotation 缺失时按 metadata.name 回退（兼容历史数据）。**前端「通知方式」一律读这一字段**。
 *   - `alias`: 通知对象名称，来源 annotation `tower.io/alias`。
 *   - `description`: 通知对象描述，来源 annotation `tower.io/description`。
 */
export async function harvesterMonitoringAlertmanagerConfigsReceiversHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const namespaces = parseQueryArray(req.query?.namespaces);
    let receiverNames = parseQueryArray(req.query?.receiverName);
    if (receiverNames.length === 0) receiverNames = [...DEFAULT_RECEIVER_NAMES];
    const receiverNameSet = new Set(receiverNames.map((s) => String(s ?? '').trim()).filter(Boolean));
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

      const meta = inner?.metadata ?? {};
      const receiverType = resolveMonitoringReceiverType(meta);
      // 通知方式过滤：annotation/metadata.name 命中其一即放行
      if (receiverNameSet.size > 0 && !receiverNameSet.has(receiverType) && !receiverNameSet.has(name)) continue;

      const spec = inner?.spec ?? {};
      const rawReceivers = Array.isArray(spec.receivers) ? spec.receivers : [];
      const createdAt = meta?.creationTimestamp ? String(meta.creationTimestamp) : undefined;

      const specReceivers = rawReceivers.map((r: any) => ({
        ...r,
        createdAt: createdAt ?? undefined,
      }));

      if (specReceivers.length > 0) {
        const { alias, description } = readReceiverAliasDescription(meta);
        receivers.push({
          namespace: ns,
          receiverName: name,
          receiverType,
          ...(alias ? { alias } : {}),
          ...(description ? { description } : {}),
          specReceivers,
        });
      }
    }

    res.json({ receivers });
  } catch (e: any) {
    if (res.headersSent) return;
    const status = (e as any).status || 500;
    res.status(status).json({ message: e?.message || '获取通知对象列表失败' });
  }
}

/**
 * 校验通知对象标识在 namespace 下是否已存在。
 *
 * 新模型：标识 = AlertmanagerConfig metadata.name。直接 GET 该 CR；命中 → 存在。
 * 兼容历史共享 CR：同时检查 `email-receiver|dingtalk-receiver|website-receiver` 这三类 CR
 *   的 spec.receivers[].name 是否包含 specReceiverName（避免与历史条目重名）。
 */
export async function harvesterMonitoringAlertmanagerConfigsReceiversCheckHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const namespace = (req.query?.namespace ?? '').toString().trim();
    const specReceiverName = (req.query?.specReceiverName ?? '').toString().trim();
    if (!namespace || !specReceiverName) {
      return res.status(400).json({ message: 'namespace 与 specReceiverName 不能为空' });
    }
    const tenant = await requireTenantAccessForMonitoring(req as any, res, id, { namespaces: [namespace] });
    if (!tenant) return;

    const cloud = (req as any).cloud;
    let exists = false;
    if (cloud) {
      if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

      const insecure = !!(cloud.config as any)?.ignoreTls;
      const origin = normalizeOrigin(cloud.endpoint || '');

      // 1) 新模型：直接探测同名 CR
      try {
        const path = `${ALERTMANAGERCONFIG_BASE}/${encodeURIComponent(namespace)}/${encodeURIComponent(specReceiverName)}`;
        await getJsonOnce(`${origin}/${path}`, cloud.secretKey || '', insecure, true);
        exists = true;
      } catch {
        /* 404 => keep checking legacy */
      }

      // 2) 兼容历史共享 CR：在 email-receiver / dingtalk-receiver / website-receiver 内查找
      if (!exists) {
        for (const legacy of LEGACY_SHARED_CONFIG_NAMES) {
          try {
            const path = `${ALERTMANAGERCONFIG_BASE}/${encodeURIComponent(namespace)}/${encodeURIComponent(legacy)}`;
            const raw = await getJsonOnce(`${origin}/${path}`, cloud.secretKey || '', insecure, true);
            const item =
              (raw as any)?.data != null && typeof (raw as any).data === 'object' ? (raw as any).data : raw;
            const receivers = Array.isArray(item?.spec?.receivers) ? item.spec.receivers : [];
            if (receivers.some((r: any) => (r?.name ?? '').toString().trim() === specReceiverName)) {
              exists = true;
              break;
            }
          } catch {
            /* 404 => continue */
          }
        }
      }
    }
    res.json({ exists });
  } catch (e: any) {
    if (res.headersSent) return;
    const status = (e as any).status || 500;
    res.status(status).json({ message: e?.message || '校验失败' });
  }
}

/**
 * 钉钉接收器 spec.receivers 规范化：为每个 webhookConfig 写入代理 URL；缺省时按 robotAccount = `${ns}_${specReceiverName}` 兜底。
 */
function normalizeDingtalkReceiversForCR(receivers: any[], ns: string): any[] {
  if (!Array.isArray(receivers)) return [];
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
}

/**
 * 创建或更新「单个通知对象」对应的独立 AlertmanagerConfig CR。
 *
 * 路由：POST /api/clouds/:id/monitoring/alertmanagerconfigs/receivers/:namespace/:name
 *
 * 关键约定（新模型，每通知对象一 CR）：
 *   - 路径参数 `:name` 即为 AlertmanagerConfig `metadata.name`，也是 `spec.receivers[0].name`，
 *     等价于前端的「通知对象标识 specReceiverName」。
 *   - 通知方式（email/dingtalk/website）由 `?receiverType=` 或 body.metadata.annotations 决定。
 *   - 服务端始终：
 *       * 写入 labels.monitoring-receiver = 'true'
 *       * 写入 annotations['tower.io/monitoring-receiver'] = <receiverType>
 *       * spec.receivers 仅保留 body 提供的「单个」条目（不再向历史共享 CR 中合并）
 *   - 若名为 email-receiver / dingtalk-receiver 的旧共享 CR 已存在且 spec.receivers 多于 1 条，
 *     视为「历史共享 CR」，拒绝整体覆盖；提示前端改名后再保存。
 */
export async function harvesterMonitoringAlertmanagerConfigsReceiversCreateUpdateHandler(
  req: Request,
  res: Response
) {
  try {
    const { id, namespace: ns, name } = req.params;
    if (!ns) return res.status(400).json({ message: '项目名称不能为空' });
    const trimmedName = String(name ?? '').trim();
    if (!trimmedName) return res.status(400).json({ message: '通知对象标识不能为空' });

    const tenant = await requireTenantAccessForMonitoring(req as any, res, id, {
      namespaces: [ns],
      forbiddenMessage: '仅能在您有权限的项目名称下操作告警通知对象',
    });
    if (!tenant) return;

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const body = req.body || {};
    const receiverType = resolveRequestedReceiverType(req, body);
    if (!receiverType) {
      return res
        .status(400)
        .json({ message: '缺少 receiverType（query 或 body.metadata.annotations[tower.io/monitoring-receiver]）' });
    }
    if (!isValidReceiverType(receiverType)) {
      return res.status(400).json({ message: '通知方式必须是邮件、钉钉或站内信之一' });
    }

    // 命名收口：email-receiver / dingtalk-receiver 是旧共享 CR 保留名，仅允许 website-receiver 类型沿用 `website-receiver`
    if (LEGACY_SHARED_CONFIG_NAMES.has(trimmedName) && trimmedName !== receiverType) {
      return res.status(400).json({
        message: `通知对象标识 ${trimmedName} 与历史共享配置同名，请改名后再保存`,
      });
    }
    if (
      (receiverType === EMAIL_RECEIVER || receiverType === DINGTALK_RECEIVER) &&
      trimmedName === receiverType
    ) {
      return res.status(400).json({
        message: `通知对象标识不能等于通知方式名 ${trimmedName}，请使用唯一标识（如 ops-${receiverType.split('-')[0]}）`,
      });
    }

    const rawReceivers = Array.isArray(body?.spec?.receivers) ? body.spec.receivers : [];
    if (rawReceivers.length === 0) {
      return res.status(400).json({ message: 'spec.receivers 至少需要一条' });
    }
    if (rawReceivers.length > 1) {
      return res
        .status(400)
        .json({ message: '新模型下每个 AlertmanagerConfig CR 仅允许包含一个 spec.receivers 条目' });
    }
    const singleReceiver = { ...(rawReceivers[0] || {}), name: trimmedName };

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const path = `${ALERTMANAGERCONFIG_BASE}/${encodeURIComponent(ns)}/${encodeURIComponent(trimmedName)}`;
    const getUrl = `${origin}/${path}`;
    const conn = { origin, token: cloud.secretKey || '', insecure };

    // 读取既有 CR；用于判定历史共享 vs 新模型替换
    let existingRaw: any = null;
    const exists = await getJsonOnce(getUrl, conn.token, insecure, true)
      .then((data) => {
        existingRaw = data;
        return true;
      })
      .catch((err: any) =>
        err?.status === 404 || err?.statusCode === 404 ? false : Promise.reject(err)
      );

    const existing =
      (existingRaw as any)?.data != null && typeof (existingRaw as any).data === 'object'
        ? (existingRaw as any).data
        : existingRaw;
    const existingSpecReceivers: any[] = Array.isArray(existing?.spec?.receivers)
      ? existing.spec.receivers
      : [];

    // 历史共享 CR 守护：不允许把单条 entry 通过 PUT 覆盖整个共享 CR
    if (exists && existingSpecReceivers.length > 1) {
      return res.status(400).json({
        message:
          `通知对象 ${ns}/${trimmedName} 仍为历史共享配置（${existingSpecReceivers.length} 条条目），` +
          '请先将其中条目逐一删除迁移为「每通知对象一 CR」后再保存',
      });
    }

    // 邮件接收器：维护引用 Secret 上的 ALERTMANAGER_TARGET_ANNOTATION
    if (receiverType === EMAIL_RECEIVER) {
      try {
        await syncLinkedSecretsAnnotationForReceivers(conn, ns, existingSpecReceivers, [singleReceiver]);
      } catch (e: any) {
        const status = (e as any)?.status ?? (e as any)?.statusCode ?? 500;
        const msg = e?.message || '更新告警密钥关联标记失败';
        if (status >= 500) console.error('[email-receiver] syncLinkedSecretsAnnotationForReceivers:', e);
        return res.status(status).json({ message: msg });
      }
    }

    // 钉钉接收器：同步 webhook ConfigMap 的 targets（new 条目）
    let normalizedReceiver = singleReceiver;
    if (receiverType === DINGTALK_RECEIVER) {
      const normalized = normalizeDingtalkReceiversForCR([singleReceiver], ns);
      normalizedReceiver = normalized[0] ?? singleReceiver;
      try {
        await updateDingtalkConfigMapTargets(conn, ns, [singleReceiver]);
      } catch (e: any) {
        const status = (e as any)?.status ?? (e as any)?.statusCode ?? 500;
        const msg = e?.message || '更新钉钉 Webhook ConfigMap 失败';
        if (status >= 500) console.error('[dingtalk-receiver] updateDingtalkConfigMapTargets:', e);
        return res.status(status).json({ message: msg });
      }
    }

    if (!exists) {
      const createPayload = {
        apiVersion: 'monitoring.coreos.com/v1alpha1',
        kind: 'AlertmanagerConfig',
        ...body,
        metadata: {
          ...(body?.metadata || {}),
          namespace: ns,
          name: trimmedName,
          labels: { ...(body?.metadata?.labels || {}), 'monitoring-receiver': 'true' },
          annotations: buildReceiverMetadataAnnotations(
            undefined,
            body?.metadata?.annotations,
            receiverType
          ),
        },
        spec: { ...(body?.spec || {}), receivers: [normalizedReceiver] },
      };
      const data = await requestJson(
        'POST',
        `${conn.origin}/${ALERTMANAGERCONFIG_BASE}`,
        conn.token,
        insecure,
        createPayload
      );
      try {
        await syncPoliciesReceiverSpecsAfterReceiverConfigUpdate(conn, ns, [normalizedReceiver]);
      } catch (e) {
        console.warn('[receivers/create] syncPoliciesReceiverSpecs failed:', e);
      }
      return res.status(201).json(data);
    }

    // PUT 全量替换（不再 merge）
    if (!existing?.spec) {
      return res.status(500).json({ message: '通知对象配置异常（缺少 spec）' });
    }
    const nextExisting = {
      ...existing,
      metadata: {
        ...(existing.metadata || {}),
        namespace: ns,
        name: trimmedName,
        labels: { ...(existing.metadata?.labels || {}), 'monitoring-receiver': 'true' },
        annotations: buildReceiverMetadataAnnotations(
          existing.metadata?.annotations,
          body?.metadata?.annotations,
          receiverType
        ),
      },
      spec: { ...(existing.spec || {}), receivers: [normalizedReceiver] },
    };
    const data = await requestJson('PUT', `${conn.origin}/${path}`, conn.token, insecure, nextExisting);
    try {
      await syncPoliciesReceiverSpecsAfterReceiverConfigUpdate(conn, ns, [normalizedReceiver]);
    } catch (e) {
      console.warn('[receivers/update] syncPoliciesReceiverSpecs failed:', e);
    }
    return res.json(data);
  } catch (e: any) {
    if (res.headersSent) return;
    const status = (e as any)?.status ?? (e as any)?.statusCode ?? 500;
    const msg = e?.message || '创建或更新告警通知对象失败';
    if (status >= 500) console.error('[alertmanagerconfigs/receivers]', e);
    res.status(status).json({ message: msg });
  }
}

/**
 * 删除通知对象。
 *
 * 路由：DELETE /api/clouds/:id/monitoring/alertmanagerconfigs/receivers/:namespace/:name
 *
 * 行为：
 *   - 新模型（每通知对象一 CR）：默认整 CR 删除。
 *   - 兼容历史共享 CR：若 spec.receivers 多于一条且 query `?specReceiverName=` 命中其中一条，
 *     则从 spec.receivers 中移除该条 entry（PUT）而不删整个 CR。
 *   - 钉钉条目删除时同步移除 ConfigMap targets 里对应的 robotAccount。
 *   - 删除前先校验是否被告警策略引用（策略 CR 与接收器 CR 通过 label monitoring-receiver=true 区分）。
 */
export async function harvesterMonitoringAlertmanagerConfigsReceiversDeleteHandler(
  req: Request,
  res: Response
) {
  try {
    const { id, namespace, name } = req.params;
    const trimmedName = String(name ?? '').trim();
    if (!trimmedName) return res.status(400).json({ message: '通知对象标识不能为空' });
    const specReceiverNameQuery = (req.query.specReceiverName ?? '').toString().trim();

    const tenant = await requireTenantAccessForMonitoring(req as any, res, id, { namespaces: [namespace] });
    if (!tenant) return;

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const path = `${ALERTMANAGERCONFIG_BASE}/${encodeURIComponent(namespace)}/${encodeURIComponent(trimmedName)}`;
    const getUrl = `${origin}/${path}`;
    const conn = { origin, token: cloud.secretKey || '', insecure };

    // 先取 CR；用于判定整 CR 删除还是仅删 entry，以及通知方式（钉钉需同步 ConfigMap）
    let existing: any = null;
    try {
      const raw = await getJsonOnce(getUrl, conn.token, insecure, true);
      existing = (raw as any)?.data != null && typeof (raw as any).data === 'object' ? (raw as any).data : raw;
    } catch (e: any) {
      const status = Number((e as any)?.status ?? (e as any)?.statusCode ?? 0);
      if (status === 404) return res.status(404).json({ message: '未找到该通知对象' });
      throw e;
    }
    if (!existing || !existing.metadata) {
      return res.status(404).json({ message: '未找到该通知对象' });
    }

    const receiverType = resolveMonitoringReceiverType(existing.metadata);
    const specReceivers: any[] = Array.isArray(existing.spec?.receivers) ? existing.spec.receivers : [];

    // 判定是否走「仅删 entry」分支：历史共享 CR（多条）且 query 提供 specReceiverName
    const isMultiReceiverCR = specReceivers.length > 1;
    const shouldRemoveSingleEntry =
      isMultiReceiverCR && !!specReceiverNameQuery &&
      specReceivers.some((r: any) => (r?.name ?? '').toString().trim() === specReceiverNameQuery);

    // 引用校验：删除前确认目标名（整 CR 删除时为 trimmedName，删 entry 时为 specReceiverNameQuery）未被策略引用
    const referencedName = shouldRemoveSingleEntry ? specReceiverNameQuery : trimmedName;
    try {
      const listUrl = `${origin}/${ALERTMANAGERCONFIG_BASE}?${PAGESIZE}&exclude=metadata.managedFields&exclude=metadata.ownerReferences`;
      const listRaw = await getJsonOnce(listUrl, conn.token, insecure, true);
      const listItems: any[] = Array.isArray(listRaw?.data) ? listRaw.data : [];
      const referencedPolicies: string[] = [];
      for (const item of listItems) {
        const inner = item?.data ?? item;
        const policyName = (inner?.metadata?.name ?? '').toString().trim();
        const ns = (inner?.metadata?.namespace ?? '').toString().trim();
        if (ns !== namespace) continue;
        const isReceiverCR =
          (inner?.metadata?.labels?.['monitoring-receiver'] ?? '').toString().trim() === 'true' ||
          LEGACY_SHARED_CONFIG_NAMES.has(policyName);
        if (isReceiverCR) continue;
        const route = inner?.spec?.route ?? {};
        const refs = collectReceiverNamesFromRoute(route);
        if (refs.includes(referencedName)) referencedPolicies.push(policyName);
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

    if (shouldRemoveSingleEntry) {
      // 历史共享 CR：仅移除单条 entry
      const toRemove = specReceivers.find((r: any) => (r?.name ?? '').toString().trim() === specReceiverNameQuery);
      const nextReceivers = specReceivers.filter(
        (r: any) => (r?.name ?? '').toString().trim() !== specReceiverNameQuery
      );
      // 邮件：先同步 Secret 关联标记（删旧 entry 引用）
      if (receiverType === EMAIL_RECEIVER) {
        try {
          await syncLinkedSecretsAnnotationForReceivers(conn, namespace, [toRemove].filter(Boolean), []);
        } catch (e) {
          console.warn('[DELETE receivers] sync secrets annotation failed:', e);
        }
      }
      if (receiverType === DINGTALK_RECEIVER && toRemove) {
        const robotAccount =
          ((toRemove as any)?.webhookConfigs?.[0] as any)?.robotAccount ??
          (toRemove as any)?.robotAccount ??
          `${namespace}_${specReceiverNameQuery}`;
        try {
          await removeDingtalkConfigMapTarget(conn, robotAccount);
        } catch (e: any) {
          const status = (e as any)?.status ?? (e as any)?.statusCode ?? 500;
          const msg = e?.message || '移除钉钉 Webhook ConfigMap target 失败';
          if (status >= 500) console.error('[dingtalk-receiver] removeDingtalkConfigMapTarget:', e);
          return res.status(status).json({ message: msg });
        }
      }
      existing.spec = { ...(existing.spec || {}), receivers: nextReceivers };
      await requestJson('PUT', `${origin}/${path}`, conn.token, insecure, existing);
      return res.status(204).send();
    }

    // 整 CR 删除：先做通知方式相关的清理（钉钉 ConfigMap、邮件 Secret 关联）
    if (receiverType === EMAIL_RECEIVER && specReceivers.length > 0) {
      try {
        await syncLinkedSecretsAnnotationForReceivers(conn, namespace, specReceivers, []);
      } catch (e) {
        console.warn('[DELETE receivers] sync secrets annotation failed:', e);
      }
    }
    if (receiverType === DINGTALK_RECEIVER && specReceivers.length > 0) {
      for (const r of specReceivers) {
        const sName = (r?.name ?? '').toString().trim();
        const robotAccount =
          (r?.webhookConfigs?.[0]?.robotAccount as string | undefined) ??
          (r as any)?.robotAccount ??
          (sName ? `${namespace}_${sName}` : '');
        if (!robotAccount) continue;
        try {
          await removeDingtalkConfigMapTarget(conn, robotAccount);
        } catch (e) {
          console.warn('[DELETE receivers] removeDingtalkConfigMapTarget failed:', e);
        }
      }
    }
    await requestJson('DELETE', `${origin}/${path}`, conn.token, insecure);
    return res.status(204).send();
  } catch (e: any) {
    if (Number((e as any)?.status) === 404) {
      return res.status(404).json({ message: e?.message || '未找到该通知对象' });
    }
    if (res.headersSent) return;
    const status = (e as any).status || 500;
    res.status(status).json({ message: e?.message || '删除通知对象失败' });
  }
}