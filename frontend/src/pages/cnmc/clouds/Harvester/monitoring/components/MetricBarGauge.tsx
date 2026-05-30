/**
 * Grafana `bargauge` 的横向直译：
 * - 每个 series 取最后一个样本作为当前值（对应 Grafana `instant: true` / `reduceOptions.calcs:['mean'|'lastNotNull']`）
 * - 按值倒序排序，最长 bar 对应最大值（`max = items[0].value`）
 * - 颜色按 `percent = value / max * 100` 落在哪段阈值（Grafana `thresholds.mode:'percentage'`）
 * - 没有数据时 max=0 时不画 bar，仅显示文字 0
 *
 * 与 Grafana `displayMode:'gradient'` 的差异：本实现按阈值"段"取离散色，不做颜色过渡；
 * 视觉上仍能在一屏看出哪些 VM 处于黄/红区，且实现远比 SVG/Canvas 简单。
 */
import React, { useMemo } from 'react';
import { Typography } from 'antd';
import { legendNameFromLabels } from '../lib/legendLabels';
import { formatValue, type UnitKind } from '../lib/unit';
import type { PromSeries } from '../hooks/usePromQueries';

export interface BarGaugeThresholdStep {
  /** 占 max 的百分比（0–100），与 Grafana `thresholds.mode:'percentage'` 一致 */
  percent: number;
  color: string;
}

export interface MetricBarGaugeProps {
  series: PromSeries[];
  unit?: UnitKind;
  thresholds?: BarGaugeThresholdStep[];
  decimals?: number;
  /** legend 模板（如 `{{name}}`），不传时优先 metric.name，再 fallback */
  legendTemplate?: string;
  /** 一行的高度，包含 padding；默认 22 */
  rowHeight?: number;
  /** 列表区最大高度（超出滚动），默认 280 */
  maxHeight?: number;
  /** 自定义 legend 名（如将 Prometheus name 映射为云主机名称） */
  legendNameResolver?: (
    template: string,
    labels: Record<string, string>,
    fallback: string,
  ) => string;
}

const DEFAULT_THRESHOLDS: BarGaugeThresholdStep[] = [
  { percent: 0, color: '#52c41a' },
  { percent: 65, color: '#EAB839' },
  { percent: 90, color: '#f5222d' },
];

function pickLast(series: PromSeries): number | undefined {
  if (!Array.isArray(series.values) || series.values.length === 0) return undefined;
  const last = series.values[series.values.length - 1];
  const v = Number(last?.[1]);
  return Number.isFinite(v) ? v : undefined;
}

function pickThresholdColor(percent: number, thresholds: BarGaugeThresholdStep[]): string {
  let color = thresholds[0]?.color ?? '#52c41a';
  for (const t of thresholds) {
    if (percent >= t.percent) color = t.color;
  }
  return color;
}

const MetricBarGauge: React.FC<MetricBarGaugeProps> = ({
  series,
  unit = 'short',
  thresholds = DEFAULT_THRESHOLDS,
  legendTemplate,
  rowHeight = 22,
  maxHeight = 280,
  legendNameResolver,
}) => {
  const rows = useMemo(() => {
    const items = series
      .map((s, idx) => {
        const v = pickLast(s);
        const fallback = `series ${idx + 1}`;
        const labels = s.metric ?? {};
        const template = legendTemplate ?? '';
        const name = legendNameResolver
          ? legendNameResolver(template, labels, fallback)
          : legendNameFromLabels(legendTemplate, labels, fallback);
        return {
          name,
          value: Number.isFinite(v as number) ? (v as number) : 0,
        };
      })
      .sort((a, b) => b.value - a.value);
    return items;
  }, [series, legendTemplate, legendNameResolver]);

  const max = rows[0]?.value ?? 0;
  const labelWidth = useMemo(() => {
    /** 估算 name 列宽度（中英混排），不超过 240 px、不少于 120 px */
    const maxNameLen = rows.reduce((acc, r) => Math.max(acc, r.name?.length ?? 0), 0);
    return Math.min(240, Math.max(120, maxNameLen * 7 + 16));
  }, [rows]);

  return (
    <div style={{ maxHeight, overflowY: 'auto', overflowX: 'hidden', paddingRight: 4 }}>
      {rows.map((row, idx) => {
        const percent = max > 0 ? (row.value / max) * 100 : 0;
        const color = pickThresholdColor(percent, thresholds);
        return (
          <div
            key={`${row.name}-${idx}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              minHeight: rowHeight,
              padding: '2px 0',
            }}
          >
            <Typography.Text
              ellipsis={{ tooltip: row.name }}
              style={{ width: labelWidth, fontSize: 12 }}
            >
              {row.name || '-'}
            </Typography.Text>
            <div
              style={{
                flex: 1,
                minWidth: 80,
                height: rowHeight - 6,
                background: '#f0f0f0',
                borderRadius: 3,
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              <div
                style={{
                  width: `${Math.max(0, Math.min(100, percent))}%`,
                  height: '100%',
                  background: color,
                  transition: 'width 0.2s ease',
                }}
              />
            </div>
            <Typography.Text
              style={{ minWidth: 90, textAlign: 'right', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}
            >
              {formatValue(row.value, unit).text}
            </Typography.Text>
          </div>
        );
      })}
    </div>
  );
};

export default MetricBarGauge;
