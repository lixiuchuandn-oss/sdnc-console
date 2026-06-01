/**
 * 运维监控大盘 · 云主机按节点分布
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ClusterOutlined } from '@ant-design/icons';
import { fetchHarvesterNodes } from '../../../../../../services/harvester/clusterInventory';
import { countPhysicalHosts } from '../lib/hostSegments';
import type { VMInstancesSummary } from '../lib/vmInstances';
import OpsDashboardVmDistributionCard from './OpsDashboardVmDistributionCard';

export interface OpsDashboardVmNodeCardProps {
  cloudId: string;
  summary: VMInstancesSummary | null;
  /** 慢车道轮询刷新；仅首次无数据时展示 loading */
  loading?: boolean;
  /** 与大盘手动刷新联动，静默更新物理节点总数 */
  reloadToken?: number;
  height?: number;
  topN?: number;
}

const OpsDashboardVmNodeCard: React.FC<OpsDashboardVmNodeCardProps> = ({
  cloudId,
  summary,
  loading = false,
  reloadToken = 0,
  height = 220,
  topN = 5,
}) => {
  const [nodeCount, setNodeCount] = useState<number | null>(null);
  const [nodesInitialLoading, setNodesInitialLoading] = useState(false);
  const nodesLoadedRef = useRef(false);
  const distributionLoadedRef = useRef(false);

  useEffect(() => {
    if ((summary?.nodeSummary?.length ?? 0) > 0 || (summary?.total ?? 0) > 0) {
      distributionLoadedRef.current = true;
    }
  }, [summary]);

  useEffect(() => {
    if (!loading) {
      distributionLoadedRef.current = true;
    }
  }, [loading]);

  const loadNodes = useCallback(
    async (force: boolean, signal: { cancelled: boolean }) => {
      if (!cloudId) {
        nodesLoadedRef.current = false;
        setNodeCount(null);
        return;
      }

      const isInitial = !nodesLoadedRef.current;
      if (isInitial) setNodesInitialLoading(true);

      try {
        const res = await fetchHarvesterNodes(cloudId, force);
        if (signal.cancelled) return;
        setNodeCount(countPhysicalHosts(res));
        nodesLoadedRef.current = true;
      } catch {
        if (!signal.cancelled && isInitial) setNodeCount(null);
      } finally {
        if (!signal.cancelled && isInitial) setNodesInitialLoading(false);
      }
    },
    [cloudId],
  );

  useEffect(() => {
    nodesLoadedRef.current = false;
    distributionLoadedRef.current = false;
    setNodeCount(null);
  }, [cloudId]);

  useEffect(() => {
    const signal = { cancelled: false };
    void loadNodes(reloadToken > 0, signal);
    return () => {
      signal.cancelled = true;
    };
  }, [cloudId, reloadToken, loadNodes]);

  const distributionInitialLoading =
    loading && !distributionLoadedRef.current;
  const cardInitialLoading = distributionInitialLoading || nodesInitialLoading;

  return (
    <OpsDashboardVmDistributionCard
      title="按节点分布"
      icon={<ClusterOutlined style={{ color: '#1677ff', fontSize: 18 }} />}
      items={summary?.nodeSummary ?? []}
      total={summary?.total ?? 0}
      loading={cardInitialLoading}
      height={height}
      topN={topN}
      centerValue={nodeCount ?? 0}
      centerLabel="节点数"
      emptyHint="暂无节点数据"
    />
  );
};

export default OpsDashboardVmNodeCard;
