/**
 * 告警数据解析：Alertmanager v2 数组格式
 * 与参考项目 Compute.Tower-Monitoring 一致。
 */
import { ALERT_LEVEL_CRITICAL, ALERT_LEVEL_INFO, ALERT_LEVEL_WARNING } from '../context/MonitoringContext';

export interface ParsedAlert {
  id: string;
  level: typeof ALERT_LEVEL_CRITICAL | typeof ALERT_LEVEL_WARNING | typeof ALERT_LEVEL_INFO;
  title: string;
  description: string;
  startsAtRaw: string;
  endsAtRaw: string;
  updatedAtRaw: string;
  activeAt: string;
  activeAtRaw: string;
  /** 告警分组标识，对应 Alertmanager `labels.prometheus_rule_name` */
  groupName: string;
  groupDescription: string;
  /** 告警状态：active / suppressed / unprocessed 等（来自 status.state） */
  state?: string;
  /** 是否被静默 / 抑制 */
  silencedBy?: string[];
  inhibitedBy?: string[];
  namespace?: string;
  /** 监控任务，对应 Alertmanager `labels.job`（Prometheus 抓取任务名） */
  job?: string;
  node?: string;
  /** 告警实例（labels.instance 原始值） */
  instance?: string;
  pod?: string;
  container?: string;
  /** Alertmanager 指纹 */
  fingerprint?: string;
  /** Prometheus 查询表达式跳转链接 */
  generatorURL?: string;
  /** 告警运维手册链接 */
  runbookUrl?: string;
  /** 推送的通知对象（来自 alertmanager 路由匹配） */
  receivers?: string[];
  /** 原始 alertname（labels.alertname），与 title（annotations.summary）区分 */
  alertname?: string;
}

/**
 * 格式化日期时间
 * @param iso - 日期时间 ISO 字符串
 * @returns 格式化后的日期时间字符串
 */
export function formatDateTimeDetailed(iso?: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}:${s}`;
}

/**
 * 格式化持续时间
 * @param row - 告警记录
 * @returns 格式化后的持续时间字符串
 */
export function formatDuration(row: ParsedAlert): string {
  const startMs = row.startsAtRaw ? new Date(row.startsAtRaw).getTime() : NaN;
  const endMs = row.endsAtRaw ? new Date(row.endsAtRaw).getTime() : NaN;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return '-';
  let totalSeconds = Math.floor((endMs - startMs) / 1000);
  const days = Math.floor(totalSeconds / 86400);
  totalSeconds %= 86400;
  const hours = Math.floor(totalSeconds / 3600);
  totalSeconds %= 3600;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}天`);
  if (hours > 0 || days > 0) parts.push(`${hours}时`);
  if (minutes > 0 || hours > 0 || days > 0) parts.push(`${minutes}分`);
  parts.push(`${seconds}秒`);
  return parts.join(' ');
}

function formatActiveAt(iso: string): string {
  if (!iso) return '--';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${day} ${h}:${min}`;
  } catch {
    return iso;
  }
}

export const ALLOWED_ALERT_GROUP_NAMES = [
  'etcd-custom-rules',
  'kubevirt-custom-rules',
  'k8s-core-custom-rules',
  'k8s-node-custom-rules',
  'node-disk-custom-rules',
  'smartctl-custom-rules',
  'storage-custom-rules',
] as const;

/**
 * 告警分组展示文案：分组标识固定取自 `labels.prometheus_rule_name`（`ParsedAlert.groupName`）。
 * 若提供 `rulesGroupMap`（PrometheusRule 分组缓存，key 为 prometheus_rule_name），优先展示分组别名。
 */
export function getAlertGroupLabel(
  row: Pick<ParsedAlert, 'groupName' | 'groupDescription'>,
  rulesGroupMap?: Record<string, string>,
): string {
  const ruleGroupId = (row.groupName ?? '').toString().trim();
  if (!ruleGroupId) return '-';
  const alias = rulesGroupMap?.[ruleGroupId]?.trim();
  if (alias) return alias;
  const desc = (row.groupDescription ?? '').toString().trim();
  return desc || ruleGroupId;
}

export const GROUP_NAME_DESCRIPTIONS: Record<string, string> = {
  'etcd-custom-rules': 'etcd数据库相关告警规则组',
  'kubevirt-custom-rules': '虚拟机相关告警规则组',
  'k8s-core-custom-rules': '集群核心组件相关告警规则组',
  'k8s-node-custom-rules': 'K8s 节点相关告警规则组',
  'node-disk-custom-rules': '存储-节点级别相关告警规则组',
  'smartctl-custom-rules': '存储-节点真实物理磁盘相关告警规则组',
  'storage-custom-rules': '存储-存储池、虚拟机等相关告警规则组',
  other: '其他告警',
};

export function parseAlerts(data: unknown): ParsedAlert[] {
  if (data == null) return [];
  const raw = Array.isArray(data) ? data : (data as { data?: unknown[] })?.data;
  if (!Array.isArray(raw)) return [];

  let idSeq = 0;
  const list: ParsedAlert[] = [];

  for (const item of raw as any[]) {
    const state = item?.status?.state;
    if (state && state !== 'active') continue;

    const labels = item?.labels ?? {};
    const annotations = item?.annotations ?? {};
    const groupName = (labels.prometheus_rule_name as string) ?? 'other';

    const severity = (labels.severity ?? ALERT_LEVEL_WARNING) as string;
    const normalizedSeverity = String(severity).trim().toLowerCase();
    const level: typeof ALERT_LEVEL_CRITICAL | typeof ALERT_LEVEL_WARNING | typeof ALERT_LEVEL_INFO =
      normalizedSeverity === ALERT_LEVEL_CRITICAL
        ? ALERT_LEVEL_CRITICAL
        : normalizedSeverity === ALERT_LEVEL_INFO
          ? ALERT_LEVEL_INFO
          : ALERT_LEVEL_WARNING;
    const title = (annotations.summary ?? labels.alertname ?? '--') as string;
    const description = (annotations.description ?? '') as string;
    // 触发时间：优先使用 updatedAt，没有则回退到 startsAt
    const startsAtRaw = (item?.startsAt ?? '') as string;
    const endsAtRaw = (item?.endsAt ?? '') as string;
    const updatedAtRaw = (item?.updatedAt ?? '') as string;
    const activeAtRaw = (updatedAtRaw || startsAtRaw || '') as string;
    const activeAt = formatActiveAt(activeAtRaw);
    const namespace = (labels.namespace as string) ?? '';
    const job = (labels.job ?? '').toString().trim();
    const node = (labels.node ?? '').toString().trim();
    const instance = (labels.instance ?? '').toString().trim();
    const pod = (labels.pod ?? '').toString().trim();
    const container = (labels.container ?? '').toString().trim();
    const alertname = (labels.alertname ?? '').toString().trim();
    const fingerprint = (item?.fingerprint ?? '').toString().trim();
    const generatorURL = (item?.generatorURL ?? '').toString().trim();
    const runbookUrl = (annotations.runbook_url ?? '').toString().trim();
    const receivers = Array.isArray(item?.receivers)
      ? (item.receivers as any[])
          .map((r) => (r?.name ?? '').toString().trim())
          .filter(Boolean)
      : [];
    const silencedBy = Array.isArray(item?.status?.silencedBy)
      ? (item.status.silencedBy as any[]).map((s) => String(s)).filter(Boolean)
      : [];
    const inhibitedBy = Array.isArray(item?.status?.inhibitedBy)
      ? (item.status.inhibitedBy as any[]).map((s) => String(s)).filter(Boolean)
      : [];
    const id = fingerprint
      ? `v2-${fingerprint}-${activeAtRaw}`
      : `v2-${idSeq++}-${groupName}-${alertname}-${activeAtRaw}`;

    list.push({
      id,
      level,
      title: String(title).trim(),
      description: String(description).trim(),
      startsAtRaw,
      endsAtRaw,
      updatedAtRaw,
      activeAt,
      activeAtRaw,
      groupName,
      groupDescription: GROUP_NAME_DESCRIPTIONS[groupName] ?? GROUP_NAME_DESCRIPTIONS.other ?? groupName,
      state: state ? String(state) : undefined,
      silencedBy: silencedBy.length ? silencedBy : undefined,
      inhibitedBy: inhibitedBy.length ? inhibitedBy : undefined,
      namespace: namespace || undefined,
      job: job || undefined,
      node: node || undefined,
      instance: instance || undefined,
      pod: pod || undefined,
      container: container || undefined,
      fingerprint: fingerprint || undefined,
      generatorURL: generatorURL || undefined,
      runbookUrl: runbookUrl || undefined,
      receivers: receivers.length ? receivers : undefined,
      alertname: alertname || undefined,
    });
  }

  return list;
}
