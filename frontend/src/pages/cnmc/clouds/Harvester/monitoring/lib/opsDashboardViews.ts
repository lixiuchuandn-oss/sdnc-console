/** 运维监控大盘 · 视图 Tab 目录（顺序由 {@link opsDashboardViewOrder} 持久化） */
export const CLUSTER_RESOURCES_VIEW = 'cluster-resources';
export const VMS_OVERVIEW_VIEW = 'vms-overview';
export const VMS_DETAIL_VIEW = 'vms-resources';
export const NODES_OVERVIEW_VIEW = 'nodes-overview';

export type OpsDashboardView =
  | typeof CLUSTER_RESOURCES_VIEW
  | typeof VMS_OVERVIEW_VIEW
  | typeof VMS_DETAIL_VIEW
  | typeof NODES_OVERVIEW_VIEW;

export interface OpsDashboardViewDef {
  key: OpsDashboardView;
  label: string;
}

export const OPS_DASHBOARD_VIEW_CATALOG: OpsDashboardViewDef[] = [
  { key: CLUSTER_RESOURCES_VIEW, label: '集群概览' },
  { key: VMS_OVERVIEW_VIEW, label: '云主机概览' },
  // { key: VMS_DETAIL_VIEW, label: '云主机资源' },
  // { key: NODES_OVERVIEW_VIEW, label: '节点概览' },
];

export const DEFAULT_OPS_DASHBOARD_VIEW_ORDER: OpsDashboardView[] = OPS_DASHBOARD_VIEW_CATALOG.map(
  (v) => v.key,
);
