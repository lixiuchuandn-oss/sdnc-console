/**
 * 运维监控大盘 · 节点概览 · 物理主机状态分布
 */
import React, { useMemo } from 'react';
import { DatabaseOutlined } from '@ant-design/icons';
import { Tag } from 'antd';
import { useMonitoringOverviewFastLane } from '../MonitoringOverviewLanesContext';
import { parseNodeStatusTags, parseNodesToHostSegments } from '../lib/hostSegments';
import { useOverviewInitialLoading } from '../lib/panelLoadState';
import OpsDashboardVmDistributionCard from './OpsDashboardVmDistributionCard';

const HEIGHT_SIZE = 250;

export interface OpsDashboardNodesHostsCardProps {
  height?: number;
}

const OpsDashboardNodesHostsCard: React.FC<OpsDashboardNodesHostsCardProps> = ({ height = HEIGHT_SIZE }) => {
  const fast = useMonitoringOverviewFastLane();

  const { total, items, nodeStatusTags } = useMemo(() => {
    const summary = parseNodesToHostSegments(fast.nodeResources ?? null);
    const tags = parseNodeStatusTags(fast.nodeResources ?? null);
    return {
      total: summary.total,
      items: summary.segments.map((seg) => ({
        name: seg.name,
        value: seg.count,
        color: seg.color,
      })),
      nodeStatusTags: tags,
    };
  }, [fast.nodeResources]);

  const hasRenderableData = total > 0 || items.length > 0;
  const initialLoading = useOverviewInitialLoading(fast.coreLoading, hasRenderableData);

  return (
    <OpsDashboardVmDistributionCard
      title="物理主机"
      icon={<DatabaseOutlined style={{ color: '#1677ff', fontSize: 18 }} />}
      items={items}
      total={total}
      loading={initialLoading}
      height={height}
      centerValue={total}
      centerLabel="物理主机"
      includeZeroInList
      extraText={`共 ${total} 台`}
      emptyHint="暂无物理主机"
      footerContent={
        nodeStatusTags.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 2, justifyContent: 'flex-end' }}>
            {nodeStatusTags.map((tag) => (
              <Tag
                key={`${tag.key}-${tag.nodeName}`}
                style={{
                  marginInlineEnd: 0,
                  borderColor: tag.color,
                  color: tag.color,
                  background: '#fff',
                  maxWidth: '100%',
                }}
              >
                {tag.nodeName}
              </Tag>
            ))}
          </div>
        ) : null
      }
    />
  );
};

export default OpsDashboardNodesHostsCard;
