/**
 * 与 Xinference 官方 Web UI 一致的 Grafana 嵌入 URL 拼装（见 xinference/ui/.../grafanaUtils.js）
 */
export type XinferenceGrafanaEmbedConfig = {
  grafanaUrl?: string;
  grafanaDashboardUid?: string;
  grafanaDatasource?: string;
  grafanaAlertDatasource?: string;
  clusterName?: string;
};

export function isGrafanaMonitoringConfigured(config: XinferenceGrafanaEmbedConfig | null | undefined): boolean {
  if (!config) return false;
  return Boolean(config.grafanaUrl?.trim() && config.grafanaDashboardUid?.trim());
}

export function buildGrafanaDashboardUrl(
  config: XinferenceGrafanaEmbedConfig,
  opts?: {
    theme?: 'light' | 'dark';
    from?: string;
    to?: string;
    refresh?: string;
    cacheBust?: number;
  },
): string | null {
  const { grafanaUrl, grafanaDashboardUid, grafanaDatasource, grafanaAlertDatasource, clusterName } = config;
  if (!grafanaUrl?.trim() || !grafanaDashboardUid?.trim()) return null;

  const theme = opts?.theme ?? 'light';
  const base = grafanaUrl.replace(/\/+$/, '');

  let url = `${base}/d/${encodeURIComponent(grafanaDashboardUid)}?orgId=1&kiosk&theme=${theme}`;
  // 时间范围由 Grafana 看板内选择；仅显式传入时才写入 URL，避免覆盖用户在 Grafana 内的操作
  if (opts?.from && opts?.to) {
    url += `&from=${encodeURIComponent(opts.from)}&to=${encodeURIComponent(opts.to)}`;
  }

  const ds = grafanaDatasource?.trim();
  const alertDs = (grafanaAlertDatasource?.trim() || ds) ?? '';
  if (ds) {
    url += `&var-datasource=${encodeURIComponent(ds)}`;
    url += `&var-alert_datasource=${encodeURIComponent(alertDs)}`;
  }
  const cluster = clusterName?.trim();
  if (cluster) {
    url += `&var-cluster=${encodeURIComponent(cluster)}`;
  }
  if (opts?.refresh) {
    url += `&refresh=${encodeURIComponent(opts.refresh)}`;
  }
  if (opts?.cacheBust != null) {
    url += `&_t=${opts.cacheBust}`;
  }
  return url;
}
