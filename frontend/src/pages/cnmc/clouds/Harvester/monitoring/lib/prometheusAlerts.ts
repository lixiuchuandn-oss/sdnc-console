/**
 * 告警数据解析：Alertmanager v2 数组格式
 * 与参考项目 Compute.Tower-Monitoring 一致。
 */
export interface ParsedAlert {
  id: string;
  level: 'critical' | 'warning';
  title: string;
  description: string;
  activeAt: string;
  activeAtRaw: string;
  groupName: string;
  groupDescription: string;
  namespace?: string;
  node?: string;
  /** 告警实例（labels.instance 原始值） */
  instance?: string;
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

    const severity = (labels.severity ?? 'warning') as string;
    const level: 'critical' | 'warning' = severity === 'critical' ? 'critical' : 'warning';
    const title = (annotations.summary ?? labels.alertname ?? '--') as string;
    const description = (annotations.description ?? '') as string;
    // 触发时间：优先使用 updatedAt，没有则回退到 startsAt
    const activeAtRaw = (item?.updatedAt ?? item?.startsAt ?? '') as string;
    const activeAt = formatActiveAt(activeAtRaw);
    const namespace = (labels.namespace as string) ?? '';
    const node = (labels.node ?? '').toString().trim();
    const instance = (labels.instance ?? '').toString().trim();
    const id = item?.fingerprint
      ? `v2-${item.fingerprint}-${activeAtRaw}`
      : `v2-${idSeq++}-${groupName}-${labels.alertname ?? ''}-${activeAtRaw}`;

    list.push({
      id,
      level,
      title: String(title).trim(),
      description: String(description).trim().replace(/\n/g, ' '),
      activeAt,
      activeAtRaw,
      groupName,
      groupDescription: GROUP_NAME_DESCRIPTIONS[groupName] ?? GROUP_NAME_DESCRIPTIONS.other ?? groupName,
      namespace: namespace || undefined,
      node: node || undefined,
      instance: instance || undefined,
    });
  }

  return list;
}
