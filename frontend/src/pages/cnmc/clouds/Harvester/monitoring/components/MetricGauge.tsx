/**
 * 监控大盘单值仪表盘：对应 Grafana panel `type: gauge`。
 * - 取 series 最后一个数据点作为当前值（series 内置多条时取第一条 series 的 last value）
 * - 支持按阈值上色（与 Grafana steps 一致：value 升序，落在哪段就显示哪段颜色）
 * - 单位按 raw 值传，组件内决定显示文本（默认 fixed(1) + 单位后缀，如 `78.2 %`）
 */
import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import type { PromSeries } from '../hooks/usePromQueries';

export interface GaugeThresholdStep {
  /** 取值临界点（与 max 同尺度，例如 max=100、value=80 表示 80% 临界） */
  value: number;
  color: string;
}

export interface MetricGaugeProps {
  /** 输入序列（usePromQueries.results[key].series），多 series 取第一条 */
  series: PromSeries[];
  /** 当前 raw 值，若直接传则覆盖 series 解析；测试时方便 */
  value?: number;
  min?: number;
  max?: number;
  /** 显示单位后缀，例如 `%`、`GiB`；不传则不附加 */
  unit?: string;
  /** 与 Grafana thresholds.steps 一致；按 value 升序，第一项 value 通常 -Infinity / 起始色 */
  thresholds?: GaugeThresholdStep[];
  height?: number;
  /** Detail 文字大小，默认 22 */
  detailFontSize?: number;
}

const DEFAULT_THRESHOLDS: GaugeThresholdStep[] = [
  { value: 0, color: 'rgba(50, 172, 45, 0.97)' },
  { value: 80, color: 'rgba(237, 129, 40, 0.89)' },
  { value: 90, color: 'rgba(245, 54, 54, 0.9)' },
];

function pickLastValue(series: PromSeries[]): number | undefined {
  for (const s of series) {
    if (Array.isArray(s.values) && s.values.length > 0) {
      const last = s.values[s.values.length - 1];
      const v = Number(last?.[1]);
      if (Number.isFinite(v)) return v;
    }
  }
  return undefined;
}

const MetricGauge: React.FC<MetricGaugeProps> = ({
  series,
  value,
  min = 0,
  max = 100,
  unit = '',
  thresholds = DEFAULT_THRESHOLDS,
  height = 240,
  detailFontSize = 22,
}) => {
  const currentValue = useMemo(() => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const v = pickLastValue(series);
    return Number.isFinite(v as number) ? (v as number) : 0;
  }, [series, value]);

  /** 把 Grafana steps（按 raw value）转成 ECharts 的 `[fraction, color]` 数组 */
  const axisLineColor = useMemo<Array<[number, string]>>(() => {
    if (!thresholds.length) return [[1, DEFAULT_THRESHOLDS[0].color]];
    const sorted = [...thresholds].sort((a, b) => a.value - b.value);
    const span = max - min;
    if (span <= 0) return [[1, sorted[0].color]];
    const result: Array<[number, string]> = [];
    for (let i = 0; i < sorted.length; i += 1) {
      const next = sorted[i + 1];
      const upper = next ? Math.min(1, Math.max(0, (next.value - min) / span)) : 1;
      result.push([upper, sorted[i].color]);
    }
    if (result[result.length - 1][0] < 1) result.push([1, sorted[sorted.length - 1].color]);
    return result;
  }, [thresholds, min, max]);

  const option = useMemo<EChartsOption>(() => {
    return {
      animation: false,
      series: [
        {
          type: 'gauge',
          min,
          max,
          radius: '95%',
          startAngle: 210,
          endAngle: -30,
          progress: { show: false },
          axisLine: {
            lineStyle: { width: 14, color: axisLineColor },
          },
          pointer: {
            length: '60%',
            width: 4,
            itemStyle: { color: 'rgba(0,0,0,.65)' },
          },
          axisTick: { show: false },
          splitLine: {
            length: 8,
            lineStyle: { color: '#fff', width: 2 },
          },
          axisLabel: {
            distance: 18,
            color: 'rgba(0,0,0,.45)',
            fontSize: 10,
          },
          detail: {
            valueAnimation: false,
            fontSize: detailFontSize,
            color: 'rgba(0,0,0,.85)',
            offsetCenter: [0, '55%'],
            formatter: (v: number) => `${Number(v).toFixed(1)}${unit ? ` ${unit}` : ''}`,
          },
          data: [{ value: currentValue }],
        },
      ],
    };
  }, [currentValue, min, max, axisLineColor, unit, detailFontSize]);

  return <ReactECharts option={option} style={{ height, width: '100%' }} notMerge lazyUpdate />;
};

export default MetricGauge;
