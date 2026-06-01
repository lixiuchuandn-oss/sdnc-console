import {
  DEFAULT_OPS_DASHBOARD_VIEW_ORDER,
  type OpsDashboardView,
  type OpsDashboardViewDef,
  OPS_DASHBOARD_VIEW_CATALOG,
} from './opsDashboardViews';

const STORAGE_KEY = 'tower:harvester_ops_dashboard_view_order';

/** 将持久化的 key 列表与目录合并，补全新增视图、剔除已下线 key；status 始终以 catalog 为准 */
export function mergeOpsDashboardViewOrder(
  savedKeys: unknown,
  catalog: OpsDashboardViewDef[] = OPS_DASHBOARD_VIEW_CATALOG,
): OpsDashboardViewDef[] {
  const byKey = new Map(catalog.map((v) => [v.key, v]));
  if (!Array.isArray(savedKeys)) {
    return [...catalog];
  }
  const ordered: OpsDashboardViewDef[] = [];
  const seen = new Set<OpsDashboardView>();
  for (const raw of savedKeys) {
    if (typeof raw !== 'string') continue;
    const def = byKey.get(raw as OpsDashboardView);
    if (!def || seen.has(def.key)) continue;
    ordered.push(def);
    seen.add(def.key);
  }
  for (const def of catalog) {
    if (!seen.has(def.key)) ordered.push(def);
  }
  return ordered;
}

export function loadOpsDashboardViewOrder(
  catalog: OpsDashboardViewDef[] = OPS_DASHBOARD_VIEW_CATALOG,
): OpsDashboardViewDef[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...catalog];
    return mergeOpsDashboardViewOrder(JSON.parse(raw), catalog);
  } catch {
    return [...catalog];
  }
}

export function saveOpsDashboardViewOrder(views: OpsDashboardViewDef[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(views.map((v) => v.key)));
  } catch (e) {
    console.warn('Failed to persist ops dashboard view order', e);
  }
}

/** 把 fromKey 移动到 toKey 之前；若 toKey 未找到则追加到末尾 */
export function reorderOpsDashboardViews(
  views: OpsDashboardViewDef[],
  fromKey: OpsDashboardView,
  toKey: OpsDashboardView,
): OpsDashboardViewDef[] {
  if (fromKey === toKey) return views;
  const fromIdx = views.findIndex((v) => v.key === fromKey);
  const toIdx = views.findIndex((v) => v.key === toKey);
  if (fromIdx < 0) return views;
  const next = [...views];
  const [moved] = next.splice(fromIdx, 1);
  if (toIdx < 0) {
    next.push(moved);
    return next;
  }
  const insertAt = fromIdx < toIdx ? toIdx - 1 : toIdx;
  next.splice(insertAt, 0, moved);
  return next;
}

export function moveOpsDashboardView(
  views: OpsDashboardViewDef[],
  key: OpsDashboardView,
  direction: 'up' | 'down',
): OpsDashboardViewDef[] {
  const idx = views.findIndex((v) => v.key === key);
  if (idx < 0) return views;
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= views.length) return views;
  const next = [...views];
  [next[idx], next[targetIdx]] = [next[targetIdx], next[idx]];
  return next;
}

export function resetOpsDashboardViewOrder(): OpsDashboardViewDef[] {
  return mergeOpsDashboardViewOrder(DEFAULT_OPS_DASHBOARD_VIEW_ORDER);
}
