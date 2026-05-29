/**
 * 运维监控大盘 · 集群磁盘概览（总容量 / 已使用 / 使用率）
 * 与下方「集群磁盘使用率」面板同源 PromQL（node_filesystem_*，排除 tmpfs/fuse 等）。
 */
import React, { useMemo } from 'react';
import { HddOutlined } from '@ant-design/icons';
import { usePromQueries } from '../hooks/usePromQueries';
import type { PromSeries } from '../hooks/usePromQueries';
import type { ResolvedTimeRange } from '../hooks/useDashboardTimeRange';
import { formatMemoryForDisplay } from '../lib/nodeResourceMetrics';
import { opsOverviewUsageColor } from '../lib/opsDashboardOverviewCardLayout';
import OpsDashboardClusterMetricCard from './OpsDashboardClusterMetricCard';

/** 与 cattle-monitoring-system/node-filesystem-custom-rules 告警规则一致 */
const NODE_FILESYSTEM_SELECTOR =
  'job="node-exporter",fstype!~"^(fuse.*|tmpfs|cifs|nfs)",mountpoint!=""';

function pickLastScalar(series: PromSeries[] | undefined): number {
  const values = series?.[0]?.values;
  if (!values?.length) return 0;
  const last = values[values.length - 1]?.[1];
  return Number.isFinite(last) ? (last as number) : 0;
}

export interface OpsDashboardClusterDiskCardProps {
  height?: number;
  cloudId: string;
  resolved: ResolvedTimeRange;
  reloadToken: number;
}

const OpsDashboardClusterDiskCard: React.FC<OpsDashboardClusterDiskCardProps> = ({
  height = 220,
  cloudId,
  resolved,
  reloadToken,
}) => {
  const diskQueries = useMemo(
    () => [
      {
        key: 'total',
        expr: `sum(node_filesystem_size_bytes{${NODE_FILESYSTEM_SELECTOR}})`,
      },
      {
        key: 'avail',
        expr: `sum(node_filesystem_avail_bytes{${NODE_FILESYSTEM_SELECTOR}})`,
      },
    ],
    [],
  );

  const globalVars = useMemo(
    () => ({ __rate_interval: resolved.rateInterval, __interval: resolved.intervalStr }),
    [resolved.rateInterval, resolved.intervalStr],
  );

  const { results, loading } = usePromQueries({
    cloudId,
    queries: diskQueries,
    start: resolved.start,
    end: resolved.end,
    step: resolved.step,
    globalVars,
    reloadToken,
  });

  const { totalDiskBytes, usedDiskBytes, usagePercent } = useMemo(() => {
    const total = pickLastScalar(results.total?.series);
    const avail = pickLastScalar(results.avail?.series);
    const used = Math.max(0, total - avail);
    const pct = total > 0 ? Math.round((used / total) * 1000) / 10 : 0;
    return { totalDiskBytes: total, usedDiskBytes: used, usagePercent: pct };
  }, [results.total?.series, results.avail?.series]);

  const barColor = opsOverviewUsageColor(usagePercent);

  return (
    <OpsDashboardClusterMetricCard
      title="集群磁盘"
      icon={<HddOutlined style={{ color: '#1677ff', fontSize: 18 }} />}
      loading={loading}
      height={height}
      usagePercent={usagePercent}
      rows={[
        { label: '集群总磁盘', value: formatMemoryForDisplay(totalDiskBytes).text },
        { label: '已使用磁盘', value: formatMemoryForDisplay(usedDiskBytes).text },
        { label: '集群磁盘使用率', value: `${usagePercent}%`, valueColor: barColor },
      ]}
    />
  );
};

export default OpsDashboardClusterDiskCard;
