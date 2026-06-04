import type { MetricRuleTableRow } from './drsMetricRuleUtils';

/** CPU / 内存类指标的安全阈值下限（%） */
export const METRIC_SAFE_THRESHOLD_MIN = 50;

export type MetricRuleCrSpec = {
  metricType: 'cpu' | 'memory';
  metricSafeThreshold: number;
  migrateConcurrentNum: number;
  migrateMaxCount: number;
  randTopN: number;
};

export type MetricRuleFormValues = {
  name: string;
  metricType: 'cpu' | 'memory';
  metricSafeThreshold: number;
  migrateConcurrentNum: number;
  migrateMaxCount: number;
  randTopN: number;
};

export const METRIC_RULE_TYPE_OPTIONS = [
  { value: 'cpu' as const, label: 'CPU' },
  { value: 'memory' as const, label: '内存' },
];

export function metricRuleCrToFormValues(cr: MetricRuleTableRow | null | undefined): MetricRuleFormValues {
  const spec = (cr?.spec || {}) as Record<string, unknown>;
  const metricType = String(spec.metricType || 'cpu').toLowerCase();
  return {
    name: String((cr as { metadata?: { name?: string } })?.metadata?.name || '').trim(),
    metricType: metricType === 'memory' ? 'memory' : 'cpu',
    metricSafeThreshold: Number(spec.metricSafeThreshold ?? 80),
    migrateConcurrentNum: Number(spec.migrateConcurrentNum ?? 1),
    migrateMaxCount: Number(spec.migrateMaxCount ?? 2),
    randTopN: Number(spec.randTopN ?? 3),
  };
}

export function validateMetricSafeThreshold(
  metricType: 'cpu' | 'memory',
  threshold: number,
): string | undefined {
  if (!Number.isFinite(threshold)) return '请输入安全阈值';
  if (
    (metricType === 'cpu' || metricType === 'memory') &&
    threshold < METRIC_SAFE_THRESHOLD_MIN
  ) {
    return `CPU / 内存安全阈值不能低于 ${METRIC_SAFE_THRESHOLD_MIN}%`;
  }
  if (threshold > 100) return '安全阈值不能高于 100%';
  return undefined;
}

export function metricRuleFormValuesToSpec(values: MetricRuleFormValues): MetricRuleCrSpec {
  const threshold = Number(values.metricSafeThreshold);
  const err = validateMetricSafeThreshold(values.metricType, threshold);
  if (err) {
    throw new Error(err);
  }
  return {
    metricType: values.metricType,
    metricSafeThreshold: threshold,
    migrateConcurrentNum: Number(values.migrateConcurrentNum),
    migrateMaxCount: Number(values.migrateMaxCount),
    randTopN: Number(values.randTopN),
  };
}
