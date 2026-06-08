import { apiDelete, apiPost, apiPut, apiRequest } from '../api';

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

export type DrsOverviewSummary = {
  metricRuleCount: number;
  enabledMetricRuleCount: number;
  reallocationMigrationCount: number;
  runningReallocationMigrationCount: number;
};

export type DrsOverviewResponse = {
  summary: DrsOverviewSummary;
  metricRules: {
    items: unknown[];
    available: boolean;
    error?: string;
    listSourceUrl?: string;
  };
  reallocationMigrations: {
    items: unknown[];
  };
};

/** 集群 DRS 概览（MetricRule + DRS 迁移记录） */
export async function fetchHarvesterDrsOverview(cloudId: string, force = false) {
  const qs = force ? '?force=true' : '';
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/drs/overview${qs}`, {
    skipCache: true,
  });
}

/** MetricRule CR 列表 */
export async function fetchHarvesterMetricRules(cloudId: string) {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/drs/metric-rules`, {
    skipCache: true,
  });
}

export async function createHarvesterMetricRuleCr(
  cloudId: string,
  body: { name: string; spec: MetricRuleCrSpec },
) {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/drs/metric-rules`, body);
}

export async function updateHarvesterMetricRuleCr(
  cloudId: string,
  name: string,
  body: { spec: MetricRuleCrSpec },
) {
  return await apiPut(
    `/api/clouds/${cloudId}/resources/harvester/drs/metric-rules/${encodeURIComponent(name)}`,
    body,
  );
}

export async function deleteHarvesterMetricRuleCr(cloudId: string, name: string) {
  return await apiDelete(
    `/api/clouds/${cloudId}/resources/harvester/drs/metric-rules/${encodeURIComponent(name)}`,
  );
}
