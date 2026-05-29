/**
 * 运维监控大盘 · 集群内存概览（总内存 / 已使用 / 使用率）
 */
import React, { useMemo } from 'react';
import { FundOutlined } from '@ant-design/icons';
import { useMonitoringOverviewFastLane } from '../MonitoringOverviewLanesContext';
import {
  aggregateNodeMetrics,
  aggregateNodeResources,
  formatMemoryForDisplay,
} from '../lib/nodeResourceMetrics';
import { opsOverviewUsageColor } from '../lib/opsDashboardOverviewCardLayout';
import OpsDashboardClusterMetricCard from './OpsDashboardClusterMetricCard';

export interface OpsDashboardClusterMemoryCardProps {
  height?: number;
}

const OpsDashboardClusterMemoryCard: React.FC<OpsDashboardClusterMemoryCardProps> = ({ height = 220 }) => {
  const fast = useMonitoringOverviewFastLane();
  const loading = fast.coreLoading;

  const { totalMemoryBytes, usedMemoryBytes, usagePercent } = useMemo(() => {
    const resources = aggregateNodeResources(fast.nodeResources ?? null);
    const metrics = aggregateNodeMetrics(fast.nodeMetrics ?? null);
    const total = resources.totalMemoryBytes;
    const used = metrics.usedMemoryBytes;
    const pct = total > 0 ? Math.round((used / total) * 1000) / 10 : 0;
    return { totalMemoryBytes: total, usedMemoryBytes: used, usagePercent: pct };
  }, [fast.nodeResources, fast.nodeMetrics]);

  const barColor = opsOverviewUsageColor(usagePercent);

  return (
    <OpsDashboardClusterMetricCard
      title="集群内存"
      icon={<FundOutlined style={{ color: '#1677ff', fontSize: 18 }} />}
      loading={loading}
      height={height}
      usagePercent={usagePercent}
      rows={[
        { label: '集群总内存', value: formatMemoryForDisplay(totalMemoryBytes).text },
        { label: '已使用内存', value: formatMemoryForDisplay(usedMemoryBytes).text },
        { label: '集群内存使用率', value: `${usagePercent}%`, valueColor: barColor },
      ]}
    />
  );
};

export default OpsDashboardClusterMemoryCard;
