/** 运维监控大盘 · 视图 key（与 Section 路由 switch 对齐） */
export const CLUSTER_RESOURCES_VIEW = 'cluster-resources';
export const VMS_OVERVIEW_VIEW = 'vms-overview';
export const VMS_DETAIL_VIEW = 'vms-resources';
export const NODES_OVERVIEW_VIEW = 'nodes-overview';

export type OpsDashboardView =
  | typeof CLUSTER_RESOURCES_VIEW
  | typeof VMS_OVERVIEW_VIEW
  | typeof VMS_DETAIL_VIEW
  | typeof NODES_OVERVIEW_VIEW;

/** 视图是否可在 Tab 栏选中展示 */
export type OpsDashboardViewStatus = 'enable' | 'disable';

/** 单条视图定义；顺序即默认 Tab 顺序 */
export type OpsDashboardViewDef = {
  key: OpsDashboardView;
  label: string;
  status: OpsDashboardViewStatus;
};

/**
 * 运维监控 · 内置视图目录（数组为唯一数据源）。
 * 用户自定义顺序见 {@link opsDashboardViewOrder}（localStorage 仅存 key；status 以目录为准）。
 * 后续可改为从 DB/API 加载同结构数组。
 */
export const OPS_DASHBOARD_VIEW_CATALOG: OpsDashboardViewDef[] = [
  { key: CLUSTER_RESOURCES_VIEW, label: '集群概览', status: 'enable' },
  { key: VMS_OVERVIEW_VIEW, label: '云主机概览', status: 'enable' },
  { key: VMS_DETAIL_VIEW, label: '云主机资源', status: 'enable' },
  { key: NODES_OVERVIEW_VIEW, label: '节点概览', status: 'enable' },
];

/** 默认 Tab 顺序（key 列表；与目录数组顺序一致） */
export const DEFAULT_OPS_DASHBOARD_VIEW_ORDER: OpsDashboardView[] =
  OPS_DASHBOARD_VIEW_CATALOG.map((v) => v.key);

export function isOpsDashboardViewEnabled(view: OpsDashboardViewDef): boolean {
  return view.status === 'enable';
}

export function opsDashboardViewStatusLabel(status: OpsDashboardViewStatus): string {
  return status === 'enable' ? '启用' : '停用';
}

export function filterEnabledOpsDashboardViews(views: OpsDashboardViewDef[]): OpsDashboardViewDef[] {
  return views.filter(isOpsDashboardViewEnabled);
}

export function firstEnabledOpsDashboardView(
  views: OpsDashboardViewDef[],
): OpsDashboardView | null {
  return filterEnabledOpsDashboardViews(views)[0]?.key ?? null;
}
