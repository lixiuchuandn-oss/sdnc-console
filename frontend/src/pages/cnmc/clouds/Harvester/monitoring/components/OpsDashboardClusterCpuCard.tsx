/**
 * 运维监控大盘 · 集群 CPU 概览（总核数 / 已使用 / 使用率）
 */
import React, { useMemo } from 'react';
import { DashboardOutlined } from '@ant-design/icons';
import { useMonitoringOverviewFastLane } from '../MonitoringOverviewLanesContext';
import { aggregateNodeMetrics, aggregateNodeResources } from '../lib/nodeResourceMetrics';
import { opsOverviewUsageColor } from '../lib/opsDashboardOverviewCardLayout';
import OpsDashboardClusterMetricCard from './OpsDashboardClusterMetricCard';

const HEIGHT_SIZE = 220;

function formatCpuCores(cores: number): string {
  if (cores >= 1) return `${Math.round(cores * 100) / 100} 核`;
  if (cores > 0) return `${(cores * 1000).toFixed(0)} m核`;
  return '0 核';
}

export interface OpsDashboardClusterCpuCardProps {
  height?: number;
}

const OpsDashboardClusterCpuCard: React.FC<OpsDashboardClusterCpuCardProps> = ({ height = HEIGHT_SIZE }) => {
  const fast = useMonitoringOverviewFastLane();
  const loading = fast.coreLoading;

  const { totalCpuCores, usedCpuCores, usagePercent } = useMemo(() => {
    const resources = aggregateNodeResources(fast.nodeResources ?? null);
    const metrics = aggregateNodeMetrics(fast.nodeMetrics ?? null);
    const total = resources.totalCpuCores;
    const used = metrics.usedCpuCores;
    const pct = total > 0 ? Math.round((used / total) * 1000) / 10 : 0;
    return { totalCpuCores: total, usedCpuCores: used, usagePercent: pct };
  }, [fast.nodeResources, fast.nodeMetrics]);

  const barColor = opsOverviewUsageColor(usagePercent);

  return (
    <OpsDashboardClusterMetricCard
      title="集群CPU"
      icon={<DashboardOutlined style={{ color: '#1677ff', fontSize: 18 }} />}
      loading={loading}
      height={height}
      usagePercent={usagePercent}
      rows={[
        { label: '集群总CPU', value: formatCpuCores(totalCpuCores) },
        { label: '已使用CPU', value: formatCpuCores(usedCpuCores) },
        { label: '集群CPU使用率', value: `${usagePercent}%`, valueColor: barColor },
      ]}
    />
  );
};

export default OpsDashboardClusterCpuCard;
