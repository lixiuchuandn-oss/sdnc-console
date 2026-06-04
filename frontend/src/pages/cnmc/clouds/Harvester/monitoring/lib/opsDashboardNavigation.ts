import {
  CLUSTER_RESOURCES_VIEW,
  OPS_DASHBOARD_VIEW_CATALOG,
  type OpsDashboardView,
} from './opsDashboardViews';

/** 运维监控大盘 URL 查询参数：指定初始视图 Tab（如 cluster-resources） */
export const OPS_DASHBOARD_VIEW_QUERY = 'view';

const VALID_VIEW_KEYS = new Set<string>(OPS_DASHBOARD_VIEW_CATALOG.map((v) => v.key));

export function isOpsDashboardViewKey(value: string): value is OpsDashboardView {
  return VALID_VIEW_KEYS.has(value);
}

export function parseOpsDashboardViewFromSearch(
  params: URLSearchParams,
): OpsDashboardView | null {
  const raw = params.get(OPS_DASHBOARD_VIEW_QUERY);
  if (!raw || !isOpsDashboardViewKey(raw)) return null;
  return raw;
}

/** Cloudmap 池 · 云监控 → 运维监控（alerts-list）路径，可选 deep-link 到指定视图 */
export function opsDashboardAlertsListPath(
  cloudId: string,
  view: OpsDashboardView = CLUSTER_RESOURCES_VIEW,
): string {
  const base = `/admin/clouds/${encodeURIComponent(cloudId)}/monitoring_alerts/alerts-list`;
  return `${base}?${OPS_DASHBOARD_VIEW_QUERY}=${encodeURIComponent(view)}`;
}
