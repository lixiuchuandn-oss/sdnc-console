import type { OpsDashboardViewDef } from './opsDashboardViews';

export const DEFAULT_OPS_DASHBOARD_VISIBLE_TAB_MAX = 5;
export const MIN_OPS_DASHBOARD_VISIBLE_TAB_MAX = 1;
export const MAX_OPS_DASHBOARD_VISIBLE_TAB_MAX = 20;

const VISIBLE_TAB_MAX_STORAGE_KEY = 'tower:harvester_ops_dashboard_visible_tab_max';

export function clampOpsDashboardVisibleTabMax(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_OPS_DASHBOARD_VISIBLE_TAB_MAX;
  return Math.min(
    MAX_OPS_DASHBOARD_VISIBLE_TAB_MAX,
    Math.max(MIN_OPS_DASHBOARD_VISIBLE_TAB_MAX, Math.trunc(n)),
  );
}

export function loadOpsDashboardVisibleTabMax(): number {
  try {
    const raw = localStorage.getItem(VISIBLE_TAB_MAX_STORAGE_KEY);
    if (raw == null || raw === '') return DEFAULT_OPS_DASHBOARD_VISIBLE_TAB_MAX;
    return clampOpsDashboardVisibleTabMax(Number(raw));
  } catch {
    return DEFAULT_OPS_DASHBOARD_VISIBLE_TAB_MAX;
  }
}

export function saveOpsDashboardVisibleTabMax(max: number): void {
  try {
    localStorage.setItem(VISIBLE_TAB_MAX_STORAGE_KEY, String(clampOpsDashboardVisibleTabMax(max)));
  } catch (e) {
    console.warn('Failed to persist ops dashboard visible tab max', e);
  }
}

/** 按用户设置的主栏上限拆分：前 N 个为标签，其余进「更多」下拉 */
export function splitOpsDashboardViewsByVisibleMax(
  views: OpsDashboardViewDef[],
  visibleTabMax: number,
): { primaryViews: OpsDashboardViewDef[]; overflowViews: OpsDashboardViewDef[] } {
  const max = clampOpsDashboardVisibleTabMax(visibleTabMax);
  if (views.length <= max) {
    return { primaryViews: views, overflowViews: [] };
  }
  return {
    primaryViews: views.slice(0, max),
    overflowViews: views.slice(max),
  };
}
