/**
 * 运维监控大盘 · 云主机概览
 *
 * 顶部展示集群云主机实例统计（与集群概览 CPU/内存/磁盘卡片同布局）；下方为 Prometheus TopN 面板。
 * - `$count` 模板变量改为 TopN `<Select>`（5 / 10 / 20，默认 10），通过 `expandPromql` 注入到 PromQL。
 * - `bargauge` 类型用 `MetricBarGauge`：按 max 取百分比、按阈值（65% / 90%）离散染色。
 * 面板按计算 / 存储 / 网络分组展示。
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Col, Row, Select, Space, Typography } from 'antd';
import MetricPanelCard from '../components/MetricPanelCard';
import MetricPanelExpandButton from '../components/MetricPanelExpandButton';
import MetricPanelPreviewModal from '../components/MetricPanelPreviewModal';
import MetricTimeSeriesChart, { type MetricSeriesInput } from '../components/MetricTimeSeriesChart';
import MetricBarGauge, { type BarGaugeThresholdStep } from '../components/MetricBarGauge';
import OpsDashboardVmStatusCard from '../components/OpsDashboardVmStatusCard';
import OpsDashboardVmNamespaceCard from '../components/OpsDashboardVmNamespaceCard';
import OpsDashboardVmNodeCard from '../components/OpsDashboardVmNodeCard';
import { MonitoringOverviewLanesProvider, useMonitoringOverviewSlowLane } from '../MonitoringOverviewLanesContext';
import { usePromQueries, type PromQueryDef, type PromQueryResult, resolveChartTimeBoundsMs } from '../hooks/usePromQueries';
import { derivePanelLoadState } from '../lib/panelLoadState';
import { useVmDisplayNameMap } from '../hooks/useVmDisplayNameMap';
import { resolveVmMetricLegendName } from '../lib/vmDisplayNames';
import { parseVMInstancesToStatusCounts } from '../lib/vmInstances';
import type { UnitKind } from '../lib/unit';
import type { ResolvedTimeRange } from '../hooks/useDashboardTimeRange';

export interface OpsDashboardVmsSectionProps {
  cloudId: string;
  resolved: ResolvedTimeRange;
  reloadToken: number;
}

const PANEL_HEIGHT = 340;
const CHART_HEIGHT = 260;
const PREVIEW_CHART_HEIGHT = 480;
const BARGAUGE_MAX_HEIGHT = 260;
const OVERVIEW_CARD_ROW_HEIGHT = 220;
const COUNT_OPTIONS = [5, 10, 20] as const;
const DEFAULT_COUNT = 10;

const OVERVIEW_CARD_COL_FILL_STYLE: React.CSSProperties = {
  display: 'flex',
  minHeight: 0,
  minWidth: 0,
  width: '100%',
  height: OVERVIEW_CARD_ROW_HEIGHT,
};

function VmOverviewSummaryRow({ height = OVERVIEW_CARD_ROW_HEIGHT }: { height?: number }) {
  const slow = useMonitoringOverviewSlowLane();
  const summary = useMemo(
    () => parseVMInstancesToStatusCounts(slow.virtualMachines ?? null, slow.vmInstances ?? null),
    [slow.virtualMachines, slow.vmInstances],
  );
  return (
    <Row gutter={[16, 16]} style={{ width: '100%' }}>
      <Col xs={24} md={8} lg={8} style={OVERVIEW_CARD_COL_FILL_STYLE}>
        <OpsDashboardVmStatusCard summary={summary} loading={slow.loading} height={height} />
      </Col>
      <Col xs={24} md={8} lg={8} style={OVERVIEW_CARD_COL_FILL_STYLE}>
        <OpsDashboardVmNamespaceCard summary={summary} loading={slow.loading} height={height} />
      </Col>
      <Col xs={24} md={8} lg={8} style={OVERVIEW_CARD_COL_FILL_STYLE}>
        <OpsDashboardVmNodeCard summary={summary} loading={slow.loading} height={height} />
      </Col>
    </Row>
  );
}

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

interface VmsPanelGroup {
  id: string;
  title: string;
  panels: VmsPanelDef[];
}

/** 云主机资源监控面板定义（按域分组） */
const VMS_PANEL_GROUPS: VmsPanelGroup[] = [
  {
    id: 'vm-compute',
    title: '计算',
    panels: [
  {
    kind: 'timeseries',
    id: 'vm-cpu-usage',
    title: 'CPU利用率(%)',
    description:
      '按 CPU 占用从高到低展示最繁忙的云主机（数量由上方「TopN 数量」决定）。每条线代表一台虚拟机，数值越高表示该云主机算力占用越多；若长期接近 100%，可能影响虚拟机内应用响应速度。',
    unit: 'percent01',
    yMin: 0,
    stack: true,
    showLegend: true,
    col: { xs: 24, lg: 12 },
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
    title: '内存使用率(%)',
    description:
      '按内存占用从高到低展示最吃内存的云主机（数量由上方「TopN 数量」决定）。每条线代表一台虚拟机，数值为「已用内存 ÷ 分配给该机的可用内存」；越高表示内存越紧，长期接近 100% 时应用可能变慢或出现内存不足风险。',
    unit: 'percent01',
    yMin: 0,
    stack: true,
    showLegend: true,
    col: { xs: 24, lg: 12 },
    queries: [
      {
        key: 'A',
        expr:
          'topk(${count}, ((kubevirt_vmi_memory_available_bytes - kubevirt_vmi_memory_unused_bytes) / kubevirt_vmi_memory_available_bytes))',
        legend: '{{name}}',
      },
    ],
  },
    ],
  },
  {
    id: 'vm-storage',
    title: '存储',
    panels: [
  {
    kind: 'timeseries',
    id: 'vm-storage-read',
    title: '存储读流量',
    description:
      '按磁盘读取速度从高到低展示读取最活跃的云主机（数量由上方「TopN 数量」决定）；每条线代表一台云主机的一块磁盘，数值表示每秒从磁盘读取的数据量；读取突增常见于启动、加载程序或批量读盘等操作。',
    unit: 'bytesRate',
    yMin: 0,
    showLegend: true,
    col: { xs: 24, lg: 12 },
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
    description:
      '按磁盘写入速度从高到低展示写入最活跃的云主机（数量由上方「TopN 数量」决定）。每条线代表一台云主机的一块磁盘，数值表示每秒写入的数据量；写入突增常见于落盘、日志或备份类操作。',
    unit: 'bytesRate',
    yMin: 0,
    showLegend: true,
    col: { xs: 24, lg: 12 },
    queries: [
      {
        key: 'A',
        expr: 'topk(${count}, (irate(kubevirt_vmi_storage_write_traffic_bytes_total[5m])))',
        legend: '{{name}}: {{drive}}',
      },
    ],
  },
  ],
  },
  {
    id: 'network',
    title: '网络',
    panels: [
  {
    kind: 'timeseries',
    id: 'vm-network-receive',
    title: '网络入站速率',
    description: 'TopN VM 的网卡入流量（bit/s）：irate(kubevirt_vmi_network_receive_bytes_total[5m]) × 8',
    unit: 'bitsRate',
    yMin: 0,
    showLegend: true,
    col: { xs: 24, lg: 12 },
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
    col: { xs: 24, lg: 12 },
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
    col: { xs: 24, lg: 12 },
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
    col: { xs: 24, lg: 12 },
    query: {
      key: 'A',
      expr: 'topk(${count}, (delta(kubevirt_vmi_network_transmit_packets_total[2h])))',
      legend: '{{name}}',
    },
  },
    ],
  },
];

const ALL_VMS_PANELS = VMS_PANEL_GROUPS.flatMap((g) => g.panels);

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

function getPanelLoadState(panel: VmsPanelDef, results: Record<string, PromQueryResult>) {
  return derivePanelLoadState(collectPanelResults(panel, results));
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

type VmLegendNameResolver = (
  template: string,
  labels: Record<string, string>,
  fallback: string,
) => string;

function renderTimeSeriesPanel(
  panel: TimeSeriesPanelDef,
  results: Record<string, PromQueryResult>,
  chartMin: number,
  chartMax: number,
  legendNameResolver?: VmLegendNameResolver,
  height: number = CHART_HEIGHT,
  loading = false,
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
      height={height}
      chartMin={chartMin}
      chartMax={chartMax}
      yMin={panel.yMin}
      yMax={panel.yMax}
      showLegend={panel.showLegend}
      stack={panel.stack}
      legendNameResolver={legendNameResolver}
      loading={loading}
    />
  );
}

function renderBarGaugePanel(
  panel: BarGaugePanelDef,
  results: Record<string, PromQueryResult>,
  legendNameResolver?: VmLegendNameResolver,
  maxHeight: number = BARGAUGE_MAX_HEIGHT,
): React.ReactNode {
  const series = results[composeKey(panel.id, panel.query.key)]?.series ?? [];
  return (
    <MetricBarGauge
      series={series}
      unit={panel.unit}
      thresholds={panel.thresholds}
      legendTemplate={panel.legendTemplate}
      maxHeight={maxHeight}
      legendNameResolver={legendNameResolver}
    />
  );
}

function renderVmsPanelBody(
  panel: VmsPanelDef,
  results: Record<string, PromQueryResult>,
  chartMin: number,
  chartMax: number,
  legendNameResolver: VmLegendNameResolver,
  options?: { chartHeight?: number; barGaugeMaxHeight?: number; loading?: boolean },
): React.ReactNode {
  const loading = options?.loading ?? false;
  switch (panel.kind) {
    case 'timeseries':
      return renderTimeSeriesPanel(
        panel,
        results,
        chartMin,
        chartMax,
        legendNameResolver,
        options?.chartHeight,
        loading,
      );
    case 'bargauge':
      return renderBarGaugePanel(
        panel,
        results,
        legendNameResolver,
        options?.barGaugeMaxHeight,
      );
  }
}

function collectAllQueries(): PromQueryDef[] {
  const list: PromQueryDef[] = [];
  for (const panel of ALL_VMS_PANELS) {
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
  const [count, setCount] = useState<number>(DEFAULT_COUNT);
  const [previewPanelId, setPreviewPanelId] = useState<string | null>(null);

  const { nameMap, initialLoading: vmNamesInitialLoading, error: vmNamesError } =
    useVmDisplayNameMap(cloudId, reloadToken);

  const globalVars = useMemo(
    () => ({
      __rate_interval: resolved.rateInterval,
      __interval: resolved.intervalStr,
      count,
    }),
    [resolved.rateInterval, resolved.intervalStr, count],
  );

  const { results, fetchedWindow, error: aggregateError } = usePromQueries({
    cloudId,
    queries: ALL_QUERIES,
    start: resolved.start,
    end: resolved.end,
    step: resolved.step,
    globalVars,
    reloadToken,
  });

  const legendNameResolver = useCallback<VmLegendNameResolver>(
    (template, labels, fallback) => resolveVmMetricLegendName(labels, template, fallback, nameMap),
    [nameMap],
  );

  const { chartMin, chartMax } = resolveChartTimeBoundsMs(resolved, fetchedWindow);

  const previewPanel = useMemo(
    () => (previewPanelId ? ALL_VMS_PANELS.find((p) => p.id === previewPanelId) ?? null : null),
    [previewPanelId],
  );

  const previewLoadState = previewPanel ? getPanelLoadState(previewPanel, results) : null;
  const previewPanelInitialLoading =
    previewLoadState != null && (previewLoadState.initialLoading || vmNamesInitialLoading);
  const previewPanelError = previewPanel ? panelErrorMsg(previewPanel, results) : undefined;
  const previewPanelEmpty =
    previewPanel != null && !previewPanelInitialLoading && isPanelEmpty(previewPanel, results);

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {aggregateError ? (
        <Alert
          type="warning"
          showIcon
          message="部分面板加载失败"
          description={aggregateError}
          style={{ whiteSpace: 'pre-wrap' }}
        />
      ) : null}

      <MonitoringOverviewLanesProvider cloudId={cloudId}>
        <VmOverviewSummaryRow height={OVERVIEW_CARD_ROW_HEIGHT} />
      </MonitoringOverviewLanesProvider>

      <Space size={12} wrap align="center">
        <Typography.Text strong>TopN 数量</Typography.Text>
        <Select<number>
          size="middle"
          style={{ width: 120 }}
          value={count}
          options={COUNT_OPTIONS.map((v) => ({ value: v, label: String(v) }))}
          onChange={(v) => setCount(Number(v))}
        />
      </Space>
      {vmNamesError ? (
        <Alert
          type="info"
          showIcon
          message="云主机名称暂不可用"
          description={`图例将显示云主机 ID。${vmNamesError}`}
        />
      ) : null}
      {VMS_PANEL_GROUPS.map((group) => (
        <div key={group.id}>
          <Typography.Title level={5} style={{ margin: '0 0 8px' }}>
            {group.title}
          </Typography.Title>
          <Row gutter={[16, 16]}>
            {group.panels.map((panel) => {
              const promLoad = getPanelLoadState(panel, results);
              const initialLoading = promLoad.initialLoading || vmNamesInitialLoading;
              const error = panelErrorMsg(panel, results);
              const empty = !initialLoading && isPanelEmpty(panel, results);
              return (
                <Col key={panel.id} xs={panel.col.xs} lg={panel.col.lg}>
                  <MetricPanelCard
                    title={panel.title}
                    description={panel.description}
                    extra={<MetricPanelExpandButton onClick={() => setPreviewPanelId(panel.id)} />}
                    loading={initialLoading}
                    error={error}
                    isEmpty={empty}
                    height={PANEL_HEIGHT}
                    bodyPadding={12}
                  >
                    {renderVmsPanelBody(panel, results, chartMin, chartMax, legendNameResolver, {
                      loading: promLoad.initialLoading,
                    })}
                  </MetricPanelCard>
                </Col>
              );
            })}
          </Row>
        </div>
      ))}
      <MetricPanelPreviewModal
        open={previewPanel != null}
        onClose={() => setPreviewPanelId(null)}
        title={previewPanel?.title}
        description={previewPanel?.description}
        loading={previewPanelInitialLoading}
        error={previewPanelError}
        isEmpty={previewPanelEmpty}
      >
        {previewPanel
          ? renderVmsPanelBody(previewPanel, results, chartMin, chartMax, legendNameResolver, {
              chartHeight: PREVIEW_CHART_HEIGHT,
              barGaugeMaxHeight: PREVIEW_CHART_HEIGHT,
              loading: previewLoadState?.initialLoading ?? false,
            })
          : null}
      </MetricPanelPreviewModal>
    </Space>
  );
};

export default OpsDashboardVmsSection;
