/* eslint-disable no-template-curly-in-string -- PromQL 模板占位符 ${count} 由 expandPromql 运行时注入，非 JS 模板字符串 */
/**
 * 运维监控大盘 · 云主机视图（对齐 Grafana 仪表盘 `Harvester 虚拟机概览`，uid=harvester-vm-dashboard-1）。
 *
 * 与 Grafana 的差异：
 * - `$count` 模板变量改为顶部 `<Select>`（5 / 10 / 20，默认 10），通过 `expandPromql` 注入到 PromQL。
 * - `bargauge` 类型用本地新增的 `MetricBarGauge` 复刻：按 max 取百分比、按阈值（65% / 90%）离散染色。
 *   原 Grafana `displayMode: gradient` 的颜色过渡舍弃，换离散段色，避免引入 SVG/Canvas 复杂度。
 *
 * Panel 网格（Grafana 24-col → AntD 24-col）：每个 panel `w=8`，每行 3 个；共 3 行（最后一行 2 个）。
 */
import React, { useMemo } from 'react';
import { Alert, Col, Row, Select, Space, Typography } from 'antd';
import MetricPanelCard from '../components/MetricPanelCard';
import MetricTimeSeriesChart, { type MetricSeriesInput } from '../components/MetricTimeSeriesChart';
import MetricBarGauge, { type BarGaugeThresholdStep } from '../components/MetricBarGauge';
import { usePromQueries, type PromQueryDef, type PromQueryResult } from '../hooks/usePromQueries';
import type { UnitKind } from '../lib/unit';
import type { ResolvedTimeRange } from '../hooks/useDashboardTimeRange';

export interface OpsDashboardVmsSectionProps {
  cloudId: string;
  resolved: ResolvedTimeRange;
  reloadToken: number;
}

const PANEL_HEIGHT = 340;
const CHART_HEIGHT = 260;
const BARGAUGE_MAX_HEIGHT = 260;
const COUNT_OPTIONS = [5, 10, 20] as const;
const DEFAULT_COUNT = 10;

interface PanelQueryDef {
  key: string;
  expr: string;
  legend: string;
  color?: string;
}

interface TimeSeriesPanelDef {
  kind: 'timeseries';
  id: string;
  title: string;
  description?: string;
  unit: UnitKind;
  yMin?: number;
  yMax?: number;
  stack?: boolean;
  showLegend?: boolean;
  col: { xs: number; lg: number };
  queries: PanelQueryDef[];
}

interface BarGaugePanelDef {
  kind: 'bargauge';
  id: string;
  title: string;
  description?: string;
  unit: UnitKind;
  thresholds: BarGaugeThresholdStep[];
  legendTemplate: string;
  col: { xs: number; lg: number };
  query: PanelQueryDef;
}

type VmsPanelDef = TimeSeriesPanelDef | BarGaugePanelDef;

const VMS_PANELS: VmsPanelDef[] = [
  {
    kind: 'timeseries',
    id: 'vm-cpu-usage',
    title: 'CPU 使用率',
    description: 'TopN VM 的虚拟机 vCPU 利用率：avg(rate(kubevirt_vmi_vcpu_seconds_total[5m])) by (domain, name) / 1000；按 VM 堆叠',
    unit: 'percent01',
    yMin: 0,
    stack: true,
    showLegend: true,
    col: { xs: 24, lg: 8 },
    queries: [
      {
        key: 'A',
        expr:
          'topk(${count}, (avg(rate(kubevirt_vmi_vcpu_seconds_total[5m])) by (domain, name)) / 1000)',
        legend: '{{name}}',
      },
    ],
  },
  {
    kind: 'timeseries',
    id: 'vm-memory-usage',
    title: '内存使用率',
    description:
      'TopN VM 的虚拟机内存利用率：(kubevirt_vmi_memory_available_bytes - kubevirt_vmi_memory_unused_bytes) / kubevirt_vmi_memory_available_bytes',
    unit: 'percent01',
    yMin: 0,
    stack: true,
    showLegend: true,
    col: { xs: 24, lg: 8 },
    queries: [
      {
        key: 'A',
        expr:
          'topk(${count}, ((kubevirt_vmi_memory_available_bytes - kubevirt_vmi_memory_unused_bytes) / kubevirt_vmi_memory_available_bytes))',
        legend: '{{name}}',
      },
    ],
  },
  {
    kind: 'timeseries',
    id: 'vm-storage-read',
    title: '存储读流量',
    description: 'TopN VM 的磁盘读字节速率：irate(kubevirt_vmi_storage_read_traffic_bytes_total[5m])，按 VM × drive 一条线',
    unit: 'bytesRate',
    yMin: 0,
    showLegend: true,
    col: { xs: 24, lg: 8 },
    queries: [
      {
        key: 'A',
        expr: 'topk(${count}, (irate(kubevirt_vmi_storage_read_traffic_bytes_total[5m])))',
        legend: '{{name}}: {{drive}}',
      },
    ],
  },
  {
    kind: 'timeseries',
    id: 'vm-storage-write',
    title: '存储写流量',
    description: 'TopN VM 的磁盘写字节速率：irate(kubevirt_vmi_storage_write_traffic_bytes_total[5m])，按 VM × drive 一条线',
    unit: 'bytesRate',
    yMin: 0,
    showLegend: true,
    col: { xs: 24, lg: 8 },
    queries: [
      {
        key: 'A',
        expr: 'topk(${count}, (irate(kubevirt_vmi_storage_write_traffic_bytes_total[5m])))',
        legend: '{{name}}: {{drive}}',
      },
    ],
  },
  {
    kind: 'timeseries',
    id: 'vm-network-receive',
    title: '网络入站速率',
    description: 'TopN VM 的网卡入流量（bit/s）：irate(kubevirt_vmi_network_receive_bytes_total[5m]) × 8',
    unit: 'bitsRate',
    yMin: 0,
    showLegend: true,
    col: { xs: 24, lg: 8 },
    queries: [
      {
        key: 'A',
        expr: 'topk(${count}, (irate(kubevirt_vmi_network_receive_bytes_total[5m])*8))',
        legend: '{{name}}',
      },
    ],
  },
  {
    kind: 'timeseries',
    id: 'vm-network-transmit',
    title: '网络出站速率',
    description: 'TopN VM 的网卡出流量（bit/s）：irate(kubevirt_vmi_network_transmit_bytes_total[5m]) × 8',
    unit: 'bitsRate',
    yMin: 0,
    showLegend: true,
    col: { xs: 24, lg: 8 },
    queries: [
      {
        key: 'A',
        expr: 'topk(${count}, (irate(kubevirt_vmi_network_transmit_bytes_total[5m])*8))',
        legend: '{{name}}',
      },
    ],
  },
  {
    kind: 'bargauge',
    id: 'vm-network-receive-pkts-2h',
    title: '网络入包（过去 2 小时）',
    description: '过去 2 小时网卡入向数据包总数：delta(kubevirt_vmi_network_receive_packets_total[2h])，按 max 取相对百分比（65%/90% 阈值）',
    unit: 'short',
    thresholds: [
      { percent: 0, color: '#52c41a' },
      { percent: 65, color: '#EAB839' },
      { percent: 90, color: '#f5222d' },
    ],
    legendTemplate: '{{name}}',
    col: { xs: 24, lg: 8 },
    query: {
      key: 'A',
      expr: 'topk(${count}, (delta(kubevirt_vmi_network_receive_packets_total[2h])))',
      legend: '{{name}}',
    },
  },
  {
    kind: 'bargauge',
    id: 'vm-network-transmit-pkts-2h',
    title: '网络出包（过去 2 小时）',
    description: '过去 2 小时网卡出向数据包总数：delta(kubevirt_vmi_network_transmit_packets_total[2h])，按 max 取相对百分比（65%/90% 阈值）',
    unit: 'short',
    thresholds: [
      { percent: 0, color: '#52c41a' },
      { percent: 65, color: '#EAB839' },
      { percent: 90, color: '#f5222d' },
    ],
    legendTemplate: '{{name}}',
    col: { xs: 24, lg: 8 },
    query: {
      key: 'A',
      expr: 'topk(${count}, (delta(kubevirt_vmi_network_transmit_packets_total[2h])))',
      legend: '{{name}}',
    },
  },
];

function composeKey(panelId: string, queryKey: string): string {
  return `${panelId}__${queryKey}`;
}

function collectPanelResults(
  panel: VmsPanelDef,
  results: Record<string, PromQueryResult>,
): PromQueryResult[] {
  switch (panel.kind) {
    case 'timeseries':
      return panel.queries.map((q) => results[composeKey(panel.id, q.key)]).filter(Boolean) as PromQueryResult[];
    case 'bargauge':
      return [results[composeKey(panel.id, panel.query.key)]].filter(Boolean) as PromQueryResult[];
  }
}

function isPanelLoading(panel: VmsPanelDef, results: Record<string, PromQueryResult>): boolean {
  const list = collectPanelResults(panel, results);
  if (list.length === 0) return true;
  return list.some((r) => r?.loading === true);
}

function panelErrorMsg(panel: VmsPanelDef, results: Record<string, PromQueryResult>): string | undefined {
  const list = collectPanelResults(panel, results);
  if (list.length === 0) return undefined;
  const errs = list.map((r) => r?.error).filter((m): m is string => Boolean(m));
  return errs.length > 0 && errs.length === list.length ? errs.join('\n') : undefined;
}

function isPanelEmpty(panel: VmsPanelDef, results: Record<string, PromQueryResult>): boolean {
  const list = collectPanelResults(panel, results);
  if (list.length === 0) return true;
  return list.every((r) => !r || r.series.length === 0 || r.series.every((s) => s.values.length === 0));
}

function renderTimeSeriesPanel(
  panel: TimeSeriesPanelDef,
  results: Record<string, PromQueryResult>,
  chartMin: number,
  chartMax: number,
): React.ReactNode {
  const groups: MetricSeriesInput[] = panel.queries.map((q) => ({
    name: q.legend,
    color: q.color,
    data: results[composeKey(panel.id, q.key)]?.series ?? [],
  }));
  return (
    <MetricTimeSeriesChart
      groups={groups}
      unit={panel.unit}
      height={CHART_HEIGHT}
      chartMin={chartMin}
      chartMax={chartMax}
      yMin={panel.yMin}
      yMax={panel.yMax}
      showLegend={panel.showLegend}
      stack={panel.stack}
    />
  );
}

function renderBarGaugePanel(panel: BarGaugePanelDef, results: Record<string, PromQueryResult>): React.ReactNode {
  const series = results[composeKey(panel.id, panel.query.key)]?.series ?? [];
  return (
    <MetricBarGauge
      series={series}
      unit={panel.unit}
      thresholds={panel.thresholds}
      legendTemplate={panel.legendTemplate}
      maxHeight={BARGAUGE_MAX_HEIGHT}
    />
  );
}

function collectAllQueries(): PromQueryDef[] {
  const list: PromQueryDef[] = [];
  for (const panel of VMS_PANELS) {
    const push = (panelId: string, q: PanelQueryDef) => {
      list.push({ key: composeKey(panelId, q.key), expr: q.expr, legend: q.legend });
    };
    switch (panel.kind) {
      case 'timeseries':
        panel.queries.forEach((q) => push(panel.id, q));
        break;
      case 'bargauge':
        push(panel.id, panel.query);
        break;
    }
  }
  return list;
}

const ALL_QUERIES = collectAllQueries();

const OpsDashboardVmsSection: React.FC<OpsDashboardVmsSectionProps> = ({
  cloudId,
  resolved,
  reloadToken,
}) => {
  const [count, setCount] = React.useState<number>(DEFAULT_COUNT);

  const globalVars = useMemo(
    () => ({
      __rate_interval: resolved.rateInterval,
      __interval: resolved.intervalStr,
      count,
    }),
    [resolved.rateInterval, resolved.intervalStr, count],
  );

  const { results, error: aggregateError } = usePromQueries({
    cloudId,
    queries: ALL_QUERIES,
    start: resolved.start,
    end: resolved.end,
    step: resolved.step,
    globalVars,
    reloadToken,
  });

  const chartMin = resolved.start * 1000;
  const chartMax = resolved.end * 1000;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space size={12} wrap>
        <Typography.Text strong>TopN 数量</Typography.Text>
        <Select<number>
          size="middle"
          style={{ width: 120 }}
          value={count}
          options={COUNT_OPTIONS.map((v) => ({ value: v, label: String(v) }))}
          onChange={(v) => setCount(Number(v))}
        />
      </Space>

      {aggregateError ? (
        <Alert
          type="warning"
          showIcon
          message="部分面板加载失败"
          description={aggregateError}
          style={{ whiteSpace: 'pre-wrap' }}
        />
      ) : null}

      <Row gutter={[16, 16]}>
        {VMS_PANELS.map((panel) => {
          const loading = isPanelLoading(panel, results);
          const error = panelErrorMsg(panel, results);
          const empty = !loading && isPanelEmpty(panel, results);
          let body: React.ReactNode;
          switch (panel.kind) {
            case 'timeseries':
              body = renderTimeSeriesPanel(panel, results, chartMin, chartMax);
              break;
            case 'bargauge':
              body = renderBarGaugePanel(panel, results);
              break;
          }
          return (
            <Col key={panel.id} xs={panel.col.xs} lg={panel.col.lg}>
              <MetricPanelCard
                title={panel.title}
                description={panel.description}
                loading={loading}
                error={error}
                isEmpty={empty}
                height={PANEL_HEIGHT}
                bodyPadding={12}
              >
                {body}
              </MetricPanelCard>
            </Col>
          );
        })}
      </Row>
    </Space>
  );
};

export default OpsDashboardVmsSection;
