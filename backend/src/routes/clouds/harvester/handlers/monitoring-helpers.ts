/**
 * Monitoring 共享辅助函数
 * 复用 harvester.direct.helpers.ts 中的函数，并添加监控特有的辅助函数
 */

import { Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import { Cloud } from '../../../../entities/Cloud';
import { UserSpace } from '../../../../entities/UserSpace';
import { getJsonOnce, requestJson } from '../../../../services/clouds/harvester/utils';
import { checkTenantAccess, ensureProvider } from '../harvester.direct.helpers';
import yaml from 'js-yaml';

// 常量
export const PAGESIZE = 'pagesize=100000';
export const EXCLUDE = 'exclude=metadata.managedFields';
export const CATTLE_MONITORING_SYSTEM_NS = 'cattle-monitoring-system';
export const WEBSITE_RECEIVER_NAME = 'website-receiver';
export const ALERTMANAGER_PATH =
  `api/v1/namespaces/${CATTLE_MONITORING_SYSTEM_NS}/services/http:rancher-monitoring-alertmanager:9093/proxy/api/v2/alerts`;
export const PROMETHEUS_QUERY_RANGE_PATH =
  `api/v1/namespaces/${CATTLE_MONITORING_SYSTEM_NS}/services/http:rancher-monitoring-prometheus:9090/proxy/api/v1/query_range`;

export const DINGTALK_CONFIGMAP_NS = CATTLE_MONITORING_SYSTEM_NS;
export const DINGTALK_CONFIGMAP_NAME = 'alertmanager-webhook-dingtalk';
export const DINGTALK_CONFIG_KEY = 'config.yaml';
export const MONITORING_RECEIVER_SECRET_LABEL = 'monitoring-receiver-secret';
export const ALERTMANAGER_TARGET_ANNOTATION = 'tower.io/alertmanager-target';

export const EMAIL_RECEIVER = 'email-receiver';
export const DINGTALK_RECEIVER = 'dingtalk-receiver';
export const WEBSITE_RECEIVER = 'website-receiver';
export const NULL_RECEIVER = 'null-receiver';

export const ALERTMANAGERCONFIG_BASE = 'v1/harvester/monitoring.coreos.com.alertmanagerconfigs';
export const MONITORING_RECEIVER_LABEL_SELECTOR = 'monitoring-receiver=true';
export const PROMETHEUSRULE_VM = 'v1/harvester/monitoring.coreos.com.prometheusrules/cattle-monitoring-system/virtual-machine-custom-rules';
export const SECRETS_BASE = 'v1/harvester/secrets';
export const CONFIGMAPS_BASE = 'v1/harvester/configmaps';

export const DINGTALK_WEBHOOK_BASE = `http://${DINGTALK_CONFIGMAP_NAME}:8060/dingtalk`;

export const DINGTALK_MESSAGE_TEMPLATE = {
  title: '{{ template "ding.link.title" . }}',
  text: '{{ template "ding.link.content" . }}',
};

// 基础辅助函数（复用 harvester.direct.helpers.ts）
export { checkTenantAccess, ensureProvider } from '../harvester.direct.helpers';

// 规范化 endpoint origin
export function normalizeOrigin(endpoint: string): string {
  try {
    const u = new URL(endpoint);
    return `${u.protocol}//${u.host}`;
  } catch {
    return String(endpoint || '').replace(/\/+$/, '').replace(/\/v[0-9].*$/, '');
  }
}

// 获取租户访问权限（返回格式与 monitoring.routes.ts 一致）
export async function getTenantAccessForMonitoring(
  req: any,
  cloudId: string
): Promise<{ allowed: boolean; namespaces: string[]; isAdmin: boolean }> {
  const { allowed, namespace, isTenant } = await checkTenantAccess(req, cloudId);
  if (!allowed) return { allowed: false, namespaces: [], isAdmin: false };
  if (!isTenant) return { allowed: true, namespaces: [], isAdmin: true };
  const namespaces = namespace ? namespace.split(',').map(s => s.trim()) : [];
  return { allowed: true, namespaces, isAdmin: false };
}

// 要求租户访问权限（带响应处理）
export async function requireTenantAccessForMonitoring(
  req: any,
  res: Response,
  cloudId: string,
  options?: { namespaces?: string[]; forbiddenMessage?: string }
): Promise<{ allowed: boolean; namespaces: string[]; isAdmin: boolean } | null> {
  const tenant = await getTenantAccessForMonitoring(req, cloudId);
  if (!tenant.allowed) {
    res.status(403).json({ message: '您没有该资源池的访问权限' });
    return null;
  }
  const namespaces = options?.namespaces?.filter((ns) => ns != null && String(ns).trim() !== '');
  if (
    namespaces != null &&
    namespaces.length > 0 &&
    !tenant.isAdmin &&
    tenant.namespaces.length > 0
  ) {
    const allowedSet = new Set(tenant.namespaces);
    const allAllowed = namespaces.every((ns) => allowedSet.has(String(ns).trim()));
    if (!allAllowed) {
      res.status(403).json({ message: options?.forbiddenMessage ?? '无权访问该命名空间下的配置' });
      return null;
    }
  }
  return tenant;
}

// 是否为资源池不可达错误
export function isUnreachableError(e: any): boolean {
  const status = e?.status;
  const code = e?.code || (e?.cause as any)?.code;
  return (
    status === 503 ||
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'NETWORK_ERROR'
  );
}

// 判断是否为 website-receiver
export function isWebsiteReceiverInMonitoringNs(receiverName: unknown): boolean {
  const name = String(receiverName ?? '').trim();
  const prefix = `${CATTLE_MONITORING_SYSTEM_NS}/`;
  const suffix = `/${WEBSITE_RECEIVER_NAME}`;
  if (!name.startsWith(prefix) || !name.endsWith(suffix)) return false;
  const middle = name.slice(prefix.length, name.length - suffix.length);
  return middle !== '' && !middle.includes('/');
}

// 校验接收器配置名称
export function isValidReceiverConfigName(name: string): boolean {
  return [EMAIL_RECEIVER, DINGTALK_RECEIVER, WEBSITE_RECEIVER].includes(String(name || '').trim());
}

// 判断是否为告警通知策略
export function isPolicyAlertmanagerConfig(metadataName: string): boolean {
  const n = (metadataName ?? '').toString().trim();
  return n.length > 0 && !isValidReceiverConfigName(n);
}

// 规范化策略 spec
export function normalizePolicySpec(spec: any): any {
  if (!spec || typeof spec !== 'object') return spec;
  const receivers = Array.isArray(spec.receivers) ? spec.receivers : [];
  const hasNull = receivers.some((r: any) => (r?.name ?? '').toString().trim() === NULL_RECEIVER);
  const nextReceivers = hasNull ? receivers : [...receivers, { name: NULL_RECEIVER }];
  const route = spec.route && typeof spec.route === 'object' ? spec.route : {};
  const nextRoute = { ...route, receiver: NULL_RECEIVER };
  return { ...spec, receivers: nextReceivers, route: nextRoute };
}

// 从 route 中收集所有 receiver 名称
export function collectReceiverNamesFromRoute(route: any): string[] {
  const names: string[] = [];
  const top = (route?.receiver ?? '').toString().trim();
  if (top) names.push(top);
  const children = Array.isArray(route?.routes) ? route.routes : [];
  for (const c of children) {
    const r = (c?.receiver ?? '').toString().trim();
    if (r && !names.includes(r)) names.push(r);
  }
  return names;
}

// 推断接收器类型
export function inferReceiverType(receiverName: string, receivers: any[]): string {
  if (receiverName === WEBSITE_RECEIVER) return WEBSITE_RECEIVER;
  const r = (receivers ?? []).find((x: any) => (x?.name ?? '').toString().trim() === receiverName);
  if (!r) return EMAIL_RECEIVER;
  if (Array.isArray(r.emailConfigs) && r.emailConfigs.length > 0) return EMAIL_RECEIVER;
  if (Array.isArray(r.webhookConfigs) && r.webhookConfigs.length > 0) return DINGTALK_RECEIVER;
  return EMAIL_RECEIVER;
}

// 从 spec 中提取告警名称
export function extractAlertNamesFromSpec(spec: any, annotations?: Record<string, string>): string[] {
  const route = spec?.route ?? {};
  let routeMatchers = Array.isArray(route.matchers) ? route.matchers : [];
  if (routeMatchers.length === 0 && Array.isArray(route.routes) && route.routes.length > 0) {
    const firstChild = route.routes[0];
    routeMatchers = Array.isArray(firstChild?.matchers) ? firstChild.matchers : [];
  }
  const alertnameMatchers = routeMatchers.filter((m: any) => String(m?.name ?? '').toLowerCase() === 'alertname');
  if (alertnameMatchers.length > 0) {
    const first = alertnameMatchers[0];
    const matchType = String(first?.matchType ?? '').trim();
    const value = String(first?.value ?? '').trim();
    if (matchType === '=~' && value) {
      return value.split('|').map((s: string) => s.trim()).filter(Boolean);
    }
    return alertnameMatchers.map((m: any) => String(m?.value ?? '').trim()).filter(Boolean);
  }
  const matchRe = route.matchRe ?? {};
  const alertnameRe = (matchRe.alertname ?? '').toString().trim();
  if (alertnameRe) {
    const parts: string[] = [];
    let current = '';
    for (let i = 0; i < alertnameRe.length; i++) {
      const c = alertnameRe[i];
      if (c === '\\' && i + 1 < alertnameRe.length) {
        current += alertnameRe[i + 1];
        i++;
      } else if (c === '|') {
        if (current.trim()) parts.push(current.trim());
        current = '';
      } else {
        current += c;
      }
    }
    if (current.trim()) parts.push(current.trim());
    return parts.filter(Boolean);
  }
  const match = route.match ?? {};
  const alertnameExact = (match.alertname ?? '').toString().trim();
  if (alertnameExact) return [alertnameExact];
  const matchersStr = annotations?.matchers ?? '';
  if (typeof matchersStr === 'string' && matchersStr.trim()) {
    return matchersStr.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

// 解析查询参数为数组
export function parseQueryArray(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  const s = String(value).trim();
  if (!s) return [];
  return s.split(',').map((v) => v.trim()).filter(Boolean);
}

// 钉钉相关辅助函数
export function buildDingtalkMessageTemplate(): { title: string; text: string } {
  return {
    title: DINGTALK_MESSAGE_TEMPLATE.title,
    text: DINGTALK_MESSAGE_TEMPLATE.text,
  };
}

export function buildDefaultDingtalkConfigYamlObject(): { templates: string[]; targets: Record<string, any> } {
  return {
    templates: ['/etc/prometheus-webhook-dingtalk/templates/dingtalk.tmpl'],
    targets: {},
  };
}

export function buildDingtalkTargetUrl(robotUrl: string, robotAccessToken: string): string {
  const base = (robotUrl || 'https://oapi.dingtalk.com/robot/send').trim();
  const token = (robotAccessToken || '').trim();
  if (!token) return base;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}access_token=${encodeURIComponent(token)}`;
}

export function buildNextYamlFromExisting(
  existing: any,
  oldRobotAccounts: string[],
  newTargets: Array<{ robotAccount: string; robotUrl?: string; robotAccessToken?: string }>
): string {
  const rawTargets: Record<string, { url?: string; message?: { title?: string; text?: string } }> = {};
  let configYamlObject: any = buildDefaultDingtalkConfigYamlObject();
  if (existing) {
    const data = existing?.data && typeof existing.data === 'object' ? existing.data : {};
    const configYaml = (data[DINGTALK_CONFIG_KEY] ?? data['config.yml'] ?? '').toString();
    if (configYaml) {
      try {
        const parsed = (yaml.load(configYaml) as any) || {};
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          configYamlObject = parsed;
        }
        const t = configYamlObject?.targets;
        if (t && typeof t === 'object' && !Array.isArray(t)) {
          for (const [k, v] of Object.entries(t)) {
            if (v && typeof v === 'object' && typeof (v as any).url === 'string') {
              const msg = (v as any).message;
              const nextMsg =
                msg && typeof msg === 'object'
                  ? {
                      title: (msg as any).title ?? DINGTALK_MESSAGE_TEMPLATE.title,
                      text: (msg as any).text ?? DINGTALK_MESSAGE_TEMPLATE.text,
                    }
                  : buildDingtalkMessageTemplate();
              rawTargets[k] = {
                url: (v as any).url,
                message: nextMsg,
              };
            }
          }
        }
      } catch {
        /* ignore parse error */
      }
    }
  }
  const targets: Record<string, { url: string; message: { title: string; text: string } }> = {};
  for (const [k, v] of Object.entries(rawTargets)) {
    if (v && typeof v === 'object' && typeof (v as any).url === 'string') {
      const msg = (v as any).message;
      targets[k] = {
        url: (v as any).url,
        message:
          msg && typeof msg === 'object' && msg.title != null && msg.text != null
            ? { title: String(msg.title), text: String(msg.text) }
            : buildDingtalkMessageTemplate(),
      };
    }
  }
  for (const acc of oldRobotAccounts) {
    if (acc) delete targets[acc];
  }
  for (const t of newTargets) {
    const acc = (t.robotAccount || '').trim();
    if (!acc) continue;
    const url = buildDingtalkTargetUrl(t.robotUrl || '', t.robotAccessToken || '');
    targets[acc] = { url, message: buildDingtalkMessageTemplate() };
  }
  const nextConfigYamlObject =
    configYamlObject && typeof configYamlObject === 'object' && !Array.isArray(configYamlObject)
      ? { ...configYamlObject, targets }
      : { ...buildDefaultDingtalkConfigYamlObject(), targets };
  return yaml.dump(nextConfigYamlObject, { noRefs: true, lineWidth: -1 });
}

export async function restartDingtalkWebhookDeployment(
  conn: { origin: string; token: string; insecure: boolean }
): Promise<void> {
  const namespace = DINGTALK_CONFIGMAP_NS;
  const name = DINGTALK_CONFIGMAP_NAME;
  const candidates = [
    `${conn.origin}/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments/${encodeURIComponent(name)}`,
    `${conn.origin}/v1/harvester/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments/${encodeURIComponent(name)}`,
  ];

  let existing: any = null;
  let urlUsed: string | null = null;
  let lastErr: any = null;
  for (const url of candidates) {
    try {
      const raw = await getJsonOnce(url, conn.token, conn.insecure, true);
      if (!raw) continue;
      if (raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as any).metadata != null) {
        existing = raw;
      } else if (
        (raw as any)?.data != null &&
        typeof (raw as any).data === 'object' &&
        !Array.isArray((raw as any).data) &&
        (raw as any).data?.metadata != null
      ) {
        existing = (raw as any).data;
      } else {
        existing =
          (raw as any)?.data != null && typeof (raw as any).data === 'object' ? (raw as any).data : raw;
      }
      urlUsed = url;
      break;
    } catch (e: any) {
      lastErr = e;
    }
  }

  if (!existing || !urlUsed) {
    if (lastErr) {
      console.warn('[dingtalk-receiver] restart alertmanager-webhook-dingtalk: get deployment failed:', lastErr);
    }
    return;
  }

  const now = new Date().toISOString();
  const template = (existing as any).spec?.template || {};
  const templateMeta = template.metadata || {};
  const templateAnnotations = templateMeta.annotations || {};
  const patched: any = {
    ...existing,
    spec: {
      ...(existing as any).spec,
      template: {
        ...template,
        metadata: {
          ...templateMeta,
          annotations: {
            ...templateAnnotations,
            'compute-tower.io/restarted-at': now,
          },
        },
      },
    },
  };

  try {
    await requestJson('PUT', urlUsed, conn.token, conn.insecure, patched);
  } catch (e: any) {
    console.warn('[dingtalk-receiver] restart alertmanager-webhook-dingtalk: update deployment failed:', e);
  }
}

export async function syncDingtalkWebhookConfig(
  conn: { origin: string; token: string; insecure: boolean },
  oldRobotAccounts: string[],
  newTargets: Array<{ robotAccount: string; robotUrl?: string; robotAccessToken?: string }>
): Promise<void> {
  const path = `${CONFIGMAPS_BASE}/${encodeURIComponent(DINGTALK_CONFIGMAP_NS)}/${encodeURIComponent(DINGTALK_CONFIGMAP_NAME)}`;
  const getUrl = `${conn.origin}/${path}`;
  const maxPutRetries = 3;

  let existing: any = null;
  try {
    const raw = await getJsonOnce(getUrl, conn.token, conn.insecure, true);
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as any).metadata != null) {
      existing = raw;
    } else if ((raw as any)?.data != null && typeof (raw as any).data === 'object' && !Array.isArray((raw as any).data) && (raw as any).data?.metadata != null) {
      existing = (raw as any).data;
    } else {
      existing = (raw as any)?.data != null && typeof (raw as any).data === 'object' ? (raw as any).data : raw;
    }
  } catch {
    existing = null;
  }

  if (!existing) {
    const nextYaml = buildNextYamlFromExisting(null, oldRobotAccounts, newTargets);
    const payload = {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: { name: DINGTALK_CONFIGMAP_NAME, namespace: DINGTALK_CONFIGMAP_NS },
      data: { [DINGTALK_CONFIG_KEY]: nextYaml },
    };
    await requestJson('POST', `${conn.origin}/${CONFIGMAPS_BASE}`, conn.token, conn.insecure, payload);
    await restartDingtalkWebhookDeployment(conn);
    return;
  }

  for (let attempt = 0; attempt < maxPutRetries; attempt++) {
    const nextYaml = buildNextYamlFromExisting(existing, oldRobotAccounts, newTargets);
    const resourceVersion = (existing?.metadata?.resourceVersion ?? '').toString().trim();
    if (!resourceVersion) {
      throw new Error('ConfigMap 缺少 resourceVersion，无法更新');
    }
    const data = existing?.data && typeof existing.data === 'object' ? existing.data : {};
    const payload = {
      ...existing,
      metadata: { ...existing.metadata, name: DINGTALK_CONFIGMAP_NAME, namespace: DINGTALK_CONFIGMAP_NS, resourceVersion },
      data: { ...data, [DINGTALK_CONFIG_KEY]: nextYaml },
    };
    try {
      await requestJson('PUT', getUrl, conn.token, conn.insecure, payload);
      await restartDingtalkWebhookDeployment(conn);
      return;
    } catch (e: any) {
      const status = Number((e as any)?.status ?? (e as any)?.statusCode ?? 0);
      if (status === 409 && attempt < maxPutRetries - 1) {
        const raw = await getJsonOnce(getUrl, conn.token, conn.insecure, true);
        if (raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as any).metadata != null) {
          existing = raw;
        } else if ((raw as any)?.data != null && typeof (raw as any).data === 'object' && !Array.isArray((raw as any).data) && (raw as any).data?.metadata != null) {
          existing = (raw as any).data;
        } else {
          existing = (raw as any)?.data != null && typeof (raw as any).data === 'object' ? (raw as any).data : raw;
        }
        continue;
      }
      throw e;
    }
  }
}

export async function removeDingtalkConfigMapTarget(
  conn: { origin: string; token: string; insecure: boolean },
  robotAccount: string
): Promise<void> {
  await syncDingtalkWebhookConfig(conn, [robotAccount], []);
}

export async function updateDingtalkConfigMapTargets(
  conn: { origin: string; token: string; insecure: boolean },
  namespace: string,
  rawReceivers: any[]
): Promise<void> {
  const newTargets: Array<{ robotAccount: string; robotUrl?: string; robotAccessToken?: string }> = [];
  for (const r of rawReceivers || []) {
    const webhookConfigs = Array.isArray(r.webhookConfigs) ? r.webhookConfigs : [];
    const specReceiverName = (r?.name ?? '').toString().trim();
    for (const wc of webhookConfigs) {
      const robotAccount =
        (wc as any)?.robotAccount ?? (r as any)?.robotAccount ?? `${namespace}_${specReceiverName}`;
      newTargets.push({
        robotAccount,
        robotUrl: (wc as any)?.robotUrl ?? (r as any)?.robotUrl,
        robotAccessToken: (wc as any)?.robotAccessToken ?? (r as any)?.robotAccessToken,
      });
    }
  }
  await syncDingtalkWebhookConfig(conn, [], newTargets);
}

export async function syncPoliciesReceiverSpecsAfterReceiverConfigUpdate(
  conn: { origin: string; token: string; insecure: boolean },
  namespace: string,
  updatedReceivers: any[]
): Promise<void> {
  if (!Array.isArray(updatedReceivers) || updatedReceivers.length === 0) return;
  const namesToSync = new Set(updatedReceivers.map((r: any) => (r?.name ?? '').toString().trim()).filter(Boolean));
  if (namesToSync.size === 0) return;
  const listUrl = `${conn.origin}/${ALERTMANAGERCONFIG_BASE}?${PAGESIZE}&exclude=metadata.managedFields&exclude=metadata.ownerReferences`;
  let raw: any;
  try {
    raw = await getJsonOnce(listUrl, conn.token, conn.insecure, true);
  } catch (e) {
    console.warn('[syncPoliciesReceiverSpecs] list configs failed:', e);
    return;
  }
  const items: any[] = Array.isArray(raw?.data) ? raw.data : [];
  const receiverConfigNames = new Set([EMAIL_RECEIVER, DINGTALK_RECEIVER, WEBSITE_RECEIVER]);
  const policiesToUpdate: Array<{ namespace: string; policyName: string }> = [];
  for (const item of items) {
    const inner = item?.data ?? item;
    const policyName = (inner?.metadata?.name ?? '').toString().trim();
    const ns = (inner?.metadata?.namespace ?? '').toString().trim();
    if (receiverConfigNames.has(policyName) || ns !== namespace) continue;
    const route = inner?.spec?.route ?? {};
    const refs = collectReceiverNamesFromRoute(route);
    if (refs.some((rn: string) => namesToSync.has(rn))) policiesToUpdate.push({ namespace: ns, policyName });
  }
  const pathBase = ALERTMANAGERCONFIG_BASE;
  for (const { namespace: ns, policyName } of policiesToUpdate) {
    try {
      const getPath = `${pathBase}/${encodeURIComponent(ns)}/${encodeURIComponent(policyName)}`;
      const policyRaw = await getJsonOnce(`${conn.origin}/${getPath}`, conn.token, conn.insecure, true);
      const policy = (policyRaw as any)?.data != null && typeof (policyRaw as any).data === 'object' ? (policyRaw as any).data : policyRaw;
      if (!policy?.spec?.receivers) continue;
      const receivers = Array.isArray(policy.spec.receivers) ? policy.spec.receivers : [];
      const nextReceivers = receivers.map((r: any) => {
        const rn = (r?.name ?? '').toString().trim();
        const updated = updatedReceivers.find((u: any) => (u?.name ?? '').toString().trim() === rn);
        return updated ?? r;
      });
      const payload = { ...policy, spec: { ...policy.spec, receivers: nextReceivers } };
      await requestJson('PUT', `${conn.origin}/${getPath}`, conn.token, conn.insecure, payload);
    } catch (e) {
      console.warn(`[syncPoliciesReceiverSpecs] policy ${ns}/${policyName} failed:`, e);
    }
  }
}
