/**
 * 运维监控大盘 · 集群资源概览（ECharts 使用率饼图 + 指标列表）
 */
import React, { useCallback, useMemo, useRef } from 'react';
import ReactECharts from 'echarts-for-react';
import type ReactEChartsCore from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { Typography } from 'antd';
import { useEChartsLoading } from '../hooks/useEChartsLoading';
import OpsDashboardOverviewCard from './OpsDashboardOverviewCard';
import {
  OPS_OVERVIEW_BODY_GAP,
  OPS_OVERVIEW_BODY_MIN_HEIGHT,
  OPS_OVERVIEW_CENTER_MAIN_FONT,
  OPS_OVERVIEW_CENTER_SUB_FONT,
  OPS_OVERVIEW_LIST_LABEL_FONT,
  OPS_OVERVIEW_LIST_VALUE_FONT,
  OPS_OVERVIEW_RING_SIZE,
  opsOverviewUsageColor,
} from '../lib/opsDashboardOverviewCardLayout';

export interface ClusterMetricRow {
  label: string;
  value: React.ReactNode;
  valueColor?: string;
}

export interface OpsDashboardClusterMetricCardProps {
  title: React.ReactNode;
  icon: React.ReactNode;
  loading?: boolean;
  height?: number;
  usagePercent: number;
  rows: ClusterMetricRow[];
}

const OpsDashboardClusterMetricCard: React.FC<OpsDashboardClusterMetricCardProps> = ({
  title,
  icon,
  loading = false,
  height = 220,
  usagePercent,
  rows,
}) => {
  const chartRef = useRef<ReactEChartsCore>(null);
  const { onChartReady: onChartLoadingReady } = useEChartsLoading(chartRef, loading);

  const handleChartReady = useCallback(() => {
    onChartLoadingReady();
  }, [onChartLoadingReady]);

  const barColor = opsOverviewUsageColor(usagePercent);
  const clampedPercent = Math.min(100, Math.max(0, usagePercent));
  const remainPercent = Math.max(0, 100 - clampedPercent);

  const option = useMemo<EChartsOption>(() => {
    return {
      animation: false,
      tooltip: {
        trigger: 'item',
        confine: true,
        formatter: (p: any) => `${p.name}: ${p.value}%`,
      },
      series: [
        {
          type: 'pie',
          radius: ['58%', '78%'],
          center: ['50%', '50%'],
          label: { show: false },
          labelLine: { show: false },
          data: [
            { name: '已使用', value: clampedPercent, itemStyle: { color: barColor } },
            { name: '可用', value: remainPercent, itemStyle: { color: '#e5e7eb' } },
          ],
        },
      ],
    };
  }, [barColor, clampedPercent, remainPercent]);

  return (
    <OpsDashboardOverviewCard title={title} icon={icon} loading={loading} height={height}>
      <div
        style={{
          display: 'flex',
          gap: OPS_OVERVIEW_BODY_GAP,
          alignItems: 'stretch',
          width: '100%',
          minHeight: OPS_OVERVIEW_BODY_MIN_HEIGHT,
        }}
      >
        <div
          style={{
            width: OPS_OVERVIEW_RING_SIZE,
            flexShrink: 0,
            position: 'relative',
            height: OPS_OVERVIEW_RING_SIZE,
          }}
        >
          <ReactECharts
            ref={chartRef}
            option={option}
            style={{ width: OPS_OVERVIEW_RING_SIZE, height: OPS_OVERVIEW_RING_SIZE }}
            notMerge
            lazyUpdate
            onChartReady={handleChartReady}
          />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <span style={{ fontSize: OPS_OVERVIEW_CENTER_MAIN_FONT, fontWeight: 600, lineHeight: 1, color: barColor }}>
              {usagePercent}%
            </span>
            <Typography.Text type="secondary" style={{ fontSize: OPS_OVERVIEW_CENTER_SUB_FONT, marginTop: 4 }}>
              使用率
            </Typography.Text>
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
          {rows.map((row, idx) => (
            <div
              key={row.label}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '6px 0',
                borderBottom: idx < rows.length - 1 ? '1px solid #f0f0f0' : undefined,
              }}
            >
              <Typography.Text style={{ fontSize: OPS_OVERVIEW_LIST_LABEL_FONT }}>{row.label}</Typography.Text>
              <Typography.Text strong style={{ fontSize: OPS_OVERVIEW_LIST_VALUE_FONT, color: row.valueColor }}>
                {row.value}
              </Typography.Text>
            </div>
          ))}
        </div>
      </div>
    </OpsDashboardOverviewCard>
  );
};

export default OpsDashboardClusterMetricCard;
