/**
 * 集群 DRS（动态资源调度）概览：MetricRule CR + DRS 迁移记录。
 */
import { Request, Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import { HarvesterMigrationInventory } from '../../../../entities/harvester/HarvesterMigrationInventory';
import { listMetricRuleCrs } from '../../../../services/hms/metricRuleCr';
import { syncKubevirtMigrations } from '../../../../services/clouds/harvester/inventory';
import { fetchCloudOr404, ensureProvider } from '../harvester.cache.helpers';

export const MIGRATION_AUTO_SCHEDULED_FINGERPRINT_LABEL =
  'hci.manager.system/auto-scheduled-fingerprint';

function readAutoFingerprint(item: any): string | undefined {
  const labels =
    item?.labels ||
    item?.metadata?.labels ||
    item?.rawData?.metadata?.labels ||
    {};
  const v = labels?.[MIGRATION_AUTO_SCHEDULED_FINGERPRINT_LABEL];
  const s = v != null ? String(v).trim() : '';
  return s || undefined;
}

/** CRD spec 无 enabled 字段；有 status 时可扩展，默认计为启用 */
function isMetricRuleEnabled(_item: any): boolean {
  return true;
}

function migrationPhase(item: any): string {
  return String(
    item?.phase ||
      item?.rawData?.status?.phase ||
      item?.status?.phase ||
      'Unknown',
  ).trim();
}

function isRunningMigrationPhase(phase: string): boolean {
  return ['Running', 'Scheduled', 'Scheduling', 'Preparing'].includes(phase);
}

/**
 * GET /:id/resources/harvester/drs/overview
 * Query: force=true 时同步迁移库存后再返回。
 */
export async function harvesterDrsOverviewHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { force } = req.query;
    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester / Cloudmap')) return;

    const insecure = !!(cloud.config as any)?.ignoreTls;

    let metricRules: any[] = [];
    let metricRulesAvailable = false;
    let metricRulesError: string | undefined;
    let metricRulesListSourceUrl: string | undefined;
    try {
      const mr = await listMetricRuleCrs(cloud);
      metricRules = mr.items;
      metricRulesAvailable = mr.apiAvailable;
      metricRulesError = mr.error;
      metricRulesListSourceUrl = mr.listSourceUrl;
    } catch (e: any) {
      metricRulesError = e?.message || String(e);
    }

    const repo = AppDataSource.getRepository(HarvesterMigrationInventory);
    const count = await repo.count({ where: { cloudId: id } });
    if (String(force) === 'true' || count === 0) {
      try {
        await syncKubevirtMigrations(cloud, insecure);
      } catch (e: any) {
        if (count === 0) throw e;
      }
    }

    const allMigrations = await repo.find({ where: { cloudId: id } });
    const reallocationMigrations = allMigrations.filter((row) => !!readAutoFingerprint(row));

    const enabledMetricRules = metricRules.filter(isMetricRuleEnabled);
    const runningReallocation = reallocationMigrations.filter((row) =>
      isRunningMigrationPhase(migrationPhase(row)),
    );

    res.json({
      message: '查询成功',
      data: {
        summary: {
          metricRuleCount: metricRules.length,
          enabledMetricRuleCount: enabledMetricRules.length,
          reallocationMigrationCount: reallocationMigrations.length,
          runningReallocationMigrationCount: runningReallocation.length,
        },
        metricRules: {
          items: metricRules,
          available: metricRulesAvailable,
          error: metricRulesError,
          listSourceUrl: metricRulesListSourceUrl,
        },
        reallocationMigrations: {
          items: reallocationMigrations,
        },
      },
    });
  } catch (error: any) {
    res.status(500).json({
      message: '查询 DRS 概览失败',
      error: error?.body || error?.message || error,
    });
  }
}

