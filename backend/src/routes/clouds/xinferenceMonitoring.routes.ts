import { Router, Response, type RequestHandler } from 'express';
import { AppDataSource } from '../../config/database';
import { Cloud } from '../../entities/Cloud';
import { AuthRequest } from '../../middleware/auth';
import { logger } from '../../utils/logger';
import { getXinferenceContext, xinferenceGet } from '../../services/clouds/xinference/xinferenceClient';

const log = logger.child('XinferenceMonitoring');

async function fetchXinferenceCloudOr404(id: string, res: Response): Promise<Cloud | null> {
  const cloud = await AppDataSource.getRepository(Cloud).findOne({ where: { id } });
  if (!cloud) {
    res.status(404).json({ message: '云资源不存在' });
    return null;
  }
  const provider = String(cloud.config?.provider || '').toLowerCase();
  if (provider !== 'xinference') {
    res.status(400).json({ message: '仅 Xinference 资源池支持该接口' });
    return null;
  }
  return cloud;
}

function pickConfigString(
  primary: Record<string, unknown>,
  fallback: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const v = primary[key] ?? fallback[key];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return undefined;
}

/** 合并 Xinference ui_config 与资源池 config 中的 Grafana 覆盖项 */
function buildMonitoringUiConfig(
  uiRaw: Record<string, unknown>,
  cloudConfig: Record<string, unknown>,
  endpoint: string,
) {
  const grafanaUrl = pickConfigString(uiRaw, cloudConfig, 'grafana_url', 'grafanaUrl');
  const grafanaDashboardUid = pickConfigString(
    uiRaw,
    cloudConfig,
    'grafana_dashboard_uid',
    'grafanaDashboardUid',
  );
  const grafanaDatasource = pickConfigString(
    uiRaw,
    cloudConfig,
    'grafana_datasource',
    'grafanaDatasource',
  );
  const grafanaAlertDatasource = pickConfigString(
    uiRaw,
    cloudConfig,
    'grafana_alert_datasource',
    'grafanaAlertDatasource',
  );
  // 与原版 Xinference 一致：仅 ui_config / 资源池显式配置 cluster_name；为空时不传 var-cluster。
  // 禁止用资源池名称回填，否则 Grafana 面板 {cluster=~"$cluster"} 会匹配不到序列。
  const clusterName = pickConfigString(
    uiRaw,
    cloudConfig,
    'cluster_name',
    'monitoringClusterName',
    'clusterName',
  );

  return {
    endpoint,
    grafanaUrl,
    grafanaDashboardUid,
    grafanaDatasource,
    grafanaAlertDatasource,
    clusterName,
    configured: Boolean(grafanaUrl && grafanaDashboardUid),
    uiConfigError: undefined as string | undefined,
  };
}

/**
 * GET /api/clouds/:id/xinference/monitoring/ui-config
 * 代理 Xinference GET /v1/cluster/ui_config，并合并资源池 config 中的 Grafana 覆盖配置。
 */
export function attachXinferenceMonitoringRoutes(router: Router, perm: RequestHandler): void {
  router.get('/:id/xinference/monitoring/ui-config', perm, async (req: AuthRequest, res: Response) => {
    try {
      const cloud = await fetchXinferenceCloudOr404(req.params.id, res);
      if (!cloud) return;
      const ctx = getXinferenceContext(cloud);
      if (!ctx) {
        res.status(400).json({ message: '缺少 Xinference 服务地址' });
        return;
      }

      const cfg = (cloud.config && typeof cloud.config === 'object' ? cloud.config : {}) as Record<
        string,
        unknown
      >;

      const r = await xinferenceGet(ctx, '/v1/cluster/ui_config');
      let uiRaw: Record<string, unknown> = {};
      let uiConfigError: string | undefined;
      if (r.ok && r.data && typeof r.data === 'object') {
        uiRaw = r.data as Record<string, unknown>;
      } else if (!r.ok) {
        uiConfigError = r.message || '拉取 Xinference 监控配置失败';
      }

      const body = buildMonitoringUiConfig(uiRaw, cfg, ctx.origin);
      if (uiConfigError) {
        body.uiConfigError = uiConfigError;
      }
      res.json(body);
    } catch (error: any) {
      log.error('monitoring ui-config failed', error?.message ?? String(error));
      res.status(500).json({ message: error?.message || '获取监控配置失败' });
    }
  });
}
