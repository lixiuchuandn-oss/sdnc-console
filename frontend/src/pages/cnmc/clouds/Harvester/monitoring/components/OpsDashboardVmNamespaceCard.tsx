/**
 * 运维监控大盘 · 云主机按项目（命名空间）分布
 */
import React from 'react';
import { ApartmentOutlined } from '@ant-design/icons';
import type { VMInstancesSummary } from '../lib/vmInstances';
import OpsDashboardVmDistributionCard from './OpsDashboardVmDistributionCard';

export interface OpsDashboardVmNamespaceCardProps {
  summary: VMInstancesSummary | null;
  loading?: boolean;
  height?: number;
  topN?: number;
}

const OpsDashboardVmNamespaceCard: React.FC<OpsDashboardVmNamespaceCardProps> = ({
  summary,
  loading = false,
  height = 220,
  topN = 5,
}) => (
  <OpsDashboardVmDistributionCard
    title="按项目分布"
    icon={<ApartmentOutlined style={{ color: '#1677ff', fontSize: 18 }} />}
    items={summary?.namespaceSummary ?? []}
    total={summary?.total ?? 0}
    loading={loading}
    height={height}
    topN={topN}
    centerLabel="项目数"
    emptyHint="暂无项目数据"
  />
);

export default OpsDashboardVmNamespaceCard;
