/**
 * 运维监控大盘 · 云主机按运行状态分布
 */
import React, { useMemo } from 'react';
import { DesktopOutlined } from '@ant-design/icons';
import type { VMInstancesSummary, VMStatusKey } from '../lib/vmInstances';
import OpsDashboardVmDistributionCard, { type VmDistributionItem } from './OpsDashboardVmDistributionCard';

const SEGMENT_COLORS: Record<VMStatusKey, string> = {
  running: '#10B981',
  paused: '#FAAD14',
  stopped: '#64748B',
  other: '#FF5C7C',
};

export interface OpsDashboardVmStatusCardProps {
  summary: VMInstancesSummary | null;
  loading?: boolean;
  height?: number;
}

const OpsDashboardVmStatusCard: React.FC<OpsDashboardVmStatusCardProps> = ({
  summary,
  loading = false,
  height = 220,
}) => {
  const total = summary?.total ?? 0;
  const items = useMemo<VmDistributionItem[]>(
    () =>
      (summary?.segments ?? []).map((segment) => ({
        name: segment.label,
        value: segment.value,
        color: SEGMENT_COLORS[segment.key],
      })),
    [summary?.segments],
  );

  return (
    <OpsDashboardVmDistributionCard
      title="按状态分布"
      icon={<DesktopOutlined style={{ color: '#1677ff', fontSize: 18 }} />}
      items={items}
      total={total}
      loading={loading}
      height={height}
      centerValue={total}
      centerLabel="总台数"
      includeZeroInList
      emptyHint="暂无云主机数据"
    />
  );
};

export default OpsDashboardVmStatusCard;
