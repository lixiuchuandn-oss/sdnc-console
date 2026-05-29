/**
 * 监控大盘通用时间序列折线图：
 * - 输入 N 条 series（来自 usePromQueries.results[key].series）
 * - 自动按整体最大值挑单位（bytes / bytesRate / pps / iops / percent01…）
 * - 时间轴按 chartMin/chartMax 锚定，无数据时也能画出空轴；tooltip 多 series 合并
 * - Y 轴按整图最大值统一量级；tooltip 每条线按当前点 raw 值各自 format（对齐 Grafana）
 * - 通过 legendFormatter 把 labels 拼成 Grafana legend 风格（{{ instance }} → 实际值）
 * - 异步数据：先 init 空轴/空 series，Prometheus 返回后 option 变更触发 setOption；loading 时 showLoading
 *
 * 设计参考：Harvester/ecs/drawers/vm-detail/tabs/VmPerformance.tsx 的 getOption / getByteRateOption。
 */
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import ReactECharts from 'echarts-for-react';
import type ReactEChartsCore from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { useEChartsLoading } from '../hooks/useEChartsLoading';
import { legendNameFromLabels } from '../lib/legendLabels';
import { formatValue, pickSeriesScale, type UnitKind } from '../lib/unit';
import type { PromSeries } from '../hooks/usePromQueries';

export interface MetricSeriesInput {
  /** legend 展示用，可由 labels + legend 模板拼成 */
  name: string;
  data: PromSeries[];
  /** ECharts series 颜色；不传由 ECharts 自动配色 */
  color?: string;
  /** 落在哪条 Y 轴上；默认 0（左轴）。1 = 右轴，需同时设置 props.secondaryUnit */
  yAxisIndex?: 0 | 1;
}

export interface MetricTimeSeriesChartProps {
  /** 多组 series（同一面板内多 query），将合并到一张折线图里 */
  groups: MetricSeriesInput[];
  unit?: UnitKind;
  /** 高度，默认 240 */
  height?: number;
  /** 时间轴左右边界（毫秒）；不传由 ECharts 自动适配 */
  chartMin?: number;
  chartMax?: number;
  /** 强制 Y 轴最小值 / 最大值（按 raw 单位传，内部自动除以 scale.divider） */
  yMin?: number;
  yMax?: number;
  /** 折线模式：smooth（默认）/ step */
  step?: boolean;
  /** 是否填充 area，默认是 */
  area?: boolean;
  /** 是否显示 legend，默认 true；单 series 面板传 false 可省空间 */
  showLegend?: boolean;
  /** 堆叠：true 时左轴 / 右轴各自堆叠（跨轴不合并），等价 Grafana `stacking.mode: normal` */
  stack?: boolean;
  /** 右 Y 轴单位；不传则不显示右轴。group.yAxisIndex=1 的 series 落在右轴 */
  secondaryUnit?: UnitKind;
  /** 右 Y 轴 raw 最小值 / 最大值 */
  secondaryYMin?: number;
  secondaryYMax?: number;
  /** 自定义 legend 名（如将 Prometheus name 映射为云主机名称） */
  legendNameResolver?: (
    template: string,
    labels: Record<string, string>,
    fallback: string,
  ) => string;
  /** 异步拉取中：图表先挂载空轴，由 ECharts showLoading 覆盖；数据到达后 setOption 更新 */
  loading?: boolean;
}

const DEFAULT_COLORS = [
  '#1677ff',
  '#52c41a',
  '#fa8c16',
  '#eb2f96',
  '#13c2c2',
  '#722ed1',
  '#faad14',
  '#f5222d',
  '#2f54eb',
  '#a0d911',
];

interface FlatSeries {
  name: string;
  data: Array<[number, number]>;
  color?: string;
  yAxisIndex: 0 | 1;
}

const MetricTimeSeriesChart: React.FC<MetricTimeSeriesChartProps> = ({
  groups,
  unit = 'short',
  height = 240,
  chartMin,
  chartMax,
  yMin,
  yMax,
  step = false,
  area = true,
  showLegend = true,
  stack = false,
  secondaryUnit,
  secondaryYMin,
  secondaryYMax,
  legendNameResolver,
  loading = false,
}) => {
  /** 把所有 series 展开到一个数组，便于 ECharts 合并 */
  const flatSeries = useMemo<FlatSeries[]>(() => {
    const arr: FlatSeries[] = [];
    groups.forEach((g, gi) => {
      const axis: 0 | 1 = g.yAxisIndex === 1 ? 1 : 0;
      g.data.forEach((s, si) => {
        const fallback = g.data.length === 1 ? g.name : `${g.name} #${si + 1}`;
        const labels = s.metric ?? {};
        const seriesName = legendNameResolver
          ? legendNameResolver(g.name, labels, fallback)
          : legendNameFromLabels(g.name, labels, fallback);
        arr.push({
          name: seriesName,
          data: s.values,
          color: g.color ?? DEFAULT_COLORS[(gi * 3 + si) % DEFAULT_COLORS.length],
          yAxisIndex: axis,
        });
      });
    });
    return arr;
  }, [groups, legendNameResolver]);

  const leftValues = useMemo(
    () => flatSeries.filter((s) => s.yAxisIndex === 0).flatMap((s) => s.data.map((d) => d[1] || 0)),
    [flatSeries],
  );
  const rightValues = useMemo(
    () => flatSeries.filter((s) => s.yAxisIndex === 1).flatMap((s) => s.data.map((d) => d[1] || 0)),
    [flatSeries],
  );
  const leftScale = useMemo(() => pickSeriesScale(leftValues, unit), [leftValues, unit]);
  const rightScale = useMemo(
    () => (secondaryUnit ? pickSeriesScale(rightValues, secondaryUnit) : undefined),
    [rightValues, secondaryUnit],
  );

  const option = useMemo<EChartsOption>(() => {
    const min = chartMin != null ? chartMin : undefined;
    const max = chartMax != null ? chartMax : undefined;

    const leftYAxis = {
      type: 'value' as const,
      min: yMin != null ? yMin / leftScale.divider : undefined,
      max: yMax != null ? yMax / leftScale.divider : undefined,
      axisLabel: { formatter: (v: number) => leftScale.formatTick(v) },
    };
    const rightYAxis = rightScale
      ? {
          type: 'value' as const,
          min: secondaryYMin != null ? secondaryYMin / rightScale.divider : undefined,
          max: secondaryYMax != null ? secondaryYMax / rightScale.divider : undefined,
          axisLabel: { formatter: (v: number) => rightScale.formatTick(v) },
          splitLine: { show: false },
        }
      : undefined;
    const yAxis = rightYAxis ? [leftYAxis, rightYAxis] : leftYAxis;

    return {
      animation: false,
      grid: { left: 8, right: rightYAxis ? 8 : 8, top: showLegend ? 32 : 12, bottom: 28, containLabel: true },
      legend: showLegend
        ? {
            type: 'scroll',
            top: 0,
            textStyle: { fontSize: 11 },
            icon: 'roundRect',
            itemWidth: 8,
            itemHeight: 8,
          }
        : { show: false },
      tooltip: {
        trigger: 'axis',
        confine: true,
        appendToBody: true,
        formatter: (params: any) => {
          const list = Array.isArray(params) ? params : [params];
          if (list.length === 0) return '';
          const ts = Number(list[0]?.value?.[0]);
          const d = new Date(ts);
          const label = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
          const lines = list.map((p: any) => {
            const idx = Number(p.seriesIndex);
            const fs = flatSeries[idx];
            const useRight = fs?.yAxisIndex === 1 && rightScale;
            const sc = useRight ? rightScale! : leftScale;
            const unitKind = useRight && secondaryUnit ? secondaryUnit : unit;
            const scaled = Number(p.value?.[1] ?? 0);
            const raw = scaled * sc.divider;
            const { text } = formatValue(raw, unitKind);
            return `${p.marker} ${p.seriesName}: ${text}`;
          });
          return [label, ...lines].join('<br/>');
        },
      },
      xAxis: {
        type: 'time',
        min,
        max,
        boundaryGap: false,
        axisLabel: {
          hideOverlap: true,
          formatter: (value: number) => {
            const d = new Date(value);
            const rangeMs = (chartMax ?? Date.now()) - (chartMin ?? Date.now() - 60 * 60 * 1000);
            if (rangeMs > 24 * 3600 * 1000) {
              return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            }
            return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
          },
        },
      },
      yAxis,
      series: flatSeries.map((s) => {
        const divider = s.yAxisIndex === 1 && rightScale ? rightScale.divider : leftScale.divider;
        return {
          type: 'line' as const,
          name: s.name,
          smooth: !step,
          step: step ? ('end' as const) : false,
          symbol: 'none',
          sampling: 'lttb',
          lineStyle: { width: 1.5 },
          itemStyle: { color: s.color },
          areaStyle: area ? { opacity: 0.12 } : undefined,
          yAxisIndex: s.yAxisIndex,
          stack: stack ? (s.yAxisIndex === 1 ? 'right' : 'left') : undefined,
          data: s.data.map(([ts, v]) => [ts, v / divider] as [number, number]),
        };
      }),
    };
  }, [
    flatSeries,
    leftScale,
    rightScale,
    chartMin,
    chartMax,
    yMin,
    yMax,
    secondaryYMin,
    secondaryYMax,
    step,
    area,
    showLegend,
    stack,
    unit,
    secondaryUnit,
  ]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReactEChartsCore>(null);

  const resizeChart = useCallback(() => {
    chartRef.current?.getEchartsInstance()?.resize();
  }, []);

  const { onChartReady: onChartLoadingReady } = useEChartsLoading(chartRef, loading);

  const handleChartReady = useCallback(() => {
    resizeChart();
    onChartLoadingReady();
  }, [resizeChart, onChartLoadingReady]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      resizeChart();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [resizeChart]);

  return (
    <div ref={wrapRef} style={{ width: '100%', minWidth: 0, height }}>
      <ReactECharts
        ref={chartRef}
        option={option}
        style={{ height: '100%', width: '100%' }}
        notMerge
        lazyUpdate
        onChartReady={handleChartReady}
      />
    </div>
  );
};

export default MetricTimeSeriesChart;
