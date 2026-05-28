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
/**
 * AlertmanagerConfig metadata.annotations 中标识「通知方式」的注解键。
 * 取值与 EMAIL_RECEIVER / DINGTALK_RECEIVER / WEBSITE_RECEIVER 一致：
 *   - 'email-receiver'    => 邮件通知方式
 *   - 'dingtalk-receiver' => 钉钉通知方式
 *   - 'website-receiver'  => 站内信通知方式
 * 前端展示「通知方式」必须以此注解为准；缺失时按 metadata.name 回退（兼容历史数据）。
 */
export const ANNOTATION_MONITORING_RECEIVER = 'tower.io/monitoring-receiver';
/** 通知对象展示名称（AlertmanagerConfig metadata.annotations） */
export const ANNOTATION_ALIAS = 'tower.io/alias';
/** 通知对象描述（AlertmanagerConfig metadata.annotations） */
export const ANNOTATION_DESCRIPTION = 'tower.io/description';

export const EMAIL_RECEIVER = 'email-receiver';
export const DINGTALK_RECEIVER = 'dingtalk-receiver';
export const WEBSITE_RECEIVER = 'website-receiver';
export const NULL_RECEIVER = 'null-receiver';

/** 由 metadata.name 推导默认的通知方式类型；当 annotation 缺失时使用此回退 */
export function defaultReceiverTypeByName(name: string): string {
  const trimmed = String(name ?? '').trim();
  if (trimmed === EMAIL_RECEIVER || trimmed === DINGTALK_RECEIVER || trimmed === WEBSITE_RECEIVER) {
    return trimmed;
  }
  return EMAIL_RECEIVER;
}

/** 从 AlertmanagerConfig metadata 读取通知方式类型：优先 annotation，回退 metadata.name */
export function resolveMonitoringReceiverType(meta: any): string {
  const fromAnnotation = String(meta?.annotations?.[ANNOTATION_MONITORING_RECEIVER] ?? '').trim();
  if (fromAnnotation) return fromAnnotation;
  return defaultReceiverTypeByName(String(meta?.name ?? '').trim());
}

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
      res.status(403).json({ message: options?.forbiddenMessage ?? '无权访问项目下的配置' });
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

/**
 * 校验「通知方式名称」是否合法（取值与 ANNOTATION_MONITORING_RECEIVER 取值集合一致）。
 * 仅用于校验通知方式枚举；不再用于判定 AlertmanagerConfig CR 是否为「接收器 CR」。
 */
export function isValidReceiverConfigName(name: string): boolean {
  return [EMAIL_RECEIVER, DINGTALK_RECEIVER, WEBSITE_RECEIVER].includes(String(name || '').trim());
}

/**
 * 判定某 AlertmanagerConfig 是否为「接收器 CR」（与之相对的是「告警通知策略 CR」）。
 *
 * 自「每通知对象一 CR」改造起：
 *   - 接收器 CR 的唯一可靠识别标志为 `metadata.labels['monitoring-receiver'] === 'true'`；
 *   - 兼容历史共享 CR：metadata.name ∈ {email-receiver, dingtalk-receiver, website-receiver} 亦视为接收器；
 *   - 其它一律视为策略 CR。
 *
 * 入参可为完整 metadata 对象（推荐）或仅 metadata.name 字符串（兼容旧调用，但仅按 name 回退）。
 */
export function isMonitoringReceiverConfigMeta(meta: any): boolean {
  if (meta && typeof meta === 'object') {
    const labelValue = String(meta?.labels?.['monitoring-receiver'] ?? '').trim();
    if (labelValue === 'true') return true;
    const name = String(meta?.name ?? '').trim();
    if (isValidReceiverConfigName(name)) return true;
    return false;
  }
  // 旧调用：仅传 metadata.name 字符串
  return isValidReceiverConfigName(String(meta ?? '').trim());
}

/**
 * 判定 AlertmanagerConfig 是否为「告警通知策略 CR」。
 *
 * 推荐传 metadata 对象（按 label 精准判定）；为兼容旧调用，传字符串时仅按名字判定，
 * 结果会把 per-target 接收器 CR 误判为策略——所以新代码必须传 metadata 对象。
 */
export function isPolicyAlertmanagerConfig(metaOrName: any): boolean {
  if (metaOrName && typeof metaOrName === 'object') {
    const name = String(metaOrName?.name ?? '').trim();
    if (!name) return false;
    return !isMonitoringReceiverConfigMeta(metaOrName);
  }
  const n = (metaOrName ?? '').toString().trim();
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

/**
 * 从 AlertmanagerConfig sub-route 的 `matchers` 中提取「告警规则名（alertname）」列表。
 *
 * 设计上唯一可信源（自本版本起）：
 *   - `spec.route.routes[0].matchers`（或顶层 `spec.route.matchers`）中 `name === 'alertname'` 的项；
 *   - 命中 `matchType === '=~'` 时，将 `value` 按 `|` 切分；
 *   - 否则（`=` 等）按每条 `value` 收集。
 *
 * 不再读取 `annotations.matchers` / `spec.route.match` / `spec.route.matchRe`；后两者仍可被
 * 上游写入，但本助手不参与解析。`annotations.matchers` 仅在写入路径上作冗余写入，便于检索/兼容老脚本。
 */
export function extractAlertNamesFromSubRouteMatchers(matchers: any): string[] {
  if (!Array.isArray(matchers) || matchers.length === 0) return [];
  const alertnameMatchers = matchers.filter(
    (m: any) => String(m?.name ?? '').toLowerCase() === 'alertname',
  );
  if (alertnameMatchers.length === 0) return [];
  const first = alertnameMatchers[0];
  const matchType = String(first?.matchType ?? '').trim();
  const value = String(first?.value ?? '').trim();
  if (matchType === '=~' && value) {
    return value.split('|').map((s: string) => s.trim()).filter(Boolean);
  }
  return alertnameMatchers.map((m: any) => String(m?.value ?? '').trim()).filter(Boolean);
}

/**
 * 从 AlertmanagerConfig CR 提取「告警规则名」列表。
 *
 * 唯一可信源：`spec.route.routes[0].matchers`；若不存在，回退顶层 `spec.route.matchers`。
 * **不再**回退 `annotations.matchers` / `match` / `matchRe`，避免旧路径带来的歧义。
 */
export function extractAlertNamesFromPolicyCR(cr: any): string[] {
  const route = cr?.spec?.route ?? {};
  const children = Array.isArray(route?.routes) ? route.routes : [];
  const subMatchers = children.length > 0 ? children[0]?.matchers : undefined;
  if (Array.isArray(subMatchers) && subMatchers.length > 0) {
    return extractAlertNamesFromSubRouteMatchers(subMatchers);
  }
  const topMatchers = Array.isArray(route?.matchers) ? route.matchers : [];
  return extractAlertNamesFromSubRouteMatchers(topMatchers);
}

/**
 * 旧版兼容入口：保留多路径回退（用于 alertName=... 列表筛选时容错老数据）。
 * 新代码请使用 {@link extractAlertNamesFromPolicyCR} 或 {@link extractAlertNamesFromSubRouteMatchers}。
 * @deprecated 仅供兼容历史数据的过滤场景使用，**不要**在新结构化响应里读这个。
 */
export function extractAlertNamesFromSpec(spec: any, annotations?: Record<string, string>): string[] {
  const route = spec?.route ?? {};
  let routeMatchers = Array.isArray(route.matchers) ? route.matchers : [];
  if (routeMatchers.length === 0 && Array.isArray(route.routes) && route.routes.length > 0) {
    const firstChild = route.routes[0];
    routeMatchers = Array.isArray(firstChild?.matchers) ? firstChild.matchers : [];
  }
  const fromMatchers = extractAlertNamesFromSubRouteMatchers(routeMatchers);
  if (fromMatchers.length > 0) return fromMatchers;
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

// ===== 告警通知策略结构（AlertmanagerPolicy）=====
//
// 这是 Compute Tower 对外（前端/调用方）使用的策略模型，从 AlertmanagerConfig CR 解析而来。
// CR 的写入路径在 buildAlertmanagerConfigCRFromPolicyPayload 内封装；前后端再不直接拼装 CR。

/** AlertmanagerConfig sub-route / route 中单条 matcher，与 K8s API 字段一致 */
export interface AlertmanagerPolicyMatcher {
  /** '=' | '!=' | '=~' | '!~' */
  matchType: string;
  name: string;
  value: string;
}

/** 关联到「通知对象」(MonitoringAlertNotificationTarget) 后的 receiver 精简引用 */
export interface AlertmanagerPolicyReceiverRef {
  /** spec.receivers[].name；同时是同 namespace 通知对象 AlertmanagerConfig CR 的 metadata.name */
  name: string;
  /** 关联通知对象 annotation `tower.io/monitoring-receiver`；找不到 CR 时为 undefined */
  receiverType?: string;
  /** 关联通知对象 annotation `tower.io/alias`（通知对象名称） */
  aliasName?: string;
}

/**
 * 子路由（sub-route）：当前 UI 仅消费第一条；保留 raw matchers 供调试，
 * `alertNames` 是 matchers 解析出的告警规则名列表（**前端展示与编辑的唯一字段**）。
 */
export interface AlertmanagerPolicySubRoute {
  continue?: boolean;
  receiver?: string;
  repeatInterval?: string;
  matchers?: AlertmanagerPolicyMatcher[];
  alertNames?: string[];
}

/** 顶层路由：保留告警组信息（groupBy 等），当前前端 UI 不消费，预留 */
export interface AlertmanagerPolicyRoute {
  groupBy?: string[];
  groupWait?: string;
  groupInterval?: string;
  repeatInterval?: string;
  receiver?: string;
  routes?: AlertmanagerPolicySubRoute[];
}

/** 对外暴露的告警通知策略（与 AlertmanagerConfig CR 一一对应） */
export interface AlertmanagerPolicy {
  /** `${namespace}/${name}` */
  id: string;
  /** metadata.name */
  name: string;
  /** metadata.namespace */
  namespace: string;
  /** annotations['tower.io/alias']；未配置时回退 name */
  aliasName?: string;
  /** annotations['tower.io/description'] 或 annotations['description'] */
  description?: string;
  /** spec.receivers 关联通知对象后的精简列表（不含 null-receiver） */
  receivers: AlertmanagerPolicyReceiverRef[];
  /** 完整 route（含 groupBy/groupWait/groupInterval/routes），保留供未来扩展 */
  route?: AlertmanagerPolicyRoute;
  /** routes[0] 解析结果；当前 UI 主消费此字段（alertNames + repeatInterval） */
  subRoute?: AlertmanagerPolicySubRoute;
  creationTimestamp?: string;
  creator?: string;
  /** metadata.resourceVersion；前端 UPDATE 时回传以避免冲突 */
  resourceVersion?: string;
  /** 是否为系统默认策略（不可编辑/删除） */
  isSystemDefault?: boolean;
}

/** 前端 -> 后端 创建/更新策略 payload */
export interface UpsertAlertmanagerPolicyPayload {
  name: string;
  namespace: string;
  aliasName?: string;
  description?: string;
  /** 仅需 name（通知对象唯一标识 = 同 ns 通知对象 CR metadata.name） */
  receivers: Array<{ name: string }>;
  /** 告警规则名列表（最终写入 sub-route matchers，name=alertname, matchType==~, value 用 `|` 联合） */
  alertNames: string[];
  /** 子路由重复推送间隔；默认 4h */
  subRouteRepeatInterval?: string;
  /** 编辑时回传，新建省略 */
  resourceVersion?: string;
}

const SYSTEM_DEFAULT_ALERTMANAGER_CONFIG_NAME = 'default-alertmanager-config';

/** 判断 CR 是否为「系统默认策略」（不允许编辑/删除） */
function isSystemDefaultPolicyCR(cr: any): boolean {
  const namespace = (cr?.metadata?.namespace ?? '').toString().trim();
  if (namespace !== CATTLE_MONITORING_SYSTEM_NS) return false;
  const name = (cr?.metadata?.name ?? '').toString().trim();
  if (name === SYSTEM_DEFAULT_ALERTMANAGER_CONFIG_NAME) return true;
  const targetAnnotation = (cr?.metadata?.annotations?.[ALERTMANAGER_TARGET_ANNOTATION] ?? '')
    .toString()
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean);
  return targetAnnotation.includes(SYSTEM_DEFAULT_ALERTMANAGER_CONFIG_NAME);
}

function readPolicyDescription(annotations: Record<string, string>): string | undefined {
  const v1 = String(annotations?.[ANNOTATION_DESCRIPTION] ?? '').trim();
  if (v1) return v1;
  const v2 = String(annotations?.['description'] ?? '').trim();
  return v2 || undefined;
}

function normalizeMatchersArray(input: any): AlertmanagerPolicyMatcher[] | undefined {
  if (!Array.isArray(input) || input.length === 0) return undefined;
  return input
    .map((m: any) => ({
      matchType: String(m?.matchType ?? '').trim(),
      name: String(m?.name ?? '').trim(),
      value: String(m?.value ?? '').trim(),
    }))
    .filter((m) => m.name);
}

/** 把单条 sub-route 的原始字段归一为 AlertmanagerPolicySubRoute，并解析出 alertNames */
function buildSubRouteFromRaw(rawRoute: any): AlertmanagerPolicySubRoute | undefined {
  if (!rawRoute || typeof rawRoute !== 'object') return undefined;
  const matchers = normalizeMatchersArray(rawRoute?.matchers);
  const sub: AlertmanagerPolicySubRoute = {};
  if (typeof rawRoute.continue === 'boolean') sub.continue = rawRoute.continue;
  const receiver = String(rawRoute?.receiver ?? '').trim();
  if (receiver) sub.receiver = receiver;
  const repeatInterval = String(rawRoute?.repeatInterval ?? '').trim();
  if (repeatInterval) sub.repeatInterval = repeatInterval;
  if (matchers) sub.matchers = matchers;
  const alertNames = extractAlertNamesFromSubRouteMatchers(matchers ?? []);
  if (alertNames.length > 0) sub.alertNames = alertNames;
  return Object.keys(sub).length > 0 ? sub : undefined;
}

/** CR -> AlertmanagerPolicy（不含 receivers 的 receiverType / aliasName 联表信息） */
export function buildAlertmanagerPolicyFromCR(crInput: any): AlertmanagerPolicy {
  const cr = crInput?.data && typeof crInput.data === 'object' ? crInput.data : crInput;
  const meta = cr?.metadata ?? {};
  const annotations: Record<string, string> =
    meta?.annotations && typeof meta.annotations === 'object' ? meta.annotations : {};
  const name = String(meta?.name ?? '').trim();
  const namespace = String(meta?.namespace ?? '').trim();
  const spec = cr?.spec ?? {};
  const route = spec?.route && typeof spec.route === 'object' ? spec.route : {};
  const childRoutes = Array.isArray(route?.routes) ? route.routes : [];

  // 收集 receiver 引用（顶层 + 子路由，去重；排除 null-receiver）
  const seenReceiverNames = new Set<string>();
  const orderedReceiverNames: string[] = [];
  const pushReceiverName = (raw: unknown) => {
    const n = String(raw ?? '').trim();
    if (!n || n === NULL_RECEIVER) return;
    if (seenReceiverNames.has(n)) return;
    seenReceiverNames.add(n);
    orderedReceiverNames.push(n);
  };
  for (const child of childRoutes) pushReceiverName(child?.receiver);
  pushReceiverName(route?.receiver);
  const specReceivers = Array.isArray(spec?.receivers) ? spec.receivers : [];
  for (const r of specReceivers) pushReceiverName(r?.name);

  // 子路由（取第一条；当前 UI 假设所有子路由 matchers 同构、仅 receiver 不同）
  const firstChild = childRoutes.length > 0 ? childRoutes[0] : undefined;
  const subRoute = buildSubRouteFromRaw(firstChild);

  // 完整 route（保留 raw 字段，便于未来扩展；matchers 一并归一）
  const routeOut: AlertmanagerPolicyRoute = {};
  if (Array.isArray(route?.groupBy)) routeOut.groupBy = route.groupBy.map((x: any) => String(x));
  const gw = String(route?.groupWait ?? '').trim();
  if (gw) routeOut.groupWait = gw;
  const gi = String(route?.groupInterval ?? '').trim();
  if (gi) routeOut.groupInterval = gi;
  const ri = String(route?.repeatInterval ?? '').trim();
  if (ri) routeOut.repeatInterval = ri;
  const rcv = String(route?.receiver ?? '').trim();
  if (rcv) routeOut.receiver = rcv;
  if (childRoutes.length > 0) {
    routeOut.routes = childRoutes
      .map((c: any) => buildSubRouteFromRaw(c))
      .filter((x: AlertmanagerPolicySubRoute | undefined): x is AlertmanagerPolicySubRoute => !!x);
  }

  const aliasName = String(annotations?.[ANNOTATION_ALIAS] ?? '').trim() || undefined;
  const description = readPolicyDescription(annotations);
  const creationTimestamp = meta?.creationTimestamp ? String(meta.creationTimestamp) : undefined;
  const creator = meta?.creator ? String(meta.creator) : undefined;
  const resourceVersion = meta?.resourceVersion ? String(meta.resourceVersion) : undefined;

  return {
    id: `${namespace}/${name}`,
    name,
    namespace,
    aliasName,
    description,
    receivers: orderedReceiverNames.map((rn) => ({ name: rn })),
    route: Object.keys(routeOut).length > 0 ? routeOut : undefined,
    subRoute,
    creationTimestamp,
    creator,
    resourceVersion,
    isSystemDefault: isSystemDefaultPolicyCR(cr),
  };
}

/**
 * 将通知对象 CR 列表归约成「(namespace, metadata.name) -> {receiverType, aliasName}」索引，
 * 供 policy.receivers 联表使用。
 */
export function buildReceiverRefIndexFromReceiverCRs(
  receiverCRs: any[],
): Map<string, { receiverType?: string; aliasName?: string }> {
  const idx = new Map<string, { receiverType?: string; aliasName?: string }>();
  for (const item of receiverCRs ?? []) {
    const inner = item?.data ?? item;
    const meta = inner?.metadata ?? {};
    const name = String(meta?.name ?? '').trim();
    const namespace = String(meta?.namespace ?? '').trim();
    if (!name || !namespace) continue;
    const annotations: Record<string, string> =
      meta?.annotations && typeof meta.annotations === 'object' ? meta.annotations : {};
    const receiverType = resolveMonitoringReceiverType(meta) || undefined;
    const aliasName = String(annotations?.[ANNOTATION_ALIAS] ?? '').trim() || undefined;
    idx.set(`${namespace}/${name}`, { receiverType, aliasName });
  }
  return idx;
}

/** 联表 receiver 引用元信息（receiverType / aliasName）到一组 policies 上 */
export function joinReceiverRefsForPolicies(
  policies: AlertmanagerPolicy[],
  receiverIndex: Map<string, { receiverType?: string; aliasName?: string }>,
): AlertmanagerPolicy[] {
  return policies.map((p) => ({
    ...p,
    receivers: p.receivers.map((r) => {
      const meta = receiverIndex.get(`${p.namespace}/${r.name}`) ?? {};
      return {
        name: r.name,
        ...(meta.receiverType ? { receiverType: meta.receiverType } : {}),
        ...(meta.aliasName ? { aliasName: meta.aliasName } : {}),
      };
    }),
  }));
}

const DEFAULT_TOP_REPEAT_INTERVAL = '30m';
const DEFAULT_SUB_REPEAT_INTERVAL = '4h';
const DEFAULT_GROUP_BY = ['alertname', 'namespace'];
const DEFAULT_GROUP_WAIT = '30s';
const DEFAULT_GROUP_INTERVAL = '5m';

/**
 * 把前端提交的 AlertmanagerPolicy payload 序列化为 AlertmanagerConfig CR。
 *
 * 行为：
 *   - metadata.{name, namespace}, annotations[tower.io/alias|description], annotations.matchers（冗余写入）
 *   - spec.receivers：payload.receivers 中的 {name} 列表（后续由 normalizePolicySpec 追加 null-receiver）
 *   - spec.route：顶层 groupBy/groupWait/groupInterval/repeatInterval 兜底；
 *     `routes` 按 receivers 拆为 N 条 sub-route，matchers 共用 alertNames 联合
 *   - 当 `existingCR` 提供时，会保留它的 metadata.annotations 其它键、metadata.labels、
 *     spec.route 顶层除 receiver/routes/match/matchRe/matchers 之外的其他字段（防止误覆盖外部维护）
 */
export function buildAlertmanagerConfigCRFromPolicyPayload(
  payload: UpsertAlertmanagerPolicyPayload,
  existingCR?: any,
): any {
  const name = String(payload?.name ?? '').trim();
  const namespace = String(payload?.namespace ?? '').trim();
  const aliasName = String(payload?.aliasName ?? '').trim();
  const description = String(payload?.description ?? '').trim();
  const receivers = Array.isArray(payload?.receivers) ? payload.receivers : [];
  const alertNames = Array.isArray(payload?.alertNames)
    ? payload.alertNames.map((s) => String(s ?? '').trim()).filter(Boolean)
    : [];
  const subRouteRepeatInterval =
    String(payload?.subRouteRepeatInterval ?? '').trim() || DEFAULT_SUB_REPEAT_INTERVAL;

  const existing =
    existingCR?.data && typeof existingCR.data === 'object' ? existingCR.data : existingCR ?? {};
  const existingMeta = existing?.metadata ?? {};
  const existingAnnotations: Record<string, string> =
    existingMeta?.annotations && typeof existingMeta.annotations === 'object'
      ? { ...existingMeta.annotations }
      : {};
  const existingLabels: Record<string, string> =
    existingMeta?.labels && typeof existingMeta.labels === 'object'
      ? { ...existingMeta.labels }
      : {};
  const existingRoute =
    existing?.spec?.route && typeof existing.spec.route === 'object' ? existing.spec.route : {};
  // 保留顶层 route 其它字段（如 muteTimeIntervals 等），但 receiver/routes/match/matchRe/matchers 我们要覆盖
  const {
    receiver: _omitReceiver,
    routes: _omitRoutes,
    match: _omitMatch,
    matchRe: _omitMatchRe,
    matchers: _omitMatchers,
    groupBy: _omitGroupBy,
    groupWait: _omitGroupWait,
    groupInterval: _omitGroupInterval,
    repeatInterval: _omitRepeatInterval,
    ...restRoute
  } = existingRoute as Record<string, unknown>;

  const annotations: Record<string, string> = { ...existingAnnotations };
  if (aliasName) annotations[ANNOTATION_ALIAS] = aliasName;
  else delete annotations[ANNOTATION_ALIAS];
  if (description) annotations[ANNOTATION_DESCRIPTION] = description;
  else delete annotations[ANNOTATION_DESCRIPTION];
  if (alertNames.length > 0) annotations['matchers'] = alertNames.join(',');
  else delete annotations['matchers'];

  // sub-route matchers：name=alertname, matchType==~, value = a|b|c
  const subRouteMatchers =
    alertNames.length > 0
      ? [{ matchType: '=~', name: 'alertname', value: alertNames.join('|') }]
      : [];

  const childRoutes = receivers.map((r) => ({
    continue: true,
    receiver: String(r?.name ?? '').trim(),
    repeatInterval: subRouteRepeatInterval,
    matchers: subRouteMatchers.map((m) => ({ ...m })),
  }));

  // 顶层 route 由我们兜底字段 + 保留的 restRoute 合成；顶层 receiver 由 normalizePolicySpec 兜底为 null-receiver
  const nextRoute: Record<string, unknown> = {
    ...restRoute,
    groupBy: Array.isArray(existingRoute?.groupBy) && existingRoute.groupBy.length ? existingRoute.groupBy : DEFAULT_GROUP_BY,
    groupWait: String(existingRoute?.groupWait ?? '').trim() || DEFAULT_GROUP_WAIT,
    groupInterval: String(existingRoute?.groupInterval ?? '').trim() || DEFAULT_GROUP_INTERVAL,
    repeatInterval: DEFAULT_TOP_REPEAT_INTERVAL,
    routes: childRoutes,
  };

  const nextLabels: Record<string, string> = { ...existingLabels };
  // 策略 CR 不应带 monitoring-receiver 标签（避免被接收器列表误识别）
  delete nextLabels['monitoring-receiver'];

  const apiVersion = String(existing?.apiVersion ?? '').trim() || 'monitoring.coreos.com/v1alpha1';
  const kind = String(existing?.kind ?? '').trim() || 'AlertmanagerConfig';

  const next: Record<string, unknown> = {
    ...(existing && typeof existing === 'object' ? existing : {}),
    apiVersion,
    kind,
    metadata: {
      ...(existingMeta && typeof existingMeta === 'object' ? existingMeta : {}),
      name,
      namespace,
      annotations,
      ...(Object.keys(nextLabels).length > 0 ? { labels: nextLabels } : {}),
      ...(payload?.resourceVersion
        ? { resourceVersion: payload.resourceVersion }
        : existingMeta?.resourceVersion
          ? { resourceVersion: existingMeta.resourceVersion }
          : {}),
    },
    spec: {
      ...(existing?.spec && typeof existing.spec === 'object' ? existing.spec : {}),
      receivers: receivers.map((r) => ({ name: String(r?.name ?? '').trim() })).filter((r) => r.name),
      route: nextRoute,
    },
  };
  return next;
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
  const policiesToUpdate: Array<{ namespace: string; policyName: string }> = [];
  for (const item of items) {
    const inner = item?.data ?? item;
    const policyName = (inner?.metadata?.name ?? '').toString().trim();
    const ns = (inner?.metadata?.namespace ?? '').toString().trim();
    if (ns !== namespace) continue;
    // 跳过接收器 CR（含历史共享 CR 与新模型 per-target CR，均带 label monitoring-receiver=true）
    if (isMonitoringReceiverConfigMeta(inner?.metadata ?? {})) continue;
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