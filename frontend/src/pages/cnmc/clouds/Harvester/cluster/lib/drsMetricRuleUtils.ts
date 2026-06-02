import dayjs from 'dayjs';

/** MetricRule CR 列表行（hms.rivercloud.com/v1，集群级） */
export type MetricRuleTableRow = Record<string, unknown>;

type MetricRuleRowBase = {
  metadata?: {
    name?: string;
    uid?: string;
    creationTimestamp?: string;
    annotations?: Record<string, string>;
  };
  name?: string;
  spec?: {
    metricType?: string;
    metricSafeThreshold?: number;
    migrateConcurrentNum?: number;
    migrateMaxCount?: number;
    randTopN?: number;
    enabled?: boolean;
    disabled?: boolean;
  };
  status?: Record<string, unknown>;
};

function pickRow(r: unknown): MetricRuleRowBase {
  return (r ?? {}) as MetricRuleRowBase;
}

function pickSpec(r: unknown): NonNullable<MetricRuleRowBase['spec']> {
  return pickRow(r).spec || {};
}

export const metricRuleRowFields = {
  base: pickRow,
  name: (r: unknown) => {
    const x = pickRow(r);
    return String(x.metadata?.name || x.name || '-');
  },
  /** 集群级 CR，无 namespace */
  scopeLabel: () => '集群',
  metricType: (r: unknown) => {
    const t = pickSpec(r).metricType;
    const s = t != null ? String(t).trim() : '';
    if (!s) return '—';
    return s === 'cpu' ? 'CPU' : s === 'memory' ? '内存' : s;
  },
  metricSafeThreshold: (r: unknown) => {
    const v = pickSpec(r).metricSafeThreshold;
    if (v == null || Number.isNaN(Number(v))) return '—';
    return `${v}%`;
  },
  migrateMaxCount: (r: unknown) => {
    const v = pickSpec(r).migrateMaxCount;
    return v == null ? '—' : String(v);
  },
  migrateConcurrentNum: (r: unknown) => {
    const v = pickSpec(r).migrateConcurrentNum;
    return v == null ? '—' : String(v);
  },
  randTopN: (r: unknown) => {
    const v = pickSpec(r).randTopN;
    return v == null ? '—' : String(v);
  },
  createdAt: (r: unknown) => {
    return String(pickRow(r).metadata?.creationTimestamp || '').trim();
  },
  uidOrKey: (r: unknown) => {
    const x = pickRow(r);
    return x.metadata?.uid || metricRuleRowFields.name(r);
  },
};

export function formatMetricRuleCreatedAt(r: unknown): string {
  const t = metricRuleRowFields.createdAt(r);
  return t ? dayjs(t).format('YYYY-MM-DD HH:mm:ss') : '-';
}

export function filterMetricRulesForTable(
  items: readonly MetricRuleTableRow[],
  keyword: string,
): MetricRuleTableRow[] {
  const k = keyword.trim().toLowerCase();
  if (!k) return [...items];
  return items.filter((item) => {
    const name = metricRuleRowFields.name(item).toLowerCase();
    const metricType = metricRuleRowFields.metricType(item).toLowerCase();
    return name.includes(k) || metricType.includes(k);
  });
}
