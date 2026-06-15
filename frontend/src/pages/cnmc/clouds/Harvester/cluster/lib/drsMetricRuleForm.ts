import type { MetricRuleTableRow } from './drsMetricRuleUtils';

/** CPU / 内存安全阈值下限（%） */
export const METRIC_SAFE_THRESHOLD_MIN = 50;
export const METRIC_SAFE_THRESHOLD_DEFAULT = 80;
export const METRIC_CPU_SCORE_DEFAULT = 4;
export const METRIC_MEMORY_SCORE_DEFAULT = 6;
export const METRIC_SCORE_SUM = 10;
export const METRIC_MAX_MIGRATE_PERIOD_DEFAULT = 24;
/** 关闭调度条件时的默认安全阈值 / 占用比例 */
export const METRIC_DISABLED_SAFE_THRESHOLD = 500;
export const METRIC_DISABLED_SCORE = 0;
/** 集群级 MetricRule 仅允许一条 */
export const METRIC_RULE_MAX_COUNT = 1;

export type MetricRuleCrSpec = {
  cpuSafeThreshold: number;
  cpuScore: number;
  memorySafeThreshold: number;
  memoryScore: number;
  migrateConcurrentNum: number;
  migrateMaxCount: number;
  randTopN: number;
  maxMigratePeriod: number;
};

export type MetricRuleFormValues = {
  name: string;
  cpuEnabled: boolean;
  cpuSafeThreshold?: number;
  cpuScore?: number;
  memoryEnabled: boolean;
  memorySafeThreshold?: number;
  memoryScore?: number;
  migrateConcurrentNum: number;
  migrateMaxCount: number;
  randTopN: number;
  maxMigratePeriod: number;
};

export const DEFAULT_METRIC_RULE_CREATE_VALUES: MetricRuleFormValues = {
  name: '',
  cpuEnabled: true,
  cpuSafeThreshold: METRIC_SAFE_THRESHOLD_DEFAULT,
  cpuScore: METRIC_CPU_SCORE_DEFAULT,
  memoryEnabled: true,
  memorySafeThreshold: METRIC_SAFE_THRESHOLD_DEFAULT,
  memoryScore: METRIC_MEMORY_SCORE_DEFAULT,
  migrateConcurrentNum: 2,
  migrateMaxCount: 1,
  randTopN: 3,
  maxMigratePeriod: METRIC_MAX_MIGRATE_PERIOD_DEFAULT,
};

function readSpec(cr: MetricRuleTableRow | null | undefined): Record<string, unknown> {
  return ((cr?.spec || {}) as Record<string, unknown>) || {};
}

/** 占用比例 > 0 视为启用 */
export function isCpuMetricEnabled(spec: Record<string, unknown>): boolean {
  if (spec.cpuScore != null) return Number(spec.cpuScore) > METRIC_DISABLED_SCORE;
  const legacyType = String(spec.metricType || '')
    .trim()
    .toLowerCase();
  return legacyType === 'cpu';
}

export function isMemoryMetricEnabled(spec: Record<string, unknown>): boolean {
  if (spec.memoryScore != null) return Number(spec.memoryScore) > METRIC_DISABLED_SCORE;
  const legacyType = String(spec.metricType || '')
    .trim()
    .toLowerCase();
  return legacyType === 'memory';
}

/** 兼容旧版 metricType + metricSafeThreshold */
function readLegacyMetricType(spec: Record<string, unknown>): 'cpu' | 'memory' | null {
  const metricType = String(spec.metricType || '')
    .trim()
    .toLowerCase();
  if (metricType === 'cpu' || metricType === 'memory') return metricType;
  return null;
}

/** 按启用状态同步占用比例：关闭项为 0；仅开一项时该项为 10；两项同开时和为 10 */
export function syncMetricRuleScores(
  cpuEnabled: boolean,
  memoryEnabled: boolean,
  scores?: { cpuScore?: number; memoryScore?: number },
): Pick<MetricRuleFormValues, 'cpuScore' | 'memoryScore'> {
  if (!cpuEnabled && !memoryEnabled) {
    return { cpuScore: METRIC_DISABLED_SCORE, memoryScore: METRIC_DISABLED_SCORE };
  }
  if (cpuEnabled && !memoryEnabled) {
    return { cpuScore: METRIC_SCORE_SUM, memoryScore: METRIC_DISABLED_SCORE };
  }
  if (!cpuEnabled && memoryEnabled) {
    return { cpuScore: METRIC_DISABLED_SCORE, memoryScore: METRIC_SCORE_SUM };
  }

  const cpuScore = scores?.cpuScore ?? METRIC_CPU_SCORE_DEFAULT;
  const memoryScore = scores?.memoryScore ?? METRIC_MEMORY_SCORE_DEFAULT;
  if (
    Number.isFinite(cpuScore) &&
    Number.isFinite(memoryScore) &&
    cpuScore + memoryScore === METRIC_SCORE_SUM
  ) {
    return { cpuScore, memoryScore };
  }
  const normalizedCpu = Number.isFinite(cpuScore) ? Math.floor(cpuScore) : METRIC_CPU_SCORE_DEFAULT;
  return {
    cpuScore: normalizedCpu,
    memoryScore: METRIC_SCORE_SUM - normalizedCpu,
  };
}

export function disabledMetricDefaults(): Pick<
  MetricRuleFormValues,
  'cpuSafeThreshold' | 'cpuScore' | 'memorySafeThreshold' | 'memoryScore'
> {
  return {
    cpuSafeThreshold: METRIC_DISABLED_SAFE_THRESHOLD,
    cpuScore: METRIC_DISABLED_SCORE,
    memorySafeThreshold: METRIC_DISABLED_SAFE_THRESHOLD,
    memoryScore: METRIC_DISABLED_SCORE,
  };
}

export function metricRuleCrToFormValues(cr: MetricRuleTableRow | null | undefined): MetricRuleFormValues {
  const spec = readSpec(cr);
  const legacyType = readLegacyMetricType(spec);
  const legacyThreshold =
    spec.metricSafeThreshold != null ? Number(spec.metricSafeThreshold) : undefined;

  let cpuEnabled = isCpuMetricEnabled(spec);
  let memoryEnabled = isMemoryMetricEnabled(spec);

  if (!cpuEnabled && !memoryEnabled && legacyType) {
    if (legacyType === 'cpu') cpuEnabled = true;
    if (legacyType === 'memory') memoryEnabled = true;
  }

  const scores = syncMetricRuleScores(cpuEnabled, memoryEnabled, {
    cpuScore: spec.cpuScore != null ? Number(spec.cpuScore) : undefined,
    memoryScore: spec.memoryScore != null ? Number(spec.memoryScore) : undefined,
  });

  return {
    name: String((cr as { metadata?: { name?: string } })?.metadata?.name || '').trim(),
    cpuEnabled,
    cpuSafeThreshold: cpuEnabled
      ? spec.cpuSafeThreshold != null
        ? Number(spec.cpuSafeThreshold)
        : legacyType === 'cpu' && legacyThreshold != null
          ? legacyThreshold
          : METRIC_SAFE_THRESHOLD_DEFAULT
      : METRIC_DISABLED_SAFE_THRESHOLD,
    cpuScore: scores.cpuScore,
    memoryEnabled,
    memorySafeThreshold: memoryEnabled
      ? spec.memorySafeThreshold != null
        ? Number(spec.memorySafeThreshold)
        : legacyType === 'memory' && legacyThreshold != null
          ? legacyThreshold
          : METRIC_SAFE_THRESHOLD_DEFAULT
      : METRIC_DISABLED_SAFE_THRESHOLD,
    memoryScore: scores.memoryScore,
    migrateConcurrentNum: Number(spec.migrateConcurrentNum ?? 1),
    migrateMaxCount: Number(spec.migrateMaxCount ?? 1),
    randTopN: Number(spec.randTopN ?? 3),
    maxMigratePeriod: Number(spec.maxMigratePeriod ?? METRIC_MAX_MIGRATE_PERIOD_DEFAULT),
  };
}

function validateEnabledSafeThreshold(label: string, value: number | undefined): string | undefined {
  if (value == null || Number.isNaN(value)) return `请输入${label}`;
  if (value < METRIC_SAFE_THRESHOLD_MIN || value > 100) {
    return `${label}须在 ${METRIC_SAFE_THRESHOLD_MIN}–100 之间`;
  }
  return undefined;
}

function validateScores(
  cpuEnabled: boolean,
  memoryEnabled: boolean,
  cpuScore?: number,
  memoryScore?: number,
): string | undefined {
  if (cpuEnabled && !memoryEnabled) {
    if (cpuScore !== METRIC_SCORE_SUM) return `仅启用 CPU 时，CPU 占用比例须为 ${METRIC_SCORE_SUM}`;
    if (memoryScore !== METRIC_DISABLED_SCORE) return `关闭内存时，内存占用比例须为 ${METRIC_DISABLED_SCORE}`;
    return undefined;
  }
  if (!cpuEnabled && memoryEnabled) {
    if (memoryScore !== METRIC_SCORE_SUM) return `仅启用内存时，内存 占用比例须为 ${METRIC_SCORE_SUM}`;
    if (cpuScore !== METRIC_DISABLED_SCORE) return `关闭 CPU 时，CPU 占用比例须为 ${METRIC_DISABLED_SCORE}`;
    return undefined;
  }
  if (cpuEnabled && memoryEnabled) {
    if (cpuScore == null || memoryScore == null || Number.isNaN(cpuScore) || Number.isNaN(memoryScore)) {
      return '请输入 CPU 与内存占用比例';
    }
    if (cpuScore + memoryScore !== METRIC_SCORE_SUM) {
      return `CPU 与内存占用比例之和须为 ${METRIC_SCORE_SUM}`;
    }
    if (cpuScore < 1 || memoryScore < 1) {
      return '占用比例须大于 0';
    }
  }
  return undefined;
}

export function validateMetricRuleFormValues(values: MetricRuleFormValues): string | undefined {
  if (!values.cpuEnabled && !values.memoryEnabled) {
    return '请至少启用 CPU 或内存其中一种调度条件（两者为或关系）';
  }

  if (values.cpuEnabled) {
    const thresholdErr = validateEnabledSafeThreshold('CPU 安全阈值', values.cpuSafeThreshold);
    if (thresholdErr) return thresholdErr;
  } else if (
    values.cpuSafeThreshold !== METRIC_DISABLED_SAFE_THRESHOLD ||
    values.cpuScore !== METRIC_DISABLED_SCORE
  ) {
    return `关闭 CPU 时，安全阈值须为 ${METRIC_DISABLED_SAFE_THRESHOLD}、占用比例须为 ${METRIC_DISABLED_SCORE}`;
  }

  if (values.memoryEnabled) {
    const thresholdErr = validateEnabledSafeThreshold('内存 安全阈值', values.memorySafeThreshold);
    if (thresholdErr) return thresholdErr;
  } else if (
    values.memorySafeThreshold !== METRIC_DISABLED_SAFE_THRESHOLD ||
    values.memoryScore !== METRIC_DISABLED_SCORE
  ) {
    return `关闭内存时，安全阈值须为 ${METRIC_DISABLED_SAFE_THRESHOLD}、占用比例须为 ${METRIC_DISABLED_SCORE}`;
  }

  const scoreErr = validateScores(
    values.cpuEnabled,
    values.memoryEnabled,
    values.cpuScore,
    values.memoryScore,
  );
  if (scoreErr) return scoreErr;

  const maxMigratePeriod = Number(values.maxMigratePeriod);
  if (!Number.isFinite(maxMigratePeriod) || maxMigratePeriod < 1) {
    return '统计时间范围须为大于 0 的小时数';
  }

  const nums = [
    Number(values.migrateConcurrentNum),
    Number(values.migrateMaxCount),
    Number(values.randTopN),
  ];
  if (nums.some((n) => !Number.isFinite(n) || n < 1)) {
    return '最大迁移数 / 并发迁移数 / TopN 须为大于 0 的整数';
  }

  return undefined;
}

export function normalizeMetricRuleFormValues(values: MetricRuleFormValues): MetricRuleFormValues {
  const scores = syncMetricRuleScores(values.cpuEnabled, values.memoryEnabled, {
    cpuScore: values.cpuEnabled ? values.cpuScore : METRIC_DISABLED_SCORE,
    memoryScore: values.memoryEnabled ? values.memoryScore : METRIC_DISABLED_SCORE,
  });
  const normalized: MetricRuleFormValues = { ...values, ...scores };

  if (!values.cpuEnabled) {
    normalized.cpuSafeThreshold = METRIC_DISABLED_SAFE_THRESHOLD;
    normalized.cpuScore = METRIC_DISABLED_SCORE;
  }

  if (!values.memoryEnabled) {
    normalized.memorySafeThreshold = METRIC_DISABLED_SAFE_THRESHOLD;
    normalized.memoryScore = METRIC_DISABLED_SCORE;
  }

  return normalized;
}

export function metricRuleFormValuesToSpec(values: MetricRuleFormValues): MetricRuleCrSpec {
  const normalized = normalizeMetricRuleFormValues(values);
  const err = validateMetricRuleFormValues(normalized);
  if (err) {
    throw new Error(err);
  }

  return {
    cpuSafeThreshold: Math.floor(Number(normalized.cpuSafeThreshold)),
    cpuScore: Math.floor(Number(normalized.cpuScore)),
    memorySafeThreshold: Math.floor(Number(normalized.memorySafeThreshold)),
    memoryScore: Math.floor(Number(normalized.memoryScore)),
    migrateConcurrentNum: Math.floor(Number(normalized.migrateConcurrentNum)),
    migrateMaxCount: Math.floor(Number(normalized.migrateMaxCount)),
    randTopN: Math.floor(Number(normalized.randTopN)),
    maxMigratePeriod: Math.floor(Number(normalized.maxMigratePeriod)),
  };
}
