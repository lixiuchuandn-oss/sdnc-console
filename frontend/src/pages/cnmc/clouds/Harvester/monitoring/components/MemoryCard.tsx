/**
 * 内存卡片 - 可分配 / 已分配 / 系统预留 竖条 + 图例
 */
import React, { useMemo } from 'react';
import { Card, Typography, Spin } from 'antd';
import { DatabaseOutlined } from '@ant-design/icons';
import { useMonitoringOverviewFastLane } from '../MonitoringOverviewLanesContext';
import {
  aggregateNodeResources,
  aggregateNodeMetrics,
  formatMemoryForDisplay,
} from '../lib/nodeResourceMetrics';

const SEGMENT_COLORS = { 可分配: '#D9DDE6', 已分配: '#22C55E', 系统预留: '#15803D' } as const;

export const MemoryCard: React.FC = () => {
  const fast = useMonitoringOverviewFastLane();
  const loading = fast.coreLoading;
  const nodeData = fast;

  const { totalDisplay, segments } = useMemo(() => {
    const resources = aggregateNodeResources(nodeData.nodeResources ?? null);
    const metrics = aggregateNodeMetrics(nodeData.nodeMetrics ?? null);
    const totalCapacityBytes = resources.totalCapacityMemoryBytes;
    const totalAllocatableBytes = resources.totalMemoryBytes;
    const usedBytes = metrics.usedMemoryBytes;
    const reservedBytes = resources.reservedMemoryBytes;
    const allocatableRemaining = Math.max(0, totalAllocatableBytes - usedBytes);

    const totalDisplay = formatMemoryForDisplay(totalCapacityBytes);
    const segs = [
      { label: '可分配' as const, bytes: allocatableRemaining, displayValue: formatMemoryForDisplay(allocatableRemaining).text },
      { label: '已分配' as const, bytes: usedBytes, displayValue: formatMemoryForDisplay(usedBytes).text },
      { label: '系统预留' as const, bytes: reservedBytes, displayValue: formatMemoryForDisplay(reservedBytes).text },
    ];
    const totalForPercent = totalCapacityBytes;
    const segments =
      totalForPercent > 0
        ? segs.map((s) => ({ ...s, percent: (s.bytes / totalForPercent) * 100 }))
        : segs.map((s) => ({ ...s, percent: 0 }));

    return { totalDisplay, segments };
  }, [nodeData.nodeResources, nodeData.nodeMetrics]);

  return (
    <Card
      size="small"
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <DatabaseOutlined style={{ color: '#1677ff', fontSize: 20 }} />
          <span style={{ fontSize: 16 }}>内存</span>
        </span>
      }
      styles={{
        header: { padding: '16px 20px', height: 60, minHeight: 60 },
        body: {
          padding: '16px 20px',
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        },
      }}
      extra={<span style={{ fontSize: 14, color: '#999' }}>共 {totalDisplay.text}</span>}
      style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
    >
      <Spin spinning={loading}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'stretch', flex: 1, minHeight: 0 }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-evenly' }}>
            {segments.map((seg, i) => (
              <div
                key={seg.label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 0',
                  borderBottom: i < segments.length - 1 ? '1px solid #f0f0f0' : undefined,
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 3,
                      background: SEGMENT_COLORS[seg.label],
                      flexShrink: 0,
                    }}
                  />
                  <Typography.Text style={{ fontSize: 14 }}>{seg.label}</Typography.Text>
                </span>
                <span style={{ fontSize: 14 }}>{seg.displayValue}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            <div
              style={{
                width: 12,
                height: '92%',
                minHeight: 42,
                borderRadius: 4,
                border: '1px solid #e5e7eb',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column-reverse',
              }}
            >
              {[...segments].reverse().map((seg) => (
                <div
                  key={seg.label}
                  style={{
                    height: `${seg.percent}%`,
                    background: SEGMENT_COLORS[seg.label],
                    minHeight: 2,
                  }}
                  title={`${seg.label}: ${seg.displayValue}`}
                />
              ))}
            </div>
          </div>
        </div>
      </Spin>
    </Card>
  );
};
