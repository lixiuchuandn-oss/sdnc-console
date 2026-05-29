import {
  mergeOpsDashboardViewOrder,
  reorderOpsDashboardViews,
  moveOpsDashboardView,
} from './opsDashboardViewOrder';
import { OPS_DASHBOARD_VIEW_CATALOG, VMS_RESOURCES_VIEW, CLUSTER_RESOURCES_VIEW } from './opsDashboardViews';

describe('opsDashboardViewOrder', () => {
  it('mergeOpsDashboardViewOrder keeps catalog order when saved is invalid', () => {
    expect(mergeOpsDashboardViewOrder(null, OPS_DASHBOARD_VIEW_CATALOG).map((v) => v.key)).toEqual(
      OPS_DASHBOARD_VIEW_CATALOG.map((v) => v.key),
    );
  });

  it('mergeOpsDashboardViewOrder applies saved keys and appends new views', () => {
    const merged = mergeOpsDashboardViewOrder(
      [VMS_RESOURCES_VIEW, CLUSTER_RESOURCES_VIEW],
      OPS_DASHBOARD_VIEW_CATALOG,
    );
    expect(merged.map((v) => v.key).slice(0, 2)).toEqual([VMS_RESOURCES_VIEW, CLUSTER_RESOURCES_VIEW]);
    expect(merged.length).toBe(OPS_DASHBOARD_VIEW_CATALOG.length);
  });

  it('reorderOpsDashboardViews moves item before target', () => {
    const reordered = reorderOpsDashboardViews(
      OPS_DASHBOARD_VIEW_CATALOG,
      VMS_RESOURCES_VIEW,
      CLUSTER_RESOURCES_VIEW,
    );
    expect(reordered[0].key).toBe(VMS_RESOURCES_VIEW);
    expect(reordered[1].key).toBe(CLUSTER_RESOURCES_VIEW);
  });

  it('moveOpsDashboardView swaps adjacent items', () => {
    const moved = moveOpsDashboardView(OPS_DASHBOARD_VIEW_CATALOG, CLUSTER_RESOURCES_VIEW, 'down');
    expect(moved[0].key).toBe(OPS_DASHBOARD_VIEW_CATALOG[1].key);
    expect(moved[1].key).toBe(CLUSTER_RESOURCES_VIEW);
  });
});
