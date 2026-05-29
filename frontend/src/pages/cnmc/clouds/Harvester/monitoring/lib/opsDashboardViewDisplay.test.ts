import {
  clampOpsDashboardVisibleTabMax,
  DEFAULT_OPS_DASHBOARD_VISIBLE_TAB_MAX,
  splitOpsDashboardViewsByVisibleMax,
} from './opsDashboardViewDisplay';
import { OPS_DASHBOARD_VIEW_CATALOG } from './opsDashboardViews';

describe('opsDashboardViewDisplay', () => {
  it('clampOpsDashboardVisibleTabMax falls back to default for invalid input', () => {
    expect(clampOpsDashboardVisibleTabMax(undefined)).toBe(DEFAULT_OPS_DASHBOARD_VISIBLE_TAB_MAX);
    expect(clampOpsDashboardVisibleTabMax('x')).toBe(DEFAULT_OPS_DASHBOARD_VISIBLE_TAB_MAX);
  });

  it('clampOpsDashboardVisibleTabMax enforces min and max', () => {
    expect(clampOpsDashboardVisibleTabMax(0)).toBe(1);
    expect(clampOpsDashboardVisibleTabMax(99)).toBe(20);
  });

  it('splitOpsDashboardViewsByVisibleMax puts extras in overflow', () => {
    const { primaryViews, overflowViews } = splitOpsDashboardViewsByVisibleMax(
      OPS_DASHBOARD_VIEW_CATALOG,
      2,
    );
    expect(primaryViews).toHaveLength(2);
    expect(overflowViews).toHaveLength(OPS_DASHBOARD_VIEW_CATALOG.length - 2);
  });

  it('splitOpsDashboardViewsByVisibleMax has no overflow when within limit', () => {
    const { primaryViews, overflowViews } = splitOpsDashboardViewsByVisibleMax(
      OPS_DASHBOARD_VIEW_CATALOG,
      10,
    );
    expect(primaryViews).toHaveLength(OPS_DASHBOARD_VIEW_CATALOG.length);
    expect(overflowViews).toHaveLength(0);
  });
});
