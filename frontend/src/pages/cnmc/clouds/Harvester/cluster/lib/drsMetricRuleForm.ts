import type { MetricRuleTableRow } from './drsMetricRuleUtils';

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

export function metricRuleFormValuesToSpec(values: MetricRuleFormValues): MetricRuleCrSpec {
  return {
    metricType: values.metricType,
    metricSafeThreshold: Number(values.metricSafeThreshold),
    migrateConcurrentNum: Number(values.migrateConcurrentNum),
    migrateMaxCount: Number(values.migrateMaxCount),
    randTopN: Number(values.randTopN),
  };
}
