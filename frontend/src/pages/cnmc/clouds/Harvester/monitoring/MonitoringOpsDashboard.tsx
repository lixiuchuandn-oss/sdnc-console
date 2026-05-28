/**
 * 运维监控大盘
 * `GET /monitoring/metric-range` → Service Proxy → Prometheus query_range，在 Compute Tower
 * 内用 Ant Design + ECharts 自渲染。
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Space, Tag } from 'antd';
import DashboardToolbar from './components/DashboardToolbar';
import {
  useDashboardTimeRange,
  OPS_DASHBOARD_DEFAULT_RANGE_SECONDS,
} from './hooks/useDashboardTimeRange';
import { useAutoRefresh } from './hooks/useAutoRefresh';
import OpsDashboardClusterSection from './sections/OpsDashboardClusterSection';
import OpsDashboardNodesSection from './sections/OpsDashboardNodesSection';
import OpsDashboardVmsSection from './sections/OpsDashboardVmsSection';
import '../../Cloudmap/pool/styles/layout.css';
import {
  OPS_DASHBOARD_PAGE_ROOT_STYLE,
  OPS_DASHBOARD_PAGE_STACK_GAP,
  OPS_DASHBOARD_TOOLBAR_ROW_STYLE,
  OPS_DASHBOARD_TOOLBAR_SPACE_SIZE,
  opsDashboardTagStyle,
} from './lib/opsDashboardLayout';

interface MonitoringOpsDashboardProps {
  cloudId: string;
}

type OpsDashboardView = 'cluster-resources' | 'nodes-resources' | 'vms-resources';

const DASHBOARD_VIEWS: Array<{ key: OpsDashboardView; label: string }> = [
  { key: 'cluster-resources', label: '集群资源' },
  { key: 'nodes-resources', label: '节点资源' },
  { key: 'vms-resources', label: '云主机资源' },
];

const DEFAULT_AUTO_REFRESH_MS: number | null = 60 * 1000;

const MonitoringOpsDashboard: React.FC<MonitoringOpsDashboardProps> = ({ cloudId }) => {
  const [activeView, setActiveView] = useState<OpsDashboardView>('cluster-resources');
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
      case 'nodes-resources':
        return <OpsDashboardNodesSection cloudId={cloudId} resolved={resolved} reloadToken={reloadToken} />;
      case 'vms-resources':
        return <OpsDashboardVmsSection cloudId={cloudId} resolved={resolved} reloadToken={reloadToken} />;
      case 'cluster-resources':
      default:
        return <OpsDashboardClusterSection cloudId={cloudId} resolved={resolved} reloadToken={reloadToken} />;
    }
  }, [activeView, cloudId, resolved, reloadToken]);

  return (
    <div className="cloudmap-monitoring-page-root" style={OPS_DASHBOARD_PAGE_ROOT_STYLE}>
      <Space direction="vertical" size={OPS_DASHBOARD_PAGE_STACK_GAP} style={{ width: '100%' }}>
        <div style={OPS_DASHBOARD_TOOLBAR_ROW_STYLE}>
          <Space size={OPS_DASHBOARD_TOOLBAR_SPACE_SIZE} wrap>
            {DASHBOARD_VIEWS.map((view) => (
              <Tag.CheckableTag
                key={view.key}
                checked={activeView === view.key}
                onChange={() => setActiveView(view.key)}
                style={opsDashboardTagStyle(activeView === view.key)}
              >
                {view.label}
              </Tag.CheckableTag>
            ))}
          </Space>
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
