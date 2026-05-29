/**
 * 运维监控大盘 · 集群内存概览（总内存 / 已使用 / 使用率）
 */
import React, { useMemo } from 'react';
import { Card, Spin, Typography } from 'antd';
import { FundOutlined } from '@ant-design/icons';
import { useMonitoringOverviewFastLane } from '../MonitoringOverviewLanesContext';
import {
  aggregateNodeMetrics,
  aggregateNodeResources,
  formatMemoryForDisplay,
} from '../lib/nodeResourceMetrics';

function usageColor(percent: number): string {
  if (percent >= 90) return '#ef4444';
  if (percent >= 70) return '#f59e0b';
  return '#22C55E';
}

const RING_SIZE = 150;
const RING_STROKE = 9;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export interface OpsDashboardClusterMemoryCardProps {
  height?: number;
}

const OpsDashboardClusterMemoryCard: React.FC<OpsDashboardClusterMemoryCardProps> = ({
  height = 250,
}) => {
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

  const barColor = usageColor(usagePercent);
  const clampedPercent = Math.min(100, Math.max(0, usagePercent));
  const ringOffset = RING_CIRCUMFERENCE - (clampedPercent / 100) * RING_CIRCUMFERENCE;

  return (
    <Card
      size="small"
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <FundOutlined style={{ color: '#1677ff', fontSize: 18 }} />
          <span style={{ fontSize: 15 }}>集群内存</span>
        </span>
      }
      styles={{
        header: { padding: '12px 16px', minHeight: 48 },
        body: {
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
          padding: '12px 16px 16px',
        },
      }}
      style={{
        width: '100%',
        height,
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
      }}
    >
      <Spin spinning={loading} style={{ width: '100%', flex: 1, minHeight: 0 }}>
        <div
          style={{
            display: 'flex',
            gap: 24,
            alignItems: 'stretch',
            width: '100%',
            minHeight: 120,
          }}
        >
          <div
            style={{
              width: RING_SIZE,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div style={{ position: 'relative', width: RING_SIZE, height: RING_SIZE }}>
              <svg width={RING_SIZE} height={RING_SIZE} style={{ transform: 'rotate(-90deg)' }}>
                <circle
                  cx={RING_SIZE / 2}
                  cy={RING_SIZE / 2}
                  r={RING_RADIUS}
                  fill="none"
                  stroke="#e5e7eb"
                  strokeWidth={RING_STROKE}
                />
                <circle
                  cx={RING_SIZE / 2}
                  cy={RING_SIZE / 2}
                  r={RING_RADIUS}
                  fill="none"
                  stroke={barColor}
                  strokeWidth={RING_STROKE}
                  strokeDasharray={RING_CIRCUMFERENCE}
                  strokeDashoffset={ringOffset}
                  strokeLinecap="round"
                  style={{ transition: 'stroke-dashoffset 0.3s, stroke 0.3s' }}
                />
              </svg>
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <span style={{ fontSize: 18, fontWeight: 600, lineHeight: 1, color: barColor }}>
                  {usagePercent}%
                </span>
                <Typography.Text type="secondary" style={{ fontSize: 12, marginTop: 4 }}>
                  使用率
                </Typography.Text>
              </div>
            </div>
          </div>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: 10,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '6px 0',
                borderBottom: '1px solid #f0f0f0',
              }}
            >
              <Typography.Text style={{ fontSize: 14 }}>集群总内存</Typography.Text>
              <Typography.Text strong style={{ fontSize: 14 }}>
                {formatMemoryForDisplay(totalMemoryBytes).text}
              </Typography.Text>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '6px 0',
                borderBottom: '1px solid #f0f0f0',
              }}
            >
              <Typography.Text style={{ fontSize: 14 }}>已使用内存</Typography.Text>
              <Typography.Text strong style={{ fontSize: 14 }}>
                {formatMemoryForDisplay(usedMemoryBytes).text}
              </Typography.Text>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '6px 0',
              }}
            >
              <Typography.Text style={{ fontSize: 14 }}>集群内存使用率</Typography.Text>
              <Typography.Text strong style={{ fontSize: 14, color: barColor }}>
                {usagePercent}%
              </Typography.Text>
            </div>
          </div>
        </div>
      </Spin>
    </Card>
  );
};

export default OpsDashboardClusterMemoryCard;
