/**
 * 运维监控大盘 · 云主机按项目分布/云主机按命名空间分布
 */
import React from 'react';
import { ApartmentOutlined } from '@ant-design/icons';
import type { VMInstancesSummary } from '../lib/vmInstances';
import { useOverviewInitialLoading } from '../lib/panelLoadState';
import OpsDashboardVmDistributionCard from './OpsDashboardVmDistributionCard';

const HEIGHT_SIZE = 220;
const TOP_NAMESPACE_COUNT = 4;

export interface OpsDashboardVmNamespaceCardProps {
  summary: VMInstancesSummary | null;
  loading?: boolean;
  height?: number;
  topN?: number;
}

const OpsDashboardVmNamespaceCard: React.FC<OpsDashboardVmNamespaceCardProps> = ({
  summary,
  loading = false,
  height = HEIGHT_SIZE,
  topN = TOP_NAMESPACE_COUNT,
}) => {
  const namespaceItems = summary?.namespaceSummary ?? [];
  const hasRenderableData = (summary?.total ?? 0) > 0 || namespaceItems.length > 0;
  const initialLoading = useOverviewInitialLoading(loading, hasRenderableData);
  return (
    <OpsDashboardVmDistributionCard
      title="按项目分布"
      icon={<ApartmentOutlined style={{ color: '#1677ff', fontSize: 18 }} />}
      items={namespaceItems}
      total={summary?.total ?? 0}
      loading={initialLoading}
      height={height}
      topN={topN}
      centerLabel="项目数"
      emptyHint="暂无项目"
    />
  );
};

export default OpsDashboardVmNamespaceCard;
