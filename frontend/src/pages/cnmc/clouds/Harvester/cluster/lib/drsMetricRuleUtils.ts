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
    cpuSafeThreshold?: number;
    cpuScore?: number;
    memorySafeThreshold?: number;
    memoryScore?: number;
    migrateConcurrentNum?: number;
    migrateMaxCount?: number;
    randTopN?: number;
    maxMigratePeriod?: number;
    /** 旧版字段，仅展示兼容 */
    metricType?: string;
    metricSafeThreshold?: number;
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

function formatPercent(v: unknown): string {
  if (v == null || Number.isNaN(Number(v))) return '—';
  return `${v}%`;
}

function formatScore(v: unknown): string {
  if (v == null || Number.isNaN(Number(v))) return '—';
  return String(v);
}

export const metricRuleRowFields = {
  base: pickRow,
  name: (r: unknown) => {
    const x = pickRow(r);
    return String(x.metadata?.name || x.name || '-');
  },
  /** 集群级 CR，无 namespace */
  scopeLabel: () => '集群',
  metricTypesLabel: (r: unknown) => {
    const spec = pickSpec(r);
    const parts: string[] = [];
    if (spec.cpuScore != null ? Number(spec.cpuScore) > 0 : false) parts.push('CPU');
    if (spec.memoryScore != null ? Number(spec.memoryScore) > 0 : false) parts.push('内存');
    if (parts.length > 0) return parts.join(' / ');

    const legacyType = String(spec.metricType || '').trim().toLowerCase();
    if (legacyType === 'cpu') return 'CPU';
    if (legacyType === 'memory') return '内存';
    return '—';
  },
  cpuSafeThreshold: (r: unknown) => {
    const spec = pickSpec(r);
    const enabled = spec.cpuScore != null ? Number(spec.cpuScore) > 0 : false;
    if (!enabled) return '—';
    if (spec.cpuSafeThreshold != null) return formatPercent(spec.cpuSafeThreshold);
    if (String(spec.metricType || '').toLowerCase() === 'cpu') {
      return formatPercent(spec.metricSafeThreshold);
    }
    return '—';
  },
  cpuScore: (r: unknown) => {
    const score = pickSpec(r).cpuScore;
    if (score == null || Number(score) <= 0) return '—';
    return formatScore(score);
  },
  memorySafeThreshold: (r: unknown) => {
    const spec = pickSpec(r);
    const enabled = spec.memoryScore != null ? Number(spec.memoryScore) > 0 : false;
    if (!enabled) return '—';
    if (spec.memorySafeThreshold != null) return formatPercent(spec.memorySafeThreshold);
    if (String(spec.metricType || '').toLowerCase() === 'memory') {
      return formatPercent(spec.metricSafeThreshold);
    }
    return '—';
  },
  memoryScore: (r: unknown) => {
    const score = pickSpec(r).memoryScore;
    if (score == null || Number(score) <= 0) return '—';
    return formatScore(score);
  },
  healthScoreLabel: (r: unknown) => {
    const spec = pickSpec(r);
    const parts: string[] = [];
    const cpuScore = spec.cpuScore;
    const memoryScore = spec.memoryScore;
    if (cpuScore != null && Number(cpuScore) > 0) parts.push(`CPU ${cpuScore}`);
    if (memoryScore != null && Number(memoryScore) > 0) parts.push(`内存 ${memoryScore}`);
    return parts.length > 0 ? parts.join(' / ') : '—';
  },
  maxMigratePeriod: (r: unknown) => {
    const v = pickSpec(r).maxMigratePeriod;
    if (v == null || Number.isNaN(Number(v))) return '—';
    return `${v} 小时`;
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
    const metricTypes = metricRuleRowFields.metricTypesLabel(item).toLowerCase();
    return name.includes(k) || metricTypes.includes(k);
  });
}
