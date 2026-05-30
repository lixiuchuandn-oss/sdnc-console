/**
 * 运维监控大盘 · 云主机分布概览（环形图 + 明细列表，与集群概览卡片统一布局）
 */
import React, { useCallback, useMemo, useRef } from 'react';
import ReactECharts from 'echarts-for-react';
import type ReactEChartsCore from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { Typography } from 'antd';
import { useEChartsLoading } from '../hooks/useEChartsLoading';
import {
  OPS_OVERVIEW_BODY_GAP,
  OPS_OVERVIEW_BODY_MIN_HEIGHT,
  OPS_OVERVIEW_CENTER_MAIN_FONT,
  OPS_OVERVIEW_CENTER_SUB_FONT,
  OPS_OVERVIEW_DOT_SIZE,
  OPS_OVERVIEW_LIST_LABEL_FONT,
  OPS_OVERVIEW_LIST_SUB_FONT,
  OPS_OVERVIEW_LIST_VALUE_FONT,
  OPS_OVERVIEW_RING_SIZE,
} from '../lib/opsDashboardOverviewCardLayout';
import OpsDashboardOverviewCard from './OpsDashboardOverviewCard';

const PIE_COLORS = ['#1677ff', '#52c41a', '#fa8c16', '#eb2f96', '#13c2c2', '#722ed1', '#faad14', '#2f54eb'];

export interface VmDistributionItem {
  name: string;
  value: number;
  color?: string;
}

export interface OpsDashboardVmDistributionCardProps {
  title: React.ReactNode;
  icon: React.ReactNode;
  items: VmDistributionItem[];
  total: number;
  loading?: boolean;
  height?: number;
  topN?: number;
  /** 圆环中心数值；默认取 items 条目数 */
  centerValue?: number;
  /** 圆环中心副标题，如「总台数」；留空则不显示 */
  centerLabel?: string;
  emptyHint?: string;
  /** 列表展示 value=0 的项（状态分布需展示全部状态） */
  includeZeroInList?: boolean;
  /** 右上角附加文案，默认「共 N 台」 */
  extraText?: string;
}

function buildPieData(items: VmDistributionItem[], total: number, topN: number, includeZeroInList: boolean) {
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const list = includeZeroInList ? items : sorted.slice(0, topN);
  const pieSource = sorted.filter((item) => item.value > 0);
  const top = pieSource.slice(0, topN);
  const topSum = top.reduce((sum, item) => sum + item.value, 0);
  const rest = Math.max(0, total - topSum);
  const data = top.map((item, idx) => ({
    name: item.name,
    value: item.value,
    itemStyle: { color: item.color ?? PIE_COLORS[idx % PIE_COLORS.length] },
  }));
  if (rest > 0 && !includeZeroInList) {
    data.push({
      name: '其他',
      value: rest,
      itemStyle: { color: '#d9d9d9' },
    });
  }
  return { data, list };
}

const OpsDashboardVmDistributionCard: React.FC<OpsDashboardVmDistributionCardProps> = ({
  title,
  icon,
  items,
  total,
  loading = false,
  height = 220,
  topN = 5,
  centerValue,
  centerLabel = '合计',
  emptyHint = '暂无数据',
  includeZeroInList = false,
  extraText,
}) => {
  const chartRef = useRef<ReactEChartsCore>(null);
  const { onChartReady: onChartLoadingReady } = useEChartsLoading(chartRef, loading);

  const handleChartReady = useCallback(() => {
    onChartLoadingReady();
  }, [onChartLoadingReady]);

  const { data: pieData, list: displayList } = useMemo(
    () => buildPieData(items, total, topN, includeZeroInList),
    [items, total, topN, includeZeroInList],
  );

  const option = useMemo<EChartsOption>(() => {
    return {
      animation: false,
      tooltip: {
        trigger: 'item',
        confine: true,
        formatter: (p: any) => {
          const pct = total > 0 ? ((Number(p.value) / total) * 100).toFixed(1) : '0';
          return `${p.name}<br/>${p.value} 台 (${pct}%)`;
        },
      },
      series: [
        {
          type: 'pie',
          radius: ['58%', '78%'],
          center: ['50%', '50%'],
          label: { show: false },
          labelLine: { show: false },
          data: pieData.length > 0 ? pieData : [{ name: emptyHint, value: 1, itemStyle: { color: '#f0f0f0' } }],
        },
      ],
    };
  }, [pieData, total, emptyHint]);

  const centerDisplay = centerValue ?? items.length;

  return (
    <OpsDashboardOverviewCard
      title={title}
      icon={icon}
      loading={loading}
      height={height}
    >
      {displayList.length > 0 || total > 0 ? (
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
              <span style={{ fontSize: OPS_OVERVIEW_CENTER_MAIN_FONT, fontWeight: 600, lineHeight: 1 }}>
                {centerDisplay}
              </span>
              {centerLabel ? (
                <Typography.Text type="secondary" style={{ fontSize: OPS_OVERVIEW_CENTER_SUB_FONT, marginTop: 4 }}>
                  {centerLabel}
                </Typography.Text>
              ) : null}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            {displayList.map((item, idx) => {
              const color = item.color ?? PIE_COLORS[idx % PIE_COLORS.length];
              const pct = total > 0 ? Math.round((item.value / total) * 1000) / 10 : 0;
              return (
                <div
                  key={item.name}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderBottom: idx < displayList.length - 1 ? '1px solid #f0f0f0' : undefined,
                    padding: '6px 0',
                    gap: 8,
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                    <span
                      style={{
                        width: OPS_OVERVIEW_DOT_SIZE,
                        height: OPS_OVERVIEW_DOT_SIZE,
                        borderRadius: '50%',
                        background: color,
                        flexShrink: 0,
                      }}
                    />
                    <Typography.Text ellipsis style={{ fontSize: OPS_OVERVIEW_LIST_LABEL_FONT }}>
                      {item.name}
                    </Typography.Text>
                  </span>
                  <span style={{ fontSize: OPS_OVERVIEW_LIST_VALUE_FONT, fontWeight: 500, flexShrink: 0 }}>
                    {item.value}
                    <Typography.Text type="secondary" style={{ fontSize: OPS_OVERVIEW_LIST_SUB_FONT, marginLeft: 4 }}>
                      ({pct}%)
                    </Typography.Text>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <Typography.Text type="secondary" style={{ fontSize: OPS_OVERVIEW_LIST_SUB_FONT }}>
          {emptyHint}
        </Typography.Text>
      )}
    </OpsDashboardOverviewCard>
  );
};

export default OpsDashboardVmDistributionCard;
