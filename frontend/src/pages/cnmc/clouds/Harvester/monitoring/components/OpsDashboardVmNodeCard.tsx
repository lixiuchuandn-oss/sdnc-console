/**
 * 运维监控大盘 · 云主机按节点分布
 */
import React from 'react';
import { ClusterOutlined } from '@ant-design/icons';
import type { VMInstancesSummary } from '../lib/vmInstances';
import OpsDashboardVmDistributionCard from './OpsDashboardVmDistributionCard';

export interface OpsDashboardVmNodeCardProps {
  summary: VMInstancesSummary | null;
  loading?: boolean;
  height?: number;
  topN?: number;
}

const OpsDashboardVmNodeCard: React.FC<OpsDashboardVmNodeCardProps> = ({
  summary,
  loading = false,
  height = 220,
  topN = 5,
}) => (
  <OpsDashboardVmDistributionCard
    title="按节点分布"
    icon={<ClusterOutlined style={{ color: '#1677ff', fontSize: 18 }} />}
    items={summary?.nodeSummary ?? []}
    total={summary?.total ?? 0}
    loading={loading}
    height={height}
    topN={topN}
    centerLabel="节点数"
    emptyHint="暂无节点数据"
  />
);

export default OpsDashboardVmNodeCard;
