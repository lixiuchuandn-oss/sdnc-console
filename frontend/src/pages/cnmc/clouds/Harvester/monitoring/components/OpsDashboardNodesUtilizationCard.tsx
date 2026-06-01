/**
 * 运维监控大盘 · 节点资源用量概览（已使用 / 未使用饼图 + 物理总量摘要）
 */
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
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

const HEIGHT_SIZE = 280;

export interface OpsDashboardNodesUtilizationCardProps {
  title: React.ReactNode;
  icon: React.ReactNode;
  loading?: boolean;
  height?: number;
  total: number;
  used: number;
  unused: number;
  summaryText: string;
  formatValue?: (value: number) => string;
  usedLabel?: string;
  unusedLabel?: string;
}

const OpsDashboardNodesUtilizationCard: React.FC<OpsDashboardNodesUtilizationCardProps> = ({
  title,
  icon,
  loading = false,
  height = HEIGHT_SIZE,
  total,
  used,
  unused,
  summaryText,
  formatValue = (value) => (Math.round(value * 10) / 10).toFixed(1),
  usedLabel = '已使用',
  unusedLabel = '未使用',
}) => {
  const chartRef = useRef<ReactEChartsCore>(null);
  const hasDataRef = useRef(false);

  useEffect(() => {
    if (total > 0 || used > 0 || unused > 0) {
      hasDataRef.current = true;
    }
  }, [total, used, unused]);

  useEffect(() => {
    if (!loading) {
      hasDataRef.current = true;
    }
  }, [loading]);

  const initialLoading = loading && !hasDataRef.current;
  const { onChartReady: onChartLoadingReady } = useEChartsLoading(chartRef, initialLoading);

  const handleChartReady = useCallback(() => {
    onChartLoadingReady();
  }, [onChartLoadingReady]);

  const usagePercent = total > 0 ? Math.round((used / total) * 1000) / 10 : 0;
  const barColor = opsOverviewUsageColor(usagePercent);
  const safeUsed = Math.max(0, used);
  const safeUnused = Math.max(0, unused);

  const option = useMemo<EChartsOption>(() => {
    return {
      animation: false,
      tooltip: {
        trigger: 'item',
        confine: true,
      },
      series: [
        {
          type: 'pie',
          radius: ['58%', '78%'],
          center: ['50%', '50%'],
          label: { show: false },
          labelLine: { show: false },
          data: [
            { name: usedLabel, value: safeUsed, itemStyle: { color: barColor } },
            { name: unusedLabel, value: safeUnused, itemStyle: { color: '#e5e7eb' } },
          ],
        },
      ],
    };
  }, [barColor, safeUsed, safeUnused, usedLabel, unusedLabel]);

  useEffect(() => {
    const chart = chartRef.current?.getEchartsInstance();
    if (!chart) return;
    chart.setOption(
      {
        series: [
          {
            data: [
              { name: usedLabel, value: safeUsed, itemStyle: { color: barColor } },
              { name: unusedLabel, value: safeUnused, itemStyle: { color: '#e5e7eb' } },
            ],
          },
        ],
      },
      { notMerge: false, lazyUpdate: true, replaceMerge: ['series'] },
    );
  }, [barColor, safeUsed, safeUnused, usedLabel, unusedLabel]);

  return (
    <OpsDashboardOverviewCard title={title} icon={icon} extra={summaryText} loading={initialLoading} height={height}>
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
            notMerge={false}
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
            gap: 8,
          }}
        >
          {[
            { label: usedLabel, value: safeUsed, color: barColor },
            { label: unusedLabel, value: safeUnused, color: '#d9d9d9' },
          ].map((row, idx) => (
            <div
              key={row.label}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '6px 0',
                borderBottom: idx === 0 ? '1px solid #f0f0f0' : undefined,
              }}
            >
              <Typography.Text style={{ fontSize: OPS_OVERVIEW_LIST_LABEL_FONT }}>
                <span
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: row.color,
                    marginRight: 8,
                  }}
                />
                {row.label}
              </Typography.Text>
              <Typography.Text strong style={{ fontSize: OPS_OVERVIEW_LIST_VALUE_FONT }}>
                {formatValue(row.value)}
              </Typography.Text>
            </div>
          ))}
        </div>
      </div>
    </OpsDashboardOverviewCard>
  );
};

export default OpsDashboardNodesUtilizationCard;
