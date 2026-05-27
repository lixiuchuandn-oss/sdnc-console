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

const tagStyle = (active: boolean): React.CSSProperties => ({
  padding: '4px 12px',
  fontSize: 14,
  borderRadius: 16,
  border: active ? undefined : '1px solid #d9d9d9',
  cursor: 'pointer',
  userSelect: 'none',
});

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
    <div style={{ maxHeight: 'calc(100vh - 180px)', overflowY: 'auto', overflowX: 'hidden', paddingRight: 4 }}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <Space size={8} wrap>
            {DASHBOARD_VIEWS.map((view) => (
              <Tag.CheckableTag
                key={view.key}
                checked={activeView === view.key}
                onChange={() => setActiveView(view.key)}
                style={tagStyle(activeView === view.key)}
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
