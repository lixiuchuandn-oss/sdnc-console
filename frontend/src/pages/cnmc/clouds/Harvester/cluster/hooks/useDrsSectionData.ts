import { useCallback, useEffect, useState } from 'react';
import { message } from 'antd';
import {
  fetchHarvesterDrsOverview,
  type DrsOverviewResponse,
  type DrsOverviewSummary,
} from 'services/harvester/drs';
import type { MigrationTableRow } from '../../ecs/lib/migrationsSectionUtils';

const EMPTY_SUMMARY: DrsOverviewSummary = {
  metricRuleCount: 0,
  enabledMetricRuleCount: 0,
  reallocationMigrationCount: 0,
  runningReallocationMigrationCount: 0,
};

export function useDrsSectionData(cloudId: string, canRead: boolean) {
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<DrsOverviewSummary>(EMPTY_SUMMARY);
  const [metricRules, setMetricRules] = useState<unknown[]>([]);
  const [metricRulesAvailable, setMetricRulesAvailable] = useState(true);
  const [metricRulesError, setMetricRulesError] = useState<string | undefined>();
  const [metricRulesListSourceUrl, setMetricRulesListSourceUrl] = useState<string | undefined>();
  const [reallocationMigrations, setReallocationMigrations] = useState<MigrationTableRow[]>([]);

  const loadAll = useCallback(
    async (force = true) => {
      if (!canRead || !cloudId) return;
      setLoading(true);
      try {
        const res = await fetchHarvesterDrsOverview(cloudId, force);
        const data = (res?.data || {}) as DrsOverviewResponse;
        setSummary(data.summary || EMPTY_SUMMARY);
        setMetricRules(Array.isArray(data.metricRules?.items) ? data.metricRules.items : []);
        setMetricRulesAvailable(data.metricRules?.available !== false);
        setMetricRulesError(data.metricRules?.error);
        setMetricRulesListSourceUrl(data.metricRules?.listSourceUrl);
        setReallocationMigrations(
          Array.isArray(data.reallocationMigrations?.items)
            ? (data.reallocationMigrations.items as MigrationTableRow[])
            : [],
        );
      } catch (e: unknown) {
        const err = e as { message?: string };
        message.error(err?.message || '加载 DRS 概览失败');
      } finally {
        setLoading(false);
      }
    },
    [canRead, cloudId],
  );

  useEffect(() => {
    void loadAll(true);
  }, [loadAll]);

  return {
    loading,
    summary,
    metricRules,
    metricRulesAvailable,
    metricRulesError,
    metricRulesListSourceUrl,
    reallocationMigrations,
    loadAll,
  };
}
