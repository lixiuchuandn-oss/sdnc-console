/**
 * 运维监控大盘
 * `GET /monitoring/metric-range` → Service Proxy → Prometheus query_range，在 Compute Tower
 * 内用 Ant Design + ECharts 自渲染。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Space } from 'antd';
import DashboardToolbar from './components/DashboardToolbar';
import OpsDashboardViewTabs from './components/OpsDashboardViewTabs';
import {
  useDashboardTimeRange,
  OPS_DASHBOARD_DEFAULT_RANGE_SECONDS,
} from './hooks/useDashboardTimeRange';
import { useAutoRefresh } from './hooks/useAutoRefresh';
import OpsDashboardClusterSection from './sections/OpsDashboardClusterSection';
import OpsDashboardVmsSection from './sections/OpsDashboardVmsSection';
import OpsDashboardVmsDetailSection from './sections/OpsDashboardVmsDetailSection';
import OpsDashboardNodesSection from './sections/OpsDashboardNodesSection';
import '../../Cloudmap/pool/styles/layout.css';
import {
  OPS_DASHBOARD_PAGE_ROOT_STYLE,
  OPS_DASHBOARD_PAGE_STACK_GAP,
  OPS_DASHBOARD_TOOLBAR_ROW_STYLE,
} from './lib/opsDashboardLayout';
import { loadOpsDashboardViewOrder } from './lib/opsDashboardViewOrder';
import {
  CLUSTER_RESOURCES_VIEW,
  NODES_OVERVIEW_VIEW,
  VMS_OVERVIEW_VIEW,
  VMS_DETAIL_VIEW,
  firstEnabledOpsDashboardView,
  isOpsDashboardViewEnabled,
  type OpsDashboardView,
  type OpsDashboardViewDef,
} from './lib/opsDashboardViews';

interface MonitoringOpsDashboardProps {
  cloudId: string;
}

const DEFAULT_AUTO_REFRESH_MS: number | null = 60 * 1000;

const MonitoringOpsDashboard: React.FC<MonitoringOpsDashboardProps> = ({ cloudId }) => {
  const [orderedViews, setOrderedViews] = useState<OpsDashboardViewDef[]>(() =>
    loadOpsDashboardViewOrder(),
  );
  const [activeView, setActiveView] = useState<OpsDashboardView>(() => {
    const views = loadOpsDashboardViewOrder();
    return firstEnabledOpsDashboardView(views) ?? CLUSTER_RESOURCES_VIEW;
  });

  useEffect(() => {
    const current = orderedViews.find((v) => v.key === activeView);
    if (current && isOpsDashboardViewEnabled(current)) return;
    const fallback = firstEnabledOpsDashboardView(orderedViews);
    if (fallback && fallback !== activeView) setActiveView(fallback);
  }, [orderedViews, activeView]);
  const {
    rangeSeconds,
    setRangeSeconds,
    reloadToken,
    triggerReload,
    resolved,
  } = useDashboardTimeRange(OPS_DASHBOARD_DEFAULT_RANGE_SECONDS);

  const handleAutoTick = useCallback(() => {
    triggerReload();
  }, [triggerReload]);

  const { intervalMs: autoRefreshMs, setIntervalMs: setAutoRefreshMs } = useAutoRefresh(
    DEFAULT_AUTO_REFRESH_MS,
    handleAutoTick,
  );

  const sectionBody = useMemo(() => {
    switch (activeView) {
      case NODES_OVERVIEW_VIEW:
        return <OpsDashboardNodesSection cloudId={cloudId} resolved={resolved} reloadToken={reloadToken} />;
      case VMS_DETAIL_VIEW:
        return (
          <OpsDashboardVmsDetailSection cloudId={cloudId} resolved={resolved} reloadToken={reloadToken} />
        );
      case VMS_OVERVIEW_VIEW:
        return <OpsDashboardVmsSection cloudId={cloudId} resolved={resolved} reloadToken={reloadToken} />;
      case CLUSTER_RESOURCES_VIEW:
      default:
        return <OpsDashboardClusterSection cloudId={cloudId} resolved={resolved} reloadToken={reloadToken} />;
    }
  }, [activeView, cloudId, resolved, reloadToken]);

  return (
    <div className="cloudmap-monitoring-page-root" style={OPS_DASHBOARD_PAGE_ROOT_STYLE}>
      <Space direction="vertical" size={OPS_DASHBOARD_PAGE_STACK_GAP} style={{ width: '100%' }}>
        <div style={OPS_DASHBOARD_TOOLBAR_ROW_STYLE}>
          <OpsDashboardViewTabs
            views={orderedViews}
            activeView={activeView}
            onActiveViewChange={setActiveView}
            onViewsOrderChange={setOrderedViews}
          />
          <DashboardToolbar
            rangeSeconds={rangeSeconds}
            onRangeChange={setRangeSeconds}
            autoRefreshMs={autoRefreshMs}
            onAutoRefreshChange={setAutoRefreshMs}
            onManualRefresh={triggerReload}
          />
        </div>

        {sectionBody}
      </Space>
    </div>
  );
};

export default MonitoringOpsDashboard;
