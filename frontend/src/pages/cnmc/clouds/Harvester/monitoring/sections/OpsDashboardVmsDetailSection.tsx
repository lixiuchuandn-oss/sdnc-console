/**
 * 运维监控大盘 · 云主机资源详情视图（对齐 Grafana `Harvester 云主机详情`）。
 * - 参数：namespace、vm（vm 随 namespace 联动）
 * - 面板：CPU Gauge、内存 Gauge、IO 流量、IO 时间、IOPS、网络流量
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Col, Row, Select, Space, Typography } from 'antd';
import MetricPanelCard from '../components/MetricPanelCard';
import MetricPanelExpandButton from '../components/MetricPanelExpandButton';
import MetricPanelPreviewModal from '../components/MetricPanelPreviewModal';
import MetricTimeSeriesChart, { type MetricSeriesInput } from '../components/MetricTimeSeriesChart';
import MetricGauge from '../components/MetricGauge';
import { usePromQueries, type PromQueryDef, type PromQueryResult, resolveChartTimeBoundsMs } from '../hooks/usePromQueries';
import { useVmDisplayNameMap } from '../hooks/useVmDisplayNameMap';
import { derivePanelLoadState } from '../lib/panelLoadState';
import type { UnitKind } from '../lib/unit';
import type { ResolvedTimeRange } from '../hooks/useDashboardTimeRange';
import { fetchMetricRange } from '../../../../../../services/monitoringApi';

export interface OpsDashboardVmsDetailSectionProps {
  cloudId: string;
  resolved: ResolvedTimeRange;
  reloadToken: number;
}

const PANEL_HEIGHT = 320;
const CHART_HEIGHT = 240;
const PREVIEW_CHART_HEIGHT = 480;
const NAMESPACE_QUERY = 'count by (namespace) (kubevirt_vmi_vcpu_seconds_total)';

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

interface GaugePanelDef {
  kind: 'gauge';
  id: string;
  title: string;
  description?: string;
  unit: string;
  min: number;
  max: number;
  thresholds: Array<{ value: number; color: string }>;
  col: { xs: number; lg: number };
  query: PanelQueryDef;
}

type VmsDetailPanelDef = TimeSeriesPanelDef | GaugePanelDef;

/** 云主机详情监控面板（布局与 Grafana 同结构） */
const VM_DETAIL_PANELS: VmsDetailPanelDef[] = [
  {
    kind: 'gauge',
    id: 'vm-cpu-usage-gauge',
    title: 'CPU 使用率',
    description:
      '展示当前云主机 CPU 占用比例；超过 65% 建议关注，超过 90% 建议排查负载并考虑扩容。',
    unit: '%',
    min: 0,
    max: 100,
    thresholds: [
      { value: 0, color: '#52c41a' },
      { value: 65, color: '#EAB839' },
      { value: 90, color: '#f5222d' },
    ],
    col: { xs: 24, lg: 12 },
    query: {
      key: 'A',
      expr:
        'sum(avg(rate(kubevirt_vmi_vcpu_seconds_total{namespace="$namespace", name="$vm"}[5m])) by (domain, name)) / 1000 * 100',
      legend: '',
    },
  },
  {
    kind: 'gauge',
    id: 'vm-memory-usage-gauge',
    title: '内存使用率',
    description:
      '展示当前云主机内存占用比例；超过 65% 建议关注，超过 90% 建议排查内存压力。',
    unit: '%',
    min: 0,
    max: 100,
    thresholds: [
      { value: 0, color: '#52c41a' },
      { value: 65, color: '#EAB839' },
      { value: 90, color: '#f5222d' },
    ],
    col: { xs: 24, lg: 12 },
    query: {
      key: 'A',
      expr:
        'sum((kubevirt_vmi_memory_available_bytes{namespace="$namespace", name="$vm"} - kubevirt_vmi_memory_unused_bytes{namespace="$namespace", name="$vm"}) / kubevirt_vmi_memory_available_bytes{namespace="$namespace", name="$vm"}) * 100',
      legend: '',
    },
  },
  {
    kind: 'timeseries',
    id: 'vm-io-traffic',
    title: 'IO 流量',
    description: '展示当前云主机各磁盘读写流量（字节/秒）。',
    unit: 'bytesRate',
    yMin: 0,
    showLegend: true,
    col: { xs: 24, lg: 8 },
    queries: [
      {
        key: 'A',
        expr: 'irate(kubevirt_vmi_storage_read_traffic_bytes_total{namespace="$namespace", name="$vm"}[5m])',
        legend: '{{drive}}-读',
      },
      {
        key: 'B',
        expr: 'irate(kubevirt_vmi_storage_write_traffic_bytes_total{namespace="$namespace", name="$vm"}[5m])',
        legend: '{{drive}}-写',
      },
    ],
  },
  {
    kind: 'timeseries',
    id: 'vm-io-time',
    title: 'IO 时间',
    description: '展示当前云主机各磁盘读写耗时速率（秒/秒）。',
    unit: 'short',
    yMin: 0,
    showLegend: true,
    col: { xs: 24, lg: 8 },
    queries: [
      {
        key: 'A',
        expr: 'irate(kubevirt_vmi_storage_read_times_seconds_total{namespace="$namespace", name="$vm"}[5m])',
        legend: '{{drive}}-读',
      },
      {
        key: 'B',
        expr: 'irate(kubevirt_vmi_storage_write_times_seconds_total{namespace="$namespace", name="$vm"}[5m])',
        legend: '{{drive}}-写',
      },
    ],
  },
  {
    kind: 'timeseries',
    id: 'vm-iops',
    title: 'IOPS',
    description: '展示当前云主机各磁盘每秒读写 I/O 次数。',
    unit: 'iops',
    yMin: 0,
    showLegend: true,
    col: { xs: 24, lg: 8 },
    queries: [
      {
        key: 'A',
        expr: 'irate(kubevirt_vmi_storage_iops_read_total{namespace="$namespace", name="$vm"}[5m])',
        legend: '{{drive}}-读',
      },
      {
        key: 'B',
        expr: 'irate(kubevirt_vmi_storage_iops_write_total{namespace="$namespace", name="$vm"}[5m])',
        legend: '{{drive}}-写',
      },
    ],
  },
  {
    kind: 'timeseries',
    id: 'vm-network-traffic',
    title: '网络流量',
    description: '展示当前云主机各网卡入站/出站流量（bit/s）。',
    unit: 'bitsRate',
    yMin: 0,
    showLegend: true,
    col: { xs: 24, lg: 24 },
    queries: [
      {
        key: 'A',
        expr: 'irate(kubevirt_vmi_network_receive_bytes_total{namespace="$namespace", name="$vm"}[5m])*8',
        legend: '{{interface}}-入站',
      },
      {
        key: 'B',
        expr: 'irate(kubevirt_vmi_network_transmit_bytes_total{namespace="$namespace", name="$vm"}[5m])*8',
        legend: '{{interface}}-出站',
      },
    ],
  },
];

const VM_DETAIL_QUERIES: PromQueryDef[] = VM_DETAIL_PANELS.flatMap((panel) => {
  if (panel.kind === 'timeseries') {
    return panel.queries.map((q) => ({ key: composeKey(panel.id, q.key), expr: q.expr, legend: q.legend }));
  }
  return [{ key: composeKey(panel.id, panel.query.key), expr: panel.query.expr, legend: panel.query.legend }];
});

function composeKey(panelId: string, queryKey: string): string {
  return `${panelId}__${queryKey}`;
}

function collectPanelResults(
  panel: VmsDetailPanelDef,
  results: Record<string, PromQueryResult>,
): PromQueryResult[] {
  switch (panel.kind) {
    case 'timeseries':
      return panel.queries.map((q) => results[composeKey(panel.id, q.key)]).filter(Boolean) as PromQueryResult[];
    case 'gauge':
      return [results[composeKey(panel.id, panel.query.key)]].filter(Boolean) as PromQueryResult[];
  }
}

function getPanelLoadState(panel: VmsDetailPanelDef, results: Record<string, PromQueryResult>) {
  return derivePanelLoadState(collectPanelResults(panel, results));
}

function panelErrorMsg(panel: VmsDetailPanelDef, results: Record<string, PromQueryResult>): string | undefined {
  const list = collectPanelResults(panel, results);
  if (list.length === 0) return undefined;
  const errs = list.map((r) => r?.error).filter((m): m is string => Boolean(m));
  return errs.length > 0 && errs.length === list.length ? errs.join('\n') : undefined;
}

function isPanelEmpty(panel: VmsDetailPanelDef, results: Record<string, PromQueryResult>): boolean {
  const list = collectPanelResults(panel, results);
  if (list.length === 0) return true;
  return list.every((r) => !r || r.series.length === 0 || r.series.every((s) => s.values.length === 0));
}

function renderTimeSeriesPanel(
  panel: TimeSeriesPanelDef,
  results: Record<string, PromQueryResult>,
  chartMin: number,
  chartMax: number,
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
      loading={loading}
    />
  );
}

function renderGaugePanel(
  panel: GaugePanelDef,
  results: Record<string, PromQueryResult>,
  height: number = CHART_HEIGHT,
  loading = false,
): React.ReactNode {
  const series = results[composeKey(panel.id, panel.query.key)]?.series ?? [];
  return (
    <MetricGauge
      series={series}
      min={panel.min}
      max={panel.max}
      thresholds={panel.thresholds}
      unit={panel.unit}
      height={height}
      loading={loading}
    />
  );
}

function renderVmDetailPanelBody(
  panel: VmsDetailPanelDef,
  results: Record<string, PromQueryResult>,
  chartMin: number,
  chartMax: number,
  options?: { chartHeight?: number; loading?: boolean },
): React.ReactNode {
  const chartHeight = options?.chartHeight ?? CHART_HEIGHT;
  const loading = options?.loading ?? false;
  switch (panel.kind) {
    case 'timeseries':
      return renderTimeSeriesPanel(panel, results, chartMin, chartMax, chartHeight, loading);
    case 'gauge':
      return renderGaugePanel(panel, results, chartHeight, loading);
  }
}

function quotePromqlString(v: string): string {
  return `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function collectLabelValues(result: any[], labelKey: string): string[] {
  const set = new Set<string>();
  result.forEach((item) => {
    const raw = String(item?.metric?.[labelKey] ?? '').trim();
    if (raw) set.add(raw);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

const OpsDashboardVmsDetailSection: React.FC<OpsDashboardVmsDetailSectionProps> = ({
  cloudId,
  resolved,
  reloadToken,
}) => {
  const [namespace, setNamespace] = useState<string>('');
  const [vm, setVm] = useState<string>('');
  const [namespaceOptions, setNamespaceOptions] = useState<string[]>([]);
  const [vmOptions, setVmOptions] = useState<string[]>([]);
  const [namespaceLoading, setNamespaceLoading] = useState<boolean>(false);
  const [vmLoading, setVmLoading] = useState<boolean>(false);
  const [namespaceError, setNamespaceError] = useState<string | undefined>();
  const [vmError, setVmError] = useState<string | undefined>();
  const [previewPanelId, setPreviewPanelId] = useState<string | null>(null);
  const { nameMap: vmDisplayNameMap } = useVmDisplayNameMap(cloudId, reloadToken);
  const namespaceCtrlRef = useRef<AbortController | null>(null);
  const vmCtrlRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!cloudId) return undefined;
    if (namespaceCtrlRef.current) namespaceCtrlRef.current.abort();
    const ctrl = new AbortController();
    namespaceCtrlRef.current = ctrl;
    setNamespaceLoading(true);
    setNamespaceError(undefined);
    const now = Math.floor(Date.now() / 1000);
    void fetchMetricRange(
      cloudId,
      { query: NAMESPACE_QUERY, start: now - 10 * 60, end: now, step: 60 },
      { signal: ctrl.signal },
    ).then((res) => {
      if (ctrl.signal.aborted) return;
      if (res.ok) {
        const items = collectLabelValues(res.data?.data?.result ?? [], 'namespace');
        setNamespaceOptions(items);
        setNamespace((prev) => (prev && items.includes(prev) ? prev : items[0] ?? ''));
      } else {
        setNamespaceOptions([]);
        setNamespace('');
        setNamespaceError(res.error ?? '加载项目失败');
      }
      setNamespaceLoading(false);
    });
    return () => ctrl.abort();
  }, [cloudId, reloadToken]);

  useEffect(() => {
    if (!cloudId || !namespace) {
      if (vmCtrlRef.current) vmCtrlRef.current.abort();
      setVmOptions([]);
      setVm('');
      setVmLoading(false);
      setVmError(undefined);
      return;
    }
    if (vmCtrlRef.current) vmCtrlRef.current.abort();
    const ctrl = new AbortController();
    vmCtrlRef.current = ctrl;
    setVmLoading(true);
    setVmError(undefined);
    const now = Math.floor(Date.now() / 1000);
    const query =
      `count by (name) (kubevirt_vmi_vcpu_seconds_total{namespace=${quotePromqlString(namespace)}})`;
    void fetchMetricRange(
      cloudId,
      { query, start: now - 10 * 60, end: now, step: 60 },
      { signal: ctrl.signal },
    ).then((res) => {
      if (ctrl.signal.aborted) return;
      if (res.ok) {
        const items = collectLabelValues(res.data?.data?.result ?? [], 'name');
        setVmOptions(items);
        setVm((prev) => (prev && items.includes(prev) ? prev : items[0] ?? ''));
      } else {
        setVmOptions([]);
        setVm('');
        setVmError(res.error ?? '加载云主机列表失败');
      }
      setVmLoading(false);
    });
    return () => ctrl.abort();
  }, [cloudId, namespace, reloadToken]);

  const globalVars = useMemo(
    () => ({
      __rate_interval: resolved.rateInterval,
      __interval: resolved.intervalStr,
      namespace,
      vm,
    }),
    [resolved.rateInterval, resolved.intervalStr, namespace, vm],
  );

  const effectiveQueries = useMemo(
    () => (namespace && vm ? VM_DETAIL_QUERIES : []),
    [namespace, vm],
  );

  const { results, fetchedWindow, error: aggregateError } = usePromQueries({
    cloudId,
    queries: effectiveQueries,
    start: resolved.start,
    end: resolved.end,
    step: resolved.step,
    globalVars,
    reloadToken,
  });

  const namespaceSelectOptions = useMemo(
    () => namespaceOptions.map((item) => ({ label: item, value: item })),
    [namespaceOptions],
  );
  const vmSelectOptions = useMemo(
    () =>
      vmOptions.map((item) => {
        const displayName = vmDisplayNameMap[item] || item;
        return {
          label: `${displayName} (${item})`,  
          value: item,
        };
      }),
    [vmOptions, vmDisplayNameMap],
  );

  const { chartMin, chartMax } = resolveChartTimeBoundsMs(resolved, fetchedWindow);
  const previewPanel = useMemo(
    () => (previewPanelId ? VM_DETAIL_PANELS.find((panel) => panel.id === previewPanelId) ?? null : null),
    [previewPanelId],
  );
  const previewLoadState = previewPanel ? getPanelLoadState(previewPanel, results) : null;
  
  const previewPanelInitialLoading = previewLoadState?.initialLoading ?? false;
  const previewPanelError = previewPanel ? panelErrorMsg(previewPanel, results) : undefined;
  const previewPanelEmpty =
    previewPanel != null && !previewPanelInitialLoading && isPanelEmpty(previewPanel, results);

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space size={12} wrap>
        <Typography.Text strong>项目</Typography.Text>
        <Select<string>
          size="middle"
          showSearch
          style={{ minWidth: 220 }}
          value={namespace || undefined}
          options={namespaceSelectOptions}
          onChange={(v) => setNamespace(String(v ?? ''))}
          placeholder={namespaceLoading ? '加载项目中…' : '选择项目'}
          loading={namespaceLoading}
          disabled={namespaceLoading}
          optionFilterProp="label"
        />
        <Typography.Text strong>云主机</Typography.Text>
        <Select<string>
          size="middle"
          showSearch
          style={{ minWidth: 280 }}
          value={vm || undefined}
          options={vmSelectOptions}
          onChange={(v) => setVm(String(v ?? ''))}
          placeholder={vmLoading ? '加载云主机中…' : '选择云主机'}
          loading={vmLoading}
          disabled={vmLoading || !namespace}
          optionFilterProp="label"
        />
      </Space>
      {namespaceError ? (
        <Alert
          type="warning"
          showIcon
          message="项目列表加载失败"
          description={namespaceError}
          style={{ whiteSpace: 'pre-wrap' }}
        />
      ) : null}
      {vmError ? (
        <Alert
          type="warning"
          showIcon
          message="云主机列表加载失败"
          description={vmError}
          style={{ whiteSpace: 'pre-wrap' }}
        />
      ) : null}
      {aggregateError ? (
        <Alert
          type="warning"
          showIcon
          message="部分面板加载失败"
          description={aggregateError}
          style={{ whiteSpace: 'pre-wrap' }}
        />
      ) : null}
      {!namespace || !vm ? (
        <Alert type="info" showIcon message="请选择项目与云主机后查看资源详情" />
      ) : (
        <Row gutter={[16, 16]}>
          {VM_DETAIL_PANELS.map((panel) => {
            const promLoad = getPanelLoadState(panel, results);
            const initialLoading = promLoad.initialLoading;
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
                  {renderVmDetailPanelBody(panel, results, chartMin, chartMax, {
                    loading: initialLoading,
                  })}
                </MetricPanelCard>
              </Col>
            );
          })}
        </Row>
      )}
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
          ? renderVmDetailPanelBody(previewPanel, results, chartMin, chartMax, {
              chartHeight: PREVIEW_CHART_HEIGHT,
              loading: previewPanelInitialLoading,
            })
          : null}
      </MetricPanelPreviewModal>
    </Space>
  );
};

export default OpsDashboardVmsDetailSection;
