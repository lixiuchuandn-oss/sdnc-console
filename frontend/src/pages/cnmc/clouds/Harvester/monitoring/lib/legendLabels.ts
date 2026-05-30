/**
 * Grafana 风格 legend 模板展开（与 MetricTimeSeriesChart / MetricBarGauge 一致）。
 */
export function legendNameFromLabels(
  template: string | undefined,
  labels: Record<string, string>,
  fallback: string,
): string {
  if (!template) {
    return labels.instance || labels.pod || labels.node || labels.namespace || fallback;
  }
  if (template.includes('{{')) {
    return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, name) => labels[name] ?? '');
  }
  return template;
}
